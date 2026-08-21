'use strict';

const { one, many, scalar, exec, withTransaction } = require('../db/query');
const { toInt } = require('../utils/php');
const { mysqlDate, currentYear } = require('../utils/dates');
const { highestRoleNum, adminRoleNum, LEADERSHIP_CODES } = require('../utils/roles');

/** Port of application/models/Sevak_model.php */

async function checkPermission(sevakCode) {
  return one(
    `SELECT u.id, u.name, GROUP_CONCAT(DISTINCT p.code) AS permissions
       FROM users u
       JOIN user_roles ur       ON ur.user_id = u.id
       JOIN roles r             ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p       ON p.id = rp.permission_id
      WHERE u.sevak_code = ? AND u.active = 1
      GROUP BY u.id, u.name`,
    [sevakCode]
  );
}

/** Inserts the user and, when a mandal name resolves, a primary membership. */
async function addSevak(data = {}) {
  const user = {
    sevak_code: data.sevak_id,
    name: data.name ?? '',
    phone_number: data.phone_number ?? null,
    password: data.password ?? '1',
    is_changed: data.is_changed ?? 'no',
    active: 1,
  };

  const inserted = await exec(
    `INSERT INTO users (sevak_code, name, phone_number, password, is_changed, active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      user.sevak_code,
      user.name,
      user.phone_number,
      user.password,
      user.is_changed,
      user.active,
    ]
  );
  const userId = inserted.insertId;

  if (data.mandal) {
    const mandal = await one(`SELECT id FROM mandals WHERE name = ?`, [data.mandal]);
    if (mandal) {
      await exec(
        `INSERT INTO user_mandal_memberships (user_id, mandal_id, is_primary, start_date)
         VALUES (?, ?, 1, ?)`,
        [userId, mandal.id, mysqlDate()]
      );
    }
  }

  return userId > 0;
}

/**
 * Updates user fields and, when sevak_target is supplied, reconciles both
 * sevak_targets and the owning mandal's mandal_targets by the delta.
 *
 * Runs in a single transaction, replacing CI's trans_begin/trans_status pair.
 */
async function updateSevak(data = {}) {
  if (!data.sevak_id) return false;

  const user = await one(
    `SELECT id FROM users WHERE sevak_code = ? AND deleted_at IS NULL`,
    [data.sevak_id]
  );
  if (!user) return false;

  const userId = toInt(user.id);

  return withTransaction(async (conn) => {
    // 1) Whitelisted user columns.
    const allowed = ['name', 'phone_number', 'active', 'is_changed', 'password'];
    const present = allowed.filter((k) => Object.prototype.hasOwnProperty.call(data, k));
    if (present.length) {
      const assignments = present.map((c) => `\`${c}\` = ?`).join(', ');
      await exec(
        `UPDATE users SET ${assignments} WHERE id = ?`,
        [...present.map((c) => data[c]), userId],
        conn
      );
    }

    // 2) Target reconciliation.
    if (data.sevak_target !== undefined && data.sevak_target !== '') {
      const year = data.year ? toInt(data.year) : currentYear();
      const newTarget = toInt(data.sevak_target);

      let oldTarget = 0;
      if (year !== currentYear()) {
        const tmp = await one(
          `SELECT target_forms FROM sevak_targets WHERE user_id = ? AND year = ?`,
          [userId, year],
          conn
        );
        oldTarget = tmp ? toInt(tmp.target_forms) : 0;
      } else {
        const cur = await one(
          `SELECT target_forms FROM sevak_targets WHERE user_id = ? AND year = ?`,
          [userId, currentYear()],
          conn
        );
        oldTarget = cur ? toInt(cur.target_forms) : 0;
      }

      if (newTarget !== oldTarget) {
        const delta = newTarget - oldTarget;

        const primary = await one(
          `SELECT mandal_id FROM user_mandal_memberships
            WHERE user_id = ? AND is_primary = 1 LIMIT 1`,
          [userId],
          conn
        );
        const mandalId = toInt(primary?.mandal_id);

        if (mandalId > 0) {
          const mt = await one(
            `SELECT id, target_forms FROM mandal_targets
              WHERE mandal_id = ? AND year = ? LIMIT 1`,
            [mandalId, year],
            conn
          );

          if (mt) {
            const next = Math.max(0, toInt(mt.target_forms) + delta);
            await exec(
              `UPDATE mandal_targets SET target_forms = ? WHERE id = ?`,
              [next, toInt(mt.id)],
              conn
            );
          } else {
            await exec(
              `INSERT INTO mandal_targets (mandal_id, year, target_forms, target_amount)
               VALUES (?, ?, ?, 0)`,
              [mandalId, year, Math.max(0, delta)],
              conn
            );
          }
        }

        const exists = await one(
          `SELECT id FROM sevak_targets WHERE user_id = ? AND year = ?`,
          [userId, year],
          conn
        );
        if (exists) {
          await exec(
            `UPDATE sevak_targets SET target_forms = ? WHERE id = ?`,
            [newTarget, toInt(exists.id)],
            conn
          );
        } else {
          await exec(
            `INSERT INTO sevak_targets (user_id, year, target_forms) VALUES (?, ?, ?)`,
            [userId, year, newTarget],
            conn
          );
        }
      } else {
        // Unchanged target: still guarantee the row exists.
        const exists = await one(
          `SELECT id FROM sevak_targets WHERE user_id = ? AND year = ?`,
          [userId, year],
          conn
        );
        if (!exists) {
          await exec(
            `INSERT INTO sevak_targets (user_id, year, target_forms) VALUES (?, ?, ?)`,
            [userId, year, newTarget],
            conn
          );
        }
      }
    }

    return true;
  });
}

