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

2. Update both workspace package versions:

   ```powershell
   npm version patch --workspace @capabilitykit/core --no-git-tag-version
   npm version patch --workspace @capabilitykit/cli --no-git-tag-version
   npm install
   ```

   Replace `patch` with `minor` or `major` when appropriate.

3. If the CLI should depend on the exact new core range, update `packages/cli/package.json` before running `npm install`.

   Example:

   ```json
   "@capabilitykit/core": "^0.1.2"
   ```

4. Verify locally:

   ```powershell
   npm run verify
   npm pack --workspace @capabilitykit/core --dry-run
   npm pack --workspace @capabilitykit/cli --dry-run
   ```

5. Commit the release prep:

   ```powershell
   git status
   git add package-lock.json packages/core/package.json packages/cli/package.json
   git commit -m "Release 0.1.2"
   ```

   Adjust the version in the commit message.

6. Create and push the version tag:

   ```powershell
   git tag v0.1.2
   git push origin main --follow-tags
   ```

7. Monitor the run at:

   ```text
   https://github.com/FocusedObjective/capabilitykit/actions
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
