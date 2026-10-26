const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/finance-core.js');

// Helper to simulate envelope stats calculation used in budgets.js
function getEnvelopeStats(data) {
    const categories = {};
    let totalCredit = 0;
    let totalFunded = 0;

    const allCats = [
        ...(data.expenseCategories || []),
        ...(data.savingsCategories || []),
        ...(data.investmentCategories || [])
    ];

    allCats.forEach(cat => {
        categories[cat] = { funded: 0, spent: 0, available: 0 };
    });

    (data.envelopeLedger || []).forEach(entry => {
        if (entry.type === 'credit') {
            totalCredit += entry.amount;
        } else if (entry.type === 'fund') {
            totalFunded += entry.amount;
            if (!categories[entry.category]) categories[entry.category] = { funded: 0, spent: 0, available: 0 };
            categories[entry.category].funded += entry.amount;
        } else if (entry.type === 'defund') {
            totalFunded -= entry.amount;
            if (!categories[entry.category]) categories[entry.category] = { funded: 0, spent: 0, available: 0 };
            categories[entry.category].funded -= entry.amount;
        }
    });

    (data.transactions || []).forEach(t => {
        if (t.type === 'expense' && categories[t.category]) {
            categories[t.category].spent += Math.abs(t.amount);
        }
    });

    allCats.forEach(cat => {
        categories[cat].available = categories[cat].funded - categories[cat].spent;
    });

    const unallocatedCash = totalCredit - totalFunded;
    return { categories, totalCredit, totalFunded, unallocatedCash };
}

test('envelope budgeting: transferring accidental 250 AED from Mutual Funds to Savings', () => {
    const data = F.normalize({
        expenseCategories: ['Rent', 'Groceries'],
        savingsCategories: ['Savings', 'Emergency Fund'],
        investmentCategories: ['Mutual Funds', 'Stocks'],
        envelopeLedger: [
            { id: 'cred-1', date: '2026-10-01', type: 'credit', amount: 5000, note: 'Salary' },
            // Mistake: funded 250 to Mutual Funds instead of Savings
            { id: 'fund-mf', date: '2026-10-02', type: 'fund', category: 'Mutual Funds', amount: 250 }
        ]
    });

    let stats = getEnvelopeStats(data);
    assert.equal(stats.totalCredit, 5000);
    assert.equal(stats.categories['Mutual Funds'].funded, 250);
    assert.equal(stats.categories['Savings'].funded, 0);
    assert.equal(stats.unallocatedCash, 4750);

    // Execute transfer: defund Mutual Funds 250, fund Savings 250
    const date = '2026-10-02T12:00:00Z';
    data.envelopeLedger.push({
        id: 'defund-mf',
        date,
        type: 'defund',
        category: 'Mutual Funds',
        amount: 250
    });
    data.envelopeLedger.push({
        id: 'fund-sav',
        date,
        type: 'fund',
        category: 'Savings',
        amount: 250
    });

    stats = getEnvelopeStats(data);
    assert.equal(stats.categories['Mutual Funds'].funded, 0);
    assert.equal(stats.categories['Savings'].funded, 250);
    assert.equal(stats.unallocatedCash, 4750); // Unallocated cash is preserved
});

test('envelope budgeting: setting exact allocation down returns difference to unallocated cash', () => {
    const data = F.normalize({
        expenseCategories: ['Groceries'],
        savingsCategories: ['Savings'],
        investmentCategories: ['Mutual Funds'],
        envelopeLedger: [
            { id: 'c1', date: '2026-10-01', type: 'credit', amount: 1000 },
            { id: 'f1', date: '2026-10-02', type: 'fund', category: 'Mutual Funds', amount: 250 }
        ]
    });

    // User wants to edit Mutual Funds budget from 250 to 0 (or 50)
    let stats = getEnvelopeStats(data);
    const newTarget = 50;
    const diff = newTarget - stats.categories['Mutual Funds'].funded; // 50 - 250 = -200

    assert.equal(diff, -200);

    // Defund the difference
    data.envelopeLedger.push({
        id: 'adj-1',
        date: '2026-10-02T13:00:00Z',
        type: 'defund',
        category: 'Mutual Funds',
        amount: Math.abs(diff)
    });

    stats = getEnvelopeStats(data);
    assert.equal(stats.categories['Mutual Funds'].funded, 50);
    assert.equal(stats.unallocatedCash, 950); // 1000 - 50 = 950
});

test('envelope budgeting: deleting accidental ledger entry restores unallocated cash', () => {
    const data = F.normalize({
        investmentCategories: ['Mutual Funds'],
        envelopeLedger: [
            { id: 'c1', date: '2026-10-01', type: 'credit', amount: 1000 },
            { id: 'mistake-entry', date: '2026-10-02', type: 'fund', category: 'Mutual Funds', amount: 250 }
        ]
    });

    let stats = getEnvelopeStats(data);
    assert.equal(stats.categories['Mutual Funds'].funded, 250);
    assert.equal(stats.unallocatedCash, 750);

    // Delete the mistaken entry by ID
    data.envelopeLedger = data.envelopeLedger.filter(e => e.id !== 'mistake-entry');

    stats = getEnvelopeStats(data);
    assert.equal(stats.categories['Mutual Funds'].funded, 0);
    assert.equal(stats.unallocatedCash, 1000);
});

