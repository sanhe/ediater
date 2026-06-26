# Releasing ediater

This guide covers building, signing, notarizing, and publishing installers. The
actual signing/notarization steps require **your** Apple Developer ID and (for
Windows) a code-signing certificate — those are never committed; they're
supplied as environment variables / CI secrets.

## 1. Version bump

Keep these three versions in sync, then commit and tag:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `version`

```bash
git commit -am "release: v0.1.0"
git tag v0.1.0
git push origin master --tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds for
macOS (universal), Linux, and Windows and opens a **draft GitHub Release** with
the installers attached. Review and publish it.

## 2. Local unsigned build (no credentials)

```bash
pnpm tauri build            # all targets for the current OS
pnpm tauri build --debug --bundles app   # quick unsigned .app for testing
```

Artifacts land under `src-tauri/target/release/bundle/` (`.dmg`/`.app` on macOS,
`.deb`/`.AppImage`/`.rpm` on Linux, `.msi`/`.exe` on Windows).

## 3. macOS — code-signing & notarization

### Prerequisites
- An Apple Developer account.
- A **Developer ID Application** certificate (Keychain Access → Certificate
  Assistant, or download from the Apple Developer portal) installed in your
  login keychain.
- An **app-specific password** (appleid.apple.com → Sign-In and Security) **or**
  an App Store Connect **API key** for notarization.

The hardened-runtime entitlements are already configured
(`src-tauri/entitlements.plist` + `bundle.macOS.entitlements` in
`tauri.conf.json`) — WKWebView requires JIT/unsigned-memory entitlements.

### Local signed + notarized build

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
pnpm tauri build
```

Tauri signs the app with the identity, then submits the `.dmg`/`.app` to Apple's
notary service and staples the ticket. Verify:

```bash
spctl -a -vvv -t install "src-tauri/target/release/bundle/macos/ediater.app"
xcrun stapler validate "src-tauri/target/release/bundle/dmg/ediater_0.1.0_universal.dmg"
```

### CI secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of your exported `Developer ID Application.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | your 10-char team id |

Export the cert to base64 with:
`base64 -i DeveloperIDApplication.p12 | pbcopy`

## 4. Windows — code-signing (optional)

Provide a signing certificate to `tauri-action` (or `tauri.conf.json`
`bundle.windows.certificateThumbprint`) — see the
[Tauri Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).
Unsigned `.msi`/`.exe` still build; users just see a SmartScreen warning.

## 5. Linux

`.deb`, `.AppImage`, and `.rpm` are produced unsigned by default — no extra
setup. The release workflow installs `libwebkit2gtk-4.1-dev` and friends.

## 6. (Optional) Auto-updater

Not wired in yet — enabling it is a deliberate, keyed step:

1. Generate an updater signing keypair:
   ```bash
   pnpm tauri signer generate -w ~/.ediater-updater.key
   ```
2. Add the plugin:
   ```bash
   pnpm add @tauri-apps/plugin-updater
   cargo add tauri-plugin-updater --manifest-path src-tauri/Cargo.toml
   ```
   then `.plugin(tauri_plugin_updater::Builder::new().build())` in
   `src-tauri/src/lib.rs` and `"updater:default"` in
   `src-tauri/capabilities/default.json`.
3. Configure `plugins.updater` in `tauri.conf.json` with your release
   `endpoints` and the **public** key, and set
   `bundle.createUpdaterArtifacts: true`.
4. Provide `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   (already referenced as secrets in the release workflow) so CI signs the
   update artifacts.

See the [Tauri updater guide](https://v2.tauri.app/plugin/updater/).

## 7. Bundled plugins (note)

The sample plugins under `plugins/` are not bundled into the app installer yet.
Until a plugin-install UI exists, document that users copy the `plugins/` tree
into their app-data dir
(`~/Library/Application Support/dev.ediater.app/plugins/` on macOS).
