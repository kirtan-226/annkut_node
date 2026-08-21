'use strict';

const { one, many, exec } = require('../db/query');
const { toInt } = require('../utils/php');
const { currentYear } = require('../utils/dates');
const { LEADERSHIP_CODES } = require('../utils/roles');

/** Port of application/models/Mandal_model.php */

async function getMandalDetails(mandalName) {
  return one(`SELECT * FROM mandals WHERE name = ? LIMIT 1`, [mandalName]);
}

/**
 * Mandal roll-up: current-year target, receipt count, kshetra, and one
 * sanchalak per mandal.
 *
 * The PHP interpolated the year straight into three derived-table subqueries.
 * Same shape here, but the year is bound. Note the sanchalak is chosen with
 * MAX(sevak_code) purely to collapse multiple assignments to one row -- it is
 * lexicographic, not meaningful, which is why two sanchalaks in one mandal
 * surface arbitrarily.
 */
function mandalSummarySql(extraWhere = '') {
  return `
    SELECT m.name AS name,
           COALESCE(mt.mandal_target, 0)        AS mandal_target,
           COALESCE(rf.mandal_filled_form, 0)   AS mandal_filled_form,
           COALESCE(x.name, '')                 AS mandal_xetra,
           COALESCE(sc_code.sanchalak_code, '') AS sanchalak,
           COALESCE(u2.name, '')                AS sanchalak_name
      FROM mandals m
      LEFT JOIN xetra x ON x.id = m.xetra_id
      LEFT JOIN (
            SELECT mt.mandal_id, mt.target_forms AS mandal_target
              FROM mandal_targets mt
             WHERE mt.year = ?
      ) mt ON mt.mandal_id = m.id
      LEFT JOIN (
            SELECT r.mandal_id, COUNT(*) AS mandal_filled_form
              FROM receipts r
             WHERE r.deleted_at IS NULL
             GROUP BY r.mandal_id
      ) rf ON rf.mandal_id = m.id
      LEFT JOIN (
            SELECT mra.mandal_id, MAX(u.sevak_code) AS sanchalak_code
              FROM mandal_role_assignments mra
              JOIN roles rr ON rr.id = mra.role_id AND rr.code = 'SANCHALAK'
              JOIN users u  ON u.id = mra.user_id
             GROUP BY mra.mandal_id
      ) sc_code ON sc_code.mandal_id = m.id
      LEFT JOIN users u2 ON u2.sevak_code = sc_code.sanchalak_code
      ${extraWhere}
     ORDER BY m.name ASC`;
}

async function getAllMandal() {
  return many(mandalSummarySql(), [currentYear()]);
}

async function getMandalByXetra(id) {
  return many(mandalSummarySql('WHERE m.xetra_id = ?'), [currentYear(), id]);
}

async function getMandalTarget(mandalName) {
  const row = await one(
    `SELECT mt.target_forms AS mandal_target, m.name AS mandal_name
       FROM mandals m
       LEFT JOIN mandal_targets mt ON mt.mandal_id = m.id AND mt.year = ?
      WHERE m.name = ?`,
    [currentYear(), mandalName]
  );

  if (!row) return { mandal_target: 0, mandal_name: mandalName };
  return { ...row, mandal_target: toInt(row.mandal_target) };
}

async function getMandalCodeByName(mandalName) {
  if (!mandalName) return null;
  const row = await one(`SELECT code FROM mandals WHERE name = ? LIMIT 1`, [
    mandalName,
  ]);
  return row?.code ? String(row.code).toUpperCase() : null;
}

/**
 * Updates a mandal's code/name and upserts this year's target.
 *
 * The `xetra` key is accepted and ignored, exactly as in the PHP -- the branch
 * that would have handled it was left empty.
 */
async function updateMandal(mandal = {}) {
  if (!mandal.mandal_name) return false;

  const sets = [];
  const params = [];
  if (mandal.mandal_code) {
    sets.push('code = ?');
    params.push(mandal.mandal_code);
  }
  if (mandal.mandal_name) {
    sets.push('name = ?');
    params.push(mandal.mandal_name);
  }
  if (sets.length) {
    params.push(mandal.mandal_name);
    await exec(`UPDATE mandals SET ${sets.join(', ')} WHERE name = ?`, params);
  }

  if (mandal.mandal_target !== undefined) {
    const year = currentYear();
    const m = await one(`SELECT id FROM mandals WHERE name = ?`, [
      mandal.mandal_name,
    ]);
    if (m) {
      const exists = await one(
        `SELECT id FROM mandal_targets WHERE mandal_id = ? AND year = ?`,
        [m.id, year]
      );
      if (exists) {
        await exec(`UPDATE mandal_targets SET target_forms = ? WHERE id = ?`, [
          toInt(mandal.mandal_target),
          exists.id,
        ]);
      } else {
        await exec(
          `INSERT INTO mandal_targets (mandal_id, year, target_forms, target_amount)
           VALUES (?, ?, ?, 0)`,
          [m.id, year, toInt(mandal.mandal_target)]
        );
      }
    }
  }

  return true;
}

async function getSanchalakId(mandalName) {
  return one(
    `SELECT u.sevak_code AS sanchalak
       FROM mandals m
       JOIN mandal_role_assignments mra ON mra.mandal_id = m.id
       JOIN roles r ON r.id = mra.role_id
       JOIN users u ON u.id = mra.user_id
      WHERE m.name = ? AND r.code = 'SANCHALAK'
      LIMIT 1`,
    [mandalName]
  );
}

/** Mandals a leader is assigned to, by any leadership role. */
async function getRolewiseMandal(sevakCode) {
  return many(
    `SELECT m.name AS mandal_name
       FROM users u
       JOIN mandal_role_assignments mra ON mra.user_id = u.id
       JOIN roles r   ON r.id = mra.role_id
       JOIN mandals m ON m.id = mra.mandal_id
      WHERE u.sevak_code = ? AND r.code IN (?)`,
    [sevakCode, LEADERSHIP_CODES]
  );
}

async function incrementMandalTarget(mandalName, delta) {
  const d = toInt(delta);
  const year = currentYear();

  const m = await one(`SELECT id FROM mandals WHERE name = ?`, [mandalName]);
  if (!m) return false;

  const exists = await one(
    `SELECT id FROM mandal_targets WHERE mandal_id = ? AND year = ?`,
    [m.id, year]
  );
  if (exists) {
    await exec(
      `UPDATE mandal_targets SET target_forms = target_forms + ? WHERE id = ?`,
      [d, exists.id]
    );
  } else {
    await exec(
      `INSERT INTO mandal_targets (mandal_id, year, target_forms, target_amount)
       VALUES (?, ?, ?, 0)`,
      [m.id, year, d]
    );
  }
  return true;
}

module.exports = {
  getMandalDetails,
  getAllMandal,
  getMandalByXetra,
  getMandalTarget,
  getMandalCodeByName,
  updateMandal,
  getSanchalakId,
  getRolewiseMandal,
  incrementMandalTarget,
};
