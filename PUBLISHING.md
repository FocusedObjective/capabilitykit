# Publishing

CapabilityKit publishes two public npm packages:

- `@capabilitykit/core`
- `@capabilitykit/cli`

Publish `@capabilitykit/core` first because `@capabilitykit/cli` depends on it.

## Prerequisites

Confirm you are logged in as an npm user with publish access to the `@capabilitykit` org:

```powershell
npm whoami
npm access list packages @capabilitykit
```

If needed, log in:

```powershell
npm login
```

## Choose The Version

Use semantic versioning:

- Patch: bug fixes, docs/package metadata fixes, internal cleanup with no new API.
- Minor: new backwards-compatible features.
- Major: breaking changes.

Both packages can usually move together while the project is small.

## Update Versions

From the repo root, update both workspace package versions:

```powershell
npm version patch --workspace @capabilitykit/core --no-git-tag-version
npm version patch --workspace @capabilitykit/cli --no-git-tag-version
npm install
```

Replace `patch` with `minor` or `major` when appropriate.

If `@capabilitykit/cli` depends on the exact new core range, update `packages/cli/package.json` before running `npm install`.

Example:

```json
"@capabilitykit/core": "^0.1.1"
```

## Verify Locally

Run the full verification loop:

```powershell
npm run verify
```

Inspect the files that npm will publish:

```powershell
npm pack --workspace @capabilitykit/core --dry-run
npm pack --workspace @capabilitykit/cli --dry-run
```

The package contents should be limited to `dist/` and `package.json`.

## Publish

Publish core first:

```powershell
npm publish --workspace @capabilitykit/core --access public
```

Then publish the CLI:

```powershell
npm publish --workspace @capabilitykit/cli --access public
```

If npm asks for two-factor authentication, rerun the command with the current one-time password:

```powershell
npm publish --workspace @capabilitykit/core --access public --otp 123456
npm publish --workspace @capabilitykit/cli --access public --otp 123456
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

## Commit The Release Prep

Commit the version and lockfile changes:

```powershell
git status
git add package.json package-lock.json packages/core/package.json packages/cli/package.json
git commit -m "Release 0.1.1"
```

Adjust the version in the commit message.

## Important Notes

Published npm versions are immutable. If a package version has already been published, fixes require a new version number.

Do not publish the root package. The root `package.json` is private and only coordinates the workspace.
