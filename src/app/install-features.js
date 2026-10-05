import { install as foundation } from '../features/foundation.js';
import { install as accounts } from '../features/accounts.js';
import { install as transactions } from '../features/transactions.js';
import { install as debts } from '../features/debts.js';
import { install as budgets } from '../features/budgets.js';
import { install as messaging } from '../features/messaging.js';
import { install as reports } from '../features/reports.js';
import { install as screens } from '../features/screens.js';
export function installFeatures(ctx) {
    foundation(ctx);
    accounts(ctx);
    transactions(ctx);
    debts(ctx);
    budgets(ctx);
    messaging(ctx);
    reports(ctx);
    screens(ctx);
}
