#!/usr/bin/env bash
# Generates the "public" variants of the JSON schemas from the authoritative
# ones in this folder.
#
# Authoritative schemas use AJV-style `$id` / `$ref` to reuse sub-schemas.
# The public schemas (served raw to the YAML language server in VS Code via
# https://raw.githubusercontent.com/...) must be self-contained because that
# consumer does not resolve `$id`-relative refs.
#
# This script:
#   1. Collects every object that has an `$id` into a lookup table.
#   2. Replaces every `{"$ref": "<id>"}` with the matching definition
#      (recursively, so nested $refs are also resolved).
#   3. Strips all `$id` keys.
#
# Requires: jq (https://jqlang.github.io/jq/)
#
# Run: ./server/schema/build-public-schema.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR"
DST_DIR="$SCRIPT_DIR/public"
FILES=("form_schema.json")
# public/forms_schema.json is not generated any more: it describes the forms.yaml layout
# that 7 removed. It stays in public/ because editors were pointed at its raw GitHub URL,
# and removing it would turn their schema validation into a 404.

if ! command -v jq >/dev/null 2>&1; then
  echo "[public-schema] ERROR: jq is required but not installed." >&2
  exit 1
fi

mkdir -p "$DST_DIR"

# jq program:
#   - `defs` collects every subtree that has an `$id` into an object keyed by $id.
#   - `inline` walks the tree and, whenever it sees an object whose only key is
#     `$ref` with a known id, replaces it by the corresponding definition.
#   - We loop `inline` until the output is stable (handles $refs inside defs).
#   - Finally `del(..|.["$id"]?)` strips all `$id` markers.
JQ_PROGRAM='
  def collect_defs:
    [.. | objects | select(has("$id")) | {key: .["$id"], value: (del(.["$id"]))}]
    | from_entries;

  . as $root
  | collect_defs as $defs
  | def inline:
      walk(
        if type == "object"
           and (.["$ref"]? | type) == "string"
           and (keys | length == 1)
        then . as $node
           | if $defs | has($node["$ref"])
             then $defs[$node["$ref"]]
             else $node end
        else . end
      );
  # A few passes are enough: $refs only appear a couple of levels deep inside
  # definitions. Avoid a generic fixed-point comparison, which is O(n^2) on the
  # large forms_schema tree.
  inline | inline | inline | inline
  # Recursive definitions (e.g. /category -> /category) can never be fully
  # inlined; replace any leftover {"$ref": "..."} with {} (match anything) so
  # the public schema is self-contained.
  | walk(
      if type == "object"
         and (.["$ref"]? | type) == "string"
         and (keys | length == 1)
      then {}
      else . end
    )
  | walk(if type == "object" then del(.["$id"]) else . end)
'

for file in "${FILES[@]}"; do
  src="$SRC_DIR/$file"
  dst="$DST_DIR/$file"
  if [[ ! -f "$src" ]]; then
    echo "[public-schema] WARN: $src not found, skipping" >&2
    continue
  fi
  jq "$JQ_PROGRAM" "$src" > "$dst"
  count=$(jq '[.. | objects | select(has("$id"))] | length' "$src")
  echo "[public-schema] $file: $count definition(s) inlined -> ${dst#$PWD/}"

  # For form_schema: wrap in oneOf[single, array] so a form file can contain
  # either one form (dict) or multiple forms (list) without duplicating the schema.
  if [[ "$file" == "form_schema.json" ]]; then
    jq '. as $form | {
      "oneOf": [
        $form,
        { "type": "array", "items": $form }
      ]
    }' "$dst" > "$dst.tmp" && mv "$dst.tmp" "$dst"
    echo "[public-schema] $file: wrapped in oneOf[single, array]"
  fi
done
