'use strict';

const config = require('../config/env');

/**
 * Resolves the database username/password.
 *
 * Two sources, in priority order:
 *
 *   1. DB_SECRET_ARN  -- a Secrets Manager secret holding
 *                        {"username": "...", "password": "..."}. This is what
 *                        template.yaml wires up, and it is how production runs:
 *                        the credentials never appear in the function's
 *                        environment, so they cannot leak via the console, a
 *                        stack export, or a CloudTrail GetFunction call.
 *   2. DB_USER / DB_PASSWORD -- plain env vars, for local development and for
 *                        anyone running this on EC2/ECS without Secrets Manager.
 *
 * The lookup is async, which is why getPool() is async. It happens once per
 * execution environment: the resolved promise is cached at module scope, so
 * warm Lambda invocations never re-call Secrets Manager. Caching the *promise*
 * rather than the value also collapses the concurrent-first-request case into a
 * single API call.
 */
let cached = null;

/**
 * An RDS-managed secret stores the password under `password` and the user under
 * `username`. Some hand-rolled secrets use `user`, so both are accepted.
 */
function parseSecret(payload, arn) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(
      `Secret ${arn} is not valid JSON. Expected {"username":"...","password":"..."}.`
    );
  }

  const user = parsed.username ?? parsed.user;
  const password = parsed.password;

  if (!user || password === undefined) {
    throw new Error(
      `Secret ${arn} is missing "username" and/or "password". ` +
        'RDS-managed secrets already use these key names.'
    );
  }

  return { user, password: String(password) };
}

async function fetchFromSecretsManager(arn) {
  // Required lazily so that local development -- which never sets
  // DB_SECRET_ARN -- does not pay the SDK's load time on every boot.
  const {
    SecretsManagerClient,
    GetSecretValueCommand,
  } = require('@aws-sdk/client-secrets-manager');

  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: arn }));

  const payload =
    result.SecretString ??
    (result.SecretBinary
      ? Buffer.from(result.SecretBinary).toString('utf8')
      : null);

  if (!payload) {
    throw new Error(`Secret ${arn} has no value.`);
  }

  return parseSecret(payload, arn);
}

function getCredentials() {
  if (cached) return cached;

  cached = (async () => {
    if (config.db.secretArn) {
      return fetchFromSecretsManager(config.db.secretArn);
    }

    if (!config.db.user || config.db.password === undefined) {
      throw new Error(
        'No database credentials. Set DB_SECRET_ARN, or set DB_USER and ' +
          'DB_PASSWORD. See .env.example.'
      );
    }

    return { user: config.db.user, password: config.db.password };
  })();

  // A failed lookup must not be cached forever -- a transient Secrets Manager
  // error on a cold start would otherwise poison the whole execution
  // environment until Lambda recycled it.
  cached.catch(() => {
    cached = null;
  });

  return cached;
}

module.exports = { getCredentials };
