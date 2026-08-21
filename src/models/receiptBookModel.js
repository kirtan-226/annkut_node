'use strict';

const { one, many, exec } = require('../db/query');
const { fieldExists } = require('../db/introspect');
const { toInt } = require('../utils/php');
const { mysqlDateTime } = require('../utils/dates');

/** Port of application/models/Receipt_book_model.php */

/**
 * Default receipt count in a book. The PHP docblock said 25 and the constant
 * said 50; 50 is what actually ran, so 50 it is.
 */
const BOOK_CAPACITY = 50;

const ok = (message) => ({ status: true, message, code: 200 });
const fail = (code, message) => ({ status: false, message, code });

/**
 * Resolves an effective end_no.
 *
 * end_no of 0, "0" or NULL all mean "unset" and fall back to capacity. The
 * loose string comparison is intentional: mysql2 hands back INT columns as
 * numbers, whereas PHP's mysqli returned strings, so both shapes are covered.
 */
function effectiveEnd(book) {
  const raw = book?.end_no;
  if (raw === null || raw === undefined || raw === 0 || raw === '0') {
    return BOOK_CAPACITY;
  }
  return toInt(raw);
}

async function getBook(bookNo) {
  return one(
    `SELECT id, mandal_id, issued_to_user_id, book_no, start_no, end_no,
            issued_on, last_used_no, submitted_at, status
       FROM receipt_books
      WHERE book_no = ? AND deleted_at IS NULL`,
    [toInt(bookNo)]
  );
}

async function getUserBySevakCode(sevakCode) {
  return one(`SELECT id, name FROM users WHERE sevak_code = ? AND active = 1`, [
    sevakCode,
  ]);
}

async function getUserMandalId(sevakCode) {
  const row = await one(
    `SELECT umm.mandal_id
       FROM user_mandal_memberships umm
       JOIN users u ON u.id = umm.user_id
      WHERE u.sevak_code = ?
      LIMIT 1`,
    [sevakCode]
  );
  return row?.mandal_id ?? null;
}

/**
 * Highest receipt number consumed from a book.
 *
 * Prefers the denormalised receipt_books.last_used_no when that column exists
 * and is populated, otherwise derives it from MAX(receipts.receipt_no).
 */
async function resolveLastUsedNo(bookNo, bookRow) {
  if (
    (await fieldExists('last_used_no', 'receipt_books')) &&
    bookRow &&
    Object.prototype.hasOwnProperty.call(bookRow, 'last_used_no') &&
    bookRow.last_used_no !== null
  ) {
    return toInt(bookRow.last_used_no);
  }

  const row = await one(
    `SELECT MAX(r.receipt_no) AS max_no
       FROM receipts r
       JOIN receipt_books b ON b.id = r.book_no
      WHERE b.book_no = ? AND r.deleted_at IS NULL`,
    [toInt(bookNo)]
  );
  return toInt(row?.max_no);
}

async function computeNextForRow(bookRow) {
  const last = await resolveLastUsedNo(toInt(bookRow.book_no), bookRow);
  const start = toInt(bookRow.start_no ?? 1);
  return Math.max(start, toInt(last) + 1);
}

/** Creates or re-points a book at a mandal, clearing any sevak assignment. */
async function assignToMandal(bookNo, startNo, endNo, toMandalId) {
  const book = await one(`SELECT id FROM receipt_books WHERE book_no = ?`, [bookNo]);

  const data = {
    mandal_id: toMandalId,
    start_no: startNo,
    end_no: endNo !== null && endNo !== undefined ? endNo : BOOK_CAPACITY,
    issued_to_user_id: null,
    issued_on: mysqlDateTime(),
  };

  if (book) {
    // Re-assigning revives a soft-deleted book, as before.
    data.deleted_at = null;
    const columns = Object.keys(data);
    await exec(
      `UPDATE receipt_books SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')}
        WHERE book_no = ?`,
      [...columns.map((c) => data[c]), bookNo]
    );
    return ok('Receipt book assigned');
  }

  data.book_no = bookNo;
  const columns = Object.keys(data);
  await exec(
    `INSERT INTO receipt_books (${columns.map((c) => `\`${c}\``).join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((c) => data[c])
  );
  return ok('New receipt book created and assigned to mandal');
}

/**
 * Issues a mandal-held book to a sevak.
 *
 * The same-mandal and book-ownership checks were commented out in the PHP;
 * they stay commented here so behaviour does not change on cutover. Restoring
 * them is a one-line change -- see docs/SECURITY.md.
 */
