'use strict';

/**
 * Smoke test: boots the real Express app in-process and exercises it over a
 * loopback socket.
 *
 * Two modes, chosen by whether a database is reachable:
 *
 *   - Always: every module loads, every route table builds, and the routes that
 *     need no database answer correctly. This catches the class of bug that
 *     only shows up as a 502 on a cold Lambda -- a bad require, a syntax error
 *     in a rarely-touched model, a route mounted at the wrong path.
 *   - With DB_SMOKE_DB=1: additionally opens a connection and runs SELECT 1,
 *     verifying credentials, network path, and TLS.
 *
 * Run: npm run smoke
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

// Same .env loading as local.js, so smoke and dev see identical configuration.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// config/env.js requires DB_HOST and DB_NAME even when no query will run. Supply
// placeholders so the no-database mode works on a bare checkout.
process.env.DB_HOST = process.env.DB_HOST || 'smoke.invalid';
process.env.DB_NAME = process.env.DB_NAME || 'smoke';

let failures = 0;
let checks = 0;

function check(name, ok, detail) {
  checks += 1;
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function request(server, method, urlPath, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: {
          'content-type': 'application/json',
          ...(payload ? { 'content-length': payload.length } : {}),
          origin: 'http://localhost:3000',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('annkut-backend-node smoke test\n');

  console.log('module load');
  const createApp = require('../src/app');
  check('src/app.js and its full require graph load', true);
  // Loading the Lambda entry point separately: it pulls in serverless-http and
  // is the module production actually starts from.
  require('../src/lambda');
  check('src/lambda.js loads', true);

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    console.log('\nroutes that need no database');

    const health = await request(server, 'GET', '/health');
    check(
      'GET /health -> 200 {status:true}',
      health.status === 200 && JSON.parse(health.text).status === true,
      `got ${health.status} ${health.text}`
    );

    const root = await request(server, 'GET', '/');
    check('GET / -> 200', root.status === 200, `got ${root.status}`);

    const missing = await request(server, 'GET', '/no/such/route');
    check(
      'unknown path -> 404 JSON',
      missing.status === 404,
      `got ${missing.status}`
    );

    console.log('\nCORS');

    const preflight = await request(server, 'OPTIONS', '/login/login');
    check(
      'preflight from an allowed origin is permitted',
      preflight.headers['access-control-allow-origin'] === 'http://localhost:3000',
      `allow-origin was ${preflight.headers['access-control-allow-origin']}`
    );

    console.log('\nrouting: every controller is mounted');

    // A request with an empty body. The point is not the business outcome but
    // that the path resolves to a handler rather than falling through to 404 --
    // i.e. the router is wired. Anything except 404 proves that.
    const mounted = [
      ['/login/login', 'Login::login'],
      ['/login/forgot_password', 'Login::forgot_password'],
      ['/sevak/get_sevak', 'Sevak::get_sevak'],
      ['/sevak/get_mandal_list', 'Sevak::get_mandal_list'],
      ['/seva/get_seva', 'Seva::get_seva'],
      ['/seva/get_seva_count', 'Seva::get_seva_count'],
      ['/receiptbooks/list', 'ReceiptBooks::list'],
      ['/receiptbooks/my_books', 'ReceiptBooks::my_books'],
      ['/import_karyakar/annkut', 'Import_karyakar::annkut'],
    ];

    for (const [urlPath, label] of mounted) {
      const res = await request(server, 'POST', urlPath, {});
      check(`${label} is mounted`, res.status !== 404, `got 404 for ${urlPath}`);
    }

    // CodeIgniter matched controller names case-insensitively; the frontend
    // calls a mix of /Login/login and /login/login.
    const mixedCase = await request(server, 'POST', '/ReceiptBooks/list', {});
    check(
      'mixed-case paths still resolve',
      mixedCase.status !== 404,
      `got ${mixedCase.status}`
    );

    if (process.env.DB_SMOKE_DB === '1') {
      console.log('\ndatabase');
      const { scalar } = require('../src/db/query');
      const { closePool } = require('../src/db/pool');
      try {
        const value = await scalar('SELECT 1 AS ok');
        check('SELECT 1 succeeds', Number(value) === 1, `got ${value}`);
      } catch (err) {
        check('SELECT 1 succeeds', false, err.message);
      }
      await closePool();
    } else {
      console.log('\ndatabase');
      console.log('  skip  set DB_SMOKE_DB=1 with real credentials to test');
    }
  } finally {
    server.close();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\nsmoke test crashed:', err);
  process.exitCode = 1;
});
