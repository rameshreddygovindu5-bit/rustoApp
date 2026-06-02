# TROUBLESHOOTING — "Failed to load dashboard"

If you're seeing **"Failed to load dashboard"** + **"Server error. Please try again."**
toasts, follow this guide. The dashboard endpoint is now bulletproof — every
individual query is wrapped, so it should always return data, even partial.
If you're STILL seeing the error after re-deploying, the root cause is one of
the things below.

---

## STEP 1 — Confirm the new code actually deployed

Look at GitHub Actions:
- Go to your repo → **Actions** tab
- The latest "Deploy to EC2" run should be green
- Open it and check the "External health check" step printed `✓ Deployed successfully`

If the workflow didn't run at all, your push might be on a branch other than
`main` or `master`. The workflow now triggers on **both**, so push to either.

If the workflow ran but failed, scroll to the failed step. The most likely
failure points and their causes:
- **"Backend never reported healthy"** → backend container can't start. The
  workflow now dumps the last 200 lines of backend logs in this case — read
  those to find the actual error.
- **"External health check failed"** → backend started but nginx can't reach
  it, or the EC2 security group is blocking port 80.

---

## STEP 2 — Use the diagnostic endpoint

Once you have a deploy that *seems* healthy, hit this URL in your browser:

```
http://YOUR_EC2_HOST/api/diagnostics
```

You'll get a JSON response like:

```json
{
  "version": "2.0.0",
  "python_env": {
    "DATABASE_URL_set": true,
    "JWT_SECRET_KEY_set": true,
    "CORS_ORIGINS": "http://localhost,https://your-domain.example.com",
    "AGENT_PROVIDER": "(unset)",
    "ANTHROPIC_API_KEY": "(unset)",
    "OPENAI_API_KEY": "(unset)"
  },
  "database": {
    "url_scheme": "postgresql",
    "url_host": "db:5432",
    "connected": true,
    "tables": ["agencies", "agent_conversations", "alerts", "audit_log",
               "bookings", "checkins", "customers", "invoices", "rooms",
               "settings", "users", "webhook_deliveries"],
    "table_count": 12
  },
  "counts": {
    "rooms": 21,
    "users": 1,
    "settings": 36
  }
}
```

### Diagnose from this output:

| What you see | What it means | Fix |
|---|---|---|
| `"DATABASE_URL_set": false` | Your `.env.production` is missing or doesn't have `DATABASE_URL` | Re-run `ec2-bootstrap.sh` or copy `.env.production.example` |
| `"url_scheme": "sqlite"` | Backend is using SQLite — bad! Means env var didn't reach the container | Check `.env.production` exists and has `DATABASE_URL=postgresql://...` |
| `"connected": false` | Backend can't reach Postgres | Check `db` container is running: `docker compose ps`. Check the password in `.env.production` matches what `db` was created with. |
| `"tables": []` | Schema not created | Look at backend logs — `Base.metadata.create_all` failed |
| `"counts.rooms": 0` | Seed didn't run (or failed) | Look at backend logs for "Seeding failed" |
| `"counts.users": 0` | No admin user — you can't log in | Same — seeding failed. Check logs. |

---

## STEP 3 — Inspect the actual backend error

If diagnostics says everything is fine but dashboard still fails, hit it
manually with a logged-in token. Browser DevTools → Network tab → reload
dashboard page → click the failed `/api/reports/dashboard` request →
**Response tab**. The response now includes the exact exception type and message:

```json
{
  "detail": "<the actual error>",
  "type": "DataError",
  "path": "/api/reports/dashboard"
}
```

Or pull from logs on EC2:

```bash
ssh ubuntu@your-ec2
cd /opt/rusto-lms
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=200 backend | grep -A 20 dashboard
```

The dashboard endpoint now logs each individual query failure with full
traceback under names like `dashboard.total_rooms`, `dashboard.activity`, etc.

---

## STEP 4 — Common root causes (in order of likelihood)

### a) Old container still running

`docker compose down` doesn't always replace running containers cleanly if
they have the same name. Force it:

```bash
cd /opt/rusto-lms
docker compose -f docker-compose.prod.yml --env-file .env.production down --remove-orphans
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate
```

### b) Stale Postgres volume

If you previously deployed with different credentials, the named volume
`lms_pgdata` still has the old user/password. The new backend can't connect.
Wipe and re-init:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production down -v   # ← -v drops volumes!
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

⚠ This wipes ALL data. Backup first if you have real data:
```bash
docker exec rusto_lms_db pg_dump -U lms rusto_lms > backup.sql
```

### c) `.env.production` malformed

Common mistakes:
- `POSTGRES_PASSWORD=foo bar` (space breaks parsing → use quotes or no spaces)
- `DATABASE_URL` references `${POSTGRES_PASSWORD}` but it's defined later in
  the file (variables in `.env` files are NOT expanded — write the password
  literally in `DATABASE_URL`)
- File has Windows CRLF line endings (run `dos2unix .env.production`)

### d) The frontend's compiled bundle is cached in your browser

Hard-refresh: **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (Mac).
Or open in incognito.

### e) Nginx is not routing /api/ correctly

Verify with:
```bash
curl -i http://YOUR_EC2_HOST/api/health
# should return: {"status":"healthy","database":"connected","version":"2.0.0"}
```
If you get HTML instead of JSON, the outer nginx isn't proxying — check
`nginx/conf.d/default.conf` is mounted in the nginx container.

---

## STEP 5 — If all else fails: nuclear redeploy

```bash
ssh ubuntu@your-ec2
cd /opt/rusto-lms
docker compose -f docker-compose.prod.yml --env-file .env.production down -v --remove-orphans
docker system prune -af --volumes
sudo systemctl stop nginx 2>/dev/null
git pull       # if you cloned the repo here (otherwise re-run the workflow)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --force-recreate
sleep 30
curl http://localhost/api/diagnostics
```

The `up -d --build --force-recreate` flag combined with prior `down -v` and
`prune -af --volumes` GUARANTEES every layer is rebuilt from scratch and every
volume is fresh.
