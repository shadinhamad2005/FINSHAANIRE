const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/finance-core.js');

test('asset deletion: internal transactions (opening balance, revaluation) do not block deletion and are cleanly wiped', () => {
    const data = F.normalize({
        accounts: [
            { id: 'gold', name: '24K Gold Bar', type: 'Commodity', subtype: 'Gold', weight: 10, currency: 'AED', balance: 3150 },
            { id: 'bank', name: 'ADCB Bank', type: 'Bank Account', currency: 'AED', balance: 10000 }
        ],
        transactions: [
            { id: 't1', accountId: 'gold', amount: 3150, type: 'income', category: 'Opening Balance', note: 'Initial Balance', tags: ['#init'], date: '2026-01-01' },
            { id: 't2', accountId: 'gold', amount: 200, type: 'income', category: 'Revaluation', note: 'Market revaluation', date: '2026-02-01' },
            { id: 't3', accountId: 'bank', amount: 10000, type: 'income', category: 'Opening Balance', date: '2026-01-01' }
        ],
        settings: { emfAccountId: 'gold' },
        goals: [{ id: 'g1', name: 'Gold Goal', target: 5000, saved: 0, accountId: 'gold' }]
    });

    const isInternal = t => {
        if (!t || t.transferGroupId || t.debtId) return false;
        const cat = String(t.category || '').trim().toLowerCase();
        const note = String(t.note || '').trim().toLowerCase();
        const hasInitTag = Array.isArray(t.tags) && t.tags.some(tag => String(tag).toLowerCase().includes('init'));
        return cat === 'opening balance' || cat === 'revaluation' || cat === 'initial balance' || note === 'initial balance' || hasInitTag;
    };

    const blockers = (id) => {
        const txCount = data.transactions.filter(t => t.accountId === id && !isInternal(t)).length;
        const subs = (data.subscriptions || []).filter(s => s.accountId === id || s.targetAccountId === id).length;
        const reasons = [];
        if (txCount) reasons.push(`${txCount} transaction${txCount === 1 ? '' : 's'}`);
        if (subs) reasons.push(`${subs} recurring auto-pay schedule`);
        return reasons;
    };

    // Gold has only Opening Balance and Revaluation => should have 0 blockers!
    assert.deepEqual(blockers('gold'), []);

    // Perform deletion
    data.transactions = data.transactions.filter(t => t.accountId !== 'gold');
    data.accounts = data.accounts.filter(a => a.id !== 'gold');
    if (data.settings.emfAccountId === 'gold') delete data.settings.emfAccountId;
    for (const g of data.goals) if (g.accountId === 'gold') delete g.accountId;
    F.recalculate(data);

    // Assert that the account and all its transactions are gone
    assert.equal(data.accounts.some(a => a.id === 'gold'), false);
    assert.equal(data.transactions.some(t => t.accountId === 'gold'), false);
    assert.equal(data.settings.emfAccountId, undefined);
    assert.equal(data.goals[0].accountId, undefined);

    // Validate backup integrity (no dangling references!)
    assert.doesNotThrow(() => F.validateBackup(data));
});

test('asset deletion: external transactions (e.g. transfers) are flagged as blockers', () => {
    const data = F.normalize({
        accounts: [
            { id: 'inv', name: 'Tech ETF', type: 'Investment', currency: 'AED', balance: 5000 },
            { id: 'bank', name: 'ADCB Bank', type: 'Bank Account', currency: 'AED', balance: 10000 }
        ],
        transactions: [
            { id: 't1', accountId: 'inv', amount: 5000, type: 'transfer_in', transferGroupId: 'grp1', category: 'Investment', date: '2026-01-01' },
            { id: 't2', accountId: 'bank', amount: 5000, type: 'transfer_out', transferGroupId: 'grp1', category: 'Investment', date: '2026-01-01' }
        ]
    });

    const isInternal = t => {
        if (!t || t.transferGroupId || t.debtId) return false;
        const cat = String(t.category || '').trim().toLowerCase();
        const note = String(t.note || '').trim().toLowerCase();
        const hasInitTag = Array.isArray(t.tags) && t.tags.some(tag => String(tag).toLowerCase().includes('init'));
        return cat === 'opening balance' || cat === 'revaluation' || cat === 'initial balance' || note === 'initial balance' || hasInitTag;
    };

    const blockers = (id) => {
        const txCount = data.transactions.filter(t => t.accountId === id && !isInternal(t)).length;
        const subs = (data.subscriptions || []).filter(s => s.accountId === id || s.targetAccountId === id).length;
        const reasons = [];
        if (txCount) reasons.push(`${txCount} transaction${txCount === 1 ? '' : 's'}`);
        if (subs) reasons.push(`${subs} recurring auto-pay schedule`);
        return reasons;
    };

    assert.deepEqual(blockers('inv'), ['1 transaction']);
});
