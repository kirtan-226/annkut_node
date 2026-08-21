# Deploying to AWS

Target architecture:

```
Amplify (Ionic frontend)
        │  HTTPS
        ▼
API Gateway HTTP API  ──►  Lambda (Node 22, arm64)  ──►  RDS MySQL 8.0
                                    │                      ▲
                                    └── Secrets Manager ────┘
                                        (db credentials)
```

Lambda runs in private subnets; RDS is not publicly reachable. The whole thing
fits comfortably in the low tens of dollars a month at this app's traffic, and
scales to zero when idle.

---

## 0. Prerequisites

- AWS CLI configured (`aws sts get-caller-identity` works)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- A MySQL client, for loading the schema
- Node 20+ (the function targets 22)

Pick one region and stay in it. `ap-south-1` (Mumbai) is the sensible choice
here — lowest latency to the users and to the existing Amplify app.

---

## 1. Network

If you already have a VPC with private subnets, use it and skip ahead. What the
stack needs:

- **At least two private subnets** in different availability zones. RDS requires
  two AZs for a subnet group even in single-AZ mode.
- **A route to Secrets Manager** from those subnets. Two options:
  - a **VPC interface endpoint** for `com.amazonaws.<region>.secretsmanager` —
    ~$7/month, no internet exposure. Recommended.
  - a **NAT gateway** — ~$32/month. Only worth it if the function needs the
    public internet for something else. It does not, today.

  Without one of these, every cold start hangs for ten seconds and then fails to
  fetch credentials. This is the single most common way this deployment goes
  wrong.

- **Two security groups**:
  - `annkut-lambda-sg` — no inbound rules needed; default outbound is fine.
  - `annkut-rds-sg` — one inbound rule: TCP 3306, source = `annkut-lambda-sg`
    (the security group itself, not a CIDR).

---

## 2. Database

### 2.1 Create the instance

RDS MySQL **8.0**. The dump came from MySQL 5.7, but it contains no DEFINER
clauses, no stored routines, no views and no triggers, so nothing needs the
`SUPER` privilege that RDS withholds. It restores onto 8.0 cleanly.

Sensible starting point:

| Setting | Value | Why |
|---|---|---|
| Class | `db.t4g.micro` | Graviton, cheapest that isn't burstable-to-uselessness. Resize later. |
| Storage | 20 GB gp3, autoscaling on | The full dump is ~3 MB. |
| Multi-AZ | off for dev, on for prod | Doubles cost; halves downtime on failure. |
| Public access | **No** | Lambda reaches it inside the VPC. |
| Security group | `annkut-rds-sg` | From step 1. |
| Backup retention | 7 days | Enables point-in-time restore. |
| Deletion protection | on | |

Set the master password to something random; you will not type it again.

### 2.2 Store the credentials

```bash
aws secretsmanager create-secret \
  --name annkut/db \
  --description "Annkut RDS master credentials" \
  --secret-string '{"username":"admin","password":"<the-password>"}'
```

Note the returned ARN — it is the `DbSecretArn` parameter in step 4.

The function reads `username` and `password` from this JSON. If you attach the
secret to the RDS instance for managed rotation, RDS uses those same key names,
so rotation works without a code change.

### 2.3 Load the schema

RDS is private, so run this from a bastion, a Session Manager port-forward, or
CloudShell in the same VPC.

```bash
mysql -h <rds-endpoint> -u admin -p --ssl-mode=REQUIRED \
  -e "CREATE DATABASE IF NOT EXISTS bharuchbaps_annkut_new
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

mysql -h <rds-endpoint> -u admin -p --ssl-mode=REQUIRED \
  bharuchbaps_annkut_new < db/schema.sql
```

`db/schema.sql` is structure only — 16 tables, no rows. It is generated from the
production dump with two changes: `receipt_book_logs` becomes InnoDB (it was the
one MyISAM table, which would have excluded it from crash recovery and PITR),
and every `CREATE TABLE` is `IF NOT EXISTS` so the file is re-runnable.

**To migrate the existing data instead**, load the original dump, which carries
both structure and rows:

```bash
mysql -h <rds-endpoint> -u admin -p --ssl-mode=REQUIRED \
  bharuchbaps_annkut_new < ../../annkut_2025/bharuchbaps_annkut_new.sql

# then convert the one MyISAM table
mysql -h <rds-endpoint> -u admin -p --ssl-mode=REQUIRED bharuchbaps_annkut_new \
  -e "ALTER TABLE receipt_book_logs ENGINE=InnoDB;"
```

