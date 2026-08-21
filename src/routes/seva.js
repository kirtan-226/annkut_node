'use strict';

const express = require('express');
const sevaModel = require('../models/sevaModel');
const sevakModel = require('../models/sevakModel');
const mandalModel = require('../models/mandalModel');
const receiptBookModel = require('../models/receiptBookModel');
const { isEmpty, toInt } = require('../utils/php');
const { fileStamp } = require('../utils/dates');
const { buildTsv } = require('../utils/excel');
const asyncRoute = require('../middleware/asyncRoute');

/** Port of application/controllers/Seva.php */

const router = express.Router();

const EXPORT_HEADERS = [
  'Sevak ID',
  'Name',
  'Mandal',
  'Phone Number',
  'Target',
  'Filled Form',
  'Sahyogi Prasad',
  'Sevak Prasad',
];

/**
 * GET /seva/export_data
 *
 * Tab-separated download of every active sevak.
 *
 * Performance note: this walks all users and issues four queries each, exactly
 * as the PHP did. At a few hundred sevaks that is fine; past roughly a thousand
 * it will approach API Gateway's hard 29s response ceiling, which is stricter
 * than the old host's 600s max_execution_time. docs/DEPLOY.md covers the
 * options if the roster grows.
 */
router.all(
  '/export_data',
  asyncRoute(async (req, res) => {
    const sevaks = await sevakModel.getAllUsers();
    const rows = [];

    for (const sevak of sevaks) {
      const sevakId = sevak.sevak_code ?? sevak.sevak_id;

      const m = await sevakModel.getSevakMandal(sevakId);
      const mandalName = m?.mandal ?? '';

      const mt = await mandalModel.getMandalTarget(mandalName);
      const targetForms = toInt(mt?.mandal_target);

      const filled = toInt(await sevakModel.getFilledForm(sevakId));

      const sevas = await sevaModel.getSeva(sevakId);
      let sahyogiPrasad = 0;
      let sevakPrasad = 0;
      for (const s of sevas) {
        if ((s.prasad_type ?? '') === 'annkut_sevak') sevakPrasad += 1;
        else if ((s.prasad_type ?? '') === 'sahyogi_pote') sahyogiPrasad += 1;
      }

      rows.push({
        'Sevak ID': sevakId,
        Name: sevak.name ?? '',
        Mandal: mandalName,
        'Phone Number': sevak.phone_number ?? '',
        Target: targetForms,
        'Filled Form': filled,
        'Sahyogi Prasad': sahyogiPrasad,
        'Sevak Prasad': sevakPrasad,
      });
    }

    const filename = `sevak_data_${fileStamp()}.xls`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'max-age=0, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'public');

    return res.send(buildTsv(EXPORT_HEADERS, rows));
  })
);

/** POST /seva/add_seva */
router.all(
  '/add_seva',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    if (isEmpty(data.book_no) || isEmpty(data.receipt_no) || isEmpty(data.sevak_id)) {
      return res.status(400).json({
        status: false,
        message: 'Please provide book number, receipt number, and sevak ID.',
      });
    }

    // Donor name is assembled last-first-middle, matching the UI's field order.
    data.sahyogi_name = [
      data.sahyogi_last_name ?? '',
      data.sahyogi_first_name ?? '',
      data.sahyogi_middle_name ?? '',
    ]
      .join(' ')
      .trim();

    const duplicate = await sevaModel.checkSeva(data);
    if (duplicate) {
      return res.status(409).json({
        status: false,
        message: 'This receipt number is already used for the selected book.',
      });
    }

    const book = await receiptBookModel.getBook(toInt(data.book_no));
    if (!book) {
      return res.status(404).json({
        status: false,
        message: 'Selected receipt book was not found. Please choose a valid book.',
      });
    }

    // Lower bound is last_used_no when present, else start_no. Note this means
    // the previously-used number itself stays acceptable, which is what the
    // PHP allowed; the duplicate check above is what actually blocks reuse.
    const hasLast = book.last_used_no !== undefined && book.last_used_no !== null;
    const start = hasLast ? toInt(book.last_used_no) : toInt(book.start_no ?? 1);
    const end = receiptBookModel.effectiveEnd(book);

    const receipt = toInt(data.receipt_no);
    if (receipt < start || receipt > end) {
      return res.status(422).json({
        status: false,
        message: `Enter receipt number between ${start} and ${end}`,
      });
    }

    delete data.sahyogi_last_name;
    delete data.sahyogi_first_name;
    delete data.sahyogi_middle_name;

    let inserted;
    try {
      inserted = await sevaModel.addSeva(data);
    } catch (err) {
      return res.status(400).json({ status: false, message: friendlyDbMessage(err) });
    }

    const filled = toInt(await sevakModel.getFilledForm(data.sevak_id));

    if (!inserted) {
      return res.status(400).json({
        status: false,
        message: 'Could not save this seva. Please try again.',
      });
    }

    return res
      .status(201)
      .json({ status: true, message: 'Seva added successfully.', filled_form: filled });
  })
);

