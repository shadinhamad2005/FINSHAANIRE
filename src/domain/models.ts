export type Currency = 'AED' | 'INR';
export type EntryType = 'income' | 'expense' | 'transfer_in' | 'transfer_out';
export interface Account {
    id: string; name: string; type: string; currency: Currency; balance: number; originalCost?: number;
}
export interface Entry {
    id: string; accountId: string; amount: number | string; amountMinor?: number; type: EntryType;
    currency?: Currency; date: string; category?: string; exchangeRate?: number;
    transferGroupId?: string; debtId?: string; installmentIndex?: number;
    excludeFromBudget?: boolean;
}
export interface Installment { amount: number | string; paid?: boolean; status?: string; }
export interface Debt { id: string; amount: number | string; currency: Currency; schedule?: Installment[]; }
export interface FinanceData {
    accounts: Account[]; transactions: Entry[]; debts: Debt[];
    settings: { rate: number; messagingToken?: string; whapiToken?: string; [key: string]: unknown };
    [key: string]: unknown;
}
