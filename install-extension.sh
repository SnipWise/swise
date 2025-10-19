#!/bin/bash
set -o allexport; source release.env; set +o allexport

code --install-extension swise-agent-extension-${EXTENSION_TAG}.vsix




