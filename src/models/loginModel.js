'use strict';

const { one, scalar, exec } = require('../db/query');
const { tableExists, fieldExists } = require('../db/introspect');
const { toInt } = require('../utils/php');
const { currentYear } = require('../utils/dates');

/** Port of application/models/Login_model.php */

/**
 * SECURITY: compares the password column literally, because that is what the
 * PHP did -- passwords are stored in plaintext. Kept for cutover parity at the
 * explicit request of the maintainer. The replacement is scoped in
 * docs/SECURITY.md; this is the single function that needs to change.
 */
async function checkUser({ sevak_id = '', password = '' } = {}) {
  return one(
    `SELECT * FROM users
      WHERE sevak_code = ? AND password = ? AND active = 1 AND deleted_at IS NULL
      LIMIT 1`,
    [sevak_id ?? '', password ?? '']
  );
}

async function findBySevakId(sevakId) {
  return one(
    `SELECT * FROM users WHERE sevak_code = ? AND deleted_at IS NULL LIMIT 1`,
    [sevakId]
  );
}

async function findBySevakIdAndPhone(sevakId, phoneNumber) {
  return one(
    `SELECT * FROM users
      WHERE sevak_code = ? AND phone_number = ? AND deleted_at IS NULL
      LIMIT 1`,
    [sevakId, phoneNumber]
  );
}

/**
 * Writes the new password verbatim, matching update_password_plain().
 *
 * The PHP returned true whenever the UPDATE executed, since it tested
 * affected_rows() >= 0 -- which is true even when zero rows matched. Preserved:
 * the controller's 500-on-failure branch was therefore effectively unreachable.
 */
async function updatePasswordPlain(sevakId, newPassword, extra = {}) {
  const fields = { password: newPassword, ...extra };
  const columns = Object.keys(fields);
  const assignments = columns.map((c) => `\`${c}\` = ?`).join(', ');
  const params = [...columns.map((c) => fields[c]), sevakId];

  const result = await exec(
    `UPDATE users SET ${assignments} WHERE sevak_code = ?`,
    params
  );
  return result.affectedRows >= 0;
}

/**
 * Personal target for a year, with the legacy-schema fallback chain intact:
 * sevak_targets joined to users first, then the old flat annkut_sevak table.
 */
async function getPersonalTarget(sevakId, year = null) {
  const y = year || currentYear();

  if ((await tableExists('sevak_targets')) && (await tableExists('users'))) {
    const row = await one(
      `SELECT st.target_forms AS target
         FROM sevak_targets st
         JOIN users u ON u.id = st.user_id
        WHERE u.sevak_code = ? AND st.year = ?
        LIMIT 1`,
      [sevakId, y]
    );
    if (row && row.target !== undefined && row.target !== null) {
      return toInt(row.target);
    }
  }

  if (await tableExists('annkut_sevak')) {
    const row = await one(
      `SELECT sevak_target FROM annkut_sevak WHERE sevak_id = ? LIMIT 1`,
      [sevakId]
    );
    return toInt(row?.sevak_target);
  }

  return 0;
}

/**
 * Counts this year's receipts for a collector, probing which columns exist
 * before referencing them -- same order of preference as the PHP.
 */
async function countFilledForms(sevakId, year = null) {
  const y = year || currentYear();

  if (await tableExists('receipts')) {
    const where = [];
    const params = [];

    if (await fieldExists('collector_sevak_code', 'receipts')) {
      where.push('collector_sevak_code = ?');
      params.push(sevakId);
    } else if (await fieldExists('sevak_id', 'receipts')) {
      where.push('sevak_id = ?');
      params.push(sevakId);
    }

    if (await fieldExists('deleted_at', 'receipts')) {
      where.push('deleted_at IS NULL');
    }

    if (await fieldExists('receipt_date', 'receipts')) {
      where.push('YEAR(receipt_date) = ?');
      params.push(y);
    } else if (await fieldExists('created_at', 'receipts')) {
      where.push('YEAR(created_at) = ?');
      params.push(y);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return toInt(await scalar(`SELECT COUNT(*) AS c FROM receipts ${clause}`, params));
  }

  if (await tableExists('form_details')) {
    const where = ['sevak_id = ?'];
    const params = [sevakId];

    if (await fieldExists('deleted_at', 'form_details')) {
      where.push('deleted_at IS NULL');
    }
    if (await fieldExists('created_at', 'form_details')) {
      where.push('YEAR(created_at) = ?');
      params.push(y);
    }

    return toInt(
      await scalar(
        `SELECT COUNT(*) AS c FROM form_details WHERE ${where.join(' AND ')}`,
        params
      )
    );
  }

  if (await tableExists('annkut_sevak')) {
    const row = await one(
      `SELECT filled_form FROM annkut_sevak WHERE sevak_id = ? LIMIT 1`,
      [sevakId]
    );
    return toInt(row?.filled_form);
  }

  return 0;
}

module.exports = {
  checkUser,
  findBySevakId,
  findBySevakIdAndPhone,
  updatePasswordPlain,
  getPersonalTarget,
  countFilledForms,
};
