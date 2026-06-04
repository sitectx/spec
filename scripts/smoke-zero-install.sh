#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${SITECTX_NPM_CACHE:-/private/tmp/sitectx-npm-cache}"
PACK_DIR="${SITECTX_PACK_DIR:-/private/tmp}"

cd "$ROOT_DIR"
PACKAGE_VERSION="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("package.json", "utf8")).version)')"
npm test
npm --cache "$CACHE_DIR" pack --pack-destination "$PACK_DIR"

TARBALL="$PACK_DIR/sitectx-${PACKAGE_VERSION}.tgz"
test -f "$TARBALL"

STRESS_DIR="$(mktemp -d /private/tmp/sitectx-zero-install.XXXXXX)"
cd "$STRESS_DIR"

npm exec --cache "$CACHE_DIR" \
  --package "$TARBALL" \
  -- sitectx --help

npm exec --cache "$CACHE_DIR" \
  --package "$TARBALL" \
  -- sitectx init --site-url http://localhost:3000 --name "Local Test Site" --force

npm exec --cache "$CACHE_DIR" \
  --package "$TARBALL" \
  -- sitectx validate .

APP_DIR="$(mktemp -d /private/tmp/sitectx-nextapp.XXXXXX)"
cd "$APP_DIR"
printf '{"scripts":{"dev":"next dev"}}\n' > package.json
touch next.config.mjs
mkdir public

npm exec --cache "$CACHE_DIR" \
  --package "$TARBALL" \
  -- sitectx init --root . --site-url http://localhost:3000 --name "Next App" --force

test -f public/.well-known/sitectx
test -f public/sitectx.json
test -f public/sitectx/updates.json
test -f public/sitectx/updates.ndjson
test -f sitectx.config.json
test ! -f package-lock.json
test ! -d node_modules

echo "SiteCTX zero-install smoke passed."
