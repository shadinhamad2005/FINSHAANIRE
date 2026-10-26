const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/finance-core.js');

test('inverted INR-to-AED rates from older transfers are read as INR per AED', () => {
    assert.equal(F.aedInrRate(22.75), 22.75);
    assert.equal(F.aedInrRate(1 / 25), 25);
    assert.equal(F.convert(2500, 'INR', 'AED', 1 / 25), 100);
    assert.equal(F.convert(100, 'AED', 'INR', 0.04), 2500);
    assert.throws(() => F.convert(1, 'AED', 'INR', 0), /positive/);
});

test('local calendar days do not shift to UTC', () => {
    const lateNight = new Date(2026, 9, 1, 1, 30); // 1 Oct, 01:30 local
    assert.equal(F.localDateKey(lateNight), '2026-10-01');
    const parsed = F.parseLocalDate('2026-10-01');
    assert.equal(parsed.getDate(), 1); assert.equal(parsed.getHours(), 0);
    assert.equal(F.parseLocalDate('2026-02-30'), null);
    assert.equal(F.parseLocalDate('not a date'), null);
    assert.equal(F.localDateKey('garbage'), '');
});

test('earned income and spending exclude opening balances, loans and repayments', () => {
    assert.equal(F.isEarnedIncome({ type: 'income', category: 'Salary' }), true);
    for (const category of ['Opening Balance', 'Loan', 'Settlement', 'Debt Settlement']) assert.equal(F.isEarnedIncome({ type: 'income', category }), false);
    assert.equal(F.isSpending({ type: 'expense', category: 'Food' }), true);
    assert.equal(F.isSpending({ type: 'expense' }), true);
    assert.equal(F.isSpending({ type: 'expense', category: 'BNPL Payment' }), true);
    for (const category of ['Loan Given', 'Settlement', 'Debt Settlement']) assert.equal(F.isSpending({ type: 'expense', category }), false);
    assert.equal(F.isSpending({ type: 'transfer_out', category: 'Food' }), false);
});

test('monthly burn ignores transfers and lending, converts INR and uses real history length', () => {
    const now = new Date(2026, 9, 22);
    const data = F.normalize({ settings: { rate: 20 }, accounts: [{ id: 'a', currency: 'AED' }, { id: 'i', currency: 'INR' }], transactions: [
        { id: '1', accountId: 'a', type: 'expense', category: 'Food', amount: 300, date: new Date(2026, 9, 5).toISOString() },
        { id: '2', accountId: 'i', type: 'expense', category: 'Rent', amount: 6000, date: new Date(2026, 9, 6).toISOString() },
        { id: '3', accountId: 'a', type: 'transfer_out', category: 'Investment', amount: 5000, date: new Date(2026, 9, 7).toISOString() },
        { id: '4', accountId: 'a', type: 'expense', category: 'Loan Given', amount: 9000, date: new Date(2026, 9, 8).toISOString() }
    ] });
    // 300 AED + 300 AED (6000 INR) over 17 days of history counts as one month, not three.
    assert.equal(Math.round(F.monthlyBurn(data, now)), 600);
    assert.equal(F.monthlyBurn(F.defaults(), now), 0);
});

test('financial freedom no longer counts money lent out as living expenses', () => {
    const data = F.normalize({ settings: { rate: 20 }, accounts: [{ id: 'a', currency: 'AED', balance: 1200 }], transactions: [
        { type: 'expense', amount: 100, currency: 'AED', date: '2026-08-10' },
        { type: 'expense', category: 'Loan Given', amount: 5000, currency: 'AED', date: '2026-08-11' }
    ] });
    const result = F.financialFreedom(data, new Date(2026, 8, 30));
    assert.equal(result.years, 1200 / (100 * 12));
});

test('CSV cells are quoted and protected from formula injection; quoted import lines parse', () => {
    assert.equal(F.csvCell('Coffee'), 'Coffee');
    assert.equal(F.csvCell('Rent, Oct'), '"Rent, Oct"');
    assert.equal(F.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(F.csvCell('-5'), "'-5");
    assert.deepEqual(F.parseCsvLine('2026-10-01, "Lulu, Al Barsha", -120.50'), ['2026-10-01', 'Lulu, Al Barsha', '-120.50']);
    assert.deepEqual(F.parseCsvLine('a,"say ""hi""",3'), ['a', 'say "hi"', '3']);
});
