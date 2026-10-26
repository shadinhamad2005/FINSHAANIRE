const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/finance-core.js');
const now = new Date(2026, 9, 22, 10);

test('bank SMS: UAE and Indian formats, debit vs credit, OTPs ignored', () => {
    const card = F.parseBankSms('AED 120.50 was spent on your Credit Card ending 1234 at CARREFOUR MOE on 21/10/2026. Avl limit AED 9,000', now);
    assert.deepEqual([card.amount, card.currency, card.type, card.merchant, F.localDateKey(card.date)], [120.5, 'AED', 'expense', 'CARREFOUR MOE', '2026-10-21']);
    const upi = F.parseBankSms('Rs.1,200 debited from a/c **1234 on 22-10-2026 to VPA merchant@upi Ref 123', now);
    assert.deepEqual([upi.amount, upi.currency, upi.type, upi.merchant], [1200, 'INR', 'expense', 'merchant@upi']);
    const neft = F.parseBankSms('INR 5,000.00 credited to A/c XX1234 on 22-Oct-26 by NEFT from RAVI KUMAR', now);
    assert.deepEqual([neft.amount, neft.type, F.localDateKey(neft.date)], [5000, 'income', '2026-10-22']);
    assert.equal(F.parseBankSms('Your OTP for AED 50 purchase is 123456', now), null);
    assert.equal(F.parseBankSms('Hello, your statement is ready', now), null);
    assert.equal(F.localDateKey(F.parseBankSms('Purchase of AED 45.00 at STARBUCKS', now).date), '2026-10-22');
});

test('bill shares add up to the exact total', () => {
    assert.deepEqual(F.splitCents(10000, 3), [3334, 3333, 3333]);
    assert.deepEqual(F.splitCents(9000, 3), [3000, 3000, 3000]);
    assert.equal(F.splitCents(12345, 4).reduce((a, b) => a + b), 12345);
});

test('credit cards can spend down to their limit; other accounts only their balance', () => {
    assert.equal(F.availableToSpend({ type: 'Credit Card', balance: -1000, creditLimit: 5000 }), 4000);
    assert.equal(F.availableToSpend({ type: 'Bank Account', balance: 300, creditLimit: 5000 }), 300);
    assert.equal(F.availableToSpend(null), 0);
});

test('metal price per gram applies purity and converts to AED and INR', () => {
    const p24 = F.metalPricePerGram(3110.34768, 24, 25); // exactly 100 USD per gram
    assert.equal(F.money(p24.AED), 367.25); assert.equal(F.money(p24.INR), 9181.25);
    // 1 kg of 22K: rounding the gram price first would be off by up to 5 AED.
    assert.equal(F.money(1000 * F.metalPricePerGram(3110.34768, 22, 25).AED), F.money(367.25 * 22 / 24 * 1000));
});

test('linked goals follow the account balance in the goal currency; manual goals keep their figure', () => {
    const data = F.normalize({ settings: { rate: 25 }, accounts: [{ id: 's', currency: 'AED', balance: 400 }] });
    assert.equal(F.goalSaved({ accountId: 's', currency: 'INR', saved: 5 }, data), 10000);
    assert.equal(F.goalSaved({ saved: 75 }, data), 75);
    assert.equal(F.goalSaved({ accountId: 'gone', saved: 12 }, data), 12);
});

test('monthly close separates earned income and spending and reads the trend', () => {
    const data = F.normalize({ settings: { rate: 25 }, accounts: [{ id: 'a', currency: 'AED' }, { id: 'i', currency: 'INR' }],
        historicalSnapshots: [{ month: '2026-08', netWorthAED: 1000 }, { month: '2026-09', netWorthAED: 1500 }],
        transactions: [
            { accountId: 'a', type: 'income', category: 'Salary', amount: 2000, date: new Date(2026, 8, 1, 12).toISOString() },
            { accountId: 'a', type: 'income', category: 'Opening Balance', amount: 9999, date: new Date(2026, 8, 1, 12).toISOString() },
            { accountId: 'a', type: 'expense', category: 'Food', amount: 300, date: new Date(2026, 8, 5, 12).toISOString() },
            { accountId: 'i', type: 'expense', category: 'Rent', amount: 5000, date: new Date(2026, 8, 6, 12).toISOString() },
            { accountId: 'a', type: 'expense', category: 'Loan Given', amount: 700, date: new Date(2026, 8, 7, 12).toISOString() },
            { accountId: 'a', type: 'expense', category: 'Food', amount: 50, date: new Date(2026, 9, 1, 12).toISOString() }
        ] });
    const m = F.monthlyClose(data, 2026, 8);
    assert.deepEqual([m.income, m.spending, m.saved, m.savingsRate, m.netWorthChange], [2000, 500, 1500, 75, 500]);
    assert.deepEqual(m.categories.map(c => c.name), ['Food', 'Rent']);
});

test('remittance advice compares today with the 90-day average; daily rates merge without conflicts', () => {
    const data = F.normalize({ settings: { rate: 25.5 }, rateHistory: { '2026-09-01': 25, '2026-09-15': 25.2, '2026-10-01': 25.1, '2025-01-01': 30 } });
    const advice = F.remittanceAdvice(data, now);
    assert.equal(advice.average, 25.1); assert.equal(advice.best, 25.2); assert.match(advice.verdict, /Good day/);
    assert.match(F.remittanceAdvice(F.defaults(), now).verdict, /Not enough/);
    const base = F.defaults(), local = F.clone(base), remote = F.clone(base);
    local.rateHistory = { '2026-10-22': 25.1 }; remote.rateHistory = { '2026-10-22': 25.2, '2026-10-21': 25 };
    assert.doesNotThrow(() => F.merge(base, local, remote));
    assert.equal(Object.keys(F.merge(base, local, remote).rateHistory).length, 2);
});

test('year pack: calendar totals, AED->INR remittances and India April-March INR income', () => {
    const data = F.normalize({ settings: { rate: 25 }, accounts: [{ id: 'a', currency: 'AED' }, { id: 'i', currency: 'INR' }], transactions: [
        { id: 'o', transferGroupId: 'g', accountId: 'a', type: 'transfer_out', amount: 1000, date: '2026-05-10T08:00:00Z' },
        { id: 'n', transferGroupId: 'g', accountId: 'i', type: 'transfer_in', amount: 25500, date: '2026-05-10T08:00:00Z' },
        { accountId: 'i', type: 'income', category: 'NRE Interest', amount: 1200, date: '2026-04-15T08:00:00Z' },
        { accountId: 'i', type: 'income', category: 'NRE Interest', amount: 800, date: '2027-02-15T08:00:00Z' },
        { accountId: 'i', type: 'income', category: 'NRE Interest', amount: 999, date: '2026-03-15T08:00:00Z' },
        { accountId: 'a', type: 'expense', category: 'Zakat', amount: 250, date: '2026-06-01T08:00:00Z' }
    ] });
    const pack = F.yearPack(data, 2026);
    assert.deepEqual(pack.remittances, { count: 1, sentAED: 1000, receivedINR: 25500 });
    assert.deepEqual(pack.inrIncome, { 'NRE Interest': 2000 });
    assert.equal(pack.zakatPaid, 250);
    assert.match(pack.indiaFinancialYear, /Apr 2026 - Mar 2027/);
});

test('market revaluations are neither earned income nor spending', () => {
    assert.equal(F.isEarnedIncome({ type: 'income', category: 'Revaluation' }), false);
    assert.equal(F.isSpending({ type: 'expense', category: 'Revaluation' }), false);
});
