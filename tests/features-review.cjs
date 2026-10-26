// Browser checks for the round-2 features (in-app updates + new features). Same mocked Firebase harness.
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
        { id: 'spare', name: 'Spare Wallet', type: 'Cash', currency: 'AED' },
        { id: 'sav', name: 'Car Savings', type: 'Savings', currency: 'AED' }
    ],
    contacts: [{ id: 'c1', name: 'Ravi', phone: '971500000001' }, { id: 'c2', name: 'Priya', phone: '971500000002' }],
    transactions: [
        { id: 'o1', type: 'income', amount: 10000, accountId: 'aed', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' },
        { id: 'o2', type: 'income', amount: 100000, accountId: 'inr', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' },
        { id: 'o3', type: 'income', amount: 50, accountId: 'spare', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' },
        { id: 'o4', type: 'income', amount: 5000, accountId: 'sav', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' },
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
    try {
        const page = await browser.newPage();
        page.on('pageerror', e => errors.push(e.message));
        await initialize(page);
        await page.evaluate(() => document.getElementById('reminder-overlay')?.classList.add('hidden'));
        const today = await page.evaluate(() => window.FinzCore.localDateKey(new Date()));
        let data;

        // 1-2. Auto-pay: category, edit keeps the schedule, pause stops charges, resume never back-charges.
        await page.evaluate(() => window.openModal('subscriptions'));
        await page.locator('#sub-name').fill('Gym');
        await page.locator('#sub-amt').fill('200');
        await page.locator('#sub-day').fill('28');
        await page.locator('#sub-acc').selectOption('aed');
        await page.locator('#sub-category').selectOption('Car Fund');
        await page.locator('#btn-save-sub').click();
        await page.waitForFunction(() => window.__records.main.subscriptions.length === 1);
        let sub = (await saved(page)).subscriptions[0];
        assert.equal(sub.category, 'Car Fund');
        const firstNext = sub.nextDate;
        await page.evaluate(id => { window.__finzContext.actions.editingSubscriptionId = id; window.openModal('subscriptions'); }, sub.id);
        assert.equal(await page.locator('#sub-name').inputValue(), 'Gym');
        await page.locator('#sub-amt').fill('250');
        await page.locator('#btn-save-sub').click();
        await page.waitForFunction(() => window.__records.main.subscriptions[0].amount === 250);
        sub = (await saved(page)).subscriptions[0];
        assert.equal(sub.nextDate, firstNext); assert.equal((await saved(page)).subscriptions.length, 1);
        await page.evaluate(id => window.toggleSubscriptionPause(id), sub.id);
        await page.evaluate(async () => { window.state.data.subscriptions[0].nextDate = '2026-01-01T08:00:00.000Z'; await window.updateDb(); await window.checkSubscriptions(); });
        data = await saved(page);
        assert.equal(data.subscriptions[0].paused, true);
        assert.equal(data.transactions.some(t => t.subscriptionId === sub.id), false);
        await page.evaluate(id => window.toggleSubscriptionPause(id), sub.id);
        data = await saved(page);
        assert.equal(data.subscriptions[0].paused, undefined);
        assert.ok(await page.evaluate(d => window.FinzCore.localDateKey(d), data.subscriptions[0].nextDate) >= today);
        await page.evaluate(id => { window.state.data.subscriptions = []; return window.updateDb(); }, sub.id);
        console.log('PASS auto-pay category, edit, pause and resume');

        // 3. Rate lock: the live rate is recorded daily but does not replace a locked rate.
        await page.route('https://api.exchangerate-api.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rates: { INR: 26 } }) }));
        await page.evaluate(() => { window.state.data.settings.rateLocked = true; return window.fetchExchangeRate(); });
        assert.equal(await page.evaluate(() => window.state.data.settings.rate), 25);
        assert.equal(await page.evaluate(d => window.state.data.rateHistory[d], today), 26);
        await page.evaluate(() => { delete window.state.data.settings.rateLocked; return window.fetchExchangeRate(); });
        assert.equal(await page.evaluate(() => window.state.data.settings.rate), 26);
        await page.evaluate(() => { window.state.data.settings.rate = 25; return window.updateDb(); });
        console.log('PASS exchange-rate lock and daily rate history');

        // 4. Archive: hidden from pickers, blocked while an auto-pay uses it, restorable.
        await page.evaluate(() => window.archiveAccount('spare'));
        await page.evaluate(() => window.openModal('transaction'));
        assert.equal(await page.locator('#ta option[value="spare"]').count(), 0);
        assert.equal((await saved(page)).accounts.find(a => a.id === 'spare').archived, true);
        await page.evaluate(async () => { window.state.data.subscriptions.push({ id: 'sx', name: 'Netflix', amount: 50, type: 'expense', accountId: 'inr', billingCycle: 'Monthly', day: 1, nextDate: '2027-01-01T08:00:00.000Z' }); await window.updateDb(); await window.archiveAccount('inr'); });
        assert.equal((await saved(page)).accounts.find(a => a.id === 'inr').archived, undefined);
        await page.evaluate(async () => { window.state.data.subscriptions = []; await window.updateDb(); await window.archiveAccount('spare', false); });
        assert.equal((await saved(page)).accounts.find(a => a.id === 'spare').archived, undefined);
        console.log('PASS account archive and restore');

        // 5. Ledger paging.
        await page.evaluate(async () => {
            for (let i = 0; i < 450; i++) window.state.data.transactions.push({ id: 'bulk' + i, accountId: 'spare', type: 'income', category: 'Other', amount: 1, date: new Date(2025, 0, 1 + (i % 300)).toISOString() });
            await window.updateDb(); window.openMasterLedger();
        });
        assert.equal(await page.locator('#master-ledger-body .group').count(), 200);
        await page.getByText(/Show more \(200 of/).click();
        assert.equal(await page.locator('#master-ledger-body .group').count(), 400);
        await page.evaluate(async () => { window.state.data.transactions = window.state.data.transactions.filter(t => !t.id.startsWith('bulk')); await window.updateDb(); window.closeModal(); });
        console.log('PASS ledger shows 200 rows at a time');

        // 6. Smart Add uses the chosen account and the user's own category.
        await page.evaluate(() => window.openSmartInput());
        await page.locator('#smart-input-acc').selectOption('inr');
        await page.locator('#smart-input-field').fill('500 coffee');
        await page.evaluate(() => window.processSmartInput());
        const coffee = (await saved(page)).transactions.find(t => t.note === 'coffee');
        assert.deepEqual([coffee.accountId, coffee.currency, coffee.amount, coffee.category], ['inr', 'INR', 500, 'Food']);
        console.log('PASS smart add account choice');

        // 7. Transfers are edited as a pair (with the fee) in one save.
        await page.evaluate(() => window.openModal('transfer'));
        await page.locator('#ts').selectOption('aed');
        await page.locator('#ttg').selectOption('spare');
        await page.evaluate(() => window.updateTransferUI());
        await page.locator('#tamt').fill('100');
        await page.locator('#btn-do-transfer').click();
        await page.waitForFunction(() => window.__records.main.transactions.some(t => t.type === 'transfer_in' && t.accountId === 'spare'));
        const tOut = (await saved(page)).transactions.find(t => t.type === 'transfer_out' && t.transferTo === 'spare');
        await page.evaluate(id => window.editTransaction(id), tOut.id);
        await page.locator('#etg-out').fill('150');
        await page.locator('#etg-fee').fill('2');
        await page.locator('#btn-save-transfer-edit').click();
        await page.waitForFunction(id => window.__records.main.transactions.find(t => t.id === id).amount === 150, tOut.id);
        const group = (await saved(page)).transactions.filter(t => t.transferGroupId === tOut.transferGroupId);
        assert.deepEqual(group.map(t => [t.type, t.amount]).sort(), [['expense', 2], ['transfer_in', 150], ['transfer_out', 150]]);
        console.log('PASS transfer edited as a linked pair with its fee');

        // 8. Credit card: owed balance, spending up to the limit, and paying it off.
        await page.evaluate(() => window.openModal('accounts'));
        await page.locator('#an').fill('Visa');
        await page.locator('#ac').selectOption('AED');
        await page.locator('#at').selectOption('Credit Card');
        await page.evaluate(() => window.toggleAssetFields());
        await page.locator('#ab').fill('1000');
        await page.locator('#card-limit').fill('5000');
        await page.locator('#card-due').fill('5');
        await page.locator('#btn-save-acc').click();
        await page.waitForFunction(() => window.__records.main.accounts.some(a => a.name === 'Visa'));
        const cardId = (await saved(page)).accounts.find(a => a.name === 'Visa').id;
        const cardBalance = () => page.evaluate(id => window.state.data.accounts.find(a => a.id === id).balance, cardId);
        assert.equal(await cardBalance(), -1000);
        const spend = async amount => { await page.evaluate(() => window.openModal('transaction')); await page.locator('#ta').selectOption(cardId); await page.locator('#tam').fill(String(amount)); await page.locator('#btn-save-tx').click(); await page.waitForTimeout(150); };
        await spend(3000);
        assert.equal(await cardBalance(), -4000);
        await spend(1500);
        assert.equal(await cardBalance(), -4000);
        await page.evaluate(id => window.openPayCard(id), cardId);
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#tamt').inputValue(), '4000.00');
        await page.locator('#btn-do-transfer').click();
        await page.waitForFunction(id => window.state.data.accounts.find(a => a.id === id).balance === 0, cardId);
        console.log('PASS credit card limit, spending and paying it off');

        // 9. Bank SMS import with currency conversion; OTPs skipped.
        await page.evaluate(() => window.openModal('import'));
        await page.locator('#sms-input').fill([
            'AED 120.50 was spent on your card ending 1234 at CARREFOUR MOE on 21/10/2026',
            'Salary of AED 15,000.00 has been credited to your account on 2026-10-01.',
            'Rs.2,500 debited from a/c **1234 on 20-10-2026 to VPA shop@upi Ref 123',
            'Your OTP is 445566 for AED 99'].join('\n'));
        await page.evaluate(() => window.parseSMS());
        await page.locator('#csv-acc').selectOption('aed');
        await page.evaluate(() => window.bulkImport());
        data = await saved(page);
        const carrefour = data.transactions.find(t => t.note === 'CARREFOUR MOE');
        assert.deepEqual([carrefour.amount, carrefour.type, carrefour.category], [120.5, 'expense', 'Food']);
        assert.equal(data.transactions.find(t => t.note === 'Bank credit').amount, 15000);
        assert.equal(data.transactions.find(t => t.note === 'shop@upi (INR 2500)').amount, 100);
        assert.equal(data.transactions.some(t => /OTP/.test(t.note || '')), false);
        console.log('PASS bank SMS import');

        // 10. Bill split: own share is spending, the rest become receivables, one save.
        await page.evaluate(() => window.openModal('transaction'));
        await page.locator('#tam').fill('90');
        await page.locator('#tn').fill('Dinner');
        await page.locator('.tx-split-contact[value="Ravi"]').check();
        await page.locator('.tx-split-contact[value="Priya"]').check();
        await page.locator('#btn-save-tx').click();
        await page.waitForFunction(() => window.__records.main.debts.some(d => d.party === 'Priya'));
        data = await saved(page);
        const mine = data.transactions.find(t => t.note?.startsWith('Dinner (your share'));
        assert.equal(mine.amount, 30);
        assert.deepEqual(data.transactions.filter(t => t.splitGroupId === mine.splitGroupId && t.category === 'Loan Given').map(t => t.amount), [30, 30]);
        assert.deepEqual(data.debts.filter(d => d.splitGroupId === mine.splitGroupId).map(d => [d.party, d.type, d.amount]).sort(), [['Priya', 'receivable', 30], ['Ravi', 'receivable', 30]]);
        console.log('PASS bill split creates your share and two receivables');

        // 11. Goal linked to an account follows its balance.
        await page.evaluate(() => window.openModal('goals'));
        await page.locator('#g-name').fill('New Car');
        await page.locator('#g-target').fill('20000');
        await page.locator('#g-account').selectOption('sav');
        await page.evaluate(() => window.saveGoal());
        data = await saved(page);
        const goal = data.goals.find(g => g.name === 'New Car');
        assert.equal(goal.accountId, 'sav');
        assert.equal(await page.evaluate(g => window.FinzCore.goalSaved(g, window.state.data), goal), 5000);
        assert.match(await page.locator('#modal-content').innerText(), /Tracks Car Savings/i);
        console.log('PASS goals linked to an account');

        // 12. Monthly close summary and email draft.
        await page.evaluate(() => window.openMonthlyClose(2026, 1));
        assert.match(await page.locator('#modal-title').innerText(), /February 2026/);
        assert.match(await page.locator('#modal-content a[href^="mailto:"]').getAttribute('href'), /subject=FINZ%20monthly%20close/);
        console.log('PASS monthly close');

        // 13. Live gold: market value by weight and purity, revaluation booked outside income.
        await page.evaluate(async () => {
            window.state.data.accounts.push({ id: 'gold', name: 'Gold Coins', type: 'Commodity', subtype: 'Gold', karat: 22, weight: 10, currency: 'AED' });
            window.state.data.transactions.push({ id: 'g0', accountId: 'gold', type: 'income', category: 'Opening Balance', amount: 3000, date: '2026-01-01T00:00:00Z' });
            await window.updateDb();
            window.__finzContext.actions.liveMetals = { Gold: 3110.34768, Silver: 31.1034768, at: Date.now() };
        });
        assert.equal(await page.evaluate(() => window.marketValue(window.state.data.accounts.find(a => a.id === 'gold'))), 3366.46);
        await page.evaluate(() => window.revalueToMarket('gold'));
        data = await saved(page);
        const reval = data.transactions.find(t => t.accountId === 'gold' && t.category === 'Revaluation');
        assert.deepEqual([reval.type, reval.amount], ['income', 366.46]);
        assert.equal(await page.evaluate(() => window.state.data.accounts.find(a => a.id === 'gold').balance), 3366.46);
        console.log('PASS live gold valuation and revaluation');

        // 14. Year-end pack PDF.
        const pack = await page.evaluate(() => window.generateYearPack(2026));
        assert.equal(pack.year, 2026);
        assert.equal(await page.evaluate(() => window.__pdf.saved), 'FINZ_Year_Pack_2026.pdf');
        assert.equal(await page.evaluate(() => window.__pdf.tables.length), 3);
        console.log('PASS year-end tax and zakat pack');

        // 15. Household sharing: owner allows a viewer; shared view is read-only with a way back.
        await page.evaluate(() => window.setSharingViewers(['viewerUid123']));
        assert.deepEqual(await page.evaluate(() => window.__records.access.viewers), ['viewerUid123']);
        await page.evaluate(() => window.openSharedLedger('ownerUid999'));
        await page.waitForFunction(() => window.state.readOnly === true && document.getElementById('shared-banner'));
        await page.waitForTimeout(100);
        const writes = await page.evaluate(() => window.__writes);
        assert.match(await page.evaluate(() => window.updateDb().then(() => 'saved', e => e.message)), /read-only/);
        assert.equal(await page.evaluate(() => window.__writes), writes);
        await page.evaluate(() => window.closeSharedLedger());
        await page.waitForFunction(() => window.state.readOnly === false && !document.getElementById('shared-banner'));
        console.log('PASS household sharing is read-only');

        // Every screen still opens.
        for (const modal of ['settings', 'budget', 'debt', 'analytics', 'subscriptions', 'goals', 'import', 'transfer', 'accounts', 'remittance']) {
            await page.evaluate(m => window.openModal(m), modal); await page.waitForTimeout(80);
        }
        await page.close();
        assert.deepEqual(errors, []);
        console.log('All feature checks passed.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
