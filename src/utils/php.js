'use strict';

/**
 * PHP value-semantics helpers.
 *
 * The controllers lean heavily on empty(), (int) and (float) casts, and PHP's
 * coercion rules differ from JavaScript's in ways that change behaviour on real
 * payloads. Re-implementing them explicitly keeps the port faithful instead of
 * approximately right.
 */

/**
 * PHP empty().
 *
 * The important divergence from JS falsiness: the STRING "0" is empty in PHP
 * but truthy in JS. Guards like `empty($data['book_no'])` therefore reject
 * book_no "0", and `!empty($data['sevak_target'])` skips a target of "0".
 * A plain `if (!v)` in JS would agree here by accident for 0 and "" but a
 * `Boolean(v)` check on "0" would not.
 */
function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (value === false || value === 0) return true;
  if (typeof value === 'string') return value === '' || value === '0';
  if (typeof value === 'number') return value === 0 || Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * PHP (int) cast.
 *
 * Parses a leading integer and yields 0 for anything unparseable -- including
 * null, '', 'abc' and true-ish objects. JS Number('') is 0 but Number('abc')
 * is NaN, and parseInt(null) is NaN, so neither is a drop-in on its own.
 */
function toInt(value) {
  if (value === undefined || value === null || value === false) return 0;
  if (value === true) return 1;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return Math.trunc(value);
  }
  const match = String(value).trim().match(/^[+-]?\d+/);
  if (!match) return 0;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) ? n : 0;
}

/** PHP (float) cast: leading numeric prefix, 0 otherwise. */
function toFloat(value) {
  if (value === undefined || value === null || value === false) return 0;
  if (value === true) return 1;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const match = String(value)
    .trim()
    .match(/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/);
  if (!match) return 0;
  const n = Number.parseFloat(match[0]);
  return Number.isFinite(n) ? n : 0;
}

/** PHP (string) cast for scalars, with null/undefined collapsing to ''. */
function toStr(value) {
  if (value === undefined || value === null) return '';
  if (value === true) return '1';
  if (value === false) return '';
  return String(value);
}

/** PHP array_column($rows, $key). */
function arrayColumn(rows, key) {
  return (rows || []).map((r) => r[key]).filter((v) => v !== undefined);
}

/** PHP mt_rand($min, $max), inclusive on both ends. */
function mtRand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Splits a GROUP_CONCAT CSV into a unique, trimmed, non-empty list.
 * Mirrors array_unique(array_filter(array_map('trim', explode(',', $csv)))).
 * array_filter drops '0' as well as '', matching isEmpty above.
 */
function csvToList(csv) {
  const parts = toStr(csv)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '0');
  return Array.from(new Set(parts));
}

module.exports = {
  isEmpty,
  toInt,
  toFloat,
  toStr,
  arrayColumn,
  mtRand,
  csvToList,
};
