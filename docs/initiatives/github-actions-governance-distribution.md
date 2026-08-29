# GitHub Actions, Governance, and Distribution Initiative

Branch: `kaaro/ci/distribution`
Worktree: `.claude/worktrees/ci-distribution`
Status: Baseline merged; trusted publishing decision pending

## Goal

Set up a resilient release and distribution path for `kaaro-sessions` across:

- GitHub Actions for validation, tests, packaging, and release gates
- npm / npx distribution for the primary Node CLI path
- winget manifest preparation for Windows distribution
- Homebrew formula preparation for macOS/Linux developer distribution

## Principles

- Keep CI deterministic and dependency-light, matching the repo's current zero-dependency posture.
- Treat tests, package metadata, and release artifacts as separate gates.
- Prefer templates with explicit placeholders over invalid publish-ready manifests.
- Prefer npm Trusted Publishing through GitHub Actions OIDC over long-lived npm tokens. If token publishing is used temporarily, keep release credentials opt-in through repository secrets.
- Keep distribution files reviewable and manually auditable.

## Phases

### Phase 1 - Baseline CI

- [x] Replace the narrow test workflow with `.github/workflows/ci.yml`.
- [x] Run Node test matrix for supported versions: 18, 20, and 22.
- [x] Add npm package dry-run validation.
- [x] Upload `npm pack` output as a workflow artifact.
- [x] Keep the existing GitHub Pages workflow untouched.

### Phase 2 - npm / npx

- [x] Confirm `package.json` has `name`, `version`, `bin`, `files`, `license`, `repository`, and engine metadata.
- [x] Add package check scripts for local and CI use.
- [x] Add deterministic `--help` and `--version` CLI exits for package manager checks.
- [x] Document the release tag flow.
- [x] Configure GitHub Actions npm publish job gated on `vX.Y.Z` tags.
- [x] Document temporary `NPM_TOKEN` release path.
- [ ] Replace token-based npm publishing with npm Trusted Publishing through GitHub Actions OIDC.

### Phase 3 - winget

- [x] Add a winget manifest template under `packaging/winget/`.
- [x] Track required winget fields: package identifier, version, locale, publisher, package name, license, short description, installers, manifest type, and manifest version.
- [ ] Identify the Windows installer artifact strategy.
- [ ] Replace installer URL and SHA256 placeholders only after a real Windows installer exists.
- [x] Add CI guardrails so placeholder manifests cannot be treated as release-ready.

### Phase 4 - Homebrew

- [x] Add a starter formula under `packaging/homebrew/`.
- [x] Use tagged source archives as the formula source.
- [ ] Replace SHA256 placeholder during release preparation.
- [ ] Decide whether this lives in a personal tap or upstream homebrew-core is a later target.
- [x] Add formula validation notes to the release docs.

### Phase 5 - Governance

- [x] Add release checklist documentation under `packaging/README.md`.
- [x] Define branch/tag protections expected in GitHub.
- [x] Define required Actions secrets and their protection scope.
- [x] Add artifact retention expectations.
- [x] Add distribution ownership notes for npm, winget, and Homebrew.

## GitHub Governance Settings

Recommended repository settings:

- Protect `master` with required status checks from `CI`.
- Require pull requests before merging into `master`.
- Require conversation resolution before merge.
- Protect `v*.*.*` tags or restrict release/tag creation to maintainers.
- Prefer npm Trusted Publishing configured on npmjs.com for this GitHub repository/workflow.
- If using token publishing temporarily, store `NPM_TOKEN` as a repository or environment secret with publish-only scope.
- Use a protected `release` environment if tag publishing should require manual approval.

## Open Decisions

- Windows installer format for winget: `exe`, `msi`, `msix`, or a generated wrapper around the npm CLI.
- Whether release publishing should be automatic on tags or require a protected GitHub environment approval.
- Whether the next sprint switches immediately to npm Trusted Publishing or keeps the token path for one release while OIDC is configured.
- Homebrew target: personal tap first, with homebrew-core as a later option only if the project meets their criteria.
- Whether GitHub Releases should also carry Windows installer artifacts once winget is active.

## Implementation Notes

- The current package already supports `npx kaaro-sessions` through the `bin` field.
- npm 2FA and CI: token-based `npm publish` works only when the token is a granular access token with package write access and Bypass 2FA enabled. A normal 2FA-protected user login cannot answer an OTP prompt inside GitHub Actions.
- npm Trusted Publishing is the preferred path for GitHub Actions. It uses OIDC, avoids storing `NPM_TOKEN`, and automatically produces provenance for public packages from public GitHub repositories.
- Trusted Publishing requires the package's `repository.url` to exactly match the GitHub repository. Current package metadata points at `https://github.com/karx/kaaroSessions.git`, matching the canonical repo GitHub reported after redirect.
- The winget manifest cannot be valid until a silent install-capable Windows installer exists.
- Homebrew can install this as a Node-based formula, but the formula checksum must be generated per release tag.
- CI only fails on manifest placeholders during tag-style release readiness checks.

## Next Sprint Handoff

Recommended first task: migrate `.github/workflows/release.yml` from `NPM_TOKEN` publishing to npm Trusted Publishing.

Concrete steps:

1. In npmjs.com package settings, add GitHub Actions as a trusted publisher for `karx/kaaroSessions` and the release workflow.
2. Remove the `Confirm npm token` step and `NODE_AUTH_TOKEN` environment usage from `.github/workflows/release.yml`.
3. Keep `permissions: id-token: write` in the release workflow.
4. Keep `npm publish kaaro-sessions-*.tgz --provenance` or simplify after verifying npm's automatic provenance behavior for trusted publishing.
5. Run a dry release from a test tag only after package ownership and trusted publisher settings are confirmed.

Critical gotchas:

- If the npm package has "require 2FA and disallow tokens" enabled, token publishing will fail, but Trusted Publishing should continue to work.
- If the npm token path is retained, create a granular access token with Bypass 2FA enabled at token creation time; this cannot be fixed from GitHub Actions during publish.
- Starting August 2026, bypass-2FA tokens are not valid for account identity or governance actions; they are only relevant for package automation such as publishing.
- Do not submit the winget manifest until a real silent Windows installer URL and SHA256 exist.
- Do not publish the Homebrew formula until `TODO_RELEASE_SHA256` is replaced for the release tag archive.

## Verification Plan

- Run `npm test` locally in the worktree.
- Run `npm pack --dry-run` locally in the worktree.
- Run `node serve.mjs --version` and `node serve.mjs --help` locally.
- Validate workflow syntax in GitHub Actions after pushing the branch.
- Validate winget manifest with `winget validate` after replacing release placeholders.
- Validate Homebrew formula with `brew audit --strict --online` and `brew test` from the target tap.