async function deleteSevak(sevakCode) {
  const result = await exec(
    `UPDATE users SET deleted_at = NOW()
      WHERE sevak_code = ? AND deleted_at IS NULL`,
    [sevakCode]
  );
  return result.affectedRows > 0;
}

async function restoreSevak(sevakCode) {
  const result = await exec(
    `UPDATE users SET deleted_at = NULL
      WHERE sevak_code = ? AND deleted_at IS NOT NULL`,
    [sevakCode]
  );
  return result.affectedRows > 0;
}

async function getSevakByMandal(mandalName) {
  return many(
    `SELECT u.*, m.name AS mandal_name
       FROM users u
       JOIN user_mandal_memberships umm ON umm.user_id = u.id
       JOIN mandals m ON m.id = umm.mandal_id
      WHERE m.name = ? AND u.active = 1`,
    [mandalName]
  );
}

async function getTargetForYear(sevakCode, year) {
  const user = await one(
    `SELECT id FROM users WHERE sevak_code = ? AND deleted_at IS NULL`,
    [sevakCode]
  );
  if (!user) return { target_forms: 0 };

  const row = await one(
    `SELECT target_forms FROM sevak_targets WHERE user_id = ? AND year = ?`,
    [toInt(user.id), year]
  );
  return row || { target_forms: 0 };
}

const getCurrentYearTarget = (sevakCode) => getTargetForYear(sevakCode, currentYear());
const getPreviousYearTarget = (sevakCode) =>
  getTargetForYear(sevakCode, currentYear() - 1);

async function checkAdmin(sevakCode) {
  const roles = await many(
    `SELECT r.code
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.sevak_code = ?`,
    [sevakCode]
  );
  return { role: adminRoleNum(roles) };
}

async function getSevakRole(sevakCode) {
  const roles = await many(
    `SELECT r.code
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.sevak_code = ?`,
    [sevakCode]
  );
  return { role: highestRoleNum(roles) };
}

/** Returns an array of rows, as the PHP did -- callers read [0].name. */
async function getSevakName(sevakCode) {
  return many(
    `SELECT name FROM users WHERE sevak_code = ? AND deleted_at IS NULL`,
    [sevakCode]
  );
}

