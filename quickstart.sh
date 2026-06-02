#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
#  Rusto — local quickstart
#
#  One-command setup for a fresh clone. Runs everything you need to
#  get the platform on your laptop:
#    1. Python venv + backend deps (SQLite-only — no Postgres needed)
#    2. Node deps for the frontend
#    3. .env file from the example (only if missing)
#    4. Database migrations + default seed (admin / superadmin users)
#
#  After this script finishes:
#    - Backend:  cd backend && source venv/bin/activate && uvicorn app.main:app --reload
#    - Frontend: cd frontend && npm run dev
#    - Open:     http://localhost:3000
#    - Login:    admin / Admin@1234   (lodge admin)
#                superadmin / superadmin123  (cross-tenant)
#
#  This script is idempotent — safe to re-run. It will skip steps that
#  are already done.
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Pretty print helpers
GOLD='\033[38;5;221m'; NAVY='\033[38;5;25m'; GREEN='\033[32m'
RED='\033[31m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
say() { printf "${GOLD}▸${RESET} %s\n" "$*"; }
ok()  { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn(){ printf "${RED}!${RESET} %s\n" "$*"; }

printf "\n${BOLD}${NAVY}Rusto — Local Quickstart${RESET}\n"
printf "${DIM}Travel Anywhere. Rest Everywhere.${RESET}\n\n"

# ── 1. Tool checks ───────────────────────────────────────────────
say "Checking prerequisites..."
command -v python3 >/dev/null 2>&1 || { warn "python3 not found. Install Python 3.10+"; exit 1; }
command -v node >/dev/null 2>&1 || { warn "node not found. Install Node 18+ (https://nodejs.org)"; exit 1; }
command -v npm >/dev/null 2>&1 || { warn "npm not found"; exit 1; }
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
NODE_VER=$(node --version)
ok "python $PY_VER, node $NODE_VER"

# ── 2. Env file ──────────────────────────────────────────────────
if [ ! -f .env ]; then
    say "Creating .env from .env.example (SQLite default — no Postgres needed)"
    cp .env.example .env
    ok ".env created"
else
    ok ".env already exists, leaving alone"
fi

# ── 3. Python venv + backend deps ────────────────────────────────
cd backend
if [ ! -d venv ]; then
    say "Creating Python virtual environment..."
    python3 -m venv venv
fi
# shellcheck source=/dev/null
source venv/bin/activate

# Use the SQLite requirements file (skips psycopg2-binary, which needs
# libpq-dev system headers to compile on first run).
say "Installing backend dependencies (SQLite-only — fast path)..."
pip install --quiet --upgrade pip
if [ -f requirements_sqlite.txt ]; then
    pip install --quiet -r requirements_sqlite.txt
else
    pip install --quiet -r requirements.txt
fi
ok "backend deps installed"

# ── 4. Database init + seed ──────────────────────────────────────
# auto_migrate runs Base.metadata.create_all + additive migrations +
# seeds default lodge / RK lodge / admin / rkadmin / superadmin users.
# All idempotent — re-running just no-ops on already-seeded rows.
say "Initializing database + seeding defaults..."
DATABASE_URL="sqlite:///./lodge_lms.db" python3 -c "
import warnings, logging
warnings.filterwarnings('ignore')
logging.getLogger('apscheduler').setLevel(logging.ERROR)
from app.database import Base, engine
from app import models
from app.auto_migrate import run_additive_migrations
Base.metadata.create_all(bind=engine)
run_additive_migrations(engine)
print('  schema ready, defaults seeded')
"
ok "database ready"

deactivate
cd ..

# ── 5. Frontend deps ─────────────────────────────────────────────
cd frontend
if [ ! -d node_modules ]; then
    say "Installing frontend dependencies (this can take 1-2 minutes)..."
    npm install --no-audit --no-fund --loglevel=error
    ok "frontend deps installed"
else
    ok "frontend deps already installed"
fi
cd ..

# ── 6. Done ──────────────────────────────────────────────────────
printf "\n${GREEN}${BOLD}✓ Setup complete${RESET}\n\n"
printf "${BOLD}Run in two terminals:${RESET}\n"
printf "  ${GOLD}Terminal 1 (backend):${RESET}\n"
printf "    cd backend\n"
printf "    source venv/bin/activate\n"
printf "    uvicorn app.main:app --reload\n\n"
printf "  ${GOLD}Terminal 2 (frontend):${RESET}\n"
printf "    cd frontend\n"
printf "    npm run dev\n\n"
printf "${BOLD}Then open:${RESET}\n"
printf "  ${NAVY}http://localhost:3000${RESET}\n\n"
printf "${BOLD}Default logins:${RESET}\n"
printf "  Lodge admin:  ${GOLD}admin${RESET} / ${GOLD}Admin@1234${RESET}\n"
printf "  Super admin:  ${GOLD}superadmin${RESET} / ${GOLD}superadmin123${RESET}\n\n"
printf "${BOLD}Try lodge registration:${RESET}\n"
printf "  ${NAVY}http://localhost:3000/register${RESET}  (no login needed)\n\n"
