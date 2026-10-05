import type { Entry, FinanceData } from './models';

/** Exact decimal-to-minor-unit conversion, including exponential notation. */
export function toMinor(value: number | string): number {
    const text = String(value).trim();
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match || !Number.isFinite(Number(text))) throw new Error('Enter a finite monetary amount.');
    const sign = match[1] === '-' ? -1n : 1n;
    const digits = BigInt(match[2] + (match[3] || ''));
    const shift = 2 + Number(match[4] || 0) - (match[3] || '').length;
    if (Math.abs(shift) > 100) throw new Error('Amount is outside the supported range.');
    const scale = 10n ** BigInt(Math.abs(shift));
    const cents = sign * (shift >= 0 ? digits * scale : (digits + scale / 2n) / scale);
    const result = Number(cents);
    if (!Number.isSafeInteger(result)) throw new Error('Amount is too large.');
    return result;
}
export function amount(value: number | string): number { return toMinor(value) / 100; }

// Compare persisted values, independent of Firestore map ordering and money migration.
function entryValue(entry: Entry): string {
    const canonical = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(canonical);
        if (value !== null && typeof value === 'object') return Object.fromEntries(
            Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
                .map(([key, v]) => [key, canonical(v)]));
        return value;
    };
    const { amountMinor: _derived, ...fields } = entry;
    return JSON.stringify(canonical({ ...fields, amount: toMinor(entry.amount) }));
}

/** All save paths pass through this boundary, regardless of the screen that made the edit. */
export function prepareCommit(previous: FinanceData, proposed: FinanceData): FinanceData {
    if (!Array.isArray(proposed.accounts) || !Array.isArray(proposed.transactions) || !Array.isArray(proposed.debts)) throw new Error('Invalid ledger structure.');
    if (!Number.isFinite(Number(proposed.settings.rate)) || Number(proposed.settings.rate) <= 0) throw new Error('Exchange rate must be positive.');
    const accounts = new Map(proposed.accounts.map(account => [account.id, account]));
    if (accounts.size !== proposed.accounts.length) throw new Error('Duplicate account ID.');
    const old = new Map(previous.transactions.map(entry => [entry.id, entry]));
    const seen = new Set<string>();
    for (const entry of proposed.transactions) {
        if (!entry.id || seen.has(entry.id)) throw new Error('Duplicate or missing transaction ID.');
        seen.add(entry.id);
        if (!['income', 'expense', 'transfer_in', 'transfer_out'].includes(entry.type)) throw new Error('Invalid transaction type.');
        const cents = toMinor(entry.amount);
        if (cents < 0 && entry.category !== 'Opening Balance') throw new Error('Use a positive amount; the entry type determines its direction.');
        const prior = old.get(entry.id);
        const changed = !prior || entryValue(prior) !== entryValue(entry);
        const account = accounts.get(entry.accountId);
        if (!account && entry.accountId !== 'virtual_writeoff' && (changed || previous.accounts.some(a => a.id === entry.accountId))) throw new Error('The entry references a missing account.');
        if (!Number.isFinite(Date.parse(entry.date))) throw new Error('Invalid transaction date.');
        if (changed && account && entry.currency && entry.currency !== account.currency) throw new Error('The entry currency must match its account.');
        entry.amountMinor = cents;
        entry.amount = cents / 100;
        if (account) entry.currency = account.currency;
        if (entry.excludeFromBudget !== undefined) entry.excludeFromBudget = Boolean(entry.excludeFromBudget);
    }
    for (const account of proposed.accounts) if (account.originalCost !== undefined) account.originalCost = amount(account.originalCost);
    for (const debt of proposed.debts) {
        debt.amount = amount(debt.amount);
        for (const installment of debt.schedule || []) installment.amount = amount(installment.amount);
    }
    delete proposed.settings.messagingToken;
    delete proposed.settings.whapiToken;
    return proposed;
}

export function balances(data: FinanceData): Map<string, number> {
    const result = new Map(data.accounts.map(account => [account.id,
        ['Bank Account', 'Cash', 'Savings'].includes(account.type) ? 0 : toMinor(account.originalCost || 0)]));
    for (const entry of data.transactions) {
        if (!result.has(entry.accountId)) continue;
        const sign = ['income', 'transfer_in'].includes(entry.type) ? 1 : -1;
        const next = result.get(entry.accountId)! + sign * toMinor(entry.amount);
        if (!Number.isSafeInteger(next)) throw new Error('Account balance is outside the supported range.');
        result.set(entry.accountId, next);
    }
    return result;
}

export function assertTransferGroups(entries: Entry[]): void {
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) if (entry.transferGroupId) {
        const group = groups.get(entry.transferGroupId) || []; group.push(entry); groups.set(entry.transferGroupId, group);
    }
    for (const group of groups.values()) {
        const outgoing = group.filter(entry => entry.type === 'transfer_out');
        const incoming = group.filter(entry => entry.type === 'transfer_in');
        if (outgoing.length !== 1 || incoming.length !== 1 || outgoing[0].accountId === incoming[0].accountId) throw new Error('A transfer must contain both account entries.');
    }
}
