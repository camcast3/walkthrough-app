#!/usr/bin/env bash
# seed-pages.sh — POST local markdown pages to the intake server.
#
# Usage:
#   tools/intake/scripts/seed-pages.sh <walkthrough-dir> [server-url]
#
# Example:
#   tools/intake/scripts/seed-pages.sh walkthroughs/trails-of-cold-steel-ii
#   tools/intake/scripts/seed-pages.sh walkthroughs/my-game http://localhost:4000
#
# The script finds all pageN.md files (sorted numerically) in the given
# directory and POSTs each one to the intake server.

set -euo pipefail

DIR="${1:?Usage: seed-pages.sh <walkthrough-dir> [server-url]}"
SERVER="${2:-http://localhost:3847}"

if [ ! -d "$DIR" ]; then
  echo "Error: directory '$DIR' does not exist." >&2
  exit 1
fi

# Find page files sorted numerically
pages=$(find "$DIR" -maxdepth 1 -name 'page*.md' | sort -t 'e' -k2 -n)

if [ -z "$pages" ]; then
  echo "Error: no page*.md files found in '$DIR'." >&2
  exit 1
fi

count=0
for page in $pages; do
  num=$(basename "$page" .md | sed 's/page//')
  title="Page $num"
  jq -Rs --arg t "$title" --arg u "file://$(basename "$page")" \
    '{ title: $t, url: $u, markdown: . }' "$page" \
  | curl -s -X POST "$SERVER/api/intake" \
      -H 'Content-Type: application/json' -d @-
  count=$((count + 1))
  echo "  ✓ $page (page $num)"
done

echo ""
echo "Seeded $count pages to $SERVER"
echo "Verify: curl -s $SERVER/api/pages | jq 'length'"
