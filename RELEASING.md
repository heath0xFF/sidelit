# Release Sidelit

Users install the DMG from [GitHub Releases](https://github.com/heath0xFF/sidelit/releases/latest). They do not need build tools. The repository is private, so downloads require GitHub access.

## Publish a version

1. Set the same version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. Use `MAJOR.MINOR.PATCH`, such as `0.1.1`.
2. Run `cargo check --manifest-path src-tauri/Cargo.toml` to update the package version in `src-tauri/Cargo.lock`. Keep both lockfiles committed.
3. Commit and push the changes to `main`.
4. Open **Actions → Release macOS → Run workflow**, select **main**, and run it.
5. Wait for the job to pass. It creates the version tag and publishes the DMG and `SHA256SUMS.txt` as a GitHub release.

A pushed version tag also starts the same workflow:

```sh
git tag v0.1.1
git push origin v0.1.1
```

The tag must match the committed app version. An existing tag must point to the build's exact commit. Published versions and assets are not overwritten; use a new version for a new build. If an upload fails and leaves a draft release, remove only that failed draft before retrying from the same tag.

## What the workflow checks

`.github/workflows/release.yml` runs on a standard macOS runner. It:

- Installs the pnpm version from `package.json`, Node 24, and stable Rust.
- Uses the committed lockfiles and runs TypeScript checks, frontend tests, Rust formatting, and Rust tests.
- Rejects runtime dependencies that include the desktop test server.
- Builds Apple Silicon and Intel binaries into one universal `.app` and `.dmg`, without `desktop-test`.
- Checks both binary architectures and the app's code signature.
- Verifies and mounts the DMG read-only, then checks the app and Applications shortcut.
- Publishes only after these checks pass, with a SHA-256 checksum.

Third-party actions are pinned to commit IDs. GitHub supplies the release token; no personal token is required. Builds use the private repository's Actions minutes. In-app automatic updates, Windows installers, and Linux packages are not part of this workflow.

The job does not replace the packaged editor smoke test or native-dialog checks in `VERIFICATION.md`. Intel is cross-built, not run on Intel hardware in this workflow.

## macOS signing

Current builds use an **ad-hoc signature** (`signingIdentity: "-"`). This satisfies the binary signature requirement, but it does not identify a trusted developer or provide Apple notarization. Browser downloads can still be blocked by Gatekeeper. Release notes explain the per-app **Open Anyway** control; do not disable Gatekeeper system-wide.

For normal first-launch approval, configure a **Developer ID Application** certificate and notarization credentials using [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/). An **Apple Development** certificate is not a substitute for distribution outside the App Store. Store signing material in GitHub Actions secrets, never in Git. Signing and notarization are not configured by this workflow yet.

## Local packaging check

Maintainers can build a native-architecture DMG without publishing:

```sh
CI=true pnpm tauri build --ci --bundles app,dmg -- --locked
```

For a local universal build, first install both Rust targets, then use the same build command as the workflow:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
CI=true pnpm tauri build --ci --target universal-apple-darwin --bundles app,dmg -- --locked
```

The universal installer is under `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`. Never publish a bundle built with `desktop-test`.
