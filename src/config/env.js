'use strict';

/**
 * Centralised environment configuration.
 *
 * Nothing in this project reads process.env directly outside this file, so the
 * full set of knobs is always discoverable in one place. No credentials are
 * baked into source -- the PHP app hard-coded them in application/config/
 * database.php, which is exactly what we are moving away from.
 */

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'See .env.example for the full list.'
    );
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

/**
 * The PHP app never called date_default_timezone_set(), so date('Y') resolved
 * against the server's default timezone. Every "current year" target lookup
 * (sevak_targets.year, mandal_targets.year) depends on it, so it is made
 * explicit here rather than inherited from whatever the runtime happens to be.
 * Lambda always runs UTC unless told otherwise.
 */
const timezone = optional('APP_TIMEZONE', 'UTC');

const config = {
  env: optional('NODE_ENV', 'development'),
  port: toInt(optional('PORT', '3001'), 3001),
  timezone,

  db: {
    host: required('DB_HOST'),
    port: toInt(optional('DB_PORT', '3306'), 3306),
    /**
     * Credentials are resolved at connect time by db/credentials.js, not here,
     * because the Secrets Manager lookup is async. Exactly one of these must be
     * supplied: DB_SECRET_ARN (production, set by template.yaml) or the
     * DB_USER/DB_PASSWORD pair (local development). Validating the choice is
     * left to getCredentials() so that the error names both options.
     */
    secretArn: optional('DB_SECRET_ARN', ''),
    user: optional('DB_USER', ''),
    password: process.env.DB_PASSWORD,
    database: required('DB_NAME'),
    // Lambda gets a tiny pool: each concurrent execution environment holds its
    // own pool, so a large limit here multiplies straight into RDS connections.
    connectionLimit: toInt(optional('DB_POOL_SIZE', '2'), 2),
    connectTimeout: toInt(optional('DB_CONNECT_TIMEOUT_MS', '10000'), 10000),
    // RDS requires TLS in transit for anything crossing a subnet boundary.
    ssl: toBool(optional('DB_SSL', 'false'), false),
  },

  /**
   * Origins allowed to call the API with credentials.
   *
   * The PHP controllers were inconsistent: Login.php used this exact allowlist,
   * while Seva/Sevak/ReceiptBooks reflected *any* Origin back with
   * Allow-Credentials: true. This port applies the allowlist everywhere, which
   * keeps the real frontend working while closing the reflection hole.
   */
  corsAllowedOrigins: optional(
    'CORS_ALLOWED_ORIGINS',
    'https://master.d3lfyncl45ukvr.amplifyapp.com,http://localhost:3000'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Mirrors CI's db_debug: surface SQL errors in non-production only.
  exposeErrors: toBool(optional('EXPOSE_ERRORS', 'false'), false),
};

module.exports = config;
