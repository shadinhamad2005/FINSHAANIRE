const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const F = require('../js/finance-core.js');
const UI = require('../js/finance-ui.js');
const fixture = () => F.normalize({
    accounts: [{ id: 'a', name: 'Bank', currency: 'AED', type: 'Bank Account' }, { id: 'b', name: 'Cash', currency: 'AED', type: 'Cash' }],
    transactions: [{ id: 'opening', accountId: 'a', amount: 100, type: 'income', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' }]
});
test('transfers reverse both sides and fees', () => {
    const data = fixture();
    data.transactions.push(
        { id: 'out', accountId: 'a', type: 'transfer_out', amount: 40, transferGroupId: 'g' },
        { id: 'in', accountId: 'b', type: 'transfer_in', amount: 40, transferGroupId: 'g' },
        { id: 'fee', accountId: 'a', type: 'expense', amount: 2, transferGroupId: 'g' }
    );
    F.recalculate(data); assert.deepEqual(data.accounts.map(a => a.balance), [58, 40]);
    F.deleteEntry(data, 'in'); assert.deepEqual(data.accounts.map(a => a.balance), [100, 0]);
    assert.equal(data.transactions.length, 1);
});
test('legacy transfers fail closed when counterpart is ambiguous', () => {
    const data = fixture(); data.transactions.push({ id: 'out', accountId: 'a', type: 'transfer_out', amount: 40, date: '2026-01-01' });
    assert.throws(() => F.deleteEntry(data, 'out'), /safely identify/);
    assert.equal(data.transactions.length, 2);
});
test('BNPL reversal reopens the exact installment and debt', () => {
    const data = fixture();
    data.debts.push({ id: 'd', isBnpl: true, currency: 'AED', amount: 0, settled: true, schedule: [{ amount: 40, paid: true, status: 'paid', paymentTransactionId: 'pay' }] });
    data.transactions.push({ id: 'pay', accountId: 'a', type: 'expense', amount: 40, debtId: 'd', installmentIndex: 0 });
    F.deleteEntry(data, 'pay');
    assert.equal(data.debts[0].amount, '40.00'); assert.equal(data.debts[0].settled, false);
    assert.equal(data.debts[0].schedule[0].status, 'pending'); assert.equal(data.accounts[0].balance, 100);
});
test('currencies convert from debt currency to account currency', () => {
    assert.equal(F.convert(2275, 'INR', 'INR', 22.75), 2275);
    assert.equal(F.convert(2275, 'INR', 'AED', 22.75), 100);
    assert.equal(F.convert(100, 'AED', 'INR', 22.75), 2275);
    assert.throws(() => F.convert(100, 'AED', 'INR', -2), /positive/);
});
test('concurrent independent entries are preserved, conflicting edits rejected', () => {
    const base = fixture(), local = F.clone(base), remote = F.clone(base);
    local.transactions.push({ id: 'local', accountId: 'a', amount: 10, type: 'expense' });
    remote.transactions.push({ id: 'remote', accountId: 'a', amount: 20, type: 'expense' });
    const merged = F.recalculate(F.merge(base, local, remote));
    assert.equal(merged.transactions.length, 3); assert.equal(merged.accounts[0].balance, 70);
    local.accounts[0].name = 'Local'; remote.accounts[0].name = 'Remote';
    assert.throws(() => F.merge(base, local, remote), /Another device/);
});
test('monthly dates clamp and restore the original day after February', () => {
    const feb = F.nextDue(new Date(2026, 0, 31), 'Monthly', 31);
    assert.equal(feb.getMonth(), 1); assert.equal(feb.getDate(), 28);
    const mar = F.nextDue(feb, 'Monthly', 31);
    assert.equal(mar.getMonth(), 2); assert.equal(mar.getDate(), 31);
    const yearly = F.nextDue(new Date(2024, 1, 29), 'Yearly', 29);
    assert.equal(yearly.getFullYear(), 2025); assert.equal(yearly.getMonth(), 1); assert.equal(yearly.getDate(), 28);
});
test('new profiles retain all required defaults independently', () => {
    const a = F.defaults(), b = F.defaults(); a.debts.push({ id: 'd' });
    assert.equal(b.debts.length, 0); assert.ok(b.expenseCategories.length); assert.deepEqual(b.subscriptions, []);
});
test('invalid backups are rejected without mutating the supplied ledger', () => {
    const valid = fixture(), before = F.clone(valid);
    assert.equal(F.validateBackup(valid).accounts[0].balance, 100); assert.deepEqual(valid, before);
    assert.throws(() => F.validateBackup({ accounts: [] }), /transactions/);
    const bad = fixture(); bad.transactions[0].amount = 'not money'; assert.throws(() => F.validateBackup(bad), /Invalid transaction/);
    const missing = fixture(); missing.transactions[0].accountId = 'missing'; assert.throws(() => F.validateBackup(missing), /missing account/);
    const duplicate = fixture(); duplicate.accounts.push(F.clone(duplicate.accounts[0])); assert.throws(() => F.validateBackup(duplicate), /duplicate ID/);
    const settings = fixture(); settings.settings = 'broken'; assert.throws(() => F.validateBackup(settings), /settings/);
    const emptyAmount = fixture(); emptyAmount.transactions[0].amount = null; assert.throws(() => F.validateBackup(emptyAmount), /Invalid transaction/);
    assert.throws(() => F.validateBackup(JSON.parse('{"accounts":[],"transactions":[],"__proto__":{}}')), /Unsafe/);
});
test('backups omit tokens and lock credentials without altering saved settings', () => {
    const data = fixture(); Object.assign(data.settings, { messagingToken: 'secret', whapiToken: 'old-secret', pinCode: 'hash', pinEnabled: true });
    const backup = F.publicBackup(data);
    for (const key of ['messagingToken', 'whapiToken', 'pinCode', 'pinEnabled']) assert.equal(backup.data.settings[key], undefined);
    assert.equal(data.settings.messagingToken, 'secret');
});
function render(value) { const element = { innerHTML: '', querySelectorAll: () => [] }; UI.setHTML(element, value); return element.innerHTML; }
test('HTML templates escape user data while retaining nested application markup', () => {
    const payload = '<img src=x onerror="globalThis.compromised=true">';
    const result = render(UI.html`<div>${['one', payload].map(name => UI.html`<span>${name}</span>`).join('')}</div>`);
    assert.ok(result.startsWith('<div><span>one</span>')); assert.ok(!result.includes('<img'));
    assert.ok(result.includes('&lt;img')); assert.ok(!result.includes('\uE000'));
});
test('quoted event arguments cannot escape into executable statements', () => {
    const value = "');globalThis.compromised=true;//";
    const markup = render(UI.html`<button onclick="window.select('${value}')">Pick</button>`);
    const handler = /onclick="([^"]*)"/.exec(markup)[1].replaceAll('&amp;', '&');
    let selected; const context = { window: { select: value => { selected = value; } }, compromised: false };
    vm.runInNewContext(handler, context);
    assert.equal(selected, value); assert.equal(context.compromised, false);
});
test('attributes cannot be broken by imported names', () => {
    const result = render(UI.html`<input value="${'" autofocus onfocus="alert(1)'}">`);
    assert.ok(result.includes('value="&quot; autofocus onfocus=&quot;alert(1)"'));
});
test('active application has no unsanitized HTML assignments', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.doesNotMatch(html, /\.innerHTML\s*\+?=/);
    assert.doesNotMatch(html, /\bon(?:click|change|input|keydown)=/);
    assert.match(html, /assets\/app.js/);
});
test('merge ignores auto-calculated historicalSnapshots drift and avoids sync conflict', () => {
    const base = F.defaults();
    base.historicalSnapshots = [{ month: '2026-08', netWorthAED: 1000 }];
    const local = JSON.parse(JSON.stringify(base));
    local.transactions = [{ id: 'tx1', amount: 100, accountId: 'acc1', type: 'expense' }];
    local.historicalSnapshots = [{ month: '2026-08', netWorthAED: 1000 }, { month: '2026-09', netWorthAED: 1200 }];
    const remote = JSON.parse(JSON.stringify(base));
    remote.historicalSnapshots = [{ month: '2026-08', netWorthAED: 1000 }, { month: '2026-09', netWorthAED: 1050 }];
    const merged = F.merge(base, local, remote);
    assert.equal(merged.transactions.length, 1);
    assert.deepEqual(merged.historicalSnapshots, local.historicalSnapshots);
});


