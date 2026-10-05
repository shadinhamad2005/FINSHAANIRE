const test = require('node:test');
const assert = require('node:assert/strict');
const { toMinor, prepareCommit, balances, assertTransferGroups } = require('../src/domain/ledger.ts');
const core = require('../js/finance-core.js');
const ledger = () => core.normalize({ accounts: [{ id: 'bank', name: 'Bank', type: 'Cash', currency: 'AED', balance: 0 }], transactions: [] });
test('money conversion rounds exact decimal ties and handles exponential notation', () => {
    assert.equal(toMinor('1.005'), 101); assert.equal(toMinor('-1.005'), -101);
    assert.equal(toMinor('1e2'), 10000); assert.equal(toMinor('0.1'), 10);
    assert.equal(toMinor(0.1 + 0.2), 30); assert.equal(toMinor('0.0001'), 0);
    assert.throws(() => toMinor(Infinity), /finite/); assert.throws(() => toMinor(''), /finite/);
});
test('every saved entry receives a validated minor-unit amount', () => {
    const previous = ledger(), next = ledger();
    next.transactions.push({ id: 'a', accountId: 'bank', type: 'income', amount: '1.005', date: '2026-09-21' });
    prepareCommit(previous, next);
    assert.equal(next.transactions[0].amountMinor, 101); assert.equal(next.transactions[0].amount, 1.01);
    assert.equal(balances(next).get('bank'), 101);
});
test('duplicate submission IDs and mismatched currencies cannot be committed', () => {
    const previous = ledger(), next = ledger();
    const entry = { id: 'a', accountId: 'bank', type: 'expense', amount: 1, date: '2026-09-21' };
    next.transactions.push(entry, { ...entry }); assert.throws(() => prepareCommit(previous, next), /Duplicate/);
    next.transactions = [{ ...entry, currency: 'INR' }]; assert.throws(() => prepareCommit(previous, next), /currency/);
});
test('the save boundary rejects one-sided transfers and removes legacy secrets', () => {
    assert.throws(() => assertTransferGroups([{ id: 'a', type: 'transfer_out', accountId: 'bank', transferGroupId: 'g' }]), /both/);
    const data = ledger(); data.settings.messagingToken = 'legacy'; data.settings.whapiToken = 'legacy';
    prepareCommit(ledger(), data); assert.equal(data.settings.messagingToken, undefined); assert.equal(data.settings.whapiToken, undefined);
});
test('excludeFromBudget flag is normalized and preserved across save boundaries', () => {
    const previous = ledger(), next = ledger();
    next.transactions.push({ id: 'a', accountId: 'bank', type: 'expense', amount: 50, date: '2026-09-21', excludeFromBudget: true });
    prepareCommit(previous, next);
    assert.equal(next.transactions[0].excludeFromBudget, true);
});

test('unchanged legacy orphan entries do not block deleting another transaction', () => {
    const previous = ledger();
    previous.transactions = [
        { id: 'orphan', accountId: 'removed', amount: '5.00', type: 'expense', date: '2026-09-21' },
        { id: 'delete', accountId: 'bank', amount: 10, type: 'income', date: '2026-09-21' }
    ];
    const next = core.clone(previous);
    next.transactions = [Object.fromEntries(Object.entries(previous.transactions[0]).reverse())];
    next.transactions[0].amount = 5;
    next.transactions[0].amountMinor = 500;
    assert.doesNotThrow(() => prepareCommit(previous, next));
    assert.equal(next.transactions.length, 1);
    const changed = core.clone(next); changed.transactions[0].amount = 6;
    assert.throws(() => prepareCommit(previous, changed), /missing account/);
    assert.throws(() => prepareCommit(ledger(), core.clone(next)), /missing account/);
    const removed = core.clone(previous); removed.transactions = [];
    assert.doesNotThrow(() => prepareCommit(previous, removed));
});

test('removing an account cannot newly orphan an existing entry', () => {
    const previous = ledger();
    previous.transactions = [{ id: 'a', accountId: 'bank', amount: 5, type: 'income', date: '2026-09-21' }];
    const next = core.clone(previous); next.accounts = [];
    assert.throws(() => prepareCommit(previous, next), /missing account/);
});
