'use strict';

const config = require('../config/env');

/**
 * PHP date() equivalents, evaluated in APP_TIMEZONE.
 *
 * This matters more than it looks. `date('Y')` decides which row of
 * sevak_targets / mandal_targets counts as "this year", and it is called on
 * every login and every target write. If the Node runtime resolves the year in
 * UTC while the old PHP host resolved it in IST, then for the 5.5 hours after
 * midnight on 31 December the two disagree and targets get written against the
 * wrong year. Set APP_TIMEZONE to whatever the cPanel host used.
 */

function parts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const out = {};
  for (const { type, value } of fmt.formatToParts(date)) {
    out[type] = value;
  }
  // Intl can emit hour '24' at midnight for some locale/calendar combinations.
  if (out.hour === '24') out.hour = '00';
  return out;
}

/** PHP date('Y-m-d H:i:s') */
function mysqlDateTime(date = new Date()) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** PHP date('Y-m-d') */
function mysqlDate(date = new Date()) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** PHP date('Ymd_His') -- used in export filenames. */
function fileStamp(date = new Date()) {
  const p = parts(date);
  return `${p.year}${p.month}${p.day}_${p.hour}${p.minute}${p.second}`;
}

/** PHP (int)date('Y') */
function currentYear(date = new Date()) {
  return Number.parseInt(parts(date).year, 10);
}

module.exports = { mysqlDateTime, mysqlDate, fileStamp, currentYear };
