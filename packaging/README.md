# Distribution

This repository ships first as an npm CLI:

```bash
npx kaaro-sessions
```

GitHub Actions validates package metadata on every branch and pull request, runs
tests on Node 18, 20, and 22, and uploads the npm tarball as a workflow artifact.
Pushing a tag like `v1.1.0` enables the release workflow when `NPM_TOKEN` is
available in repository or environment secrets.

## npm

Release checklist:

1. Update `package.json` version.
2. Tag the commit as `vX.Y.Z`.
3. Let GitHub Actions publish `kaaro-sessions-*.tgz` to npm.
4. Verify with `npx kaaro-sessions@X.Y.Z --no-open`.

Required GitHub Actions secret:

- `NPM_TOKEN`: publish-capable npm token, preferably scoped to this package.

## winget

`packaging/winget/Karx.kaaroSessions.yaml` is a starter singleton manifest.
Before submitting it to the Windows Package Manager Community Repository, replace
each `TODO_RELEASE_*` value with the released Windows installer URL and SHA256.

The winget manifest docs require Pascal-cased fields and a silent install-capable
installer. This project currently has an npm CLI package, so a Windows installer
artifact must be produced separately before the manifest is valid for submission.

## Homebrew

`packaging/homebrew/kaaro-sessions.rb` is a starter formula for a tagged source
archive. Before publishing to a tap, replace `TODO_RELEASE_SHA256` with the SHA256
of the GitHub source archive for the matching tag.
