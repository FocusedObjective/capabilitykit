# Publishing

CapabilityKit publishes two public npm packages:

- `@capabilitykit/core`
- `@capabilitykit/cli`

The GitHub Actions publish workflow publishes `@capabilitykit/core` first because `@capabilitykit/cli` depends on it.

## GitHub Actions

### Publish (`.github/workflows/publish.yml`)

Runs automatically when a tag matching `v*` is pushed.

- Steps: `npm ci` -> `test` -> `build` -> `capabilitykit validate` -> `capabilitykit compile` -> `publint` -> `attw` -> publish both workspaces
- Publishes `@capabilitykit/core` first, then `@capabilitykit/cli`
- Uses npm trusted publishing with GitHub Actions OIDC

## One-Time npm Setup

Configure trusted publishing on npmjs.com for both packages before relying on the workflow:

1. Open each package on npmjs.com.
2. Go to package settings, then Trusted Publisher.
3. Add a GitHub Actions trusted publisher with:
   - Organization/user: `FocusedObjective`
   - Repository: `capabilitykit`
   - Workflow filename: `publish.yml`

The workflow has `id-token: write`, which is required for OIDC trusted publishing. Do not add a long-lived `NODE_AUTH_TOKEN` unless you intentionally choose token-based publishing instead.

## Publishing a New Version

1. Make sure you are on `main` with a clean working tree.

   `npm run release:prep` checks this before changing files and exits if Git
   reports pending changes.

2. Prepare the release:

   ```powershell
   npm run release:prep -- patch
   ```

   Replace `patch` with `minor`, `major`, or an exact version like `0.2.0`
   when appropriate. This updates both workspace package versions, updates the
   CLI dependency on `@capabilitykit/core`, updates `package-lock.json`, runs
   `npm run verify`, and runs dry-run packs for both published packages.

   The script then asks for one confirmation before it stages the release files,
   commits them, creates the version tag, and pushes `main` with tags. Press
   Enter or answer `n` to stop after preparing the files.

   To only update files and skip the slower checks:

   ```powershell
   npm run release:prep:files -- patch
   ```

   To pass other release-prep flags through npm, put them after a second `--`.
   For example: `npm run release:prep -- patch -- --allow-dirty`. Use that only
   when you intentionally want to prepare a release with other pending changes
   in the working tree.

3. Monitor the run at:

   ```text
   https://github.com/FocusedObjective/capabilitykit/actions
   ```

If you need to run the verification commands by hand, use:

```powershell
npm run verify
npm pack --workspace @capabilitykit/core --dry-run
npm pack --workspace @capabilitykit/cli --dry-run
```

## Verify The Published Packages

Registry metadata can lag for a few minutes. After publishing, check:

```powershell
npm view @capabilitykit/core version
npm view @capabilitykit/cli version
npx @capabilitykit/cli --version
```

If `npm view` returns 404 immediately after a successful publish, wait and retry. Also confirm npm sees the packages under the org:

```powershell
npm access list packages @capabilitykit
npm dist-tag ls @capabilitykit/core
npm dist-tag ls @capabilitykit/cli
```

## Important Notes

Do not run `npm publish` locally for normal releases. The Action handles publishing.

Published npm versions are immutable. If a package version has already been published, fixes require a new version number.

Do not publish the root package. The root `package.json` is private and only coordinates the workspace.
