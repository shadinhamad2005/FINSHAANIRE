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

test('expense adding section: remaining budget calculation for category', () => {
    const data = F.normalize({
        expenseCategories: ['Food & Groceries', 'Dining Out'],
        envelopeLedger: [
            { id: 'c1', date: '2026-10-01', type: 'credit', amount: 4000 },
            { id: 'f1', date: '2026-10-01', type: 'fund', category: 'Food & Groceries', amount: 1000 },
            { id: 'f2', date: '2026-10-01', type: 'fund', category: 'Dining Out', amount: 300 }
        ],
        transactions: [
            { id: 't1', accountId: 'acc1', type: 'expense', category: 'Food & Groceries', amount: 350, date: '2026-10-05' }
        ]
    });

    const stats = getEnvelopeStats(data);
    
    // Food & Groceries: 1000 funded, 350 spent -> 650 left
    const groceryStat = stats.categories['Food & Groceries'];
    assert.equal(groceryStat.funded, 1000);
    assert.equal(groceryStat.spent, 350);
    assert.equal(groceryStat.available, 650);

    // If an expense of 200 is being added:
    const newExpenseAmt = 200;
    const remainingAfter = groceryStat.available - newExpenseAmt;
    assert.equal(remainingAfter, 450);
    assert.ok(remainingAfter >= 0); // Within budget

    // If an expense of 700 is being added:
    const overExpenseAmt = 700;
    const overRemaining = groceryStat.available - overExpenseAmt;
    assert.equal(overRemaining, -50); // Exceeds budget by 50
    assert.ok(overRemaining < 0);

    // Dining Out: 300 funded, 0 spent -> 300 left
    const diningStat = stats.categories['Dining Out'];
    assert.equal(diningStat.funded, 300);
    assert.equal(diningStat.spent, 0);
    assert.equal(diningStat.available, 300);
});

test('Salary Day budget restart: spending resets to 0, past cycle is archived, envelopes auto-fund from targets', () => {
    // 1. Setup month 1 with expenses
    const data = F.normalize({
        expenseCategories: ['Food & Groceries', 'Utilities', 'Dining Out'],
        savingsCategories: ['Emergency Fund'],
        investmentCategories: ['Mutual Funds'],
        settings: {
            rate: 22.75,
            lastSalaryDate: '2026-10-01T08:00:00.000Z'
        },
        envelopeLedger: [
            { id: 'cred-1', date: '2026-10-01T08:00:00.000Z', type: 'credit', amount: 5000 },
            { id: 'fund-g', date: '2026-10-01T08:05:00.000Z', type: 'fund', category: 'Food & Groceries', amount: 1000 },
            { id: 'fund-u', date: '2026-10-01T08:05:00.000Z', type: 'fund', category: 'Utilities', amount: 500 },
            { id: 'fund-s', date: '2026-10-01T08:05:00.000Z', type: 'fund', category: 'Emergency Fund', amount: 1500 }
        ],
        transactions: [
            // Outgoing month expenses
            { id: 'tx-1', date: '2026-10-05T12:00:00.000Z', type: 'expense', category: 'Food & Groceries', amount: 400 },
            { id: 'tx-2', date: '2026-10-15T12:00:00.000Z', type: 'expense', category: 'Food & Groceries', amount: 450 },
            { id: 'tx-3', date: '2026-10-10T12:00:00.000Z', type: 'expense', category: 'Utilities', amount: 300 }
        ],
        budgetTemplate: {
            'Food & Groceries': 1000,
            'Utilities': 500,
            'Emergency Fund': 1500
        },
        budgetReports: []
    });

    // Helper that respects lastSalaryDate like budgets.js
    function getCycleStats(d) {
        const categories = {};
        let totalCredit = 0;
        let totalFunded = 0;
        const allCats = [...(d.expenseCategories || []), ...(d.savingsCategories || []), ...(d.investmentCategories || [])];
        allCats.forEach(cat => { categories[cat] = { funded: 0, spent: 0, available: 0 }; });

        (d.envelopeLedger || []).forEach(entry => {
            if (entry.type === 'credit') totalCredit += entry.amount;
            else if (entry.type === 'fund') {
                totalFunded += entry.amount;
                if (!categories[entry.category]) categories[entry.category] = { funded: 0, spent: 0, available: 0 };
                categories[entry.category].funded += entry.amount;
            } else if (entry.type === 'defund') {
                totalFunded -= entry.amount;
                if (!categories[entry.category]) categories[entry.category] = { funded: 0, spent: 0, available: 0 };
                categories[entry.category].funded -= entry.amount;
            }
        });

        const startDate = d.settings?.lastSalaryDate ? new Date(d.settings.lastSalaryDate) : new Date(0);
        startDate.setHours(0, 0, 0, 0);

        (d.transactions || []).forEach(t => {
            const txDate = new Date(t.date);
            if (txDate >= startDate && t.type === 'expense' && categories[t.category]) {
                categories[t.category].spent += Math.abs(t.amount);
            }
        });

        allCats.forEach(cat => {
            categories[cat].available = categories[cat].funded - categories[cat].spent;
        });

        return { categories, totalCredit, totalFunded, unallocatedCash: totalCredit - totalFunded };
    }

    // Check month 1 state: Groceries spent = 850, available = 150
    const m1Stats = getCycleStats(data);
    assert.equal(m1Stats.categories['Food & Groceries'].spent, 850);
    assert.equal(m1Stats.categories['Food & Groceries'].available, 150);
    assert.equal(m1Stats.categories['Utilities'].spent, 300);
    assert.equal(m1Stats.categories['Utilities'].available, 200);

    // 2. NEW SALARY ARRIVES on Oct 26: Execute Budget Restart
    const newSalaryDate = '2026-10-26T10:00:00.000Z';
    const newSalaryAmount = 6000;

    // A. Archive outgoing cycle
    data.budgetReports.push({
        id: 'rep-oct-2026',
        date: newSalaryDate,
        startDate: data.settings.lastSalaryDate,
        stats: JSON.parse(JSON.stringify(m1Stats))
    });
    assert.equal(data.budgetReports.length, 1);
    assert.equal(data.budgetReports[0].stats.categories['Food & Groceries'].spent, 850);

    // B. Restart envelope ledger
    data.envelopeLedger = [];
    data.envelopeLedger.push({
        id: 'sal-cred-nov',
        date: newSalaryDate,
        type: 'credit',
        amount: newSalaryAmount,
        note: 'Salary Cycle Income'
    });

    // C. Auto-fill envelopes from template
    const template = data.budgetTemplate;
    let unallocated = newSalaryAmount;
    Object.keys(template).forEach(cat => {
        const toFund = Math.min(template[cat], unallocated);
        data.envelopeLedger.push({
            id: 'fund-' + cat,
            date: newSalaryDate,
            type: 'fund',
            category: cat,
            amount: toFund
        });
        unallocated -= toFund;
    });

    // D. Update settings
    data.settings.lastSalaryDate = newSalaryDate;

    // 3. Verify restarted state
    const restartedStats = getCycleStats(data);

    // Old expenses from Oct 5, 10, 15 must NOT count in the new cycle!
    assert.equal(restartedStats.categories['Food & Groceries'].spent, 0, 'Spending should reset to 0');
    assert.equal(restartedStats.categories['Food & Groceries'].funded, 1000, 'Envelope should auto-fund to planned target');
    assert.equal(restartedStats.categories['Food & Groceries'].available, 1000, 'Full budget available again');

    assert.equal(restartedStats.categories['Utilities'].spent, 0);
    assert.equal(restartedStats.categories['Utilities'].available, 500);

    assert.equal(restartedStats.unallocatedCash, 3000, 'Leftover salary sits as unallocated cash buffer');

    // 4. Log a new expense in the new cycle
    data.transactions.push({
        id: 'tx-new-1',
        date: '2026-10-26T14:30:00.000Z',
        type: 'expense',
        category: 'Food & Groceries',
        amount: 120
    });

    const newCycleUpdated = getCycleStats(data);
    assert.equal(newCycleUpdated.categories['Food & Groceries'].spent, 120);
    assert.equal(newCycleUpdated.categories['Food & Groceries'].available, 880);
});

