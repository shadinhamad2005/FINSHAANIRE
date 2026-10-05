import * as firebaseApp from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import * as firebaseStore from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { createIcons, icons } from 'lucide';
import Chart from 'chart.js/auto';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import core from '../../js/finance-core.js';
import ui from '../../js/finance-ui.js';
import installRuntime from '../../js/finance-runtime.js';
import { prepareCommit, balances, amount, assertTransferGroups } from '../domain/ledger.ts';
import { deployment } from '../config/deployment.ts';
import { installFeatures } from './install-features.js';
import { start } from './startup.js';

applyPlugin(jsPDF);
const sdk = __FINZ_TEST__ ? window.__firebase : { ...firebaseApp, ...firebaseAuth, ...firebaseStore };
const app = sdk.initializeApp(deployment.firebase);
if (!__FINZ_TEST__ && deployment.appCheckSiteKey) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(deployment.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
}
const auth = sdk.getAuth(app), db = sdk.getFirestore(app);
const state = { user: null, data: core.defaults() };
const actions = Object.create(null);
const services = { ...sdk, app, auth, db, appId: deployment.appId, prepareCommit, assertTransferGroups };
const lucide = { createIcons: options => createIcons({ icons, ...options }) };
const ctx = { state, actions, services, core, ui, libraries: { lucide, Chart, jspdf: { jsPDF } } };
installFeatures(ctx);
installRuntime(actions, { ...services, state });
actions.toCurrency = amount;
const recalculate = actions.recalculateBalances;
actions.recalculateBalances = () => {
    recalculate();
    const cents = balances(state.data);
    for (const account of state.data.accounts) account.balance = cents.get(account.id) / 100;
};
// Ignore repeated submissions while the same mutation is still saving.
for (const [name, action] of Object.entries(actions)) {
    if (action?.constructor?.name !== 'AsyncFunction' || !/^(save|doTransfer|processSmartInput|settle|pay|confirm)/.test(name)) continue;
    let inFlight;
    actions[name] = function (...args) {
        if (inFlight) return inFlight;
        inFlight = Promise.resolve().then(() => action.apply(this, args)).finally(() => { inFlight = undefined; });
        return inFlight;
    };
}
start(ctx);
document.addEventListener('finz-action-error', event => actions.showToast(event.detail, 'error'));
if (__FINZ_TEST__) {
    Object.assign(window, actions, { state, FinzCore: core, FinzUI: ui });
    window.__finzContext = ctx;
    actions.fetchExchangeRate = async () => {};
    actions.fetchMetalsRate = async () => {};

    actions.checkBudgetRollover = async () => {};
}
