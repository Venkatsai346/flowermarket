#!/usr/bin/env bash
# Start a single-node MongoDB replica set for the live E2E / browser UI jobs.
#
# WHY THIS IS A SCRIPT AND NOT A `services:` CONTAINER
#
# GitHub Actions service containers accept exactly six keys — image, credentials,
# env, ports, volumes, options — and there is NO way to give one a command. The
# intuitive spelling,
#
#     services:
#       mongo:
#         image: mongo:6.0.6
#         args: ['--replSet', 'rs0', '--bind_ip_all']     # ← not a valid key
#
# does not fail that job. It fails the entire workflow *at parse time*, before a
# single job or check-run is created, so the run shows a red X with an empty graph
# and the annotation is buried on the run page. Every job in the file dies with it,
# including the ones that need no database at all. That is how this repo ran 26
# consecutive instant failures that looked like flaky infrastructure.
#
# The --replSet flag is not optional: boot-live-stack.sh issues replSetInitiate,
# and mongod refuses that with "not running with --replSet" unless it was started
# with the flag. Transactions — which the order, payout and ledger paths depend on
# — require a replica set with a PRIMARY, so a plain standalone mongod is not a
# usable substitute either.
#
# Hence: start the container explicitly, where the command is ours to give.
#
# This script stops at "mongod accepts connections". Initiating rs0 and waiting for
# PRIMARY is deliberately left to boot-live-stack.sh, which already does both
# idempotently — doing it twice would mean two copies of the wait loop to keep in
# step (the same drift that produced this file's existence).
#
# Usage:  bash scripts/ci/start-mongo-rs0.sh
# Env:    FM_MONGO_IMAGE           (default mongo:6.0.6)
#         FM_MONGO_CONTAINER       (default fm-mongo)
#         FM_MONGO_PORT            (default 27017)
#         FM_MONGO_READY_TIMEOUT   (default 90 seconds)
set -euo pipefail

IMAGE="${FM_MONGO_IMAGE:-mongo:6.0.6}"
NAME="${FM_MONGO_CONTAINER:-fm-mongo}"
PORT="${FM_MONGO_PORT:-27017}"
READY_TIMEOUT="${FM_MONGO_READY_TIMEOUT:-90}"

log() { echo "[mongo] $*"; }

command -v docker >/dev/null 2>&1 || { log "docker is not available on PATH"; exit 1; }

# Idempotent: a re-run in the same job (or a locally reused runner) must not fail
# on a name collision or a stale container holding the port.
docker rm -f "$NAME" >/dev/null 2>&1 || true

log "starting $IMAGE as '$NAME' on :$PORT (--replSet rs0 --bind_ip_all)"
docker run -d --name "$NAME" -p "$PORT:27017" "$IMAGE" --replSet rs0 --bind_ip_all >/dev/null

for i in $(seq 1 "$READY_TIMEOUT"); do
  if docker exec "$NAME" mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'; then
    log "accepting connections after ${i}s"
    log "rs0 is NOT yet initiated — boot-live-stack.sh runs replSetInitiate"
    log "and waits for PRIMARY before seeding."
    exit 0
  fi
  sleep 1
done

# Fail loudly with the container's own log: a bare "timed out" here sends the next
# engineer hunting in the wrong place (the usual causes are an image pull failure
# or the port already bound).
log "did not accept connections within ${READY_TIMEOUT}s — container log tail:"
docker logs --tail 60 "$NAME" 2>&1 || true
exit 1
