'use strict';

const { one, many } = require('../db/query');
const { toInt, arrayColumn } = require('../utils/php');

/**
 * Port of application/models/Check_role.php (class Auth_model).
 *
 * Dead code in the original: the file is named Check_role.php but declares
 * class Auth_model, so CI's loader could never resolve it, and no controller
 * referenced it either. Ported because it is the natural home for the role
 * gate the endpoints currently lack -- see docs/SECURITY.md.
 */

async function roleCodesForUser(userId) {
  const rows = await many(
    `SELECT r.code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?`,
    [toInt(userId)]
  );
  return arrayColumn(rows, 'code');
}

async function userHasAnyRole(userId, allowedCodes = []) {
  if (!allowedCodes.length) return false;
  const row = await one(
    `SELECT 1 AS ok
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.code IN (?)
      LIMIT 1`,
    [toInt(userId), allowedCodes]
  );
  return Boolean(row);
}

async function userPrimaryMandalId(userId) {
  const row = await one(
    `SELECT mandal_id FROM user_mandal_memberships
      WHERE user_id = ?
      ORDER BY id ASC
      LIMIT 1`,
    [toInt(userId)]
  );
  return row ? toInt(row.mandal_id) : null;
}

module.exports = { roleCodesForUser, userHasAnyRole, userPrimaryMandalId };
