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
# Searches for page files in:
#   1. <dir>/.intake/pages/  (where the server stores captured pages)
#   2. <dir>/                (if pages were placed at the top level)
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

# Determine where page files live
SOURCE_DIR=""
MODE=""

for search_dir in "$DIR/.intake/pages" "$DIR"; do
  [ -d "$search_dir" ] || continue

  json_pages=$(find "$search_dir" -maxdepth 1 -name 'page*.json' 2>/dev/null | sort -t 'e' -k2 -n)
  if [ -n "$json_pages" ]; then
    SOURCE_DIR="$search_dir"
    MODE="json"
    pages=$json_pages
    break
  fi

  md_pages=$(find "$search_dir" -maxdepth 1 -name 'page*.md' 2>/dev/null | sort -t 'e' -k2 -n)
  if [ -n "$md_pages" ]; then
    SOURCE_DIR="$search_dir"
    MODE="md"
    pages=$md_pages
    break
  fi
done

if [ -z "$SOURCE_DIR" ]; then
  echo "Error: no page*.json or page*.md files found in '$DIR' or '$DIR/.intake/pages/'." >&2
  exit 1
fi

echo "Found pages in $SOURCE_DIR ($MODE format)"
echo ""

count=0
for page in $pages; do
  num=$(basename "$page" ".$MODE" | sed 's/page//')

  if [ "$MODE" = "json" ]; then
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
