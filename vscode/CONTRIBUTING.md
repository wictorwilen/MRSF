# VS Code Extension Development

## Building and Verification

Build the CLI dependency and install the Monaco dependency before working on the extension. From the repository root:

```sh
npm --prefix cli ci
npm --prefix cli run build
npm --prefix plugins/monaco ci
```

Then run these commands from the `vscode` directory:

```sh
npm ci
npm run lint
npm test
npm run test:host -- 1.137.0
npm run test:host -- stable
npm run package
```

The extension's dependency build script builds Monaco automatically. Build the CLI again after changing its source so that the extension bundles the updated library.

This guide is excluded from the Marketplace package. Keep the extension [README](README.md) focused on installation, features, configuration and supported editor modes.

## Real-Host Coverage

Host tests use temporary documents and an isolated VS Code profile. They check preview-only activation, JSON hydration, external updates and both preview tab types. Playwright connects to a loopback-only debugging port before preview creation.

Tests wait for a fully loaded visible frame containing the expected content before editing its sidecar or interacting with its controls. Hidden pending frames cannot satisfy content assertions. Pointer checks use a real pointer-down, wait for native focus through each ancestor iframe, and release the pointer once. Enter activation observes the same focus prerequisite. This respects VS Code's focus gate for native webview links without fixed sleeps, synthetic clicks or retries of comment creation.

Repeated sidebar navigation checks fresh request IDs rather than relying on catching a short animation before it finishes. Refresh assertions stay inside replacement-aware frame checks. Screenshots and frame lifecycle diagnostics are saved under `.vscode-test/screenshots/`, including failures during cold hydration and external updates.

The preview workflow covers:

- Native badge and inline click/Enter navigation, including repeated activation.
- Immediate hover Resolve/Unresolve updates without changing the cursor selection.
- Tooltip bounds for both gutters at 260px and 650px widths, long text and short viewports.
- A document longer than 150 lines with seven explicit UTF-16 selections: Japanese after an emoji prefix, ZWJ emoji, flags, non-BMP CJK, combining characters, hiragana and skin-tone modifiers.
- Exact highlighted text, Unicode authors and comment bodies, existing and newly saved replies, edits, Resolve/Unresolve, unchanged anchor coordinates and unchanged source.
- Sidebar switching between modern previews.

The native Markdown Text Editor workflow inserts Unicode text before, after and inside seven anchored selections, checks hover boundaries after each edit, and undoes the edits back to the exact original source. Insertions at an anchor's start boundary follow the shared tracker's existing inclusive-start affinity. It creates a selection comment through the real input UI, verifies exact persisted UTF-16 columns/text, and saves an inserted paragraph to check reanchoring.

The hybrid Markdown Editor is allowed to load before verifying its explicit unsupported message, absence of stale threads/preview annotations, unchanged files, and recovery when returning to Text Editor. These checks do not establish exhaustive visual parity or macOS compatibility. Automatic multi-document legacy-preview tracking is not supported.

## Focused Host Runs

Set `MRSF_TEST_FOCUS` before `npm run test:host`:

| Value | Coverage |
|-------|----------|
| `watcher` | Cold hydration and a single external sidecar update, after a separate workspace file-watcher readiness event. |
| `editor` | Native editing and hybrid negative coverage; cold hydration, external updates and legacy-tab smoke checks still run. |
| `tooltip` | Real-webview tooltip bounds only; excludes native click transport, file watching and persistence. |

For example, in PowerShell:

```powershell
$env:MRSF_TEST_FOCUS = "editor"
npm run test:host -- 1.137.0
Remove-Item Env:MRSF_TEST_FOCUS
```

Remove the variable to restore the full suite.

## Lifecycle Notes

Background store/settings events coalesce preview refreshes over 250 ms; explicit sidebar navigation remains immediate.

VS Code can deliver the first content change before the corresponding dirty-state notification. Sidemark compares a seemingly clean change with disk before classifying it as an external reload, queues subsequent edits during that check, and waits for pending edits before save-time reanchoring.
