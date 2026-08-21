'use strict';

const { many } = require('../db/query');
const { toInt } = require('../utils/php');

/**
 * Port of application/models/Import_karyakar_model.php (class Report_export_model)
 * and the inline SQL in application/controllers/Import_karyakar.php.
 *
 * The controller and the model held two slightly different versions of the same
 * two queries. The model's versions are used here because they are the more
 * careful pair: they scope the receipts join by mandal as well as collector,
 * and they filter status/deleted_at inside the SUM(CASE ...) so a sevak with no
 * receipts still returns a row with zeroes rather than being dropped.
 */

/** Format 1: one summary row per sevak. */
async function getFormat1(year, filters = {}) {
  const where = [];
  const params = [toInt(year)];

  if (filters.xetra_id) {
    where.push('xe.id = ?');
    params.push(toInt(filters.xetra_id));
  }
  if (filters.mandal_id) {
    where.push('m.id = ?');
    params.push(toInt(filters.mandal_id));
  }
  if (filters.sevak_id) {
    where.push('u.id = ?');
    params.push(toInt(filters.sevak_id));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return many(
    `SELECT xe.name        AS kshetra,
            m.name         AS mandal,
            u.sevak_code   AS sevak_id,
            u.name         AS sevak_name,
            u.phone_number AS sevak_phone,
            COALESCE(st.target_forms, 0) AS target,
            COALESCE(SUM(CASE
              WHEN r.status = 'recorded' AND r.deleted_at IS NULL
              THEN 1 ELSE 0 END), 0) AS form_filled,
            COALESCE(SUM(CASE
              WHEN r.status = 'recorded' AND r.deleted_at IS NULL AND r.seva_amount = 500
              THEN 1 ELSE 0 END), 0) AS rs500_seva,
            COALESCE(SUM(CASE
              WHEN r.status = 'recorded' AND r.deleted_at IS NULL AND r.seva_amount = 1000
              THEN 1 ELSE 0 END), 0) AS rs1000_seva,
            COALESCE(SUM(CASE
              WHEN r.status = 'recorded' AND r.deleted_at IS NULL
                   AND r.seva_amount NOT IN (500, 1000)
              THEN 1 ELSE 0 END), 0) AS other_seva
       FROM users u
       JOIN user_mandal_memberships umm ON umm.user_id = u.id AND umm.is_primary = 1
       JOIN mandals m ON m.id = umm.mandal_id
       JOIN xetra xe  ON xe.id = m.xetra_id
       LEFT JOIN sevak_targets st ON st.user_id = u.id AND st.year = ?
       LEFT JOIN receipts r ON r.collected_by_id = u.id AND r.mandal_id = m.id
       ${whereSql}
      GROUP BY xe.name, m.name, u.sevak_code, u.name, u.phone_number, st.target_forms
      ORDER BY xe.name, m.name, u.name`,
    params
  );
}

/** Format 2: one row per recorded receipt. */
async function getFormat2(filters = {}) {
  const where = ["r.status = 'recorded'", 'r.deleted_at IS NULL'];
  const params = [];

  if (filters.xetra_id) {
    where.push('xe.id = ?');
    params.push(toInt(filters.xetra_id));
  }
  if (filters.mandal_id) {
    where.push('m.id = ?');
    params.push(toInt(filters.mandal_id));
  }
  if (filters.sevak_id) {
    where.push('u.id = ?');
    params.push(toInt(filters.sevak_id));
  }
  if (filters.from) {
    where.push('r.collected_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('r.collected_at < ?');
    params.push(filters.to);
  }

  return many(
    `SELECT xe.name        AS kshetra,
            m.name         AS mandal,
            u.sevak_code   AS sevak_id,
            u.name         AS sevak_name,
            u.phone_number AS sevak_phone,
            CAST(COALESCE(r.sahyogi_name, s.name) AS CHAR CHARACTER SET utf8mb4)
              AS sahyogi_name,
            CAST(COALESCE(r.sahyogi_number, s.phone) AS CHAR CHARACTER SET utf8mb4)
              AS sahyogi_number,
            rb.book_no     AS book_no_printed,
            r.receipt_no   AS receipt_no,
            r.seva_amount  AS amount,
            r.collected_at AS collected_at
       FROM receipts r
       JOIN users u ON u.id = r.collected_by_id
       JOIN user_mandal_memberships umm ON umm.user_id = u.id AND umm.is_primary = 1
       JOIN mandals m ON m.id = umm.mandal_id
       JOIN xetra xe  ON xe.id = m.xetra_id
       JOIN receipt_books rb ON rb.id = r.book_no
       LEFT JOIN sahyogi s ON s.id = r.sahyogi_id
      WHERE ${where.join(' AND ')}
      ORDER BY xe.name, m.name, u.name, rb.book_no, r.receipt_no`,
    params
  );
}

module.exports = { getFormat1, getFormat2 };
