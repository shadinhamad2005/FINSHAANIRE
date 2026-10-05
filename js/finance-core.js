(function () {
    'use strict';
    const clone = value => structuredClone(value);
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    // Firestore map ordering is not part of a record's value.
    function same(a, b) {
        if (a === b) return true;
        if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) &&
            a.length === b.length && a.every((value, index) => same(value, b[index]));
        if (!object(a) || !object(b)) return false;
        const keys = Object.keys(a), otherKeys = Object.keys(b);
        return keys.length === otherKeys.length && keys.every(key =>
            Object.prototype.hasOwnProperty.call(b, key) && same(a[key], b[key]));
    }
    const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    function defaults() {
        return {
            accounts: [], transactions: [], debts: [], budgets: {}, categoryLinks: {}, goals: [],
            portfolio: {}, contacts: [], subscriptions: [], sinkingFunds: [], fixedCategories: [],
            budgetRollovers: {}, envelopeLedger: [], budgetReports: [],
            commodityRates: { Gold: 7200, Silver: 90 }, commodityRatesAED: { Gold: 315, Silver: 3.5 },
            allocationTargets: { 'Real Estate': 0, Gold: 20, Equity: 50, Cash: 30 },
            settings: { rate: 22.75, isPrivate: false, theme: 'emerald' },
            savingsCategories: ['Wedding Fund', 'Car Fund', 'Emergency Fund Top-Up', 'Annual Vacation'],
            investmentCategories: ['Mutual Funds', 'Sarwa', 'Crypto & Stocks'],
            incomeCategories: ['Salary', 'Bonus', 'Investment Return', 'Other'],
            expenseCategories: ['Rent', 'Food', 'Utilities', 'Investment', 'Family', 'Other'],
            assetTypes: ['Bank Account', 'Cash', 'Savings', 'Emergency Fund', 'Investment']
        };
    }
    function normalize(data) {
        const base = defaults();
        const result = { ...base, ...clone(data || {}), settings: { ...base.settings, ...(data?.settings || {}) } };
        if (Array.isArray(result.accounts)) result.accounts.forEach(a => { if (a && !a.currency) a.currency = 'INR'; });
        return result;
    }
    function convert(amount, from, to, rate) {
        amount = Number(amount); rate = Number(rate);
        if (!Number.isFinite(amount)) throw new Error('Invalid amount.');
        if (from === to) return money(amount);
        if (!Number.isFinite(rate) || rate <= 0) throw new Error('Exchange rate must be positive.');
        if (from === 'AED' && to === 'INR') return money(amount * rate);
        if (from === 'INR' && to === 'AED') return money(amount / rate);
        throw new Error('Unsupported currency conversion.');
    }
    function recalculate(data) {
        const balances = new Map(data.accounts.map(a => [a.id, 0]));
        for (const t of data.transactions) {
            if (!balances.has(t.accountId)) continue;
            const amount = Number(t.amount);
            if (!Number.isFinite(amount)) throw new Error('Invalid transaction amount.');
            const sign = ['income', 'transfer_in'].includes(t.type) ? 1 : ['expense', 'transfer_out'].includes(t.type) ? -1 : 0;
            balances.set(t.accountId, balances.get(t.accountId) + sign * Math.round(amount * 100));
        }
        for (const a of data.accounts) {
            const opening = ['Bank Account', 'Cash', 'Savings'].includes(a.type) ? 0 : Number(a.originalCost || 0);
            a.balance = money(opening + balances.get(a.id) / 100);
        }
        for (const d of data.debts || []) {
            if (!(d.isBnpl || d.subtype === 'bnpl')) continue;
            let cents = 0;
            for (const s of d.schedule || []) {
                s.paid = s.paid === true || s.status === 'paid';
                s.status = s.paid ? 'paid' : 'pending';
                if (!s.paid) cents += Math.round(Number(s.amount) * 100);
            }
            d.currentAmount = cents / 100;
            d.amount = d.currentAmount.toFixed(2);
            d.settled = cents === 0;
        }
        return data;
    }
    // Merge independent edits, but never silently choose between conflicting edits.
    function merge(base, local, remote, path = 'data') {
        if (same(local, base)) return remote;
        if (same(remote, base) || same(local, remote)) return local;
        if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote) &&
            [...base, ...local, ...remote].every(v => object(v) && typeof v.id === 'string')) {
            const maps = [base, local, remote].map(list => new Map(list.map(v => [v.id, v])));
            const ids = new Set([...remote, ...local, ...base].map(v => v.id));
            return [...ids].map(id => merge(maps[0].get(id), maps[1].get(id), maps[2].get(id), `${path}.${id}`)).filter(v => v !== undefined);
        }
        if (object(base) && object(local) && object(remote)) {
            const result = {};
            for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
                // Account balances are derived, not independent user edits.
                if (key === 'balance' && path.startsWith('data.accounts.')) continue;
                // Historical snapshots are auto-recalculated on every dashboard render;
                // they are never a deliberate user edit so should never block a save.
                if (key === 'historicalSnapshots' && path === 'data') {
                    result[key] = local[key] ?? remote[key] ?? [];
                    continue;
                }
                const value = merge(base[key], local[key], remote[key], `${path}.${key}`);
                if (value !== undefined) result[key] = value;
            }
            return result;
        }
        throw new Error(`Another device changed ${path}. The latest saved data has been loaded; please retry your change.`);
    }
    function validateBackup(input) {
        const raw = input?.data || input;
        if (!object(raw) || !Array.isArray(raw.accounts) || !Array.isArray(raw.transactions)) throw new Error('Backup requires accounts and transactions.');
        function inspect(value, depth = 0) {
            if (depth > 30) throw new Error('Backup nesting is too deep.');
            if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid numeric value.');
            if (value && typeof value === 'object') for (const key of Object.keys(value)) {
                if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe backup key.');
                inspect(value[key], depth + 1);
            }
        }
        inspect(raw);
        const base = defaults();
        for (const key of Object.keys(base)) {
            if (raw[key] === undefined) continue;
            if (Array.isArray(base[key]) && !Array.isArray(raw[key])) throw new Error(`Invalid ${key} list.`);
            if (object(base[key]) && !object(raw[key])) throw new Error(`Invalid ${key} settings.`);
        }
        const data = normalize(raw);
        const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
        for (const key of Object.keys(base)) {
            if (Array.isArray(base[key]) && !Array.isArray(data[key])) throw new Error(`Invalid ${key} list.`);
            if (object(base[key]) && !object(data[key])) throw new Error(`Invalid ${key} settings.`);
        }
        const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id);
        // Older contact records used their name as the key and did not have IDs.
        data.contacts.forEach((contact, index) => {
            if (object(contact) && contact.id === undefined && typeof contact.name === 'string') contact.id = `legacy_contact_${index}`;
        });
        for (const key of ['accounts', 'transactions', 'debts', 'subscriptions', 'goals', 'contacts', 'sinkingFunds', 'envelopeLedger', 'budgetReports']) {
            const seen = new Set();
            for (const item of data[key]) {
                if (!object(item) || !validId(item.id) || seen.has(item.id)) throw new Error(`Invalid or duplicate ID in ${key}.`);
                seen.add(item.id);
            }
        }
        const ids = new Set(data.accounts.map(a => a.id));
        for (const a of data.accounts) {
            if (typeof a.name !== 'string' || typeof a.type !== 'string' || !['AED', 'INR'].includes(a.currency)) throw new Error('Invalid account.');
            if (a.originalCost !== undefined && !numeric(a.originalCost)) throw new Error('Invalid opening cost.');
        }
        for (const t of data.transactions) {
            if (!['income', 'expense', 'transfer_in', 'transfer_out'].includes(t.type) || !numeric(t.amount) ||
                (Number(t.amount) < 0 && t.category !== 'Opening Balance') || !Number.isFinite(Date.parse(t.date))) throw new Error('Invalid transaction.');
            if (!ids.has(t.accountId) && t.accountId !== 'virtual_writeoff') throw new Error('Transaction references a missing account.');
            if (['note', 'category', 'currency'].some(key => t[key] !== undefined && typeof t[key] !== 'string')) throw new Error('Invalid transaction text.');
            if (t.exchangeRate !== undefined && (!(Number(t.exchangeRate) > 0) || !Number.isFinite(Number(t.exchangeRate)))) throw new Error('Invalid transaction exchange rate.');
        }
        for (const d of data.debts) {
            if (!numeric(d.amount) || Number(d.amount) < 0 || !['AED', 'INR'].includes(d.currency) || typeof d.party !== 'string') throw new Error('Invalid debt.');
            if (d.isBnpl || d.subtype === 'bnpl') {
                if (!Array.isArray(d.schedule)) throw new Error('Missing installment schedule.');
                for (const s of d.schedule) {
                    if (!object(s) || !numeric(s.amount) || Number(s.amount) < 0 ||
                        (s.paid !== undefined && typeof s.paid !== 'boolean') ||
                        (s.status !== undefined && !['paid', 'pending'].includes(s.status))) throw new Error('Invalid installment.');
                }
            }
        }
        for (const sub of data.subscriptions) {
            if (!ids.has(sub.accountId) || !(Number(sub.amount) > 0) || !numeric(sub.amount) ||
                !['income', 'expense', 'transfer'].includes(sub.type) || typeof sub.name !== 'string' ||
                sub.type === 'transfer' && (!ids.has(sub.targetAccountId) || sub.targetAccountId === sub.accountId) ||
                !Number.isFinite(Date.parse(sub.nextDate)) || !['Monthly', 'Yearly'].includes(sub.billingCycle || 'Monthly') ||
                sub.freeTrialEndDate && !Number.isFinite(Date.parse(sub.freeTrialEndDate))) throw new Error('Invalid recurring entry.');
        }
        for (const key of ['budgets', 'budgetRollovers', 'allocationTargets', 'commodityRates', 'commodityRatesAED']) {
            if (!Object.values(data[key]).every(value => numeric(value) && Number(value) >= 0)) throw new Error(`Invalid ${key} amount.`);
        }
        for (const g of data.goals) if (typeof g.name !== 'string' || !numeric(g.target) || !numeric(g.saved)) throw new Error('Invalid goal.');
        for (const c of data.contacts) if (typeof c.name !== 'string' || c.phone !== undefined && typeof c.phone !== 'string') throw new Error('Invalid contact.');
        if (!(Number(data.settings.rate) > 0) || !Number.isFinite(Number(data.settings.rate))) throw new Error('Invalid exchange rate.');
        for (const key of ['savingsCategories', 'investmentCategories', 'incomeCategories', 'expenseCategories', 'assetTypes', 'fixedCategories']) {
            if (!data[key].every(v => typeof v === 'string')) throw new Error(`Invalid ${key}.`);
        }
        return recalculate(data);
    }
    function publicBackup(data) {
        const copy = clone(data);
        for (const key of ['messagingToken', 'whapiToken', 'pinCode', 'pinEnabled']) delete copy.settings?.[key];
        return { app: 'FINZSHAANIREE', version: '2.6', exportedAt: new Date().toISOString(), data: copy };
    }
    function nextDue(date, cycle = 'Monthly', day) {
        const next = new Date(date);
        if (!Number.isFinite(next.getTime())) throw new Error('Invalid schedule date.');
        const wanted = Number(day) || next.getDate();
        next.setDate(1);
        next.setMonth(next.getMonth() + (cycle === 'Yearly' ? 12 : 1));
        const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(wanted, last));
        return next;
    }
    function deleteEntry(data, id) {
        const tx = data.transactions.find(t => t.id === id);
        if (!tx) return;
        let removing = [tx];
        if (tx.transferGroupId) removing = data.transactions.filter(t => t.transferGroupId === tx.transferGroupId);
        else if (tx.type.includes('transfer')) {
            // Legacy transfers have no group ID. Match only an unambiguous reciprocal pair.
            const otherType = tx.type === 'transfer_out' ? 'transfer_in' : 'transfer_out';
            const linked = tx.transferTo || tx.transferFrom;
            const matches = data.transactions.filter(t => t.type === otherType && t.date === tx.date &&
                t.accountId !== tx.accountId && (!linked || t.accountId === linked) &&
                (!(t.transferTo || t.transferFrom) || (t.transferTo || t.transferFrom) === tx.accountId));
            if (matches.length !== 1) throw new Error('Cannot safely identify both sides of this older transfer. No records were deleted.');
            removing.push(matches[0]);
            const source = tx.type === 'transfer_out' ? tx : matches[0];
            const fees = data.transactions.filter(t => t.type === 'expense' && t.category === 'Bank Charges' && t.date === tx.date && t.accountId === source.accountId);
            if (fees.length > 1) throw new Error('Ambiguous transfer fees. No records were deleted.');
            removing.push(...fees);
        }
        if (tx.debtId) {
            const debt = data.debts.find(d => d.id === tx.debtId);
            if (debt && (debt.isBnpl || debt.subtype === 'bnpl')) {
                let index = tx.installmentIndex;
                if (!Number.isInteger(index)) {
                    const candidates = (debt.schedule || []).map((s, i) => ({ s, i })).filter(({ s }) => s.paymentTransactionId === tx.id);
                    if (candidates.length === 1) index = candidates[0].i;
                    else {
                        const noteIndex = /Installment\s+(\d+)/i.exec(tx.note || '');
                        if (noteIndex) index = Number(noteIndex[1]) - 1;
                    }
                }
                const installment = debt.schedule?.[index];
                if (!installment) throw new Error('Cannot identify the installment for this older payment. No records were deleted.');
                installment.paid = false; installment.status = 'pending';
                delete installment.paymentTransactionId;
                debt.settled = false;
            } else if (debt) {
                if (['Lending', 'Borrowing', 'Loan', 'Loan Given'].includes(tx.category)) throw new Error('Remove the original loan from Liability Management instead.');
                const acc = data.accounts.find(a => a.id === tx.accountId);
                debt.amount = money(Number(debt.amount || 0) + Number(tx.debtAmount ?? convert(tx.amount, tx.currency || acc?.currency || debt.currency, debt.currency, tx.exchangeRate || data.settings.rate)));
                debt.settled = false;
            }
        }
        const ids = new Set(removing.map(t => t.id));
        data.transactions = data.transactions.filter(t => !ids.has(t.id));
        recalculate(data);
    }
    function financialFreedom(data, now = new Date()) {
        const end = new Date(now.getFullYear(), now.getMonth(), 1);
        const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        const dates = data.transactions.map(t => new Date(t.date)).filter(d => Number.isFinite(d.getTime()) && d < end);
        if (!dates.length) return { months: 0, years: null };
        const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
        const first = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
        if (first > start) start.setTime(first.getTime());
        const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
        const monthly = data.transactions.filter(t => t.type === 'expense' && new Date(t.date) >= start && new Date(t.date) < end)
            .reduce((sum, t) => sum + convert(t.amount, t.currency || data.accounts.find(a => a.id === t.accountId)?.currency || 'AED', 'AED', t.exchangeRate || data.settings.rate), 0) / months;
        let wealth = data.accounts.reduce((sum, a) => sum + convert(a.balance, a.currency, 'AED', data.settings.rate), 0);
        for (const d of data.debts.filter(d => !d.settled)) wealth += (d.type === 'receivable' ? 1 : -1) * convert(d.amount, d.currency, 'AED', data.settings.rate);
        return { months, years: monthly > 0 ? wealth / (monthly * 12) : null };
    }
    const api = { financialFreedom, same, clone, defaults, normalize, money, convert, recalculate, merge, validateBackup, publicBackup, nextDue, deleteEntry };
    if (typeof module !== 'undefined') module.exports = api;
})();