async function assignToSevak(bookNo, toUserSevakCode, bySevakCode) {
  const book = await getBook(bookNo);
  if (!book) return fail(404, 'Book not found');

  const byUser = await getUserBySevakCode(bySevakCode);
  const toUser = await getUserBySevakCode(toUserSevakCode);
  if (!byUser || !toUser) return fail(404, 'User not found');

  const byMandalId = await getUserMandalId(bySevakCode);
  const toMandalId = await getUserMandalId(toUserSevakCode);

  // if (toInt(byMandalId) !== toInt(toMandalId)) {
  //   return fail(403, 'Sanchalak and Sevak must be in the same mandal');
  // }
  // if (toInt(book.mandal_id) !== toInt(byMandalId)) {
  //   return fail(409, 'Book is not held by your mandal');
  // }

  const last = await resolveLastUsedNo(toInt(bookNo), book);
  const start = toInt(book.start_no ?? 1);
  const end = effectiveEnd(book);
  const next = Math.max(start, toInt(last) + 1);

  if (next > end && end !== 0) return fail(409, 'Book exhausted (no receipts left)');

  const mandalId = byMandalId || toMandalId;
  await exec(
    `UPDATE receipt_books
        SET mandal_id = ?, issued_to_user_id = ?, issued_on = ?
      WHERE book_no = ?`,
    [toInt(mandalId), toInt(toUser.id), mysqlDateTime(), toInt(bookNo)]
  );

  return {
    status: true,
    message: 'Receipt book assigned to sevak',
    code: 200,
    next_receipt_no: next,
  };
}

/**
 * Returns a book from a sevak and rolls start_no forward past the used stubs.
 * end_no is deliberately left alone so the book's printed range is preserved.
 */
async function deassignFromSevak(bookNo, bySevakCode, lastUsedNo = null) {
  const book = await getBook(bookNo);
  if (!book) return fail(404, 'Book not found');

  await getUserMandalId(bySevakCode);
  if (!book.issued_to_user_id) return fail(409, 'Book is not assigned to any sevak');

  const update = {};
  const bookEnd = effectiveEnd(book);
  const currentLast = toInt(await resolveLastUsedNo(bookNo, book));

  let effectiveLast;
  if (lastUsedNo !== null && lastUsedNo !== undefined && Number.isFinite(Number(lastUsedNo))) {
    let val = toInt(lastUsedNo);
    if (val < 0) val = 0;
    if (val > bookEnd) val = bookEnd;
    // History only moves forward.
    if (val < currentLast) {
      return fail(400, 'Cannot set last_used_no below existing value');
    }
    effectiveLast = val;
  } else {
    effectiveLast = currentLast;
  }

  if (await fieldExists('last_used_no', 'receipt_books')) {
    update.last_used_no = Math.max(currentLast, effectiveLast);
  }

  let newStart = effectiveLast + 1;
  if (newStart < 1) newStart = 1;
  // A fully-consumed book parks start_no at end_no to signal exhaustion.
  if (newStart > bookEnd) newStart = bookEnd;
  update.start_no = newStart;

  const columns = Object.keys(update);
  if (columns.length) {
    await exec(
      `UPDATE receipt_books SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')}
        WHERE book_no = ?`,
      [...columns.map((c) => update[c]), toInt(bookNo)]
    );
  }

  return ok('Receipt book deassigned from sevak');
}

/** Unlike assign/deassign, this one DOES enforce mandal ownership. */
async function markSubmitted(bookNo, bySevakCode) {
  const book = await getBook(bookNo);
  if (!book) return fail(404, 'Book not found');

  const byMandalId = await getUserMandalId(bySevakCode);
  if (!byMandalId) return fail(404, 'User not found');
  if (toInt(book.mandal_id) !== toInt(byMandalId)) {
    return fail(409, 'Book is not held by your mandal');
  }

  await exec(
    `UPDATE receipt_books SET submitted_at = ?, status = 'submitted' WHERE book_no = ?`,
    [mysqlDateTime(), toInt(bookNo)]
  );
  return ok('Receipt book marked as submitted');
}

