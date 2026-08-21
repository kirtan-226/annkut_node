'use strict';

const config = require('../config/env');
const { many } = require('./query');

/**
 * Replacement for CI's $this->db->table_exists() / field_exists().
 *
 * Login_model and Receipt_book_model branch on live schema shape to support
 * legacy tables (`annkut_sevak`, `form_details`) and optional columns
 * (`receipt_books.last_used_no`, `receipts.collector_sevak_code`). Dropping
 * those branches would change behaviour on any database that still has the old
 * layout, so the checks are preserved.
 *
 * CI re-queried metadata per request. Here the whole column map is read once
 * per Lambda execution environment and reused, turning what was N metadata
 * round-trips per request into zero on warm invocations.
 *
 * Consequence worth knowing: a schema change requires new execution
 * environments before it is observed. Deploying a new function version does
 * that, and these particular branches only matter during the legacy-schema
 * transition, so the trade is safe.
 */

let cache = null;
let inflight = null;

async function load() {
  const rows = await many(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?`,
    [config.db.database]
  );

  const map = new Map();
  for (const row of rows) {
    const table = String(row.t).toLowerCase();
    if (!map.has(table)) map.set(table, new Set());
    map.get(table).add(String(row.c).toLowerCase());
  }
  return map;
}

async function getSchema() {
  if (cache) return cache;
  // Collapse concurrent first-callers onto a single metadata query.
  if (!inflight) {
    inflight = load()
      .then((map) => {
        cache = map;
        return map;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function tableExists(table) {
  const schema = await getSchema();
  return schema.has(String(table).toLowerCase());
}

async function fieldExists(column, table) {
  const schema = await getSchema();
  const cols = schema.get(String(table).toLowerCase());
  return Boolean(cols && cols.has(String(column).toLowerCase()));
}

/** Test hook / forced refresh after a migration. */
function resetSchemaCache() {
  cache = null;
  inflight = null;
}

module.exports = { tableExists, fieldExists, getSchema, resetSchemaCache };