test('Firestore field reordering does not block deletion, but remote edits do', () => {
    const base = fixture(), local = F.clone(base), remote = F.clone(base);
    remote.transactions[0] = Object.fromEntries(Object.entries(remote.transactions[0]).reverse());
    local.transactions = [];
    assert.deepEqual(F.merge(base, local, remote).transactions, []);
    remote.transactions[0].amount = 150;
    assert.throws(() => F.merge(base, local, remote), /Another device/);
});
test('record equality ignores nested field order and preserves array order and types', () => {
    assert.equal(F.same({ a: 1, b: { x: 2, y: 3 } }, { b: { y: 3, x: 2 }, a: 1 }), true);
    assert.equal(F.same([1, 2], [2, 1]), false);
    assert.equal(F.same({ amount: 1 }, { amount: '1' }), false);
    assert.equal(F.same({ a: undefined }, {}), false);
});

test('financial freedom converts currencies and uses only completed history months', () => {
    const data = F.normalize({ settings: { rate: 20 }, accounts: [{ id: 'a', currency: 'AED', balance: 1200 }], debts: [{ type: 'payable', currency: 'AED', amount: 200 }], transactions: [
        { type: 'expense', amount: 100, currency: 'AED', date: '2026-07-10' },
        { type: 'expense', amount: 2000, currency: 'INR', exchangeRate: 20, date: '2026-08-10' },
        { type: 'expense', amount: 99999, currency: 'AED', date: '2026-09-10' }
    ] });
    const result = F.financialFreedom(data, new Date(2026, 8, 30));
    assert.equal(result.months, 2); assert.equal(result.years, 1000 / 1200);
    assert.equal(F.financialFreedom(F.defaults()).years, null);
});
