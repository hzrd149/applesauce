#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

find . -name "*.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/.vitepress/dist/*" \
  -not -path "*/.vitepress/cache/*" \
  -exec sh -c 'mkdir -p .vitepress/dist/$(dirname "$1") && cp "$1" .vitepress/dist/"$1"' _ {} \;