async function getRole(id) {
  const row = await one(`SELECT name FROM roles WHERE id = ?`, [id]);
  return { role: row?.name ?? null };
}

async function getAllUsers() {
  return many(`SELECT * FROM users WHERE active = 1 AND deleted_at IS NULL`);
}

/** Wrapped in an array to match the PHP's `return [$row ?? null];`. */
async function getXetra(id) {
  const row = await one(`SELECT * FROM xetra WHERE sant_nirdeshak = ?`, [id]);
  return [row ?? null];
}

async function getAllMandal() {
  return many(`SELECT * FROM mandals`);
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

async function getKaryakarMandal(sevakCode) {
  return one(
    `SELECT m.name AS mandal_name
       FROM users u
       JOIN mandal_role_assignments mra ON mra.user_id = u.id
       JOIN roles r   ON r.id = mra.role_id
       JOIN mandals m ON m.id = mra.mandal_id
      WHERE u.sevak_code = ? AND r.code IN (?)
      LIMIT 1`,
    [sevakCode, LEADERSHIP_CODES]
  );
}

async function checkId(sevakCode) {
  return one(`SELECT sevak_code FROM users WHERE sevak_code = ?`, [sevakCode]);
}

async function getSevakId(name) {
  return one(`SELECT sevak_code FROM users WHERE name = ?`, [name]);
}

async function getFilledForm(sevakCode) {
  return toInt(
    await scalar(
      `SELECT COUNT(r.id) AS cnt
         FROM receipts r
         JOIN users u ON u.id = r.collected_by_id
        WHERE u.sevak_code = ? AND r.deleted_at IS NULL`,
      [sevakCode]
    )
  );
}

async function getAllSevak() {
  return many(
    `SELECT u.*
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.code = 'SEVAK' AND u.active = 1 AND u.deleted_at IS NULL`
  );
}

async function getSevakDetails(sevakId) {
  return one(
    `SELECT u.*,
            r.code AS role_code,
            r.name AS role_name,
            GROUP_CONCAT(DISTINCT p.description ORDER BY p.description SEPARATOR ', ')
              AS permissions,
            m.id   AS mandal_id,
            m.name AS mandal_name
       FROM users u
       LEFT JOIN user_mandal_memberships umm ON umm.user_id = u.id
       LEFT JOIN mandals m          ON m.id = umm.mandal_id
       LEFT JOIN user_roles ur      ON ur.user_id = u.id
       LEFT JOIN roles r            ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p      ON p.id = rp.permission_id
      WHERE u.sevak_code = ? AND u.deleted_at IS NULL
      GROUP BY u.id, r.code, r.name, m.id, m.name`,
    [sevakId]
  );
}

async function getUserWithRole(sevakCode) {
  return one(
    `SELECT u.id, u.sevak_code, r.name AS role_code
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.sevak_code = ? AND u.active = 1`,
    [sevakCode]
  );
}

async function getUserMandalIdBySevakCode(sevakCode) {
  const row = await one(
    `SELECT umm.mandal_id
       FROM user_mandal_memberships umm
       JOIN users u ON u.id = umm.user_id
      WHERE u.sevak_code = ?
      ORDER BY umm.id DESC
      LIMIT 1`,
    [sevakCode]
  );
  return row?.mandal_id ?? null;
}

module.exports = {
  checkPermission,
  addSevak,
  updateSevak,
  deleteSevak,
  restoreSevak,
  getSevakByMandal,
  getSevak: getSevakByMandal,
  getCurrentYearTarget,
  getPreviousYearTarget,
  checkAdmin,
  getSevakRole,
  getSevakName,
  getRole,
  getAllUsers,
  getXetra,
  getAllMandal,
  getSevakMandal,
  getKaryakarMandal,
  checkId,
  getSevakId,
  getFilledForm,
  getAllSevak,
  getSevakDetails,
  getUserWithRole,
  getUserMandalIdBySevakCode,
};
