#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Rusto LMS — Local Quickstart (all 3 portals + backend)
# Usage:  bash quickstart.sh
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Rusto LMS — Full Stack Dev               ${NC}"
echo -e "${CYAN}════════════════════════════════════════════${NC}"

# ── Check prerequisites ──────────────────────────────────────────────
check_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo -e "${RED}✗ $1 not found. $2${NC}"; exit 1; }
}
check_cmd python3 "Install Python 3.11+"
check_cmd node    "Install Node.js 18+ from https://nodejs.org"
check_cmd npm     "Install Node.js 18+ from https://nodejs.org"

# ── Install frontend dependencies ────────────────────────────────────
cd "$(dirname "$0")/frontend"
if [ ! -d node_modules ]; then
  echo -e "${CYAN}Installing frontend dependencies...${NC}"
  npm install
fi
# Ensure concurrently is available
if ! npm list concurrently >/dev/null 2>&1; then
  echo -e "${CYAN}Installing concurrently...${NC}"
  npm install --save-dev concurrently
fi
cd ..

# ── Install backend dependencies ─────────────────────────────────────
cd backend
if [ ! -d venv ]; then
  echo -e "${CYAN}Creating Python venv...${NC}"
  python3 -m venv venv
fi
source venv/bin/activate
echo -e "${CYAN}Installing backend dependencies...${NC}"
pip install -q -r requirements.txt
cd ..

# ── Kill any processes on our ports ──────────────────────────────────
for port in 8000 3000 3001 3002; do
  pid=$(lsof -ti tcp:$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill -9 $pid 2>/dev/null || true
    echo -e "${YELLOW}  Freed port $port${NC}"
  fi
done
sleep 1

# ── Start backend ─────────────────────────────────────────────────────
echo -e "${CYAN}Starting backend on :8000...${NC}"
cd backend
source venv/bin/activate
DATABASE_URL="sqlite:///lodge_lms.db" \
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload \
  > /tmp/rusto-backend.log 2>&1 &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID"
cd ..

# Wait for backend ready
echo -e "${CYAN}Waiting for backend...${NC}"
for i in $(seq 1 20); do
  if curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Backend ready${NC}"
    break
  fi
  sleep 1
done

# ── Start all 3 frontend portals ─────────────────────────────────────
echo -e "${CYAN}Starting all 3 frontend portals...${NC}"
cd frontend

# Combined (port 3000)
npm run dev -- --port 3000 > /tmp/rusto-fe-combined.log 2>&1 &
FE_COMBINED=$!

# PMS portal (port 3001)
npm run dev:pms > /tmp/rusto-fe-pms.log 2>&1 &
FE_PMS=$!

# Customer portal (port 3002)
npm run dev:customer > /tmp/rusto-fe-customer.log 2>&1 &
FE_CUSTOMER=$!

echo "  Combined  PID: $FE_COMBINED"
echo "  PMS       PID: $FE_PMS"
echo "  Customer  PID: $FE_CUSTOMER"
cd ..

# Wait for frontends
sleep 4
echo -e "${CYAN}Waiting for frontends...${NC}"
for port in 3000 3001 3002; do
  for i in $(seq 1 15); do
    if curl -fsS http://localhost:$port >/dev/null 2>&1; then
      echo -e "${GREEN}  ✓ Port $port ready${NC}"
      break
    fi
    sleep 1
  done
done

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ All services running!                  ${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}PMS Portal${NC}       → ${CYAN}http://localhost:3001${NC}"
echo -e "  ${YELLOW}Customer Portal${NC}  → ${CYAN}http://localhost:3002${NC}"
echo -e "  ${YELLOW}Combined Portal${NC}  → ${CYAN}http://localhost:3000${NC}"
echo -e "  ${YELLOW}API / Swagger${NC}    → ${CYAN}http://localhost:8000/docs${NC}"
echo ""
echo -e "  Credentials:"
echo -e "    ${CYAN}superadmin${NC} / superadmin123    (all lodges)"
echo -e "    ${CYAN}admin${NC}      / Admin@1234         (lodge admin)"
echo -e "    ${CYAN}staff1${NC}     / Staff1@1234        (staff)"
echo -e "    ${CYAN}staff2${NC}     / Staff2@1234        (staff)"
echo -e "    Customer: phone=${CYAN}9000000000${NC}  password=${CYAN}Demo@1234${NC}"
echo ""
echo -e "  Logs: /tmp/rusto-backend.log | /tmp/rusto-fe-*.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Keep running; trap Ctrl+C to kill all children
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FE_COMBINED $FE_PMS $FE_CUSTOMER 2>/dev/null; exit 0" INT TERM
wait