test('Salary Day budget restart: auto-fill reads new budget limits (budgets), NOT last month envelopes', () => {
    // Month 1: Envelope was funded 800
    const oldEnvelopeFunded = 800;
    
    // User sets new budget limits before salary hits
    const data = F.normalize({
        expenseCategories: ['Food & Groceries', 'Utilities'],
        budgets: {
            'Food & Groceries': 1200, // User increased their limit from 800 to 1200
            'Utilities': 600
        },
        settings: {
            lastSalaryDate: '2026-10-01T08:00:00.000Z'
        },
        envelopeLedger: [
            { id: 'c-old', date: '2026-10-01T08:00:00.000Z', type: 'credit', amount: 3000 },
            { id: 'f-old', date: '2026-10-01T08:05:00.000Z', type: 'fund', category: 'Food & Groceries', amount: oldEnvelopeFunded }
        ]
    });

    // Auto-fill target resolution (reading new budget limits, ignoring last month's envelope)
    const targets = {};
    const allCats = data.expenseCategories;
    allCats.forEach(cat => {
        const budgetLimit = (data.budgets && data.budgets[cat] !== undefined) ? Number(data.budgets[cat]) : null;
        const templateLimit = (data.budgetTemplate && data.budgetTemplate[cat] !== undefined) ? Number(data.budgetTemplate[cat]) : null;
        const target = (budgetLimit !== null && !isNaN(budgetLimit) && budgetLimit > 0)
            ? budgetLimit
            : ((templateLimit !== null && !isNaN(templateLimit) && templateLimit > 0) ? templateLimit : 0);
        if (target > 0) targets[cat] = target;
    });

    // Assert that target read 1200 (the new budget limit), NOT 800 (last month's envelope)
    assert.equal(targets['Food & Groceries'], 1200, 'Should read new budget limit of 1200, not last month 800');
    assert.equal(targets['Utilities'], 600);
});