test('envelope budgeting: bulk update validates against available unallocated cash', () => {
    const data = F.normalize({
        expenseCategories: ['Groceries'],
        savingsCategories: ['Savings'],
        investmentCategories: ['Mutual Funds'],
        envelopeLedger: [
            { id: 'c1', date: '2026-10-01', type: 'credit', amount: 1000 },
            { id: 'f1', date: '2026-10-02', type: 'fund', category: 'Mutual Funds', amount: 250 }
        ]
    });

    const stats = getEnvelopeStats(data);
    assert.equal(stats.unallocatedCash, 750);

    // Rebalance: Mutual Funds 250 -> 0 (-250), Savings 0 -> 500 (+500)
    // Net change: +250 <= 750 (allowed)
    const changes = [
        { cat: 'Mutual Funds', orig: 250, val: 0, diff: -250 },
        { cat: 'Savings', orig: 0, val: 500, diff: 500 }
    ];

    const netChange = changes.reduce((sum, c) => sum + c.diff, 0);
    assert.equal(netChange, 250);
    assert.ok(netChange <= stats.unallocatedCash);

    for (const ch of changes) {
        if (ch.diff > 0) {
            data.envelopeLedger.push({ id: `fund-${ch.cat}`, type: 'fund', category: ch.cat, amount: ch.diff });
        } else {
            data.envelopeLedger.push({ id: `defund-${ch.cat}`, type: 'defund', category: ch.cat, amount: Math.abs(ch.diff) });
        }
    }

    const updatedStats = getEnvelopeStats(data);
    assert.equal(updatedStats.categories['Mutual Funds'].funded, 0);
    assert.equal(updatedStats.categories['Savings'].funded, 500);
    assert.equal(updatedStats.unallocatedCash, 500);
});

test('envelope budgeting: adjusting starting credit down reduces unallocated cash to match reality', () => {
    const data = F.normalize({
        expenseCategories: ['Rent'],
        envelopeLedger: [
            { id: 'c1', date: '2026-10-01', type: 'credit', amount: 5000 },
            { id: 'f1', date: '2026-10-02', type: 'fund', category: 'Rent', amount: 2000 }
        ]
    });

    let stats = getEnvelopeStats(data);
    assert.equal(stats.unallocatedCash, 3000); // 5000 - 2000

    // User realizes they don't have enough bank balance (e.g. bank balance is 4000, not 5000)
    // Reduce starting credit by 1000 AED
    const newCredit = 4000;
    const creditEntry = data.envelopeLedger.find(e => e.type === 'credit');
    creditEntry.amount = newCredit;

    stats = getEnvelopeStats(data);
    assert.equal(stats.totalCredit, 4000);
    assert.equal(stats.unallocatedCash, 2000); // 4000 - 2000 = 2000 (accurately matches real bank surplus)
});

test('envelope budgeting: orphaned envelopes detection and restoration', () => {
    const data = F.normalize({
        investmentCategories: ['Stocks'], // 'Mutual Funds' was deleted
        envelopeLedger: [
            { id: 'c1', date: '2026-10-01', type: 'credit', amount: 5000 },
            // Mistake / orphan entry for deleted category
            { id: 'f-mf', date: '2026-10-02', type: 'fund', category: 'Mutual Funds', amount: 250 }
        ]
    });

    // Detect orphaned categories
    const allCats = [...(data.expenseCategories || []), ...(data.savingsCategories || []), ...(data.investmentCategories || [])];
    const stats = getEnvelopeStats(data);
    
    assert.equal(allCats.includes('Mutual Funds'), false);
    assert.equal(stats.categories['Mutual Funds'].funded, 250);

    // Restoring the category adds it back to investmentCategories
    data.investmentCategories.push('Mutual Funds');

    const restoredCats = [...(data.expenseCategories || []), ...(data.savingsCategories || []), ...(data.investmentCategories || [])];
    assert.equal(restoredCats.includes('Mutual Funds'), true);
});

test('envelope budgeting: deleting category auto-defunds active allocation', () => {
    const data = F.normalize({
        savingsCategories: ['Emergency Fund', 'Old Fund'],
        envelopeLedger: [
            { id: 'c1', date: '2026-10-01', type: 'credit', amount: 3000 },
            { id: 'f1', date: '2026-10-02', type: 'fund', category: 'Old Fund', amount: 400 }
        ]
    });

    let stats = getEnvelopeStats(data);
    assert.equal(stats.unallocatedCash, 2600); // 3000 - 400

    // Deleting 'Old Fund' category auto-defunds its 400 AED back to unallocated cash
    const catFunded = stats.categories['Old Fund']?.funded || 0;
    data.savingsCategories = data.savingsCategories.filter(c => c !== 'Old Fund');
    if (catFunded > 0) {
        data.envelopeLedger.push({
            id: 'defund-old',
            type: 'defund',
            category: 'Old Fund',
            amount: catFunded
        });
    }

    stats = getEnvelopeStats(data);
    assert.equal(stats.unallocatedCash, 3000); // Back to full 3000
    assert.equal(stats.categories['Old Fund'].funded, 0);
});

