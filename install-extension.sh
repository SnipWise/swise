#!/bin/bash
set -o allexport; source release.env; set +o allexport
npx @vscode/vsce package
code --install-extension swise-extension-${EXTENSION_TAG}.vsix




