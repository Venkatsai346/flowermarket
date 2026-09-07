#!/usr/bin/env bash
# Boot the full live stack for E2E runs — GitHub Actions and local.
#
#   mongod (already up — service container on CI, local daemon otherwise)
#     → ensure replica set rs0 (idempotent)
#     → seed default tenant (idempotent) + point backend/.env at it
#     → API :4000  (node src/server.js)
#     → worker     (node src/worker.js)
#     → admin web  :5173  + storefront :5174  (Vite, --strictPort)
#
# Idempotent: stale stack processes are stopped first (pids file, then pkill).
# Downstream steps source the env file it writes:
#   . /tmp/fm-ci/env.sh   # exports FM_TENANT_ID, API_LOG_FILE, MONGODB_URI
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$REPO_ROOT/backend"
FRONTEND="$REPO_ROOT/frontend"
CI_DIR="${FM_CI_DIR:-/tmp/fm-ci}"
MONGO_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/flower_market?directConnection=true}"
export MONGODB_URI="$MONGO_URI"
export NODE_ENV="${NODE_ENV:-development}"

API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-5173}"
STOREFRONT_PORT="${STOREFRONT_PORT:-5174}"

log() { echo "[boot] $*"; }
mkdir -p "$CI_DIR"
cd "$BACKEND"

# ---------------------------------------------------------------- 1. replica set
log "ensuring replica set rs0 on 127.0.0.1:27017 …"
node - <<'EOF'
const { MongoClient } = require('mongodb');
const uri = 'mongodb://127.0.0.1:27017/?directConnection=true';
(async () => {
  const c = new MongoClient(uri);
  await c.connect();
  const admin = c.db('admin');
  let initiated = false;
  try {
    await admin.command({ replSetGetStatus: 1 });
  } catch (e) {
    if (/no replset config/i.test(e.message)) {
      await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] } });
      initiated = true;
    }
  }
  for (let i = 0; i < 45; i++) {
    try {
      const s = await admin.command({ replSetGetStatus: 1 });
      if (s.members.some((m) => m.stateStr === 'PRIMARY')) {
        console.log(`[boot] replica set ${s.set} ready (${initiated ? 'initiated now' : 'already up'})`);
        await c.close();
        return;
      }
    } catch { /* step-up in progress */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('replica set did not reach PRIMARY within 90s');
})().catch((e) => { console.error('[boot] mongo fail:', e.message); process.exit(1); });
EOF

# ---------------------------------------------------------------- 2. seed tenant
log "seeding default tenant (idempotent) …"
SEED_OUT="$(node scripts/seed-default-tenant.js 2>&1)" || { echo "$SEED_OUT"; exit 1; }
echo "$SEED_OUT" | tail -2
TENANT_ID="$(printf '%s\n' "$SEED_OUT" | grep -oE 'DEFAULT_TENANT_ID=[0-9a-f]{24}' | head -1 | cut -d= -f2)"
[ -n "$TENANT_ID" ] || { echo "[boot] could not parse tenant id from seed output"; exit 1; }
log "tenant: $TENANT_ID"

# point backend/.env at the tenant (gitignored local dev file; created on CI)
if [ -f .env ] && grep -q '^DEFAULT_TENANT_ID=' .env; then
  sed -i "s/^DEFAULT_TENANT_ID=.*/DEFAULT_TENANT_ID=$TENANT_ID/" .env
  grep -q '^MONGODB_URI=' .env && sed -i "s|^MONGODB_URI=.*|MONGODB_URI=$MONGO_URI|" .env || true
else
  { [ -f .env ] || printf 'NODE_ENV=development\nPORT=%s\n' "$API_PORT" > .env; }
  grep -q '^DEFAULT_TENANT_ID=' .env || printf 'DEFAULT_TENANT_ID=%s\n' "$TENANT_ID" >> .env
  grep -q '^MONGODB_URI=' .env || printf 'MONGODB_URI=%s\n' "$MONGO_URI" >> .env
fi

# ---------------------------------------------------------------- 3. stop stale stack
if [ -f "$CI_DIR/pids" ]; then
  log "stopping previous stack (pids file) …"
  kill $(tr ' ' '\n' < "$CI_DIR/pids") 2>/dev/null || true
  sleep 1
fi
pkill -f 'src/server.js' 2>/dev/null || true
pkill -f 'src/worker.js' 2>/dev/null || true
pkill -f "vite --host 0.0.0.0 --port $WEB_PORT" 2>/dev/null || true
pkill -f "vite --host 0.0.0.0 --port $STOREFRONT_PORT" 2>/dev/null || true
sleep 1

# ---------------------------------------------------------------- 4. start
log "starting API :$API_PORT, worker, admin web :$WEB_PORT, storefront :$STOREFRONT_PORT …"
# Fully detach daemons (setsid + all fds redirected) so the invoking shell /
# CI step does not wait on them; $! of the setsid wrapper is the daemon pid.
DETACH="setsid"
command -v setsid >/dev/null 2>&1 || DETACH=""
nohup $DETACH node src/server.js < /dev/null > "$CI_DIR/api.out.log" 2>&1 &
API_PID=$!
nohup $DETACH node src/worker.js < /dev/null > "$CI_DIR/worker.out.log" 2>&1 &
WORKER_PID=$!
(cd "$FRONTEND/apps/web" && nohup $DETACH npm run dev -- --host 0.0.0.0 --port "$WEB_PORT" --strictPort < /dev/null > "$CI_DIR/vite-web.out.log" 2>&1 & echo $! > "$CI_DIR/.web-pid")
(cd "$FRONTEND/apps/storefront" && nohup $DETACH npm run dev -- --host 0.0.0.0 --port "$STOREFRONT_PORT" --strictPort < /dev/null > "$CI_DIR/vite-storefront.out.log" 2>&1 & echo $! > "$CI_DIR/.storefront-pid")
WEB_PID="$(cat "$CI_DIR/.web-pid")"
STOREFRONT_PID="$(cat "$CI_DIR/.storefront-pid")"
echo "$API_PID $WORKER_PID $WEB_PID $STOREFRONT_PID" > "$CI_DIR/pids"

# ---------------------------------------------------------------- 5. health gates
wait_for() { # url, name, seconds
  local i
  for i in $(seq 1 "$3"); do
    if curl -sf -o /dev/null "$1"; then log "$2 ready (${i}s)"; return 0; fi
    sleep 1
  done
  log "ERROR: $2 not ready after ${3}s"
  [ -n "${4:-}" ] && tail -25 "$4" || true
  return 1
}
wait_for "http://127.0.0.1:$API_PORT/readyz" "API /readyz" 90 "$CI_DIR/api.out.log"
wait_for "http://127.0.0.1:$WEB_PORT/" "admin web" 90 "$CI_DIR/vite-web.out.log"
wait_for "http://127.0.0.1:$STOREFRONT_PORT/" "storefront" 90 "$CI_DIR/vite-storefront.out.log"

# ---------------------------------------------------------------- 6. env for suites
cat > "$CI_DIR/env.sh" <<EOF
export FM_TENANT_ID=$TENANT_ID
export API_LOG_FILE=$CI_DIR/api.out.log
export MONGODB_URI=$MONGO_URI
EOF
log "stack up — source $CI_DIR/env.sh before running the e2e suites"
