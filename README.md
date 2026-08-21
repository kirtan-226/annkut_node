# annkut-backend-node

Node.js port of the Annkut CodeIgniter 3 backend, packaged for AWS Lambda +
API Gateway with RDS MySQL.

The URL layout is unchanged — CodeIgniter's `/<controller>/<method>` — so the
Ionic frontend needs a new base URL and nothing else.

## Quick start

```bash
npm install
cp .env.example .env      # fill in DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
npm start                 # http://localhost:3001
```

Check it works:

```bash
npm run smoke                 # module load + routing, no database needed
DB_SMOKE_DB=1 npm run smoke   # additionally opens a connection
```

## Layout

```
src/
  app.js             Express app: routing, CORS, body parsing
  lambda.js          Lambda handler (production entry point)
  local.js           Local dev server (loads .env)
  config/env.js      Every environment variable, in one place
  db/
    pool.js          mysql2 pool, cached per execution environment
    credentials.js   Secrets Manager or DB_USER/DB_PASSWORD
    query.js         one() / many() / scalar() / exec() / withTransaction()
    introspect.js    Runtime tableExists() / fieldExists() for legacy tables
  routes/            One file per CodeIgniter controller
  models/            One file per CodeIgniter model
  utils/             PHP semantics (loose casts), dates, roles, export builders
db/schema.sql        RDS-ready schema, 16 tables, structure only
docs/DEPLOY.md       Step-by-step AWS deployment
docs/PARITY.md       What changed vs the PHP, and what was deliberately kept
template.yaml        SAM template for the whole stack
```

Controller coverage is complete: Login (2 endpoints), Sevak (7), Seva (7),
ReceiptBooks (7), Import_karyakar (1).

## Configuration

All configuration is environment variables; see [.env.example](.env.example) for
the annotated list. Nothing reads `process.env` outside `src/config/env.js`.

Database credentials come from **either** `DB_SECRET_ARN` (a Secrets Manager
secret, used in production) **or** `DB_USER` + `DB_PASSWORD` (local
development). The secret takes priority when both are set.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md). Short version:

```bash
npm ci --omit=dev
sam build
sam deploy --guided
```

## Before you go live

Three things from [docs/PARITY.md](docs/PARITY.md) that need a decision, not
just a deploy:

1. **Rotate the old database credentials.** They were hard-coded in
   `application/config/database.php` and are in that repo's history.
2. **Set `APP_TIMEZONE` to match the old cPanel host.** It decides which row of
   `sevak_targets` / `mandal_targets` counts as "this year".
3. **Passwords are stored in plain text and there are no sessions** — every
   endpoint trusts the `sevak_id` in the request body. Both are pre-existing and
   unchanged by this port. They are the obvious next work item.
