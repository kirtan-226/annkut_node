'use strict';

const express = require('express');
const sevakModel = require('../models/sevakModel');
const sevaModel = require('../models/sevaModel');
const mandalModel = require('../models/mandalModel');
const { isEmpty, toInt, mtRand } = require('../utils/php');
const { LIST_NUM_TO_LABEL } = require('../utils/roles');
const asyncRoute = require('../middleware/asyncRoute');

/** Port of application/controllers/Sevak.php */

const router = express.Router();

/**
 * POST /sevak/add_sevak
 *
 * The caller passes their own sevak_code as `id`; their leadership mandal
 * becomes the new sevak's mandal. The generated code is a mandal prefix plus a
 * random 3-digit suffix, retried until unused -- only 900 codes exist per
 * mandal prefix, so the 5000-attempt ceiling is what stops an infinite loop
 * once a mandal fills up.
 */
router.all(
  '/add_sevak',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    const mandal = await sevakModel.getKaryakarMandal(data.id);
    if (!mandal || isEmpty(mandal)) {
      return res.json({ message: 'Entered Wrong Data', status: false });
    }

    let mandalCode = await mandalModel.getMandalCodeByName(mandal.mandal_name);
    if (!mandalCode) {
      mandalCode = String(mandal.mandal_name)
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 2)
        .toUpperCase();
      if (mandalCode === '') mandalCode = 'MD';
    }

    let sevakId;
    let tries = 0;
    for (;;) {
      sevakId = `${mandalCode}${mtRand(100, 999)}`;
      const exists = await sevakModel.checkId(sevakId);
      if (isEmpty(exists)) break;
      tries += 1;
      if (tries > 5000) {
        return res.json({ status: false, message: 'Could not generate sevak_id' });
      }
    }

    const created = await sevakModel.addSevak({
      sevak_id: sevakId,
      name: data.name,
      mandal: mandal.mandal_name,
      phone_number: data.phone_number ?? null,
      password: '1',
      is_changed: 'no',
    });

    // Roll the new sevak's target into the mandal's total for this year.
    if (!isEmpty(data.sevak_target)) {
      const target = await mandalModel.getMandalTarget(mandal.mandal_name);
      target.mandal_target = toInt(target.mandal_target) + toInt(data.sevak_target);
      await mandalModel.updateMandal(target);
    }

    return res.json({
      message: created ? 'Sevak Added Successfully' : 'Failed to add sevak',
      status: Boolean(created),
      sevak_id: sevakId,
    });
  })
);

/**
 * POST /sevak/assign_mandal
 * Retained as a no-op so the existing frontend call keeps succeeding.
 */
router.all('/assign_mandal', (req, res) => {
  res.json({
    status: true,
    message: 'No-op in v2 (memberships handled at create time)',
  });
});

/** POST /sevak/get_sevak_by_mandal */
router.all(
  '/get_sevak_by_mandal',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    const mandal = data.mandal !== undefined ? String(data.mandal).trim() : '';

    if (mandal === '') {
      return res
        .status(400)
        .json({ status: false, message: 'Missing mandal', sevak: [] });
    }

    const rows = await sevakModel.getSevakByMandal(mandal);
    for (const row of rows) delete row.password;

    return res.json({ status: true, sevak: rows });
  })
);

/**
 * POST /sevak/get_sevak
 *
 * Three selection modes, in priority order:
 *   1. explicit `mandal` filter  -> that mandal's sevaks
 *   2. caller is ADMIN           -> every active user
 *   3. otherwise                 -> sevaks of each mandal they lead,
 *                                   falling back to just themselves
 *
 * Role labels here come from LIST_NUM_TO_LABEL, which is a different table
 * from the one /login uses against the same numbers. See utils/roles.js.
 */
