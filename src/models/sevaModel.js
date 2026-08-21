'use strict';

const { one, many, exec } = require('../db/query');
const { toInt, toFloat, toStr } = require('../utils/php');
const { mysqlDate, mysqlDateTime } = require('../utils/dates');

/** Port of application/models/Seva_model.php */

async function userByCode(sevakCode) {
  return one(
    `SELECT * FROM users WHERE sevak_code = ? AND deleted_at IS NULL LIMIT 1`,
    [sevakCode]
  );
}

async function primaryMandalId(userId) {
  const row = await one(
    `SELECT mandal_id FROM user_mandal_memberships
      WHERE user_id = ? AND is_primary = 1`,
    [userId]
  );
  return row?.mandal_id ?? null;
}

/**
 * Finds the receipt_books row for (mandal, printed book_no), creating a stub
 * when absent. Returns receipt_books.id -- note that receipts.book_no is a FK
 * to this id, not the printed book number, which is a recurring source of
 * confusion in the original code.
 */
async function ensureBook(mandalId, bookNo, issuedToUserId = null) {
  const row = await one(
    `SELECT id FROM receipt_books WHERE mandal_id = ? AND book_no = ?`,
    [mandalId, toStr(bookNo)]
  );
  if (row) return row.id;

  const inserted = await exec(
    `INSERT INTO receipt_books (mandal_id, issued_to_user_id, book_no, start_no, end_no, issued_on)
     VALUES (?, ?, ?, 0, 0, ?)`,
    [mandalId, issuedToUserId, toStr(bookNo), mysqlDate()]
  );
  return inserted.insertId;
}

async function addSeva(data = {}) {
  const user = await userByCode(data.sevak_id);
  if (!user) return false;

  const mandalId = await primaryMandalId(user.id);
  if (!mandalId) return false;

  const bookId = await ensureBook(mandalId, data.book_no ?? '', user.id);

  let sahyogiId = null;
  if (data.sahyogi_number) {
    const found = await one(`SELECT id FROM sahyogi WHERE phone = ?`, [
      data.sahyogi_number,
    ]);
    if (found) {
      sahyogiId = toInt(found.id);
    } else {
      const inserted = await exec(
        `INSERT INTO sahyogi (name, phone) VALUES (?, ?)`,
        [data.sahyogi_name ?? null, data.sahyogi_number ?? null]
      );
      sahyogiId = inserted.insertId;
    }
  }

  const receipt = {
    mandal_id: mandalId,
    book_no: bookId,
    receipt_no: toInt(data.receipt_no),
    sahyogi_id: sahyogiId,
    sahyogi_name: data.sahyogi_name ?? null,
    sahyogi_number: data.sahyogi_number ?? null,
    prasad_type:
      (data.prasad_detail ?? '') === 'sahyogi_pote' ? 'sahyogi_pote' : 'annkut_sevak',
    seva_amount: toFloat(data.seva_amount),
    payment_method: 'cash',
    collected_by_id: user.id,
    collected_at: mysqlDateTime(),
    status: 'recorded',
  };

  const columns = Object.keys(receipt);
  await exec(
    `INSERT INTO receipts (${columns.map((c) => `\`${c}\``).join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((c) => receipt[c])
  );

  // Advance the book's high-water mark without ever moving it backwards.
  await exec(
    `UPDATE receipt_books
        SET last_used_no = GREATEST(COALESCE(last_used_no, 0), ?)
      WHERE id = ?`,
    [toInt(data.receipt_no), toInt(bookId)]
  );

  return true;
}

async function deleteSeva(sevaId) {
  const result = await exec(
    `UPDATE receipts SET deleted_at = NOW() WHERE id = ?`,
    [sevaId]
  );
  return result.affectedRows > 0;
}

async function editSeva(data = {}) {
  const update = {};
  if (data.seva_amount !== undefined) update.seva_amount = toFloat(data.seva_amount);
  if (data.prasad_detail !== undefined) {
    update.prasad_type =
      data.prasad_detail === 'sahyogi_pote' ? 'sahyogi_pote' : 'annkut_sevak';
  }
  if (data.sahyogi_name !== undefined) update.sahyogi_name = data.sahyogi_name;
  if (data.sahyogi_number !== undefined) update.sahyogi_number = data.sahyogi_number;
  if (data.book_no !== undefined) update.book_no = data.book_no;
  if (data.receipt_no !== undefined) update.receipt_no = data.receipt_no;

  if (Object.keys(update).length === 0) return true;

  const columns = Object.keys(update);
  const result = await exec(
    `UPDATE receipts SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
    [...columns.map((c) => update[c]), data.id]
  );
  // PHP tested affected_rows() >= 0, which is always true.
  return result.affectedRows >= 0;
}

/** Receipts collected by a sevak, with the printed book number attached. */
async function getSeva(sevakCode) {
  return many(
    `SELECT r.*, rb.book_no AS book_number
       FROM receipts r
       INNER JOIN users u ON u.id = r.collected_by_id
       LEFT JOIN receipt_books rb ON rb.id = r.book_no
      WHERE u.sevak_code = ? AND r.deleted_at IS NULL`,
    [sevakCode]
  );
}

/** Duplicate guard: same printed book + receipt number for the same sevak. */
async function checkSeva(data = {}) {
  return one(
    `SELECT r.id
       FROM receipts r
       JOIN receipt_books b ON b.id = r.book_no
       JOIN users u ON u.id = b.issued_to_user_id
      WHERE b.book_no = ? AND r.receipt_no = ? AND u.sevak_code = ?
      LIMIT 1`,
    [toStr(data.book_no), toInt(data.receipt_no), toStr(data.sevak_id)]
  );
}

async function getSevaDetails(id) {
  return one(
    `SELECT r.*, rb.book_no AS book_number
       FROM receipts r
       LEFT JOIN receipt_books rb ON rb.id = r.book_no
      WHERE r.id = ?`,
    [id]
  );
}

async function getSevakMandal(sevakCode) {
  return one(
    `SELECT m.name AS mandal
       FROM users u
       LEFT JOIN user_mandal_memberships umm
              ON umm.user_id = u.id AND umm.is_primary = 1
       LEFT JOIN mandals m ON m.id = umm.mandal_id
      WHERE u.sevak_code = ?`,
    [sevakCode]
  );
}

/** Receipt rows scoped to a mandal name -- used by the dashboard aggregates. */
async function getReceiptsByMandalName(mandalName) {
  return many(
    `SELECT r.prasad_type, r.seva_amount
       FROM receipts r
       JOIN mandals m ON m.id = r.mandal_id
      WHERE m.name = ? AND r.deleted_at IS NULL`,
    [mandalName]
  );
}

/** COUNT of receipts for a mandal name. */
async function countReceiptsByMandalName(mandalName) {
  const row = await one(
    `SELECT COUNT(r.id) AS c
       FROM receipts r
       JOIN mandals m ON m.id = r.mandal_id
      WHERE m.name = ? AND r.deleted_at IS NULL`,
    [mandalName]
  );
  return toInt(row?.c);
}

module.exports = {
  addSeva,
  deleteSeva,
  editSeva,
  getSeva,
  checkSeva,
  getSevaDetails,
  getSevakMandal,
  getReceiptsByMandalName,
  countReceiptsByMandalName,
};
