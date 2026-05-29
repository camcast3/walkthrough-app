#!/usr/bin/env bash
# seed-pages.sh — POST local page files to the intake server.
#
# Usage:
#   tools/intake/scripts/seed-pages.sh <walkthrough-dir> [server-url]
#
# Example:
#   tools/intake/scripts/seed-pages.sh walkthroughs/trails-of-cold-steel-ii
#   tools/intake/scripts/seed-pages.sh walkthroughs/my-game http://localhost:4000
#
# Supports two formats:
#   - page*.json files: POSTed directly (expected shape: { title, url, markdown })
#   - page*.md files:   wrapped in JSON with a generated title, then POSTed

set -euo pipefail

DIR="${1:?Usage: seed-pages.sh <walkthrough-dir> [server-url]}"
SERVER="${2:-http://localhost:3847}"

if [ ! -d "$DIR" ]; then
  echo "Error: directory '$DIR' does not exist." >&2
  exit 1
fi

# Prefer .json pages, fall back to .md
json_pages=$(find "$DIR" -maxdepth 1 -name 'page*.json' | sort -t 'e' -k2 -n)
md_pages=$(find "$DIR" -maxdepth 1 -name 'page*.md' | sort -t 'e' -k2 -n)

if [ -n "$json_pages" ]; then
  pages=$json_pages
  mode="json"
elif [ -n "$md_pages" ]; then
  pages=$md_pages
  mode="md"
else
  echo "Error: no page*.json or page*.md files found in '$DIR'." >&2
  exit 1
fi

count=0
for page in $pages; do
  num=$(basename "$page" ".$mode" | sed 's/page//')

  if [ "$mode" = "json" ]; then
    curl -s -X POST "$SERVER/api/intake" \
      -H 'Content-Type: application/json' -d @"$page"
  else
    jq -Rs --arg t "Page $num" --arg u "file://$(basename "$page")" \
      '{ title: $t, url: $u, markdown: . }' "$page" \
    | curl -s -X POST "$SERVER/api/intake" \
        -H 'Content-Type: application/json' -d @-
  fi

  count=$((count + 1))
  echo "  OK: $page (page $num)"
done

echo ""
echo "Seeded $count pages to $SERVER"
echo "Verify: curl -s $SERVER/api/pages | jq 'length'"
