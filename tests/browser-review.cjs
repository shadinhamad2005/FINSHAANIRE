const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const F = require('../js/finance-core.js');
const root = path.resolve(__dirname, '..');
const buildRoot = path.join(root, '.test-dist');
const sourceForTest = fs.readFileSync(path.join(buildRoot, 'index.html'), 'utf8');
const base = F.recalculate(F.normalize({
    accounts: [{ id: 'aed', name: 'Main Account', type: 'Bank Account', currency: 'AED' }, { id: 'inr', name: 'India Account', type: 'Bank Account', currency: 'INR' }],
    transactions: [{ id: 'opening', type: 'income', amount: 10000, accountId: 'aed', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' }, { id: 'opening_inr', type: 'income', amount: 10000, accountId: 'inr', category: 'Opening Balance', date: '2026-01-01T00:00:00Z' }]
}));
async function initialize(page, data = base) {
    await page.addInitScript(({ data }) => {
        // Emulate Firestore's map-key ordering rather than retaining insertion order.
        const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
        const copy = value => ordered(JSON.parse(JSON.stringify(value)));
        window.__records = data === null ? {} : { main: copy(data) };
        window.__failWrites = false;
        window.__snap = key => ({ exists: () => key in window.__records, data: () => copy(window.__records[key]), metadata: { hasPendingWrites: false } });
        window.__firebase = {
            initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
            doc: (...args) => args.at(-1), getDoc: async key => window.__snap(key),
            onAuthStateChanged: (auth, callback) => { window.__auth = callback; queueMicrotask(() => callback({ uid: 'test-user', email: 'test@example.invalid' })); },
            onSnapshot: (key, callback) => { window.__snapshot = callback; queueMicrotask(() => callback(window.__snap(key))); return () => {}; },
            runTransaction: async (db, callback) => {
                if (window.__holdWrite) { window.__writeStarts = (window.__writeStarts || 0) + 1; await window.__holdWrite; }
                if (window.__failWrites) throw new Error('Simulated save failure');
                const changes = {}, deleted = [];
                await callback({ get: async key => window.__snap(key), set: (key, value) => { changes[key] = copy(value); }, delete: key => deleted.push(key) });
                Object.assign(window.__records, changes); for (const key of deleted) delete window.__records[key];
            },
            setDoc: async () => { throw new Error('Unsafe old save path'); },
            signOut: async () => window.__auth(null), signInWithEmailAndPassword: async () => {}, createUserWithEmailAndPassword: async () => {},
            updatePassword: async () => {}, reauthenticateWithCredential: async () => {}, EmailAuthProvider: { credential: () => ({}) }
        };
        window.lucide = { createIcons() {} };
        window.Chart = class { static getChart() { return null; } static defaults = { font: {} }; constructor() {} destroy() {} update() {} };
        window.confirm = () => true;
    }, { data });
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://finz.test') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: sourceForTest });
        const file = path.join(buildRoot, url.pathname.slice(1));
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/javascript', body: fs.readFileSync(file, 'utf8') });
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://finz.test/');
    await page.waitForFunction(() => window.state?.user && window.state.data.accounts);
    await page.waitForTimeout(100);
}
(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.FINZ_BROWSER_CHANNEL || 'msedge' });
    const errors = [];
    try {
        const page = await browser.newPage();
        page.on('pageerror', e => errors.push(e.message));
        await initialize(page);
        assert.equal(await page.locator('#app-content').evaluate(el => el.style.display), 'flex');
        console.log('PASS initial populated profile renders');
        await page.evaluate(() => { window.state.data.contacts.push({id:'date-person',name:'Date Test',phone:'971500000000'}); window.openModal('debt'); });
        assert.equal(await page.locator('#debt-given-date').inputValue(), await page.evaluate(() => new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)));
        await page.evaluate(() => { document.getElementById('dt').value = 'receivable'; });
        await page.locator('#dw').selectOption('Date Test');
        await page.locator('#ds').selectOption('aed');
        await page.locator('#da').fill('10');
        await page.locator('#debt-given-date').fill('2026-08-15');
        await page.locator('#drd').fill('2026-09-15');
        await page.locator('#btn-commit-debt').click();
        await page.waitForFunction(() => window.__records.main.debts.some(d=>d.party==='Date Test'));
        assert.equal(await page.evaluate(() => window.__records.main.debts.find(d=>d.party==='Date Test').date), '2026-08-15');
        assert.equal(await page.evaluate(() => new Date(window.__records.main.transactions.find(t=>t.note==='Lent to Date Test').date).getDate()),15);
        await page.evaluate(async base => {window.state.data=structuredClone(base);await window.updateDb();},base);
        await page.evaluate(() => window.openModal('settings'));
        assert.equal(await page.locator('#sets-auto-msg').count(),0);
        console.log('PASS editable credit date and manual-only messaging settings');
        await page.evaluate(() => window.openModal('transaction'));
        await page.locator('#tx-exclude-budget').check();
        await page.locator('#btn-save-tx').click();
        await page.waitForFunction(() => document.getElementById('tx-validation').textContent.includes('greater than zero'));
        assert.equal(await page.locator('#btn-save-tx').isDisabled(), false);
        await page.locator('#tam').fill('25');
        await page.locator('#tn').fill('Excluded expense test');
        await page.locator('#btn-save-tx').click();
        await page.waitForFunction(() => window.__records.main.transactions.some(t => t.note === 'Excluded expense test'));
        assert.equal(await page.evaluate(() => window.__records.main.transactions.find(t => t.note === 'Excluded expense test').excludeFromBudget), true);
        assert.equal(await page.evaluate(() => window.state.data.accounts.find(a => a.id === 'aed').balance), 9975);
        await page.evaluate(async base => { window.state.data = structuredClone(base); await window.updateDb(); }, base);
        console.log('PASS authorize excluded expense and explain missing amount');
        await page.evaluate(async () => {
            window.openSmartInput(); document.getElementById('smart-input-field').value = '5 Coffee';
            await Promise.all([window.processSmartInput(), window.processSmartInput()]);
        });
        assert.equal(await page.evaluate(() => window.state.data.transactions.filter(t => t.note === 'Coffee').length), 1);
        await page.evaluate(async base => { window.state.data = structuredClone(base); await window.updateDb(); }, base);
        await page.evaluate(() => { window.renderAnalytics(); window.closeReminder(); });
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#expense-trend-chart').count(), 1);
        const binding = await page.evaluate(() => {
            const node = document.createElement('div'); document.body.appendChild(node);
            window.FinzUI.setHTML(node, window.FinzUI.html`<button data-finz-click="${window.FinzUI.handler(() => { window.__boundClick = true; })}">Test</button><img src="x" onerror="window.__unsafe = true">`);
            node.querySelector('button').click(); const safe = !node.querySelector('[onerror]'); node.remove();
            return { clicked: window.__boundClick, safe };
        });
        assert.deepEqual(binding, { clicked: true, safe: true });
        console.log('PASS duplicate submission protection, analytics and sanitized event bindings');
        for (const modal of ['accounts', 'transaction', 'transfer', 'debt', 'settings', 'budget', 'goals', 'subscriptions', 'auth']) {
            await page.evaluate(modal => window.openModal(modal), modal);
            const text = await page.locator('#modal-content').innerText();
            assert.ok(!/\uE000|\uE001/.test(text), 'Private template marker leaked in ' + modal);
        }
        console.log('PASS primary dialogs render without escaped layouts or leaked markers');
        await page.evaluate(() => {
            window.state.data.transactions.push({ id: 'evil', type: 'income', amount: 1, accountId: 'aed', date: new Date().toISOString(), category: '<img src=x onerror="window.__xss=1">', note: '<svg onload="window.__xss=2">' });
            window.state.data.accounts[0].name = "Bank');window.__xss=3;//";
            window.renderApp(); window.viewAccountLedger('aed');
        });
        assert.equal(await page.evaluate(() => window.__xss), undefined);
        assert.equal(await page.locator('#modal-content img[onerror], #modal-content svg[onload]').count(), 0);
        console.log('PASS imported markup stays inert');
        await page.evaluate(async base => {
            window.state.data = structuredClone(base); await window.updateDb();
            window.openModal('transfer');
            document.getElementById('ts').value = 'aed'; document.getElementById('ttg').value = 'inr';
            document.getElementById('tamt').value = '100'; document.getElementById('tx-rate').value = '22.75';
            document.getElementById('tx-received').value = '2275'; document.getElementById('tx-fee').value = '2';
            await window.doTransfer();
        }, base);
        const transfer = await page.evaluate(() => window.state.data.transactions.filter(t => t.transferGroupId));
        assert.equal(transfer.length, 3); assert.equal(new Set(transfer.map(t => t.transferGroupId)).size, 1);
        await page.evaluate(id => window.deleteTransaction(id), transfer[0].id);
        await page.locator('#confirm-yes-btn').evaluate(button => button.click());
        await page.waitForFunction(() => !window.state.data.transactions.some(t => t.transferGroupId));
        assert.deepEqual(await page.evaluate(() => window.state.data.accounts.map(a => a.balance)), [10000, 10000]);
        console.log('PASS transfer and fee reverse atomically');
        await page.evaluate(async () => {
            window.state.data.debts.push({ id: 'debt', isBnpl: true, type: 'payable', party: 'Test Store', currency: 'INR', amount: 2275, installments: 1, schedule: [{ amount: 2275, paid: false, status: 'pending', date: '2026-09-01' }] });
            await window.updateDb(); window.openBnplSettleModal('debt', 0);
            document.getElementById('bnpl-pay-acc').value = 'inr';
        });
        await page.locator('#confirm-yes-btn').evaluate(button => button.click());
        await page.waitForFunction(() => window.state.data.transactions.some(t => t.debtId === 'debt'));
        const payment = await page.evaluate(() => window.state.data.transactions.find(t => t.debtId === 'debt'));
        assert.equal(payment.amount, 2275); assert.equal(payment.installmentIndex, 0);
        await page.evaluate(id => window.deleteTransaction(id), payment.id);
        await page.locator('#confirm-yes-btn').evaluate(button => button.click());
        await page.waitForFunction(() => !window.state.data.transactions.some(t => t.debtId === 'debt'));
        assert.equal(await page.evaluate(() => window.state.data.debts[0].settled), false);
        console.log('PASS INR installment payment and reversal');
        await page.evaluate(async () => {
            window.__failWrites = true; window.openModal('accounts');
            document.getElementById('an').value = 'Must Not Persist';
            await window.saveAccount(); window.__failWrites = false;
        });
        assert.equal(await page.evaluate(() => window.state.data.accounts.some(a => a.name === 'Must Not Persist')), false);
        assert.ok(!(await page.locator('#toast-container').innerText()).includes('Must Not Persist" added successfully'));
        console.log('PASS failed writes rollback and never announce success');
        await page.evaluate(async () => {
            const remote = structuredClone(window.__records.main);
            remote.transactions.push({ id: 'remote-credit', accountId: 'aed', type: 'income', amount: 10, date: new Date().toISOString() });
            window.__records.main = remote;
            window.state.data.transactions.push({ id: 'local-credit', accountId: 'aed', type: 'income', amount: 20, date: new Date().toISOString() });
            await window.updateDb();
        });
        assert.equal(await page.evaluate(() => window.state.data.transactions.filter(t => t.id.endsWith('-credit')).length), 2);
        console.log('PASS stale-client saves preserve remote entries');
        await page.evaluate(async () => {
            await window.saveTransaction({ id: 'edit-expense', accountId: 'aed', type: 'expense', amount: 10, category: 'Food', date: new Date().toISOString() });
            window.editTransaction('edit-expense'); document.getElementById('tam').value = '999999';
            await window.updateTransaction('edit-expense');
        });
        assert.equal(await page.evaluate(() => window.state.data.transactions.find(t => t.id === 'edit-expense').amount), 10);
        const countBeforeEdit = await page.evaluate(() => window.state.data.transactions.length);
        await page.locator('#tam').fill('12');
        await page.locator('#btn-save-tx').click();
        await page.waitForFunction(() => window.__records.main.transactions.find(t => t.id === 'edit-expense').amount === 12);
        assert.equal(await page.evaluate(() => window.__records.main.transactions.length), countBeforeEdit);
        await page.evaluate(async () => { await window.saveTransaction({ id: 'balance-guard-expense', accountId: 'aed', type: 'expense', amount: 100, category: 'Other', date: new Date().toISOString() }); await window.deleteTransaction('opening'); });
        await page.locator('#confirm-yes-btn').click();
        await page.waitForFunction(() => document.getElementById('confirm-yes-btn').disabled === false);
        assert.equal(await page.evaluate(() => window.__records.main.transactions.some(t => t.id === 'opening')), true);
        assert.ok(await page.evaluate(() => window.__records.main.accounts.find(a => a.id === 'aed').balance >= 0));
        await page.evaluate(() => window.showPrompt('Test', 'Value', async () => { window.__promptCalls = (window.__promptCalls || 0) + 1; await new Promise(r => { window.__finishPrompt = r; }); throw new Error('Test failure'); }));
        await page.locator('#prompt-input').fill('Keep this input');
        await page.locator('#prompt-yes-btn').evaluate(b => { b.click(); b.click(); });
        assert.equal(await page.locator('#prompt-yes-btn').isDisabled(), true);
        assert.equal(await page.evaluate(() => window.__promptCalls), 1);
        await page.evaluate(() => window.__finishPrompt());
        await page.waitForFunction(() => !document.getElementById('prompt-yes-btn').disabled);
        assert.equal(await page.locator('#prompt-input').inputValue(), 'Keep this input');
        assert.equal(await page.locator('#prompt-modal').evaluate(e => e.classList.contains('hidden')), false);
        await page.locator('#prompt-cancel-btn').click();
        console.log('PASS real edit click avoids duplicates, income deletion safeguard and prompt retry');
        const scheduleResult = await page.evaluate(async () => {
            const due = new Date(); due.setDate(due.getDate() - 1);
            const trial = new Date(); trial.setDate(trial.getDate() + 30);
            window.state.data.subscriptions = [
                { id: 'annual', name: 'Yearly Plan', accountId: 'aed', amount: 20, type: 'expense', billingCycle: 'Yearly', day: due.getDate(), nextDate: due.toISOString() },
                { id: 'trial', name: 'Trial Plan', accountId: 'aed', amount: 20, type: 'expense', billingCycle: 'Monthly', day: due.getDate(), nextDate: due.toISOString(), freeTrialEndDate: trial.toISOString().slice(0, 10) }
            ];
            await window.updateDb(); await window.checkSubscriptions(); await window.checkSubscriptions();
            return {
                annual: window.state.data.transactions.filter(t => t.subscriptionId === 'annual').length,
                trial: window.state.data.transactions.filter(t => t.subscriptionId === 'trial').length,
                nextYear: new Date(window.state.data.subscriptions[0].nextDate).getFullYear(), dueYear: due.getFullYear()
            };
        });
        assert.deepEqual(scheduleResult, { annual: 1, trial: 0, nextYear: scheduleResult.dueYear + 1, dueYear: scheduleResult.dueYear });
        console.log('PASS yearly renewal, trial deferral and recurring deduplication');
        const restored = await page.evaluate(async () => {
            const before = JSON.stringify(window.state.data);
            await window.restoreVaultFromFile(new File([JSON.stringify({ accounts: [] })], 'bad.json', { type: 'application/json' }));
            const unchanged = before === JSON.stringify(window.state.data);
            const backup = window.FinzCore.publicBackup(window.state.data);
            backup.data.accounts[0].name = 'Restored Account';
            backup.data.settings.messagingToken = 'injected-token'; backup.data.settings.pinCode = 'injected-pin';
            await window.restoreVaultFromFile(new File([JSON.stringify(backup)], 'valid.json', { type: 'application/json' }));
            return { unchanged, token: window.state.data.settings.messagingToken, pin: window.state.data.settings.pinCode, name: window.state.data.accounts[0].name };
        });
        assert.equal(restored.unchanged, true); assert.equal(restored.token, undefined); assert.equal(restored.pin, undefined);
        assert.equal(restored.name, 'Restored Account');
        console.log('PASS malformed restore leaves data intact and backups cannot replace credentials');
        await page.evaluate(async () => {
            window.state.data.largeTest = 'x'.repeat(1100000); await window.updateDb();
        });
        const segments = await page.evaluate(() => ({ root: window.__records.main, max: Math.max(...Object.values(window.__records).map(v => new TextEncoder().encode(JSON.stringify(v)).length)) }));
        assert.ok(segments.root._ledgerChunks.length > 1); assert.ok(segments.max < 1000000);
        await page.evaluate(async () => { await window.__snapshot(window.__snap('main')); });
        assert.equal(await page.evaluate(() => window.state.data.largeTest.length), 1100000);
        console.log('PASS ledgers larger than 1 MiB save and reload through bounded segments');
        const legacy = await browser.newPage(); legacy.on('pageerror', e => errors.push(e.message));
        const legacyData = F.clone(base);
        legacyData.transactions.push({ id: 'legacy-orphan', accountId: 'removed-account', amount: '5.00', type: 'expense', date: '2026-01-02' });
        await initialize(legacy, legacyData);
        await legacy.evaluate(() => window.deleteTransaction('opening_inr'));
        await legacy.evaluate(() => { window.__holdWrite = new Promise(resolve => { window.__releaseWrite = resolve; }); });
        await legacy.locator('#confirm-yes-btn').evaluate(button => { button.click(); button.click(); });
        await legacy.waitForFunction(() => window.__writeStarts === 1);
        assert.equal(await legacy.locator('#confirm-yes-btn').isDisabled(), true);
        assert.equal(await legacy.locator('#confirm-yes-btn').innerText(), 'Deleting…');
        assert.equal(await legacy.locator('#confirm-cancel-btn').isDisabled(), true);
        await legacy.evaluate(() => { window.deleteTransaction('legacy-orphan'); document.getElementById('confirm-cancel-btn').click(); });
        assert.equal(await legacy.locator('#confirm-yes-btn').innerText(), 'Deleting…');
        await legacy.evaluate(() => { window.__holdWrite = null; window.__releaseWrite(); });
        await legacy.waitForFunction(() => !window.__records.main.transactions.some(t => t.id === 'opening_inr'));
        assert.equal(await legacy.evaluate(() => window.__records.main.transactions.some(t => t.id === 'legacy-orphan')), true);
        await legacy.evaluate(() => window.deleteTransaction('legacy-orphan'));
        await legacy.locator('#confirm-yes-btn').evaluate(button => button.click());
        await legacy.waitForFunction(() => !window.__records.main.transactions.some(t => t.id === 'legacy-orphan'));
        console.log('PASS deletion with unchanged legacy missing-account records');
        const fresh = await browser.newPage(); fresh.on('pageerror', e => errors.push(e.message));
        await initialize(fresh, null);
        assert.equal(await fresh.locator('#app-content').evaluate(el => el.style.display), 'flex');
        assert.ok(await fresh.evaluate(() => window.state.data.expenseCategories.length));
        console.log('PASS new-account defaults');
        const pin = await browser.newPage(); pin.on('pageerror', e => errors.push(e.message));
        let hash = 0; for (const c of '1234') hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
        const locked = F.clone(base); locked.settings.pinCode = 'pin_' + Math.abs(hash).toString(36);
        await initialize(pin, locked);
        assert.equal(await pin.locator('#app-content').evaluate(el => el.style.display), 'none');
        assert.equal(await pin.locator('#pin-lock-screen').evaluate(el => el.classList.contains('hidden')), false);
        await pin.evaluate(() => { for (const digit of '1234') window.handlePinInput(digit); });
        await pin.waitForFunction(() => document.getElementById('app-content').style.display === 'flex');
        assert.equal(await pin.evaluate(() => window.state.data.settings.pinCode.version), 2);
        console.log('PASS PIN enforced after settings load and legacy PIN migrates');
        assert.deepEqual(errors, []);
        console.log('All browser regression checks passed. All network and database access was mocked.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

