#!/bin/bash
set -euo pipefail

# Ensure we're in the right directory
if [ ! -f "package.json" ]; then
    echo "Error: package.json not found. Are you in the right directory?"
    exit 1
fi

# Check for dirty git state
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Error: Working directory is dirty. Commit or stash your changes first."
    git status --short
    exit 1
fi

# Get version and confirm
version=$(jq .version ./server/package.json -r)
echo "Publishing production version (locally only): $version"
printf "Continue? (y/n): "
read answer
if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
    exit 1
fi

# Step 1: Build public schema
echo "🔨 Building public schema..."
./server/schema/build-public-schema.sh

# Step 2: Check if schema changed and commit
if [ -n "$(git status --porcelain server/schema/public/)" ]; then
    echo "📝 Schema changed, committing..."
    git add server/schema/public/
    git commit -m "chore: update public schema for v$version"
    git push
    echo "✅ Schema committed and pushed"
else
    echo "✅ Schema unchanged"
fi

# Step 3: Get clean git SHA and build time
GIT_SHA=$(git rev-parse --short HEAD)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "🐳 Building Docker image with SHA: $GIT_SHA"

# Step 4: Build Docker with build args
docker build \
    --build-arg GIT_SHA="$GIT_SHA" \
    --build-arg BUILD_TIME="$BUILD_TIME" \
    -t ansibleforms .

# Step 5: Tag locally (no push)
docker tag ansibleforms ghcr.io/ansibleforms/ansibleforms
docker tag ansibleforms ghcr.io/ansibleforms/ansibleforms:$version

# Cleanup
docker rmi $(docker images -f "dangling=true" -q) 2>/dev/null || true

echo "✅ Built locally: ghcr.io/ansibleforms/ansibleforms:$version (SHA: $GIT_SHA)"
