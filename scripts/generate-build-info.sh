#!/bin/bash
#
# Generate build-info.json with git SHA and dirty status
# Usage: ./scripts/generate-build-info.sh <output-path> [git-sha] [build-time] [version]
#
# Arguments:
#   output-path: Where to write build-info.json (e.g., ./server or ./client/dist)
#   git-sha:     (optional) Override git SHA (useful for Docker builds with build args)
#   build-time:  (optional) Override build timestamp (useful for Docker builds)
#   version:     (optional) The version this build reports, e.g. 6.4.0-rc.512.7. Written
#                only when given ; without it the app falls back to server/package.json

set -euo pipefail

OUTPUT_PATH="${1:-.}"
GIT_SHA="${2:-}"
BUILD_TIME="${3:-}"
VERSION="${4:-}"

# Determine git SHA
if [ -z "$GIT_SHA" ]; then
  if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_SHA=$(git rev-parse --short HEAD)
  else
    GIT_SHA="unknown"
  fi
fi

# Determine if working directory is dirty
DIRTY="false"
if git rev-parse --git-dir > /dev/null 2>&1; then
  if [ -n "$(git status --porcelain)" ]; then
    DIRTY="true"
  fi
fi

# Determine build timestamp
if [ -z "$BUILD_TIME" ]; then
  BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
fi

# Create build-info.json
VERSION_LINE=""
if [ -n "$VERSION" ]; then
  VERSION_LINE="\"version\": \"$VERSION\",
  "
fi
cat > "$OUTPUT_PATH/build-info.json" <<EOF
{
  ${VERSION_LINE}"gitSha": "$GIT_SHA",
  "dirty": $DIRTY,
  "buildTime": "$BUILD_TIME"
}
EOF

echo "Generated $OUTPUT_PATH/build-info.json (SHA: $GIT_SHA, dirty: $DIRTY${VERSION:+, version: $VERSION})"