async function updateBook(bookNo, fields = {}) {
  const update = {};

  if (fields.start_no !== undefined && fields.start_no !== null) {
    update.start_no = Math.max(1, toInt(fields.start_no));
  }
  if (fields.end_no !== undefined && fields.end_no !== null) {
    update.end_no = Math.min(BOOK_CAPACITY, toInt(fields.end_no));
  }
  if (fields.new_book_no) {
    update.book_no = toInt(fields.new_book_no);
  }

  if (
    update.start_no !== undefined &&
    update.end_no !== undefined &&
    update.start_no > update.end_no
  ) {
    return fail(400, 'Start cannot exceed end');
  }
  if (Object.keys(update).length === 0) return fail(400, 'Nothing to update');

  const columns = Object.keys(update);
  await exec(
    `UPDATE receipt_books SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')}
      WHERE book_no = ?`,
    [...columns.map((c) => update[c]), toInt(bookNo)]
  );
  return ok('Book updated');
}

async function deleteBook(bookNo) {
  const book = await one(
    `SELECT id, book_no, status, issued_to_user_id, deleted_at
       FROM receipt_books
      WHERE book_no = ? AND deleted_at IS NULL`,
    [toInt(bookNo)]
  );

  if (!book) return fail(404, 'Receipt book not found or already deleted.');

  if (String(book.status ?? '').toLowerCase() === 'assigned') {
    return fail(
      409,
      'This receipt book is currently assigned. Please deassign it before deleting.'
    );
  }

  if (await fieldExists('deleted_at', 'receipt_books')) {
    await exec(`UPDATE receipt_books SET deleted_at = NOW() WHERE book_no = ?`, [
      toInt(bookNo),
    ]);
  } else {
    await exec(`DELETE FROM receipt_books WHERE book_no = ?`, [toInt(bookNo)]);
  }

  return ok('Book deleted successfully.');
}

async function getBooksByMandal(mandalId) {
  const rows = await many(
    `SELECT rb.*, m.name AS mandal_name, u.name AS issued_to_name
       FROM receipt_books rb
       LEFT JOIN mandals m ON m.id = rb.mandal_id
       LEFT JOIN users u   ON u.id = rb.issued_to_user_id
      WHERE rb.mandal_id = ? AND rb.deleted_at IS NULL
      ORDER BY rb.book_no ASC`,
    [toInt(mandalId)]
  );

  for (const row of rows) {
    row.next_receipt_no = await computeNextForRow(row);
  }
  return rows;
}

async function getBooksBySevak(sevakCode) {
  const user = await one(
    `SELECT id FROM users WHERE sevak_code = ? AND active = 1`,
    [sevakCode]
  );
  if (!user?.id) return [];

  const rows = await many(
    `SELECT rb.*
       FROM receipt_books rb
      WHERE rb.issued_to_user_id = ? AND rb.deleted_at IS NULL
      ORDER BY rb.book_no ASC`,
    [toInt(user.id)]
  );

  for (const row of rows) {
    row.next_receipt_no = await computeNextForRow(row);
  }
  return rows;
}

async function getAllBooks() {
  return many(
    `SELECT rb.*, m.name AS mandal_name, u.name AS issued_to_name
       FROM receipt_books rb
       LEFT JOIN mandals m ON m.id = rb.mandal_id
       LEFT JOIN users u   ON u.id = rb.issued_to_user_id
      WHERE rb.deleted_at IS NULL
      ORDER BY rb.book_no ASC`
  );
}

/** Clears the sevak assignment on the most recently issued row for a book. */
async function markLatestDeassigned(bookNo) {
  const latest = await one(
    `SELECT id FROM receipt_books
      WHERE book_no = ? AND deleted_at IS NULL
      ORDER BY issued_on DESC, id DESC
      LIMIT 1`,
    [toInt(bookNo)]
  );
  if (!latest?.id) return;

  await exec(
    `UPDATE receipt_books SET issued_to_user_id = NULL, status = 'deassigned'
      WHERE id = ?`,
    [toInt(latest.id)]
  );
}

async function bumpLastUsedById(bookId, receiptNo) {
  const result = await exec(
    `UPDATE receipt_books
        SET last_used_no = GREATEST(COALESCE(last_used_no, 0), ?)
      WHERE id = ?`,
    [toInt(receiptNo), toInt(bookId)]
  );
  return result.affectedRows >= 0;
}

module.exports = {
  BOOK_CAPACITY,
  effectiveEnd,
  getBook,
  getUserBySevakCode,
  getUserMandalId,
  assignToMandal,
  assignToSevak,
  deassignFromSevak,
  markSubmitted,
  updateBook,
  deleteBook,
  getBooksByMandal,
  getBooksBySevak,
  getAllBooks,
  markLatestDeassigned,
  bumpLastUsedById,
};
