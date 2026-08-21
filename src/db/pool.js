'use strict';

const mysql = require('mysql2/promise');
const config = require('../config/env');
const { getCredentials } = require('./credentials');

/**
 * Module-scope pool.
 *
 * On Lambda this survives across warm invocations of the same execution
 * environment, so a container pays the TCP + TLS + auth handshake once rather
 * than per request. Cold starts still pay it, which is why DB_POOL_SIZE is
 * small and RDS Proxy is recommended in front of RDS (see docs/DEPLOY.md).
 */
let poolPromise = null;

/**
 * The *promise* is cached, not the pool. Lambda can hand a cold container
 * several concurrent requests before the first one finishes connecting; caching
 * the resolved value instead would let each of them build its own pool and
 * quietly multiply the connection count against RDS.
 */
async function getPool() {
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    // Credentials may come from Secrets Manager, so this is async.
    const { user, password } = await getCredentials();

    return mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user,
      password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      maxIdle: config.db.connectionLimit,
      connectTimeout: config.db.connectTimeout,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      // The PHP app connected with utf8/utf8_general_ci but the export queries
      // forced `SET NAMES utf8mb4`. utf8mb4 is the superset and the only way
      // Gujarati text and emoji round-trip intact, so it is the default here.
      charset: 'utf8mb4',
      // CI returned every column as a PHP string and the controllers cast with
      // (int)/(float) at the point of use. Keeping DECIMAL/BIGINT as strings
      // matches that and avoids silent float precision loss on seva_amount.
      decimalNumbers: false,
      dateStrings: true,
      timezone: 'Z',
      ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined,
    });
  })();

  // Don't cache a failed connect: a transient Secrets Manager or RDS failover
  // error on a cold start would otherwise break the container permanently.
  poolPromise.catch(() => {
    poolPromise = null;
  });

  return poolPromise;
}

async function closePool() {
  if (!poolPromise) return;
  const p = poolPromise;
  poolPromise = null;
  await (await p).end();
}

module.exports = { getPool, closePool };
