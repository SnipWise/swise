#!/bin/bash

# 🤚 check package.json file
VERSION="0.0.0"
# Package for tests
npx @vscode/vsce package
# Install
code --install-extension swise-extension-${VERSION}.vsix