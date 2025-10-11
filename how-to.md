# How to Use Your Extension in VSCode

## 1. Run in Development Mode (Extension Development Host)

Press `F5` in your extension's workspace. This opens a new VSCode window with your extension loaded.

## 2. Install Locally (Recommended for real usage)

First, package your extension:
```bash
# change the version of the extension in package.json if needed
npx @vscode/vsce package
```

This creates a `.vsix` file. Then install it:
- Open Command Palette (`Cmd+Shift+P`)
- Run "Extensions: Install from VSIX..."
- Select your `.vsix` file

OR via command line:
```bash
code --install-extension swise-agent-extension-0.0.0-dev.vsix
```

## 3. Link for Development

Copy your extension folder to VSCode's extensions directory:
```bash
ln -s "$(pwd)" ~/.vscode/extensions/swise
```

Then reload VSCode.
