# Work on the extension


## `extension.js`


## `package.json`

- Name of the extension
- Configuration settings

> Update `package-lock.json` with `npm update`

## Package and build for tests

- Update `package-for-tests.sh` with the new `VERSION`
- Run the script `./package-for-tests.sh`


## Package and build the extension

Update `release.env` with the new `EXTENSION_TAG`

```
set -o allexport; source release.env; set +o allexport

code --install-extension swise-extension-${EXTENSION_TAG}.vsix
```
> or use `./install-extension.sh`