'use strict';

const { arrayColumn } = require('./php');

/**
 * Role code <-> number mappings, copied verbatim from the PHP.
 *
 * These are NOT self-consistent in the original, and the inconsistency is
 * load-bearing for the frontend, so all three tables are preserved as-is.
 *
 *  - CODE_TO_NUM        Sevak_model::get_sevak_role()  ADMIN=1, SANT_NIRDESHAK=7
 *  - LOGIN_NUM_TO_LABEL Login::login()                 1=Admin, 7=Sant Nirdeshak
 *  - LIST_NUM_TO_LABEL  Sevak::get_sevak()             1=Sanchalak, 7=Admin
 *
 * LOGIN_NUM_TO_LABEL is the inverse of CODE_TO_NUM, so /login reports the role
 * correctly. LIST_NUM_TO_LABEL is a *different* table applied to the same
 * numbers, so /sevak/get_sevak labels an ADMIN (1) as "Sanchalak" and a
 * SANT_NIRDESHAK (7) as "Admin". That is existing behaviour the UI has been
 * built around; see docs/PARITY.md before changing it.
 */

const CODE_TO_NUM = {
  SANCHALAK: 5,
  NIRIKSHAK: 4,
  NIRDESHAK: 3,
  SANYOJAK: 2,
  SANT_NIRDESHAK: 7,
  SEVAK: 6,
  ADMIN: 1,
};

const LOGIN_NUM_TO_LABEL = {
  5: 'Sanchalak',
  4: 'Nirikshak',
  3: 'Nirdeshak',
  2: 'Sanyojak',
  7: 'Sant Nirdeshak',
  6: 'Sevak',
  1: 'Admin',
};

const LIST_NUM_TO_LABEL = {
  1: 'Sanchalak',
  2: 'Nirikshak',
  3: 'Nirdeshak',
  4: 'Sanyojak',
  5: 'Sant Nirdeshak',
  6: 'Sevak',
  7: 'Admin',
};

/** Leadership roles that can hold a mandal assignment. */
const LEADERSHIP_CODES = ['SANYOJAK', 'NIRDESHAK', 'NIRIKSHAK', 'SANCHALAK'];

/**
 * Sevak_model::get_sevak_role() -- highest numeric rank across the user's roles.
 *
 * Because ADMIN maps to 1 and SEVAK to 6, a user holding both ADMIN and SEVAK
 * resolves to 6 ("Sevak"), not Admin. Preserved deliberately.
 */
function highestRoleNum(roleRows) {
  const codes = arrayColumn(roleRows, 'code');
  let max = 0;
  for (const code of codes) {
    const n = CODE_TO_NUM[code] ?? 0;
    if (n > max) max = n;
  }
  return max;
}

/**
 * Sevak_model::check_admin() -- a coarser, separate scale from the one above.
 * ADMIN wins at 7, SEVAK at 6, everything else 0.
 */
function adminRoleNum(roleRows) {
  const codes = arrayColumn(roleRows, 'code');
  if (codes.includes('ADMIN')) return 7;
  if (codes.includes('SEVAK')) return 6;
  return 0;
}

module.exports = {
  CODE_TO_NUM,
  LOGIN_NUM_TO_LABEL,
  LIST_NUM_TO_LABEL,
  LEADERSHIP_CODES,
  highestRoleNum,
  adminRoleNum,
};
