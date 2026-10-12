# Release Sidelit

Users install the DMG from [GitHub Releases](https://github.com/heath0xFF/sidelit/releases/latest). The repository and downloads are public. Users do not need build tools or a GitHub account.

## Publish a version

1. Set the same `MAJOR.MINOR.PATCH` version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. Each release needs a new version.
2. Run `cargo check --manifest-path src-tauri/Cargo.toml` to update the package version in `src-tauri/Cargo.lock`. Keep both lockfiles committed.
3. Update the release notes in `.github/workflows/release.yml`, run the checks, then commit and push to `main`.
4. Open **Actions → Release macOS → Run workflow**, select **main**, and run it. A pushed matching version tag also starts the workflow.
5. Wait for the job to pass. It uploads all assets to a draft release, then publishes it as the latest release.

The tag must match the committed app version. An existing tag must point to the build's exact commit. Published versions and assets are not overwritten. If an upload fails and leaves a draft, remove only that failed draft before retrying from the same tag.

## Build and release checks

The macOS workflow:

- Uses pinned actions, the configured pnpm version, Node 24, stable Rust, and committed lockfiles.
- Runs type checks, frontend and Rust tests, and Rust formatting.
- Rejects desktop-test runtime dependencies, insecure updater settings, and downgrade settings.
- Builds a universal Apple Silicon + Intel `.app` and `.dmg`, without `desktop-test`.
- Creates and signs `Sidelit.app.tar.gz` with the version in its trusted signature comment.
- Checks both architectures, the app signature, the DMG, and its Applications shortcut.
- Runs `src-tauri/examples/update-manifest.rs` to verify the archive with the public update key and confirm its signed version before writing `latest.json`.
- Publishes the DMG, update archive, `.sig`, `latest.json`, and `SHA256SUMS.txt`. Both Mac architectures use the same universal archive.

GitHub supplies the release token. No personal token is required. Protect changes to the release workflow: a workflow that can access the signing secret can sign app updates.

These checks do not replace packaged desktop smoke tests or native-dialog checks in `VERIFICATION.md`. Intel is cross-built, not run on Intel hardware here. Windows and Linux installers are not published.

## Update signing key

The committed public key is in `src-tauri/tauri.conf.json`. The private key is the GitHub Actions secret **`TAURI_SIGNING_PRIVATE_KEY`**. The current key has no passphrase; the workflow supplies an empty signing password.

The maintainer's local copy is `~/.config/sidelit/release-signing/updater.key`, in a private directory with mode 0600 on the key. It is not stored in Git. **Keep an encrypted backup outside this computer.** GitHub does not let you retrieve a secret's value. Losing this key prevents updates for clients that trust its public key; those users would need a new manual installer.

Do not generate a replacement key for each release. Do not sign test builds with the release key. `scripts/updater-smoke.py` creates a separate disposable key for its isolated app.

The updater requires a signed version and accepts only newer versions. A modified manifest cannot pair an old signed archive with a false new version number. Checks and downloads require HTTPS in ordinary builds. The local updater test explicitly permits HTTP only in its separate test bundle.

## In-app update behavior

Version 0.1.0 has no updater. Users must install 0.1.1 or later from a DMG once.

New clients check the public `releases/latest/download/latest.json` feed on startup and daily while open. Background failures do not interrupt editing. Users can check through Actions or the native Sidelit menu.

Install & Restart uses the same live Save/Discard/Cancel checks as Quit. The app locks editing, flushes enabled recovery, then downloads and verifies the archive before replacement. A failed operation unlocks the editor and keeps drafts. The restart does not reuse a stale CLI file path or handoff receipt. Recovery remains opt-in; without it, the restarted app does not restore tabs.

## Apple signing and notarization

Update signatures and Apple code signatures are separate. Current apps use an **ad-hoc Apple signature** (`signingIdentity: "-"`), not a Developer ID signature or notarization. Browser downloads can still be blocked by Gatekeeper. Use the per-app **Privacy & Security → Open Anyway** control only for a trusted download. Do not disable Gatekeeper system-wide.

For normal first-launch approval, configure a **Developer ID Application** certificate and notarization credentials using [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/). An Apple Development certificate is not a substitute. Store credentials in Actions secrets, never Git.

## Local builds and tests

Ordinary local builds do not create update archives, so they do not need a private signing key:

```sh
CI=true pnpm tauri build --ci --bundles app,dmg -- --locked
```

The release workflow explicitly enables `bundle.createUpdaterArtifacts`. To reproduce a signed universal release locally, use the protected key, never a test key:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
TAURI_SIGNING_PRIVATE_KEY="$HOME/.config/sidelit/release-signing/updater.key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' CI=true \
pnpm tauri build --ci --target universal-apple-darwin --bundles app,dmg \
  --config '{"bundle":{"createUpdaterArtifacts":true}}' -- --locked
cargo run --manifest-path src-tauri/Cargo.toml --locked --example update-manifest -- \
  src-tauri/target/universal-apple-darwin/release/bundle
```

The real install/restart check is `python3 scripts/updater-smoke.py`. It builds only its own `Sidelit Update Check.app`, uses a temporary local feed, and removes the test bundle when finished. Do not put real work in that window. Native administrator approval and browser quarantine still need manual checks.
