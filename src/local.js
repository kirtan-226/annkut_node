'use strict';

/**
 * Local development server.
 *
 * Loads .env if present, then serves the same Express app the Lambda handler
 * wraps -- so what runs here is what runs in production, minus API Gateway.
 */

const fs = require('fs');
const path = require('path');

// Minimal .env loader: avoids a dependency that would otherwise ship to Lambda,
// where configuration comes from the function's environment instead.
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

const config = require('./config/env');
const createApp = require('./app');
const { closePool } = require('./db/pool');

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`annkut-backend-node listening on http://localhost:${config.port}`);
  const dbUser = config.db.secretArn ? '<secrets-manager>' : config.db.user || '<unset>';
  console.log(`  db       ${dbUser}@${config.db.host}:${config.db.port}/${config.db.database}`);
  console.log(`  timezone ${config.timezone}`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down`);
  server.close();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
