# Local tests

See the root README for commands. No production records or messaging provider are used.

- finance.test.cjs: reversals, currency handling, concurrent merges, dates, restore and escaping.
- ledger.test.cjs: minor units, validation, duplicate IDs and transfer integrity.
- browser-review.cjs: bundled app with CSP and mocked Firebase; includes save failures, stale saves, large ledgers, schedules, restore, PIN migration, duplicate submissions and sanitized listeners.
- firestore.rules.cjs: real local emulator tests for unauthorized access, owner writes, malformed records, private backend records and concurrent transactions.

Test builds expose state for fixtures; production builds remove that branch. Local tests do not verify deployed rules, hosting headers, real App Check tokens or actual message delivery.
