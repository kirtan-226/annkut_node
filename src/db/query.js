'use strict';

const { getPool } = require('./pool');

/**
 * Thin query helpers that mirror the CodeIgniter result API the models were
 * written against:
 *
 *   CI                        here
 *   ------------------------  ---------------------------
 *   ->get()->row_array()      one()    -> object | null
 *   ->get()->result_array()   many()   -> object[]
 *   ->insert() / ->update()   exec()   -> { affectedRows, insertId }
 *   ->count_all_results()     scalar() -> first column of first row
 *
 * Every call takes a parameterised statement. The PHP code leaned on CI's
 * query builder for escaping and, in a few places (Mandal_model's derived-table
 * joins), interpolated values straight into SQL. Those are all bound here.
 */

/**
 * An executor is anything with mysql2's .query(sql, params) -- pool or
 * connection. Async because getPool() may have to fetch credentials from
 * Secrets Manager on the first call.
 */
async function executorFor(conn) {
  return conn || getPool();
}

async function many(sql, params = [], conn = null) {
  const executor = await executorFor(conn);
  const [rows] = await executor.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function one(sql, params = [], conn = null) {
  const rows = await many(sql, params, conn);
  return rows.length ? rows[0] : null;
}

async function scalar(sql, params = [], conn = null) {
  const row = await one(sql, params, conn);
  if (!row) return null;
  const keys = Object.keys(row);
  return keys.length ? row[keys[0]] : null;
}

async function exec(sql, params = [], conn = null) {
  const executor = await executorFor(conn);
  const [result] = await executor.query(sql, params);
  return {
    affectedRows: result.affectedRows ?? 0,
    // MySQL reports affectedRows=2 for an UPDATE that ran as part of an upsert
    // and changedRows for rows whose values actually differed. CI's
    // affected_rows() maps to affectedRows.
    changedRows: result.changedRows ?? 0,
    insertId: result.insertId ?? 0,
  };
}

/**
 * Runs fn inside a transaction on a dedicated connection.
 *
 * Replaces CI's $this->db->trans_begin() / trans_status() / trans_commit().
 * Any throw rolls back; the connection is always returned to the pool.
 */
async function withTransaction(fn) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // A rollback failure means the connection is already unusable; the
      // original error is the one worth surfacing.
    }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { many, one, scalar, exec, withTransaction };
