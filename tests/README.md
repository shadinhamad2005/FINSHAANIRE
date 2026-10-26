# Local tests

See the root README for commands. No production records or messaging provider are used.

- finance.test.cjs: reversals, currency handling, concurrent merges, dates, restore and escaping.
- ledger.test.cjs: minor units, validation, duplicate IDs and transfer integrity.
- browser-review.cjs: bundled app with CSP and mocked Firebase; includes save failures, stale saves, large ledgers, schedules, restore, PIN migration, duplicate submissions and sanitized listeners.
- fixes.test.cjs: exchange-rate direction, local dates, earned income vs spending, monthly burn, CSV safety.
- fixes-review.cjs: cross-currency invest/liquidate, surplus sweep, emergency fund opening balance, safe account deletion, query side effects, edit form, back-dated entries, BNPL totals and rescheduling, CSV import.
- features.test.cjs: bank SMS parsing, bill shares, card limits, metal prices, linked goals, monthly close, remittance advice, year pack.
- features-review.cjs: auto-pay edit/pause, rate lock, archive, ledger paging, smart add account, paired transfer edit, credit cards, SMS import, bill split, linked goals, monthly close, live gold revaluation, year pack, read-only household sharing.
- firestore.rules.cjs: real local emulator tests for unauthorized access, owner writes, malformed records, private backend records and concurrent transactions.

Test builds expose state for fixtures; production builds remove that branch. Local tests do not verify deployed rules, hosting headers, real App Check tokens or actual message delivery.
