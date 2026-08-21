# Parity notes: CodeIgniter 3 → Node.js

What this port changed, what it deliberately kept, and where the original was
already broken. Read this before "fixing" anything that looks wrong.

The guiding rule was: **preserve observable behaviour, even when it is a bug**,
because the Ionic frontend has been built against it. Deviations are listed
explicitly below and each one is either a security fix or a case where the
original behaviour was unreachable.

---

## 1. Bugs preserved on purpose

These are defects in the PHP that the frontend now depends on. Changing any of
them is a frontend-visible change.

### 1.1 `get_mandal_list` ignores its own role check

`Sevak.php` branched on:

```php
if($data['sevak_id'] === 'KR002' || 'KR100'){
```

The second operand is a bare non-empty string, which PHP evaluates as `true`,
so **the whole condition is always true** regardless of `sevak_id`. The
xetra-scoped branch underneath it was dead code. Every admin and
sant-nirdeshak sees all mandals.

Ported as-is in [`src/routes/sevak.js`](../src/routes/sevak.js). If you want the
scoping the author intended, that is a behaviour change and needs frontend
sign-off.

### 1.2 `mandal_array` changes shape by role

The same endpoint returns the *raw* mandal list as `mandal_array`, not the
enriched array the loop above it builds. The two role branches source that list
from different queries, so leaders receive `[{mandal_name}]` while admins
receive full summary rows. Preserved.

### 1.3 Role code tables are mutually inconsistent

`src/utils/roles.js` carries three lookup tables copied verbatim. The
number→label map does not agree with the label→number map: an `ADMIN` (1) is
labelled "Sanchalak" and a `SANT_NIRDESHAK` (7) is labelled "Admin" by
`/sevak/get_sevak`. The UI has been built around these strings. Preserved.

### 1.4 `forgot_password` cannot report failure

`Login_model::update_password_plain()` returned true whenever the `UPDATE`
executed, because it tested `affected_rows() >= 0` — true even when zero rows
matched. The controller's 500-on-failure branch was therefore unreachable: a
reset for a non-existent user reports success. Preserved.

Note the name is literal: the password is stored **in plain text**, then and
now. See [Security](#4-security-deviations).

### 1.5 Receipt book size is 50, not 25

`Receipt_book_model`'s docblock said 25 and its constant said 50. 50 is what
executed, so 50 is what this port uses.

---

## 2. Bugs fixed

### 2.1 Currency columns exported blank

`Import_karyakar`'s SpreadsheetML export matched header labels to row keys by
stripping punctuation and comparing what was left. That mapping silently failed
for the two currency columns — header `₹500 Seva` normalised to `500seva`,
while the column `rs500_seva` normalised to `rs500seva`. The cells exported
blank on every row.

`src/utils/excel.js` now binds columns explicitly by key, so those cells carry
their values. This is a fix, not a preserved bug, because no consumer could have
depended on a permanently empty column.

### 2.2 Character set

The PHP connected as `utf8`/`utf8_general_ci` while the export queries forced
`SET NAMES utf8mb4`. This port uses `utf8mb4` everywhere. `utf8mb4` is a strict
superset of MySQL's 3-byte `utf8`, so no existing text changes meaning, and it
is what the Gujarati name data actually requires.

---

## 3. Dead code that is now live

### 3.1 `/import_karyakar/annkut` was unreachable

The file is `Import_karyakar.php` but declares `class Export`. CodeIgniter
resolves a controller by matching class name to file name, so this route
returned 404 and nothing else reached the class.

**It is now live for the first time.** Its queries have never run in
production. Verify the output before pointing anyone at it.

### 3.2 `Check_role.php` declared the wrong class

Named `Check_role.php`, declares `class Auth_model` — so CI's loader could never
resolve it, and no controller referenced it anyway. Ported to
`src/models/authModel.js` as the natural home for the role helpers, but nothing
calls it. Delete it if you prefer.

---

## 4. Security deviations

Three intentional departures. All three make the API stricter.

### 4.1 CORS is now a single allowlist

`Login.php` checked `Origin` against a two-entry allowlist. `Seva.php`,
`Sevak.php` and `ReceiptBooks.php` reflected **any** `Origin` back with
`Access-Control-Allow-Credentials: true` — which lets any website on the
internet make credentialed calls on a logged-in user's behalf.

The allowlist now applies uniformly, driven by `CORS_ALLOWED_ORIGINS`. The real
frontend keeps working; the reflection hole is closed.

### 4.2 SQL errors no longer leak to clients

`Sevak::get_sevak` echoed `$e->getMessage()` straight to the caller, exposing
SQL fragments and table names. Errors now return a generic shape and the detail
goes to CloudWatch. Set `EXPOSE_ERRORS=true` to get the old behaviour locally.

### 4.3 Credentials are out of source

The PHP hard-coded the database user and password in
`application/config/database.php`. This port takes them from Secrets Manager in
production, env vars locally, and never from source.

**Those hard-coded credentials are in the old repo's history and must be rotated
before or during cutover.**

### 4.4 Still outstanding — not fixed here

Deliberately left alone, because fixing them changes the login contract and
needs a frontend change and a data migration:

- **Passwords are stored and compared in plain text.** No hashing anywhere.
- **There are no sessions or tokens.** Every endpoint trusts the `sevak_id` in
  the request body, so any caller can act as any user by guessing an ID.

Both are pre-existing. Neither is made worse by this port, and neither is fixed
by it. They are the top two items for whatever comes after cutover.

---

## 5. Behavioural details worth knowing

**Request bodies.** Every PHP controller did
`json_decode(file_get_contents("php://input"), true) ?: []`, ignoring
`Content-Type` and degrading malformed JSON to an empty array. `src/app.js`
reproduces exactly that: any content type is parsed as JSON, and a parse failure
yields `{}` rather than a 400.

**Routing.** URLs keep CI's `/<controller>/<method>` layout, so the frontend
needs only a new base URL. Matching is case-insensitive, as it was on the old
host — the frontend calls a mix of `/Login/login` and `/login/login`. A
`/index.php/...` prefix is stripped rather than 404'd.

**Timezone.** The PHP never called `date_default_timezone_set()`, so `date('Y')`
followed the cPanel server's timezone. That value decides which row of
`sevak_targets` / `mandal_targets` counts as "this year". It is now explicit via
`APP_TIMEZONE`, defaulting to `Asia/Kolkata` in `template.yaml`. **Set this to
whatever the old host used**, or writes near the year boundary land on the wrong
row.

**Numeric types.** CI returned every column as a string and the controllers cast
with `(int)`/`(float)` at the point of use. The pool sets `decimalNumbers:
false` and `dateStrings: true` to match, which also avoids float precision loss
on `seva_amount`.

**Legacy tables.** `annkut_sevak` and `form_details` are from an older schema and
are absent from the current dump. Every reference is guarded by a runtime
`tableExists()` check (`src/db/introspect.js`), so the code works with or
without them.

**Export formats.** Both download endpoints emit files named `.xls` that are not
Excel binaries — `Seva::export_data` streams tab-separated text and
`Import_karyakar::annkut` streams SpreadsheetML 2003 XML. Excel opens both. Kept
as-is rather than "upgraded" to real `.xlsx`, which would change what downstream
consumers receive.

**SQL injection.** A few models (notably `Mandal_model`'s derived-table joins)
interpolated values directly into SQL. Every query in this port is
parameterised.
