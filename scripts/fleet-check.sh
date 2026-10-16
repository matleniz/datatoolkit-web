#!/usr/bin/env bash
# Project CHECK. Run from anywhere; it cd's to the repo root and runs, stopping
# at the first failure:
#   1. npm ci   2. lint, typecheck, unit tests   3. knip   4. full e2e (Playwright)
# Env: DTK_ENGINE_DIR (engine checkout, default ~/datatoolkit). Passed through
# to Playwright when set: DTK_E2E_HOME, DTK_UI_TOKEN, DTK_API_CMD, DTK_API_BIN,
# DTK_CORS_ORIGINS, DTK_AGENT_PACK, DTK_E2E_SKIP_ENGINE. Honours npm_config_*
# (e.g. npm_config_offline=true). Works under `env -i HOME=... PATH=...`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

start=$SECONDS
stage() {
  printf '\n==> [%s] %s\n' "$((SECONDS - start))s" "$1"
}

stage "1/4 npm ci"
npm ci --prefer-offline --no-audit --no-fund

stage "2/4 lint, typecheck, unit tests"
npm run lint
npm run typecheck
npm test

stage "3/4 knip"
npx --prefer-offline knip@6 --exclude types

stage "4/4 e2e (playwright)"
# Two free TCP ports on 127.0.0.1 (same one-liner as PR #155).
ports=$(node -e 'const n=require("net");const a=n.createServer().listen(0,"127.0.0.1",()=>{const b=n.createServer().listen(0,"127.0.0.1",()=>{console.log("export DTK_E2E_API_PORT="+a.address().port+" DTK_E2E_WEB_PORT="+b.address().port);a.close();b.close()})})')
eval "$ports"
: "${DTK_E2E_API_PORT:?port picker failed}" "${DTK_E2E_WEB_PORT:?port picker failed}"
DTK_ENGINE_DIR="${DTK_ENGINE_DIR:-$HOME/datatoolkit}"
export DTK_ENGINE_DIR
npx playwright test

printf '\n==> CHECK ok, total %ss\n' "$((SECONDS - start))"
