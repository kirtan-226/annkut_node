'use strict';

const express = require('express');
const receiptBookModel = require('../models/receiptBookModel');
const mandalModel = require('../models/mandalModel');
const sevakModel = require('../models/sevakModel');
const { isEmpty, toInt, toStr } = require('../utils/php');
const asyncRoute = require('../middleware/asyncRoute');

/** Port of application/controllers/ReceiptBooks.php */

const router = express.Router();

/** Every endpoint here requires the caller's code plus a book number. */
function requireCodeAndBook(data, res) {
  if (isEmpty(data.sevak_code) || isEmpty(data.book_no)) {
    res.status(400).json({ status: false, message: 'Missing sevak_code or book_no' });
    return false;
  }
  return true;
}

/** Forwards a model result object, which already carries its own HTTP code. */
function sendResult(res, result) {
  return res.status(result.code).json(result);
}

/**
 * POST /receiptbooks/assign
 *
 * Handles two different operations depending on the payload: assigning a book
 * to a mandal (to_mandal_name / to_mandal_id) or issuing it to a sevak
 * (to_user_sevak_code / to_user_id). Mandal assignment wins if both are given.
 */
router.all(
  '/assign',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    if (!requireCodeAndBook(data, res)) return undefined;

    if (!isEmpty(data.to_mandal_name)) {
      const mandal = await mandalModel.getMandalDetails(data.to_mandal_name);
      data.to_mandal_id = mandal?.id ?? null;
      delete data.to_mandal_name;
    }

    const bookNo = toInt(data.book_no);
    const startNo = data.start_no !== undefined ? toInt(data.start_no) : null;
    const endNo = data.end_no !== undefined ? toInt(data.end_no) : null;

    if (!isEmpty(data.to_mandal_id)) {
      const result = await receiptBookModel.assignToMandal(
        bookNo,
        startNo,
        endNo,
        toInt(data.to_mandal_id)
      );
      return sendResult(res, result);
    }

    if (!isEmpty(data.to_user_id) || !isEmpty(data.to_user_sevak_code)) {
      // Both keys carry the assignee's sevak_code despite the to_user_id name.
      const toUserCode = toStr(data.to_user_sevak_code ?? data.to_user_id);
      const byUserCode = toStr(data.sevak_code);

      const result = await receiptBookModel.assignToSevak(
        bookNo,
        toUserCode,
        byUserCode
      );
      return sendResult(res, result);
    }

    return res.status(400).json({
      status: false,
      message:
        'Invalid target; require to_mandal_name/to_mandal_id or to_user_sevak_code',
    });
  })
);

/**
 * POST /receiptbooks/deassign
 *
 * On success the controller also clears issued_to_user_id and stamps
 * status='deassigned' on the book's latest row -- the model handles the
 * numbering, the controller handles the assignment state.
 */
router.all(
  '/deassign',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    if (!requireCodeAndBook(data, res)) return undefined;

    const bookNo = toInt(data.book_no);
    const bySevak = toStr(data.sevak_code);
    // 0 means "none used yet"; absent means "leave unchanged".
    const lastUsed = Object.prototype.hasOwnProperty.call(data, 'last_used_no')
      ? toInt(data.last_used_no)
      : null;

    const result = await receiptBookModel.deassignFromSevak(
      bookNo,
      bySevak,
      lastUsed
    );

    if (result.status) {
      await receiptBookModel.markLatestDeassigned(bookNo);
    }

    return sendResult(res, result);
  })
);

/** POST /receiptbooks/update */
router.all(
  '/update',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    if (!requireCodeAndBook(data, res)) return undefined;

    const result = await receiptBookModel.updateBook(toInt(data.book_no), {
      new_book_no: data.new_book_no !== undefined ? toInt(data.new_book_no) : null,
      start_no: data.start_no !== undefined ? toInt(data.start_no) : null,
      end_no: data.end_no !== undefined ? toInt(data.end_no) : null,
    });

    return sendResult(res, result);
  })
);

/** POST /receiptbooks/delete */
router.all(
  '/delete',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    if (!requireCodeAndBook(data, res)) return undefined;

    const result = await receiptBookModel.deleteBook(toInt(data.book_no));
    return sendResult(res, result);
  })
);

/** POST /receiptbooks/submit */
router.all(
  '/submit',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    if (!requireCodeAndBook(data, res)) return undefined;

    const result = await receiptBookModel.markSubmitted(
      toInt(data.book_no),
      toStr(data.sevak_code)
    );
    return sendResult(res, result);
  })
);

/**
 * POST /receiptbooks/list
 *
 * Books held by a mandal. When the caller omits `mandal`, their own primary
 * mandal is used.
 */
router.all(
  '/list',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    const sevakCode = data.sevak_code ?? null;

    if (!sevakCode) {
      return res.status(400).json({ status: false, message: 'Missing sevak_code' });
    }

    if (isEmpty(data.mandal)) {
      const m = await sevakModel.getSevakMandal(sevakCode);
      data.mandal = m?.mandal ?? null;
    }
    if (!data.mandal) {
      return res.status(400).json({ status: false, message: 'Mandal not determined' });
    }

    const mandal = await mandalModel.getMandalDetails(data.mandal);
    if (!mandal) {
      return res.status(400).json({ status: false, message: 'Mandal not determined' });
    }

    const all = await receiptBookModel.getBooksByMandal(mandal.id);
    return res.status(200).json({ status: true, all_books: all });
  })
);

/** POST /receiptbooks/my_books */
router.all(
  '/my_books',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    const sevakCode = data.sevak_code ?? null;

    if (!sevakCode) {
      return res.status(400).json({ status: false, message: 'Missing sevak_code' });
    }

    const rows = await receiptBookModel.getBooksBySevak(sevakCode);
    return res.status(200).json({ status: true, books: rows });
  })
);

module.exports = router;
