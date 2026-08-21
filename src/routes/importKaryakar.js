'use strict';

const express = require('express');
const reportExportModel = require('../models/reportExportModel');
const { toInt } = require('../utils/php');
const { fileStamp, currentYear } = require('../utils/dates');
const { buildSpreadsheetML } = require('../utils/excel');
const asyncRoute = require('../middleware/asyncRoute');

/**
 * Port of application/controllers/Import_karyakar.php
 *
 * Heads-up: this endpoint was UNREACHABLE in the PHP app. The file is named
 * Import_karyakar.php but declares `class Export`, and CodeIgniter resolves a
 * controller by matching the class name to the file name, so /import_karyakar/
 * annkut returned 404 and no other route reached it. Porting it makes it live
 * for the first time -- verify the output before pointing anyone at it.
 * See docs/PARITY.md.
 */

const router = express.Router();

const FORMAT1_COLUMNS = [
  { label: 'Kshetra', key: 'kshetra' },
  { label: 'Mandal', key: 'mandal' },
  { label: 'Sevak ID', key: 'sevak_id' },
  { label: 'Sevak Name', key: 'sevak_name' },
  { label: 'Sevak Phone', key: 'sevak_phone' },
  { label: 'Target', key: 'target' },
  { label: 'Form Filled', key: 'form_filled' },
  { label: '₹500 Seva', key: 'rs500_seva' },
  { label: '₹1000 Seva', key: 'rs1000_seva' },
  { label: 'Other Seva', key: 'other_seva' },
];

const FORMAT2_COLUMNS = [
  { label: 'Kshetra', key: 'kshetra' },
  { label: 'Mandal', key: 'mandal' },
  { label: 'Sevak ID', key: 'sevak_id' },
  { label: 'Sevak Name', key: 'sevak_name' },
  { label: 'Sevak Phone', key: 'sevak_phone' },
  { label: 'Sahyogi Name', key: 'sahyogi_name' },
  { label: 'Sahyogi Number', key: 'sahyogi_number' },
  { label: 'Book No.', key: 'book_no_printed' },
  { label: 'Receipt No.', key: 'receipt_no' },
  { label: 'Amount', key: 'amount' },
];

/** GET /import_karyakar/annkut?year=YYYY */
router.all(
  '/annkut',
  asyncRoute(async (req, res) => {
    const year = toInt(req.query.year) || currentYear();

    const filters = {
      xetra_id: req.query.xetra_id,
      mandal_id: req.query.mandal_id,
      sevak_id: req.query.sevak_id,
      from: req.query.from,
      to: req.query.to,
    };

    const [format1, format2] = await Promise.all([
      reportExportModel.getFormat1(year, filters),
      reportExportModel.getFormat2(filters),
    ]);

    const xml = buildSpreadsheetML([
      { name: 'Format 1', columns: FORMAT1_COLUMNS, rows: format1 },
      { name: 'Format 2', columns: FORMAT2_COLUMNS, rows: format2 },
    ]);

    const filename = `Annkut_Report_${fileStamp()}.xls`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'max-age=0');

    return res.send(xml);
  })
);

module.exports = router;