router.all(
  '/get_sevak',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    const sevakIdOrCode = data.sevak_id ?? data.sevak_code ?? null;
    const mandalFilter = data.mandal !== undefined ? String(data.mandal).trim() : '';

    const newSevakArray = [];
    const counters = {
      sahyogi_prasad: 0,
      sevak_prasad: 0,
      seva_five_hundered: 0,
      seva_thousand: 0,
      seva_other: 0,
    };

    const roleInfo = await sevakModel.checkAdmin(sevakIdOrCode);
    const roleCode = toInt(roleInfo?.role);

    const nameRows = await sevakModel.getSevakName(sevakIdOrCode);

    const buildRow = async (input) => {
      const row = { ...input };
      const code = row.sevak_code ?? row.sevak_id ?? null;
      row.sevak_id = code;

      if (row.role === undefined) {
        const num = await sevakModel.getSevakRole(code);
        row.role = LIST_NUM_TO_LABEL[toInt(num?.role)] ?? null;
      }

      if (row.sevak_target === undefined) {
        const target = await sevakModel.getCurrentYearTarget(code);
        row.sevak_target = toInt(target?.target_forms);
      }

      if (row.previous_target === undefined) {
        const prev = await sevakModel.getPreviousYearTarget(code);
        row.previous_target = toInt(prev?.target_forms);
      }

      const sevas = await sevaModel.getSeva(code);
      row.filled_form = Array.isArray(sevas) ? sevas.length : 0;

      for (const seva of sevas) {
        const ptype = seva.prasad_type ?? '';
        if (ptype === 'annkut_sevak') counters.sevak_prasad += 1;
        else if (ptype === 'sahyogi_pote') counters.sahyogi_prasad += 1;

        const amt = toInt(seva.seva_amount);
        if (amt === 500) counters.seva_five_hundered += 1;
        else if (amt === 1000) counters.seva_thousand += 1;
        else if (amt > 1000) counters.seva_other += 1;
      }

      if (row.phone_number === undefined) row.phone_number = row.phone ?? null;
      if (row.mandal_name === undefined && row.mandal !== undefined) {
        row.mandal_name = row.mandal;
      }

      return row;
    };

    if (mandalFilter !== '') {
      const list = await sevakModel.getSevakByMandal(mandalFilter);
      for (const row of list) {
        row.mandal_name = row.mandal_name ?? mandalFilter;
        newSevakArray.push(await buildRow(row));
      }
    } else if (roleCode === 7) {
      const sevaks = await sevakModel.getAllUsers();
      for (const row of sevaks) {
        newSevakArray.push(await buildRow(row));
      }
    } else {
      const mandals = await mandalModel.getRolewiseMandal(sevakIdOrCode);
      if (mandals.length) {
        for (const m of mandals) {
          const mname = m.mandal_name ?? m.name ?? null;
          if (!mname) continue;

          const list = await sevakModel.getSevakByMandal(mname);
          for (const row of list) {
            row.mandal_name = row.mandal_name ?? mname;
            newSevakArray.push(await buildRow(row));
          }
        }
      } else {
        const only = await sevakModel.getSevakDetails(sevakIdOrCode);
        if (only && !isEmpty(only)) newSevakArray.push(await buildRow(only));
      }
    }

    // Null rather than '' when the caller's own name is missing: PHP read the
    // offset directly here (no ?? fallback) and produced null.
    return res.json({
      'Sanchalak Name': nameRows[0]?.name ?? null,
      sevak: newSevakArray,
      status: true,
      sevak_prasad: counters.sevak_prasad,
      sahyogi_prasad: counters.sahyogi_prasad,
    });
  })
);

/** POST /sevak/edit_sevak */
router.all(
  '/edit_sevak',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    const updated = await sevakModel.updateSevak(data);
    // Message is unconditionally the success string, as before; only `status`
    // reflects the outcome.
    return res.json({
      message: 'Sevak Edited Successfully',
      status: Boolean(updated),
    });
  })
);

/** POST /sevak/delete_sevak */
router.all(
  '/delete_sevak',
  asyncRoute(async (req, res) => {
    const data = req.body || {};
    const deleted = await sevakModel.deleteSevak(data.sevak_id);
    return res.json({
      message: deleted ? 'Sevak Deleted Successfully' : 'Not found',
      status: Boolean(deleted),
    });
  })
);

/**
 * POST /sevak/get_mandal_list
 *
 * Two quirks preserved verbatim -- both are documented in docs/PARITY.md:
 *
 *  1. The PHP branched on `$data['sevak_id'] === 'KR002' || 'KR100'`. The
 *     second operand is a non-empty string literal, so the condition is
 *     ALWAYS true and the xetra-scoped branch below it never ran. Every
 *     admin/sant-nirdeshak therefore sees all mandals.
 *  2. The response's `mandal_array` is the raw mandal list, NOT the enriched
 *     array the loop builds. Because the two branches source that list from
 *     different queries, the shape of `mandal_array` changes with the caller's
 *     role: leaders get [{mandal_name}], admins get the full summary rows.
 */
router.all(
  '/get_mandal_list',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    const role = await sevakModel.getSevakRole(data.sevak_id);
    const roleNum = role?.role ?? 0;

    let totalTarget = 0;
    let totalFilledForm = 0;
    let mandals;

    if (roleNum !== 1 && roleNum !== 7) {
      mandals = await mandalModel.getRolewiseMandal(data.sevak_id);
      for (const mandal of mandals) {
        const mt = await mandalModel.getMandalTarget(mandal.mandal_name);
        totalTarget += toInt(mt.mandal_target);
        totalFilledForm += await sevaModel.countReceiptsByMandalName(
          mandal.mandal_name
        );
      }
    } else {
      // Preserved: always-true condition, so this is the only reachable path.
      mandals = await mandalModel.getAllMandal();
      for (const mandal of mandals) {
        const mt = await mandalModel.getMandalTarget(mandal.name);
        totalTarget += toInt(mt.mandal_target);
        totalFilledForm += await sevaModel.countReceiptsByMandalName(mandal.name);
      }
    }

    return res.json({
      mandal_array: mandals,
      target: {
        total_target: totalTarget,
        total_filled_form: totalFilledForm,
      },
    });
  })
);

module.exports = router;
