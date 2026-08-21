'use strict';

const express = require('express');
const loginModel = require('../models/loginModel');
const sevakModel = require('../models/sevakModel');
const { isEmpty, toInt, csvToList } = require('../utils/php');
const { currentYear } = require('../utils/dates');
const { LOGIN_NUM_TO_LABEL } = require('../utils/roles');
const asyncRoute = require('../middleware/asyncRoute');

/** Port of application/controllers/Login.php */

const router = express.Router();

/**
 * POST /login/login
 *
 * NOTE: this returns the sevak profile and nothing else -- no token, no
 * session cookie. Every other endpoint therefore trusts whatever sevak_code
 * the client sends. That is the pre-existing model and is preserved
 * deliberately for cutover; docs/SECURITY.md covers what replacing it takes.
 */
router.all(
  '/login',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    if (isEmpty(data.sevak_id) || isEmpty(data.password)) {
      return res
        .status(400)
        .json({ status: false, message: 'sevak_id and password are required' });
    }

    const user = await loginModel.checkUser(data);
    if (!user) {
      return res.status(401).json({ status: false, message: 'Invalid credentials' });
    }

    let sevak = await sevakModel.getSevakDetails(data.sevak_id);
    if (!sevak) {
      sevak = { sevak_id: data.sevak_id };
    } else {
      delete sevak.password;
      delete sevak.deleted_at;
      delete sevak.created_at;
      delete sevak.updated_at;
      delete sevak.id;
      sevak.sevak_id = data.sevak_id;
    }

    const roleNum = await sevakModel.getSevakRole(data.sevak_id);
    sevak.role = LOGIN_NUM_TO_LABEL[roleNum?.role ?? 0] ?? null;

    const year = currentYear();
    const prevYear = year - 1;

    const currentTarget = toInt(
      await loginModel.getPersonalTarget(data.sevak_id, year)
    );
    const prevTarget = toInt(await loginModel.getPersonalTarget(data.sevak_id, prevYear));
    const filledForms = toInt(await loginModel.countFilledForms(data.sevak_id, year));

    sevak.mandal = sevak.mandal_name;
    sevak.sevak_target = currentTarget;
    sevak.previous_target = prevTarget;
    sevak.filled_form = filledForms;

    const permRow = await sevakModel.checkPermission(data.sevak_id);
    const permissionCodes = csvToList(permRow?.permissions ?? '');

    return res.json({
      status: true,
      message: 'Login successful',
      sevak: { ...sevak, permission_codes: permissionCodes },
    });
  })
);

/**
 * POST /login/forgot_password
 *
 * Identity is proven by sevak_id + phone_number alone -- no OTP, no email
 * round-trip -- and the new password is stored verbatim. Unchanged from the
 * PHP; flagged in docs/SECURITY.md.
 */
router.all(
  '/forgot_password',
  asyncRoute(async (req, res) => {
    const data = req.body || {};

    if (
      isEmpty(data.sevak_id) ||
      isEmpty(data.phone_number) ||
      isEmpty(data.password)
    ) {
      return res.status(400).json({
        status: false,
        message: 'sevak_id, phone_number and password are required',
      });
    }

    const user = await loginModel.findBySevakIdAndPhone(
      data.sevak_id,
      data.phone_number
    );
    if (!user) {
      return res
        .status(404)
        .json({ status: false, message: 'Phone Number or Sevak ID is wrong' });
    }

    const okUpdate = await loginModel.updatePasswordPlain(
      data.sevak_id,
      data.password,
      { is_changed: 'yes' }
    );
    if (!okUpdate) {
      return res.status(500).json({ status: false, message: 'Password reset failed' });
    }

    return res.json({ status: true, message: 'Password reset successful' });
  })
);

module.exports = router;
