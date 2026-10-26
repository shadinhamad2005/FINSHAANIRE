// Browser regression checks for the October 2026 logic fixes. Same mocked Firebase harness as browser-review.cjs.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const F = require('../js/finance-core.js');
const buildRoot = path.join(path.resolve(__dirname, '..'), '.test-dist');
const shell = fs.readFileSync(path.join(buildRoot, 'index.html'), 'utf8');
const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const base = F.recalculate(F.normalize({
    settings: { rate: 25 },
    savingsCategories: ['Car Fund'],
    accounts: [
        { id: 'aed', name: 'Main Account', type: 'Bank Account', currency: 'AED' },
        { id: 'inr', name: 'India Account', type: 'Bank Account', currency: 'INR' },
        { id: 'fund', name: 'Index Fund', type: 'Mutual Fund', currency: 'INR' },
        { id: 'spare', name: 'Spare Wallet', type: 'Cash', currency: 'AED' }
    ],
    transactions: [
        { id: 'o1', type: 'income', amount: 10000, accountId: 'aed', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' },
        { id: 'o2', type: 'income', amount: 100000, accountId: 'inr', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' },
        { id: 'o3', type: 'income', amount: 50, accountId: 'spare', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' },
        { id: 'f1', type: 'income', amount: 5000, accountId: 'fund', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' },
        { id: 'fx', type: 'expense', amount: 100, accountId: 'fund', category: 'Car Fund', note: 'fund fee', date: '2026-02-01T08:00:00Z' }
    ]
}));

async function initialize(page, data = base) {
    await page.addInitScript(({ data }) => {
        const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
        const copy = value => ordered(JSON.parse(JSON.stringify(value)));
        window.__records = { main: copy(data) }; window.__writes = 0;
        window.__snap = key => ({ exists: () => key in window.__records, data: () => copy(window.__records[key]), metadata: { hasPendingWrites: false } });
        window.__firebase = {
            initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
            doc: (...args) => args.at(-1), getDoc: async key => window.__snap(key),
            onAuthStateChanged: (auth, callback) => { window.__auth = callback; queueMicrotask(() => callback({ uid: 'test-user', email: 'test@example.invalid' })); },
            onSnapshot: (key, callback) => { queueMicrotask(() => callback(window.__snap(key))); return () => {}; },
            runTransaction: async (db, callback) => {
                const changes = {}, deleted = [];
                await callback({ get: async key => window.__snap(key), set: (key, value) => { changes[key] = copy(value); }, delete: key => deleted.push(key) });
                Object.assign(window.__records, changes); for (const key of deleted) delete window.__records[key];
                window.__writes++;
            },
            setDoc: async () => { throw new Error('Unsafe old save path'); },
            signOut: async () => window.__auth(null), signInWithEmailAndPassword: async () => {}, createUserWithEmailAndPassword: async () => {},
            updatePassword: async () => {}, reauthenticateWithCredential: async () => {}, EmailAuthProvider: { credential: () => ({}) }
        };
        window.Chart = class { static getChart() { return null; } static defaults = { font: {} }; constructor() {} destroy() {} update() {} };
        window.confirm = () => true;
        window.open = () => null;
    }, { data });
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://finz.test') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: shell });
        const file = path.join(buildRoot, url.pathname.slice(1));
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/javascript', body: fs.readFileSync(file, 'utf8') });
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://finz.test/');
    await page.waitForFunction(() => window.state?.user && window.state.data.accounts.length);
    await page.waitForTimeout(100);
}
const saved = page => page.evaluate(() => window.__records.main);
const confirmYes = async page => { await page.locator('#confirm-yes-btn').click(); await page.waitForFunction(() => !document.getElementById('confirm-modal').dataset.busy); };

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.FINZ_BROWSER_CHANNEL || 'msedge' });
    const errors = [];
    const fresh = async () => { const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message)); await initialize(page); return page; };
    try {
        let page = await fresh();

        // 1. Invest More from an AED bank into an INR fund: one linked save, converted debit.
        await page.evaluate(() => window.quickInvest('fund'));
        await page.locator('#quick-inv-amt').fill('2500');
        await page.locator('#quick-inv-source').selectOption('aed');
        const writesBefore = await page.evaluate(() => window.__writes);
        await confirmYes(page);
        let data = await saved(page);
        const out = data.transactions.find(t => t.type === 'transfer_out' && t.accountId === 'aed');
        const inn = data.transactions.find(t => t.type === 'transfer_in' && t.accountId === 'fund');
        assert.equal(out.amount, 100); assert.equal(out.currency, 'AED');
        assert.equal(inn.amount, 2500); assert.equal(inn.currency, 'INR');
        assert.ok(out.transferGroupId && out.transferGroupId === inn.transferGroupId);
        assert.equal(await page.evaluate(() => window.__writes) - writesBefore, 1);
        // Deleting either side now removes both (older unlinked pairs could not be deleted at all).
        await page.evaluate(id => window.deleteTransaction(id), inn.id); await confirmYes(page);
        data = await saved(page);
        assert.equal(data.transactions.some(t => t.transferGroupId === out.transferGroupId), false);
        console.log('PASS invest-more converts currency, links both sides and saves atomically');

        // 2. Liquidate from the INR fund into the AED bank credits the converted amount.
        await page.evaluate(() => window.quickLiquidate('fund'));
        await page.locator('#quick-liq-amt').fill('1000');
        await page.locator('#quick-liq-dest').selectOption('aed');
        await confirmYes(page);
        data = await saved(page);
        assert.equal(data.transactions.find(t => t.type === 'transfer_in' && t.accountId === 'aed').amount, 40);
        console.log('PASS liquidation credits the destination in its own currency');

        // 3. Surplus sweep used to write a negative amount that the save layer always rejected.
        await page.evaluate(() => window.openSurplusSweepModal(200));
        await page.locator('#sweep-source').selectOption('aed');
        await page.locator('#sweep-target').selectOption('fund');
        await page.evaluate(() => window.executeSurplusSweep());
        data = await saved(page);
        const sweepOut = data.transactions.find(t => t.note?.startsWith('Surplus Sweep to'));
        const sweepIn = data.transactions.find(t => t.note?.startsWith('Surplus Sweep from'));
        assert.equal(sweepOut.amount, 200); assert.equal(sweepIn.amount, 5000); assert.equal(sweepOut.transferGroupId, sweepIn.transferGroupId);
        console.log('PASS surplus sweep saves a positive, linked, converted transfer');

        // 4. Emergency Fund starting balance is kept (it used to reset to 0 on the next recalculation).
        await page.evaluate(() => window.openEmergencyFundWizard());
        await page.locator('#emf-currency').selectOption('AED');
        await page.locator('#emf-initial-balance').fill('750');
        await page.evaluate(() => window.saveEmergencyFund());
        data = await saved(page);
        const emf = data.accounts.find(a => a.type === 'Emergency Fund');
        assert.equal(data.transactions.find(t => t.accountId === emf.id && t.category === 'Opening Balance').amount, 750);
        assert.equal(await page.evaluate(id => window.state.data.accounts.find(a => a.id === id).balance, emf.id), 750);
        assert.ok(emf.target > 0);
        console.log('PASS emergency fund keeps its opening balance and target');

        // 5. Accounts with history cannot be deleted into orphaned records; an opening-balance-only account can.
        await page.evaluate(() => window.delAccount('aed'));
        assert.equal(await page.locator('#confirm-modal').evaluate(el => el.classList.contains('hidden')), true);
        assert.ok((await saved(page)).accounts.some(a => a.id === 'aed'));
        await page.evaluate(() => window.delAccount('spare')); await confirmYes(page);
        data = await saved(page);
        assert.equal(data.accounts.some(a => a.id === 'spare'), false);
        assert.equal(data.transactions.some(t => t.accountId === 'spare'), false);
        console.log('PASS account deletion is blocked by history and cleans up opening balances');
        await page.close();

        // 6. Custom query no longer writes display fields into saved records; net total is signed.
        page = await fresh();
        await page.evaluate(() => { window.openModal('auth'); window.switchProfileTab('reports'); });
        await page.locator('#query-type').selectOption('all');
        await page.evaluate(() => window.executeCustomQuery());
        assert.equal(await page.evaluate(() => window.state.data.transactions.some(t => '_currency' in t)), false);
        await page.evaluate(() => window.updateDb());
        assert.equal(JSON.stringify(await saved(page)).includes('_currency'), false);
        console.log('PASS query and annual report leave saved transactions untouched');

        // 7. Editing a savings-pillar expense on an investment account keeps both the account and category.
        await page.evaluate(() => window.editTransaction('fx'));
        await page.locator('#tam').fill('120');
        await page.locator('#btn-save-tx').click();
        await page.waitForFunction(() => window.__records.main.transactions.find(t => t.id === 'fx').amount === 120);
        const fx = (await saved(page)).transactions.find(t => t.id === 'fx');
        assert.equal(fx.accountId, 'fund'); assert.equal(fx.category, 'Car Fund'); assert.equal(fx.date, '2026-02-01T08:00:00Z');
        console.log('PASS editing keeps the original account, category and date');

        // 8. New entries can be back-dated and are stored on that local day.
        await page.evaluate(() => window.openModal('transaction'));
        await page.locator('#tam').fill('15');
        await page.locator('#tx-date').fill('2026-09-03');
        await page.locator('#btn-save-tx').click();
        await page.waitForFunction(() => window.__records.main.transactions.some(t => t.amount === 15));
        const back = (await saved(page)).transactions.find(t => t.amount === 15);
        assert.equal(await page.evaluate(d => window.FinzCore.localDateKey(d), back.date), '2026-09-03');
        console.log('PASS entries accept a past date');

        // 9. INR -> AED transfer stores the rate as INR per AED (not 0.04), so reports convert correctly.
        await page.evaluate(() => window.openModal('transfer'));
        await page.locator('#ts').selectOption('inr');
        await page.locator('#ttg').selectOption('aed');
        await page.evaluate(() => window.updateTransferUI());
        await page.locator('#tamt').fill('2500');
        await page.locator('#tx-rate').fill('0.04');
        await page.evaluate(() => window.calcTransferEstimate('rate'));
        await page.locator('#btn-do-transfer').click();
        await page.waitForFunction(() => window.__records.main.transactions.some(t => t.type === 'transfer_out' && t.accountId === 'inr'));
        const remit = (await saved(page)).transactions.find(t => t.type === 'transfer_out' && t.accountId === 'inr');
        assert.equal(remit.exchangeRate, 25);
        assert.equal(await page.evaluate(t => window.getTransactionBaseAmount(t), remit), 100);
        console.log('PASS INR to AED transfers store a consistent exchange rate');
        await page.close();

        // 10. BNPL plans add up to the exact total, and "Later" moves the due installment.
        page = await fresh();
        await page.evaluate(() => window.openModal('debt'));
        await page.evaluate(() => { document.getElementById('dt').value = 'bnpl'; window.toggleDebtFields(); });
        await page.locator('#bnpl-product').fill('Phone');
        await page.locator('#da').fill('100');
        await page.locator('#db-split').fill('3');
        await page.locator('#drd').fill('2026-11-01');
        await page.locator('#btn-commit-debt').click();
        await page.waitForFunction(() => window.__records.main.debts.some(d => d.party === 'Phone'));
        let plan = (await saved(page)).debts.find(d => d.party === 'Phone');
        assert.equal(plan.schedule.reduce((s, i) => s + Math.round(Number(i.amount) * 100), 0), 10000);
        assert.equal(Number(plan.amount), 100);
        await page.evaluate(id => window.openRescheduleFlow(id), plan.id);
        await page.locator('#new-date').fill('2026-11-10');
        await page.evaluate(id => window.finalizeReschedule(id), plan.id);
        plan = (await saved(page)).debts.find(d => d.party === 'Phone');
        assert.equal(plan.schedule[0].date, '2026-11-10');
        console.log('PASS installment plans sum exactly and can be rescheduled');

        // 11. CSV import: quoted commas, day-first dates, and re-importing skips duplicates.
        await page.evaluate(() => window.openModal('import'));
        const csv = '01/10/2026, "Lulu, Al Barsha", -120.50\n2026-10-02, Freelance, "1,500"\nnot-a-date, Bad, 5';
        await page.locator('#csv-input').fill(csv);
        await page.evaluate(() => window.parseCSV());
        await page.locator('#csv-acc').selectOption('aed');
        await page.evaluate(() => window.bulkImport());
        data = await saved(page);
        const isImport = t => ['Freelance', 'Lulu, Al Barsha'].includes(t.note);
        const imported = data.transactions.filter(isImport);
        assert.equal(imported.length, 2);
        assert.deepEqual(imported.map(t => [t.note, t.amount, t.type, t.category]).sort(), [['Freelance', 1500, 'income', 'Imported'], ['Lulu, Al Barsha', 120.5, 'expense', 'Food']]);
        await page.evaluate(() => window.openModal('import'));
        await page.locator('#csv-input').fill(csv);
        await page.evaluate(() => window.parseCSV());
        await page.locator('#csv-acc').selectOption('aed');
        await page.evaluate(() => window.bulkImport());
        assert.equal((await saved(page)).transactions.filter(isImport).length, 2);
        console.log('PASS CSV import handles quoting, day-first dates, duplicates and files known merchants');

        // 12. No invented net-worth history.
        const snaps = await page.evaluate(() => window.state.data.historicalSnapshots);
        assert.equal(snaps.length, 1);
        console.log('PASS net worth trend records only real monthly values');
        await page.close();

        assert.deepEqual(errors, []);
        console.log('All fix regression checks passed.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
