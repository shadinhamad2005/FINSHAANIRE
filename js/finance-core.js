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
    // Rates are stored as "INR per 1 AED". Older INR-to-AED transfers saved the inverted
    // rate (about 0.044); no real AED/INR rate is below 1, so such values are flipped back.
    function aedInrRate(rate) {
        rate = Number(rate);
        return Number.isFinite(rate) && rate > 0 && rate < 1 ? 1 / rate : rate;
    }
    // Local calendar day (YYYY-MM-DD). toISOString() would give the UTC day, which is
    // the previous day between midnight and 04:00 in the UAE.
    function localDateKey(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (!Number.isFinite(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    // A date input value (YYYY-MM-DD) as local midnight, not UTC midnight.
    function parseLocalDate(text) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
        if (!m) return null;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
    }
    // Money that moves between the user's own pockets or repays/creates a debt is not earned income or spending.
    // Revaluation = a market-price change in an asset's value (e.g. gold), not cash earned or spent.
    const NOT_EARNED = ['Opening Balance', 'Loan', 'Settlement', 'Debt Settlement', 'Revaluation'];
    const NOT_SPENT = ['Opening Balance', 'Loan Given', 'Settlement', 'Debt Settlement', 'Revaluation'];
    const isEarnedIncome = t => t?.type === 'income' && !NOT_EARNED.includes(t.category);
    const isSpending = t => t?.type === 'expense' && !NOT_SPENT.includes(t.category);
    function txCurrency(t, accounts) {
        return t.currency || accounts?.find(a => a.id === t.accountId)?.currency || 'AED';
    }
    function toAED(t, data) {
        return convert(t.amount, txCurrency(t, data.accounts), 'AED', t.exchangeRate || data.settings.rate);
    }
    function convert(amount, from, to, rate) {
        amount = Number(amount); rate = aedInrRate(rate);
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
                // Daily rate observations: each device only adds days, so keep the union instead of a conflict.
                if (key === 'rateHistory' && path === 'data') {
                    result[key] = { ...(local[key] || {}), ...(remote[key] || {}) };
                    continue;
                }
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
        const monthly = data.transactions.filter(t => isSpending(t) && new Date(t.date) >= start && new Date(t.date) < end)
            .reduce((sum, t) => sum + toAED(t, data), 0) / months;
        let wealth = data.accounts.reduce((sum, a) => sum + convert(a.balance, a.currency, 'AED', data.settings.rate), 0);
        for (const d of data.debts.filter(d => !d.settled)) wealth += (d.type === 'receivable' ? 1 : -1) * convert(d.amount, d.currency, 'AED', data.settings.rate);
        return { months, years: monthly > 0 ? wealth / (monthly * 12) : null };
    }
    // Average monthly spending (AED) over up to `maxMonths` of real history before `now`.
    function monthlyBurn(data, now = new Date(), maxMonths = 3) {
        const since = new Date(now); since.setMonth(since.getMonth() - maxMonths);
        const spent = data.transactions.filter(t => isSpending(t) && new Date(t.date) >= since && new Date(t.date) <= now);
        if (!spent.length) return 0;
        const first = Math.min(...data.transactions.map(t => new Date(t.date).getTime()).filter(Number.isFinite));
        const covered = Math.min(maxMonths, Math.max(1, (now - Math.max(first, since.getTime())) / (30.44 * 86400000)));
        return spent.reduce((sum, t) => sum + toAED(t, data), 0) / covered;
    }
    function csvCell(value) {
        let text = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; // Spreadsheet formula injection guard.
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }
    // Minimal RFC 4180 line parser: quoted fields, escaped quotes and commas inside quotes.
    function parseCsvLine(line) {
        const out = []; let cell = '', quoted = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (quoted) {
                if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
                else if (c === '"') quoted = false;
                else cell += c;
            } else if (c === '"') quoted = true;
            else if (c === ',') { out.push(cell.trim()); cell = ''; }
            else cell += c;
        }
        out.push(cell.trim());
        return out;
    }
    // ---- Feature helpers (round 2) ----
    const CARD = 'Credit Card';
    // What can still be paid from an account: a card may go negative down to its limit.
    function availableToSpend(account) {
        if (!account) return 0;
        const balance = Number(account.balance) || 0;
        return account.type === CARD ? balance + (Number(account.creditLimit) || 0) : balance;
    }
    // Splits whole fils/paise into n shares; the first share (the payer's) absorbs the remainder.
    function splitCents(totalCents, n) {
        const base = Math.floor(totalCents / n), shares = Array(n).fill(base);
        shares[0] += totalCents - base * n;
        return shares;
    }
    const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    function smsDate(text, now) {
        let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
        m = /\b(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ,]*(\d{2,4})\b/.exec(text);
        if (m && MONTHS[m[2].toLowerCase()] !== undefined) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1], 12);
        m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(text);
        if (m) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1], 12); // Day first (UAE/India)
        return new Date(now);
    }
    // Reads one bank SMS / notification line. Returns null for OTPs and messages without an amount.
    function parseBankSms(text, now = new Date()) {
        const sms = String(text || '').replace(/\s+/g, ' ').trim();
        if (!sms || /\b(otp|one[- ]time password|verification code)\b/i.test(sms)) return null;
        const amountMatch = /(AED|INR|Rs\.?|₹|Dhs?\.?)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(sms) || /([\d,]+(?:\.\d{1,2})?)\s?(AED|INR|Dhs)\b/i.exec(sms);
        if (!amountMatch) return null;
        const [label, figure] = /\d/.test(amountMatch[1]) ? [amountMatch[2], amountMatch[1]] : [amountMatch[1], amountMatch[2]];
        const amount = Number(figure.replace(/,/g, ''));
        if (!(amount > 0)) return null;
        const currency = /inr|rs|₹/i.test(label) ? 'INR' : 'AED';
        const debit = /(debited|spent|purchase|withdrawn|paid|payment of|sent|charged|transferred to)/i.exec(sms);
        const credit = /(credited|received|deposited|refund|salary|reversal|cashback)/i.exec(sms);
        if (!debit && !credit) return null;
        const type = debit && (!credit || debit.index < credit.index) ? 'expense' : 'income';
        const party = /\b(?:at|to|from|by|towards)\s+(?:VPA\s+)?([A-Za-z0-9&@'._\- ]{2,40}?)(?=\s+(?:on|with|using|via|ref|refno|avl|available|card|for|in|thru|through)\b|[.,;]|$)/i.exec(sms);
        let merchant = party ? party[1].trim() : '';
        if (/^(your|a\/?c|ac|account|card)\b/i.test(merchant) || /^x+\d+$/i.test(merchant)) merchant = '';
        const date = smsDate(sms, now);
        if (!Number.isFinite(date.getTime())) return null;
        return { amount: money(amount), currency, type, merchant: merchant || (type === 'income' ? 'Bank credit' : 'Card / bank debit'), date };
    }
    // Live metal price: USD per troy ounce -> price per gram of the given karat in AED and INR.
    const USD_AED = 3.6725, TROY_OZ_GRAMS = 31.1034768;
    function metalPricePerGram(usdPerOunce, karat = 24, rate) {
        const purity = Math.min(24, Math.max(1, Number(karat) || 24)) / 24;
        const aed = Number(usdPerOunce) / TROY_OZ_GRAMS * USD_AED * purity;
        return { AED: aed, INR: aed * aedInrRate(rate) }; // Unrounded: callers round once, after multiplying by weight
    }
    // A goal linked to an account tracks that account's real balance (in the goal's currency).
    function goalSaved(goal, data) {
        const account = goal?.accountId && data.accounts.find(a => a.id === goal.accountId);
        if (!account) return Number(goal?.saved) || 0;
        return Math.max(0, convert(account.balance || 0, account.currency, goal.currency || account.currency, data.settings.rate));
    }
    // Month summary (month is 0-based) in AED.
    function monthlyClose(data, year, month) {
        const start = new Date(year, month, 1), end = new Date(year, month + 1, 1);
        const inMonth = data.transactions.filter(t => { const d = new Date(t.date); return d >= start && d < end; });
        const income = inMonth.filter(isEarnedIncome).reduce((s, t) => s + toAED(t, data), 0);
        const byCategory = {};
        for (const t of inMonth.filter(isSpending)) byCategory[t.category || 'Uncategorised'] = (byCategory[t.category || 'Uncategorised'] || 0) + toAED(t, data);
        const spending = Object.values(byCategory).reduce((s, v) => s + v, 0);
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        const snaps = data.historicalSnapshots || [];
        const at = snaps.findIndex(s => s.month === key);
        const netWorth = at >= 0 ? snaps[at].netWorthAED : null;
        const previous = at > 0 ? snaps[at - 1].netWorthAED : null;
        return { key, income: money(income), spending: money(spending), saved: money(income - spending),
            savingsRate: income > 0 ? Math.round((income - spending) / income * 100) : null,
            categories: Object.entries(byCategory).map(([name, value]) => ({ name, value: money(value) })).sort((a, b) => b.value - a.value),
            netWorth, netWorthChange: netWorth !== null && previous !== null ? money(netWorth - previous) : null, count: inMonth.length };
    }
    // Money sent AED -> INR, from linked transfers (or older pairs with a matching note and time).
    function remittances(data) {
        const byId = new Map(data.accounts.map(a => [a.id, a]));
        const out = [];
        for (const tx of data.transactions) {
            if (tx.type !== 'transfer_out' || byId.get(tx.accountId)?.currency !== 'AED') continue;
            const inn = tx.transferGroupId ? data.transactions.find(t => t.transferGroupId === tx.transferGroupId && t.type === 'transfer_in') : null;
            if (!inn || byId.get(inn.accountId)?.currency !== 'INR') continue;
            out.push({ date: tx.date, sent: Number(tx.amount), received: Number(inn.amount), rate: Number(inn.amount) / Number(tx.amount) });
        }
        return out.sort((a, b) => new Date(a.date) - new Date(b.date));
    }
    // Today's rate against the average of the last 90 days of observed rates.
    function remittanceAdvice(data, now = new Date()) {
        const since = new Date(now); since.setDate(since.getDate() - 90);
        const sinceKey = localDateKey(since);
        const seen = Object.entries(data.rateHistory || {}).filter(([day, r]) => day >= sinceKey && Number(r) > 0).map(([, r]) => Number(r));
        for (const r of remittances(data)) if (new Date(r.date) >= since) seen.push(r.rate);
        const today = aedInrRate(data.settings.rate);
        if (seen.length < 3) return { today, average: null, best: null, verdict: 'Not enough rate history yet (needs 3+ days).' };
        const average = seen.reduce((s, r) => s + r, 0) / seen.length, best = Math.max(...seen);
        const diff = (today - average) / average * 100;
        const verdict = diff >= 0.5 ? `Good day to send: ${diff.toFixed(1)}% above your 90-day average.`
            : diff <= -0.5 ? `Below average by ${Math.abs(diff).toFixed(1)}%; consider waiting if it can.` : 'About average for the last 90 days.';
        return { today, average: Math.round(average * 100) / 100, best: Math.round(best * 100) / 100, verdict, samples: seen.length };
    }
    // Year-end pack: calendar-year totals plus India's April-March financial year for INR income.
    function yearPack(data, year) {
        const inYear = (t, s, e) => { const d = new Date(t.date); return d >= s && d < e; };
        const cal = [new Date(year, 0, 1), new Date(year + 1, 0, 1)], fy = [new Date(year, 3, 1), new Date(year + 1, 3, 1)];
        const sent = remittances(data).filter(r => inYear(r, ...cal));
        const inrIncome = {};
        for (const t of data.transactions) {
            if (!isEarnedIncome(t) || txCurrency(t, data.accounts) !== 'INR' || !inYear(t, ...fy)) continue;
            inrIncome[t.category || 'Other'] = money((inrIncome[t.category || 'Other'] || 0) + Number(t.amount));
        }
        const calTx = data.transactions.filter(t => inYear(t, ...cal));
        return {
            year, indiaFinancialYear: `FY ${year}-${String(year + 1).slice(2)} (Apr ${year} - Mar ${year + 1})`,
            income: money(calTx.filter(isEarnedIncome).reduce((s, t) => s + toAED(t, data), 0)),
            spending: money(calTx.filter(isSpending).reduce((s, t) => s + toAED(t, data), 0)),
            zakatPaid: money(calTx.filter(t => t.category === 'Zakat').reduce((s, t) => s + toAED(t, data), 0)),
            remittances: { count: sent.length, sentAED: money(sent.reduce((s, r) => s + r.sent, 0)), receivedINR: money(sent.reduce((s, r) => s + r.received, 0)) },
            inrIncome
        };
    }
    const api = { financialFreedom, same, clone, defaults, normalize, money, convert, recalculate, merge, validateBackup, publicBackup, nextDue, deleteEntry,
        aedInrRate, localDateKey, parseLocalDate, isEarnedIncome, isSpending, txCurrency, toAED, monthlyBurn, csvCell, parseCsvLine,
        availableToSpend, splitCents, parseBankSms, metalPricePerGram, goalSaved, monthlyClose, remittances, remittanceAdvice, yearPack };
    if (typeof module !== 'undefined') module.exports = api;
})();