Verify the Gujarati text survived — this is the check that catches a charset
mistake before users do:

```sql
SELECT name FROM mandals LIMIT 5;
```

Mojibake here means the load used the wrong client charset. Drop the database
and reload; do not try to repair it in place.

### 2.4 Application user

Do not let the application use the master account:

```sql
CREATE USER 'annkut_app'@'%' IDENTIFIED BY '<another-random-password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON bharuchbaps_annkut_new.* TO 'annkut_app'@'%';
FLUSH PRIVILEGES;
```

Then store *these* credentials as the secret from 2.2 and keep the master
password for administration only.

---

## 3. Rotate the old credentials

The PHP app hard-coded its database credentials in
`application/config/database.php`, so they are in that repository's history and
on the old cPanel host. **Change them on the old host now**, independently of
this deployment. See [PARITY.md](PARITY.md#4-security-deviations).

---

## 4. Deploy

```bash
cd annkut-backend-node
npm ci --omit=dev
sam build
sam deploy --guided
```

`--guided` prompts for the template parameters:

| Parameter | Value |
|---|---|
| `Stage` | `prod` |
| `DbHost` | RDS endpoint (or RDS Proxy endpoint, see below) |
| `DbPort` | `3306` |
| `DbName` | `bharuchbaps_annkut_new` |
| `DbSecretArn` | ARN from step 2.2 |
| `AppTimezone` | `Asia/Kolkata` — **see the warning below** |
| `CorsAllowedOrigins` | your Amplify URL, comma-separated |
| `VpcSubnetIds` | the two private subnets |
| `LambdaSecurityGroupId` | `annkut-lambda-sg` |

Answers are saved to `samconfig.toml`; later deploys are just `sam deploy`.

> **`AppTimezone` is not cosmetic.** It decides which row of `sevak_targets` and
> `mandal_targets` counts as "this year". The PHP inherited it from the cPanel
> server implicitly. Set it to whatever that host used, or writes near the year
> boundary land on the wrong row.

The stack outputs `ApiBaseUrl`. That is what the frontend points at.

---

## 5. Verify

```bash
curl https://<api-id>.execute-api.<region>.amazonaws.com/prod/health
# {"status":true,"service":"annkut-backend-node","env":"production"}
```

`/health` deliberately does not touch the database, so it stays green during an
RDS failover. To confirm the database path end to end, call a real endpoint:

```bash
curl -X POST https://<...>/prod/sevak/get_mandal_list \
  -H 'content-type: application/json' \
  -d '{"sevak_id":"KR002"}'
```

Locally, the full smoke test:

```bash
npm run smoke              # routing + module load, no database needed
DB_SMOKE_DB=1 npm run smoke   # additionally runs SELECT 1
```

---

## 6. Point the frontend at it

Set the API base URL in the Ionic app to `ApiBaseUrl`. No path changes are
needed — the URL layout matches CodeIgniter's `/<controller>/<method>`.

Add the Amplify origin to `CorsAllowedOrigins` and redeploy if you did not set
it in step 4.

---

## 7. Operations

**Logs.** `/aws/lambda/annkut-api-prod` (application) and
`/aws/apigateway/annkut-prod` (access), both retained 30 days.

```bash
sam logs -n ApiFunction --stack-name <stack> --tail
```

**Cold starts.** ~1s at 512 MB. If that becomes a problem, provisioned
concurrency of 1 removes it, at roughly the cost of a small always-on instance.

**Connection count.** `DB_POOL_SIZE=2`, because each concurrent execution
environment holds its own pool — 50 concurrent Lambdas means up to 100
connections, and `db.t4g.micro` allows about 170. If concurrency will exceed
~50, put **RDS Proxy** in front of RDS and set `DbHost` to the proxy endpoint.
It multiplexes connections and handles failover without a code change. That is
the one change worth making before traffic grows, not after.

**Cost sketch** (ap-south-1, low traffic): RDS `db.t4g.micro` single-AZ ~$13,
storage ~$2, Secrets Manager ~$0.40, VPC endpoint ~$7, Lambda + API Gateway
~$0–1. Roughly **$22–25/month**. Multi-AZ RDS or a NAT gateway each add ~$13
and ~$32 respectively.

---

## 8. Rollback

The old PHP app is untouched by any of this. Rolling back is repointing the
frontend's base URL at the old host.

The one-way door is the **data**: once writes land in RDS, the old MySQL is
stale. Before cutover, either accept a short write freeze or plan a reverse
sync. Do the cutover at a quiet hour and take an RDS snapshot immediately
before.
