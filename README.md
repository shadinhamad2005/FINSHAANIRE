# FINZ

Builds now use the modules in `src/`. Serve generated `dist/`, not the source HTML.

## Local checks

Use Node.js 22+, pnpm 11.19.0 and Java 21 for the database emulator.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:browser
pnpm test:rules
pnpm audit --prod
```

Browser tests default to installed Microsoft Edge. To use Chromium, run `pnpm exec playwright install chromium` and set `FINZ_BROWSER_CHANNEL=chromium`. Tests use synthetic data and the `demo-finz` emulator. GitHub Actions runs checks after this repository is hosted on GitHub.

## Structure

- `src/features/`: screens and behavior using a private application context.
- `src/domain/`: strictly typed save validation, integer minor-unit calculations and transfer integrity. Display code remains JavaScript; this is not a full TypeScript migration.
- `js/finance-runtime.js`: transactional saves, conflict detection, segmented ledgers, restore and PIN handling.
- `js/finance-ui.js`: escaped templates, DOM sanitization and registered listeners.
- `firestore.rules`: owner-only ledger access and default-deny backend records.

Dependencies are pinned. The gaxios>uuid override applies the CommonJS-compatible security fix in uuid 11.1.1.

## Deployment preparation — not performed

Local builds run without App Check. Release builds require `FINZ_APPCHECK_SITE_KEY`. Build variables come from the process environment; `.env` files are not automatically loaded.

Before deployment, register the public reCAPTCHA v3 site key with Firebase App Check, configure authorized domains, and review deployed rules and existing data compatibility. Verify client tokens before enabling Firestore App Check enforcement in Firebase Console. Local code does not activate that server setting.

Messaging uses manual WhatsApp drafts only. No messaging API, provider token, or backend function is required.

Specify the intended Firebase project explicitly for any future deployment. No default deployment project is configured. Hosting publishes only `dist/`. Script CSP rejects inline JavaScript; inline styles remain permitted by the existing UI. The local PIN is a convenience lock, not encryption or a replacement for authentication.

Segmented ledger JSON is access-controlled and size-limited by rules, but its contents are validated by the application rather than parsed by Firestore rules. Full server-side financial validation would require moving ledger writes behind a backend.
