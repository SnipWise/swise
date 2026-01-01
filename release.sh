#!/bin/bash
: <<'COMMENT'
# Relase script for mcp-snippets-server
Usage:
1. Update the version in release.env
2. Run this script: ./release.sh
3. Create a GitHub release with the new tag and description
COMMENT

set -o allexport; source release.env; set +o allexport

echo "Generating release: ${TAG} ${ABOUT}"

find . -name '.DS_Store' -type f -delete

rm swise-extension-*.vsix
# echo "📝 Replacing ${PREVIOUS_DOCKER_TAG} by ${DOCKER_TAG} in files..."

go run ./release/release.go -old="\"version\": \"${PREVIOUS_EXTENSION_TAG}\"" -new="\"version\": \"${EXTENSION_TAG}\"" -file="package.json"
# go run ./release/release.go -old="${PREVIOUS_EXTENSION_TAG}" -new="${EXTENSION_TAG}" -file="README.md"

npx @vscode/vsce package
# Install
code --install-extension swise-extension-${EXTENSION_TAG}.vsix

git add .
git commit -m "📦 ${ABOUT}"
git push origin main

git tag -a ${TAG} -m "${ABOUT}"
git push origin ${TAG}