/** POST /seva/edit_seva */
router.all(
  '/edit_seva',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    if (isEmpty(data.book_no) || isEmpty(data.receipt_no)) {
      return res.status(400).json({
        status: false,
        message: 'Please provide both book number and receipt number.',
      });
    }

    data.sahyogi_name = [
      data.sahyogi_last_name ?? '',
      data.sahyogi_first_name ?? '',
      data.sahyogi_middle_name ?? '',
    ]
      .join(' ')
      .trim();

    // Incoming book_no is the printed number; receipts.book_no is the FK id.
    const bookRow = await receiptBookModel.getBook(data.book_no);
    if (!bookRow?.id) {
      return res.status(404).json({
        status: false,
        message: 'Selected receipt book was not found. Please choose a valid book.',
      });
    }
    data.book_no = toInt(bookRow.id);

    try {
      const updated = await sevaModel.editSeva(data);
      if (!updated) {
        return res.status(400).json({
          status: false,
          message: 'Could not save your changes. Please try again.',
        });
      }
    } catch (err) {
      return res.status(400).json({ status: false, message: friendlyDbMessage(err) });
    }

    return res.json({ status: true, message: 'Seva edited successfully.' });
  })
);

/** POST /seva/get_seva */
router.all(
  '/get_seva',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    const sevaRows = await sevaModel.getSeva(data.sevak_id);
    for (const row of sevaRows) {
      row.book_no = row.book_number;
      delete row.created_at;
      delete row.updated_at;
      delete row.deleted_at;
    }

    const name = await sevakModel.getSevakName(data.sevak_id);
    const filledForm = toInt(await sevakModel.getFilledForm(data.sevak_id));

    return res.json({
      name: name[0]?.name ?? '',
      achieved_target: filledForm,
      seva: sevaRows,
      status: true,
    });
  })
);

/**
 * POST /seva/get_seva_by_id
 *
 * Splits the stored full name back into parts for the edit form. The stored
 * order is "last first middle...", so a three-plus-word name maps
 * accordingly, a two-word name is last+first, and a single word is first only.
 */
router.all(
  '/get_seva_by_id',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    const seva = await sevaModel.getSevaDetails(data.seva_id);
    if (!seva) return res.json(null);

    if (seva.book_no === undefined && seva.book_number !== undefined) {
      seva.book_no = seva.book_number;
    }

    const full =
      seva.sahyogi_name !== undefined && seva.sahyogi_name !== null
        ? String(seva.sahyogi_name).replace(/\s+/g, ' ').trim()
        : '';

    seva.sahyogi_first_name = null;
    seva.sahyogi_last_name = null;
    seva.sahyogi_middle_name = null;

    if (full !== '') {
      const parts = full.split(' ');
      if (parts.length >= 3) {
        seva.sahyogi_last_name = parts.shift();
        seva.sahyogi_first_name = parts.shift();
        seva.sahyogi_middle_name = parts.join(' ');
      } else if (parts.length === 2) {
        seva.sahyogi_last_name = parts[0];
        seva.sahyogi_first_name = parts[1];
      } else {
        seva.sahyogi_first_name = parts[0];
      }
    }

    // book_no is unset again on the way out, so the response carries only
    // book_number. Matches the PHP; the edit form reads book_number.
    delete seva.book_no;
    delete seva.created_at;
    delete seva.updated_at;
    delete seva.deleted_at;

    return res.json(seva);
  })
);

/** POST /seva/delete_seva */
router.all(
  '/delete_seva',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    const seva = await sevaModel.getSevaDetails(data.seva_id);
    if (!seva) {
      return res.json({ status: false, message: 'Seva not found' });
    }

    const deleted = await sevaModel.deleteSeva(data.seva_id);
    return res.json({
      status: Boolean(deleted),
      message: deleted ? 'Seva Deleted Successfully' : 'Delete failed',
    });
  })
);

/**
 * POST /seva/get_seva_count
 *
 * Dashboard totals. Admins (role 1) and Sant Nirdeshaks (7) see every mandal;
 * everyone else sees only the mandals they hold a leadership role in.
 */
router.all(
  '/get_seva_count',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    const role = await sevakModel.getSevakRole(data.sevak_id);
    const roleNum = role?.role ?? 0;

    const totals = {
      seva_five_hundered: 0,
      seva_thousand: 0,
      seva_other: 0,
      sahyogi_prasad: 0,
      sevak_prasad: 0,
      total_target: 0,
      total_filled_form: 0,
    };
    const mandalArray = [];

    const calc = async (mandalName) => {
      const mt = await mandalModel.getMandalTarget(mandalName);
      const mandalTarget = toInt(mt.mandal_target);

      const rows = await sevaModel.getReceiptsByMandalName(mandalName);
      const filled = rows.length;

      for (const r of rows) {
        if (r.prasad_type === 'annkut_sevak') totals.sevak_prasad += 1;
        else if (r.prasad_type === 'sahyogi_pote') totals.sahyogi_prasad += 1;

        const amt = toInt(r.seva_amount);
        if (amt === 500) totals.seva_five_hundered += 1;
        else if (amt === 1000) totals.seva_thousand += 1;
        else if (amt > 1000) totals.seva_other += 1;
      }

      totals.total_target += mandalTarget;
      totals.total_filled_form += filled;

      return [mandalTarget, filled];
    };

    if (roleNum === 7 || roleNum === 1) {
      const mandals = await mandalModel.getAllMandal();
      for (const m of mandals) {
        const [t, f] = await calc(m.name);
        mandalArray.push({
          mandal_target: t,
          mandal_filled_form: f,
          mandal_name: m.name,
        });
      }
    } else {
      const mandals = await mandalModel.getRolewiseMandal(data.sevak_id);
      for (const m of mandals) {
        const [t, f] = await calc(m.mandal_name);
        mandalArray.push({
          mandal_target: t,
          mandal_filled_form: f,
          mandal_name: m.mandal_name,
        });
      }
    }

    return res.json({ ...totals, mandal_array: mandalArray });
  })
);

/** Maps MySQL error codes onto the same user-facing strings the PHP used. */
function friendlyDbMessage(err) {
  const code = err?.errno ?? 0;
  const raw = String(err?.message ?? '').toLowerCase();

  if (code === 1452 || raw.includes('foreign key')) {
    return 'Invalid book selected. Please choose a valid receipt book.';
  }
  if (code === 1062 || raw.includes('duplicate entry')) {
    return 'This receipt number is already used for the selected book.';
  }
  if (code === 1366 || raw.includes('incorrect')) {
    return 'One or more fields have an invalid value. Please check and try again.';
  }
  if (raw.includes('constraint')) {
    return 'Your input violates a data rule. Please review and try again.';
  }
  return 'Could not save this seva. Please try again.';
}

module.exports = router;
