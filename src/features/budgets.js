// Budgets behavior and screens. Dependencies stay inside the application context.
export function install(ctx) {
const { state, actions, services, libraries, ui: FinzUI, core: FinzCore } = ctx;
const { auth, db, appId, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider } = services;
const { lucide, Chart } = libraries;
const closeModal = (...args) => actions.closeModal(...args);
const closeReminder = (...args) => actions.closeReminder(...args);
const updateDb = (...args) => actions.updateDb(...args);
const reportAppError = (...args) => actions.reportAppError(...args);
const checkDueDebts = (...args) => actions.checkDueDebts(...args);
const fetchExchangeRate = (...args) => actions.fetchExchangeRate(...args);
const fetchMetalsRate = (...args) => actions.fetchMetalsRate(...args);
const renderApp = (...args) => actions.renderApp(...args);
const renderNotifications = (...args) => actions.renderNotifications(...args);
const renderAssetsList = (...args) => actions.renderAssetsList(...args);
const renderLedger = (...args) => actions.renderLedger(...args);

actions.refreshFund = async function (accId) { return; };

actions.calculateWealthAllocation = function () {
            const groups = {
                'Liquid Assets': { total: 0, items: [] },
                'Market Investments': { total: 0, items: [] },
                'Commodities': { total: 0, items: [] },
                'Physical/Fixed Assets': { total: 0, items: [] },
                'Receivables': { total: 0, items: [] },
                'Liabilities': { total: 0, items: [] }
            };
            const r = state.data.settings.rate;

            state.data.accounts.forEach(a => {
                const val = actions.toChartCur(Number(a.balance), a.currency || 'AED', r);
                if (val === 0) return;

                const item = { name: a.name, value: val, currency: a.currency, originalBalance: a.balance };

                if (a.type === 'Credit Card') {
                    // Money owed on a card is a liability, not a (negative) asset.
                    if (val < 0) { groups['Liabilities'].total += -val; groups['Liabilities'].items.push({ ...item, value: -val }); }
                } else if (['Bank Account', 'Cash', 'Savings'].includes(a.type)) {
                    groups['Liquid Assets'].total += val;
                    groups['Liquid Assets'].items.push(item);
                } else if (['Mutual Fund', 'Stock', 'Crypto'].includes(a.type)) {
                    groups['Market Investments'].total += val;
                    groups['Market Investments'].items.push(item);
                } else if (a.type === 'Commodity' || ['Gold', 'Silver'].some(c => (a.subtype || '').includes(c))) {
                    groups['Commodities'].total += val;
                    groups['Commodities'].items.push(item);
                } else if (['Real Estate', 'Vehicle', 'Collectible'].includes(a.type)) {
                    groups['Physical/Fixed Assets'].total += val;
                    groups['Physical/Fixed Assets'].items.push(item);
                } else {
                    groups['Physical/Fixed Assets'].total += val;
                    groups['Physical/Fixed Assets'].items.push(item);
                }
            });

            state.data.debts.forEach(d => {
                if (d.settled) return;
                const val = actions.toChartCur(Number(d.amount), d.currency || 'AED', r);
                const item = { name: d.party, value: val, currency: d.currency, originalBalance: Number(d.amount) };

                if (d.type === 'receivable') {
                    groups['Receivables'].total += val;
                    groups['Receivables'].items.push(item);
                } else if (d.type === 'payable') {
                    groups['Liabilities'].total += val;
                    groups['Liabilities'].items.push(item);
                }
            });

            Object.values(groups).forEach(g => {
                g.items.sort((a, b) => b.value - a.value);
            });

            return groups;
        };

actions.renderAllocationChart = function (isModal = false) {
            const suffix = isModal ? '-modal' : '';
            const ctx = document.getElementById('allocation-chart' + suffix);
            if (!ctx) return;

            if (!ctx.offsetParent) {
                setTimeout(() => actions.renderAllocationChart(isModal), 100);
                return;
            }

            const dataGroups = actions.calculateWealthAllocation();

            const classOrder = ['Liquid Assets', 'Market Investments', 'Commodities', 'Physical/Fixed Assets', 'Receivables'];
            const colorMap = {
                'Liquid Assets': '#10b981',
                'Market Investments': '#3b82f6',
                'Commodities': '#f59e0b',
                'Physical/Fixed Assets': '#8b5cf6',
                'Receivables': '#14b8a6'
            };

            const labels = [];
            const data = [];
            const colors = [];
            let totalGrossAssets = 0;

            classOrder.forEach((key) => {
                const total = dataGroups[key].total;
                if (total > 0) {
                    labels.push(key);
                    data.push(total);
                    colors.push(colorMap[key]);
                    totalGrossAssets += total;
                }
            });

            const liabilitiesTotal = dataGroups['Liabilities'].total;
            const debtRatio = totalGrossAssets > 0 ? (liabilitiesTotal / totalGrossAssets) * 100 : 0;

            const cur = actions.chartCurrency || 'AED';
            FinzUI.setHTML(document.getElementById('chart-center-val' + suffix), actions.fmtMoney(totalGrossAssets, cur));
            document.getElementById('debt-ratio-val' + suffix).innerText = debtRatio.toFixed(1) + '%';
            document.getElementById('liability-bar' + suffix).style.width = Math.min(debtRatio, 100) + '%';
            FinzUI.setHTML(document.getElementById('gross-assets-label' + suffix), 'Assets: ' + actions.fmtMoney(totalGrossAssets, cur));
            FinzUI.setHTML(document.getElementById('liabilities-label' + suffix), 'Liabilities: ' + actions.fmtMoney(liabilitiesTotal, cur));

            if (isModal) {
                if (actions.allocationChartInstanceModal) actions.allocationChartInstanceModal.destroy();
            } else {
                if (actions.allocationChartInstance) actions.allocationChartInstance.destroy();
            }

            const chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors,
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: { position: 'right', labels: { font: { family: "'Plus Jakarta Sans'", size: 10, weight: 'bold' }, usePointStyle: true, padding: 20 } },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const value = context.raw;
                                    const percentage = totalGrossAssets > 0 ? ((value / totalGrossAssets) * 100).toFixed(1) + '%' : '0%';
                                    const fmtVal = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(value);
                                    return ' ' + context.label + ': ' + fmtVal + ' (' + percentage + ')';
                                }
                            }
                        }
                    },
                    onClick: (event, elements, chart) => {
                        if (elements.length > 0) {
                            const datasetIndex = elements[0].index;
                            const label = chart.data.labels[datasetIndex];
                            actions.showCategoryDetails(label, dataGroups[label], suffix);
                        }
                    }
                }
            });

            if (isModal) actions.allocationChartInstanceModal = chartInstance;
            else actions.allocationChartInstance = chartInstance;
        };

actions.sweepBudget = function (cat, amt) {
            actions.showToast("Savings Pots feature removed.", "warning");
        };

actions.finalizeSweep = async function () {
            const sw = actions.pendingSweep;
            if (!sw) return;

            const srcId = document.getElementById('sw-src').value;
            const goalId = document.getElementById('sw-goal').value;

            if (!srcId || !goalId) {
                actions.showToast("Please select both source and target.", "warning");
                return;
            }

            const acc = state.data.accounts.find(a => a.id === srcId);
            const goal = state.data.goals.find(g => g.id === goalId);

            if (!acc || !goal) return;
            if (acc.balance < sw.amt) {
                actions.showToast("Insufficient funds in selected account!", "error");
                return;
            }

            // Execute
            const accIdx = state.data.accounts.findIndex(a => a.id === acc.id);
            const gIdx = state.data.goals.findIndex(g => g.id === goal.id);

            state.data.accounts[accIdx].balance = actions.toCurrency(state.data.accounts[accIdx].balance - sw.amt);
            state.data.goals[gIdx].saved += sw.amt;

            // Log Transaction (Mark as Sweep)
            state.data.transactions.push({
                id: actions.genId(),
                accountId: acc.id,
                amount: actions.toCurrency(sw.amt),
                type: 'transfer_out',
                category: 'Sweep',
                note: `Budget Sweep: ${sw.cat} -> ${goal.name} `,
                date: new Date().toISOString()
            });

            await updateDb();
            actions.closeModal();
            actions.renderApp();
            actions.showToast(`✨ Swept ${sw.amt} into ${goal.name} !`, "success");
            actions.pendingSweep = null; // Clear
        };

actions.setBudget = function (cat) {
            actions.showPrompt(`Budget for ${cat}`, "Set Monthly Limit (AED):", async (valStr) => {
                const val = parseFloat(valStr);
                if (!Number.isFinite(val) || val < 0) { actions.showToast('Enter a budget of zero or more.', 'error'); return false; }
                {
                    if (!state.data.budgets) state.data.budgets = {};
                    state.data.budgets[cat] = val;
                    await updateDb(); actions.openModal('budget');
                    actions.showToast("Budget Updated", "success");
                }
            }, "number");
        };

actions.checkBudgetRollover = async function () {
            const now = new Date();
            const last = state.data.lastRolloverDate ? new Date(state.data.lastRolloverDate) : null;

            // If new month detected
            if (last && (now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear())) {
                actions.showToast("📅 New Month! Processing Rollovers...", "info");
                if (!state.data.budgetRollovers) state.data.budgetRollovers = {};

                // Calculate rollovers from PREVIOUS month
                const cats = state.data.expenseCategories;
                for (let c of cats) {
                    const budget = (state.data.budgets && state.data.budgets[c]) || 0;
                    if (budget > 0) {
                        // Calc spend of LAST month
                        const spend = state.data.transactions.filter(t =>
                            t.type === 'expense' && t.category === c && !t.excludeFromBudget &&
                            new Date(t.date).getMonth() === last.getMonth() &&
                            new Date(t.date).getFullYear() === last.getFullYear()
                        ).reduce((s, t) => s + actions.getTransactionBaseAmount(t), 0); // Budgets are in AED

                        const leftover = Math.max(0, budget - spend);
                        if (leftover > 0) {
                            state.data.budgetRollovers[c] = (state.data.budgetRollovers[c] || 0) + leftover;
                        }
                    }
                }
                state.data.lastRolloverDate = now.toISOString();
                await updateDb();
            } else if (!last) {
                state.data.lastRolloverDate = now.toISOString();
                await updateDb();
            }
        };

actions.renderGoalsUI = function () {
            if (!state.data.goals) state.data.goals = [];
            return FinzUI.html`
            <div class="max-w-2xl mx-auto space-y-6 text-left">
                <div class="grid gap-4 max-h-[50vh] overflow-y-auto no-scrollbar custom-scrollbar pr-2">
                    ${state.data.goals.map(g => FinzUI.html`
                    <div class="text-slate-900 bg-white border border-slate-200 rounded-3xl p-5 flex flex-col md:flex-row justify-between items-center shadow-sm">
                        <div class="flex items-center space-x-4 mb-4 md:mb-0">
                            <div class="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center">
                                <i data-lucide="${g.icon || 'target'}" class="w-6 h-6"></i>
                            </div>
                            <div>
                                <h4 class="font-bold text-sm text-slate-900">${g.name}</h4>
                                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Target: ${actions.fmtMoney(g.target, g.currency)} | Saved: ${actions.fmtMoney(FinzCore.goalSaved(g, state.data), g.currency)}</p>
                                ${g.accountId ? FinzUI.html`<p class="text-[9px] font-bold text-emerald-600 uppercase"><i data-lucide="link" class="w-3 h-3 inline"></i> Tracks ${state.data.accounts.find(a => a.id === g.accountId)?.name || 'a removed account'}</p>` : ''}
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            ${g.accountId ? '' : FinzUI.html`<button data-finz-click="${FinzUI.handler(function(event) { return actions.addGoalFunds(((g.id))) })}" class="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-bold uppercase hover:bg-emerald-100">+ Add Funds</button>`}
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteGoal(((g.id))) })}" class="px-3 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-bold hover:bg-red-100"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                        </div>
                    </div>`).join('') || FinzUI.literal("<p class=\"text-center text-slate-400 py-8 font-bold text-xs uppercase tracking-widest\">No Active Goals</p>")}
                </div>
                
                <div class="text-slate-900 bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100">
                    <h4 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 ml-2"><i data-lucide="plus" class="w-4 h-4 inline-block -mt-1 mr-1"></i> Create New Goal</h4>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <input type="text" id="g-name" placeholder="Goal Name (e.g. New Car)" class="col-span-2 p-4 border border-slate-200 rounded-2xl outline-none focus:border-indigo-500 text-sm font-bold text-center">
                        <select id="g-currency" class="p-4 border border-slate-200 rounded-2xl outline-none font-bold text-center">
                            <option value="AED">AED</option>
                            <option value="INR">INR</option>
                        </select>
                        <select id="g-icon" class="p-4 border border-slate-200 rounded-2xl outline-none font-bold text-center text-slate-500">
                            <option value="target">Target</option>
                            <option value="car">Car</option>
                            <option value="home">Home</option>
                            <option value="plane">Travel</option>
                            <option value="graduation-cap">Education</option>
                            <option value="shield-alert">Emergency</option>
                        </select>
                        <input type="number" id="g-target" placeholder="Target Amount" class="col-span-2 p-4 border border-slate-200 rounded-2xl outline-none focus:border-indigo-500 text-sm font-bold text-center">
                        <select id="g-account" class="col-span-2 p-4 border border-slate-200 rounded-2xl outline-none font-bold text-center text-slate-600">
                            <option value="">Track manually (add funds yourself)</option>
                            ${actions.activeAccounts().filter(a => !['Credit Card'].includes(a.type)).map(a => FinzUI.html`<option value="${a.id}">Track account: ${a.name} (${a.currency})</option>`).join('')}
                        </select>
                    </div>
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveGoal() })}" class="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg hover:bg-indigo-500 transition-colors">Create Goal Envelope</button>
                </div>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.closeModal() })}" class="w-full text-slate-400 py-3 text-[10px] font-black uppercase tracking-widest hover:text-slate-600 transition-colors">Close Menu</button>
            </div>`;
        };

actions.saveGoal = async function () {
            const name = document.getElementById('g-name').value;
            const target = document.getElementById('g-target').value;
            const currency = document.getElementById('g-currency').value;
            const icon = document.getElementById('g-icon').value;
            const accountId = document.getElementById('g-account')?.value || '';

            if (!name || !(parseFloat(target) > 0)) return actions.showToast("Enter a goal name and a target above zero", "error");

            if (!state.data.goals) state.data.goals = [];
            // A linked goal follows that account's real balance instead of a manually added figure.
            state.data.goals.push({
                id: actions.genId(),
                name, target: parseFloat(target), saved: 0, currency, icon, ...(accountId ? { accountId } : {})
            });

            await updateDb();
            actions.openModal('goals');
            actions.recalculateBalances();
            actions.renderApp();
            actions.showToast("Goal Created", "success");
        };

actions.deleteGoal = async function (id) {
            if (confirm("Remove this goal? The funds will simply return to your 'Safe to Spend' limit.")) {
                state.data.goals = state.data.goals.filter(g => g.id !== id);
                await updateDb();
                actions.openModal('goals');
                actions.recalculateBalances();
                actions.renderApp();
            }
        };

actions.addGoalFunds = function (id) {
            const g = state.data.goals.find(x => x.id === id);
            if (!g) return;
            actions.showPrompt("Add Funds to " + g.name, "Enter the amount of " + g.currency + " to lock into this goal envelope:", async (amtStr) => {
                const amt = parseFloat(amtStr);
                if (isNaN(amt) || amt <= 0) return;
                g.saved += amt;
                if (g.saved > g.target) g.saved = g.target; // Cap it
                await updateDb();
                actions.openModal('goals');
                actions.recalculateBalances();
                actions.renderApp();
            }, 'number');
        };

actions.resetBudgetSystem = async function () {
            actions.showConfirm(
                "Reset Budget System",
                "This will permanently clear your current envelope balances, allocations, and past budget reports.\n\nAre you sure you want to reset?",
                async () => {
                    try {
                        state.data.envelopeLedger = [];
                        state.data.budgets = {};
                        state.data.budgetReports = [];
                        state.data.settings.expectedSalary = 0;
                        delete state.data.settings.lastSalaryDate;
                        await actions.updateDb();
                        actions.showToast("Budget Reset Complete", "success");
                        actions.renderApp();
                    } catch (error) {
                        actions.showToast("Reset failed: " + error.message, "error");
                    }
                }
            );
        };

actions.addCategory = async function (type) {
            const inpId = type === 'income' ? 'new-inc-cat' : 'new-exp-cat';
            const listKey = type === 'income' ? 'incomeCategories' : 'expenseCategories';
            const val = document.getElementById(inpId)?.value?.trim();
            if (!val || state.data[listKey].includes(val)) return;
            state.data[listKey].push(val); await updateDb(); actions.openModal('settings');
        };

actions.openBudgetSettings = function () {
            FinzUI.setHTML(document.getElementById('modal-content'), FinzUI.html`<div class="text-slate-900 max-w-md mx-auto bg-slate-50 p-10 rounded-[3rem] border space-y-6 text-center">
                <p class="text-[10px] font-black uppercase text-slate-400">Monthly Budget Targets (AED)</p>
                <div class="space-y-4">
                    ${state.data.expenseCategories.map(cat => FinzUI.html`
                        <div class="flex items-center space-x-4">
                            <span class="w-1/3 text-xs font-black text-left text-slate-500 uppercase">${cat}</span>
                            <input type="number" id="budget-${cat}" value="${state.data.budgets[cat] || 0}" class="text-slate-900 w-2/3 p-4 border rounded-xl font-black text-center outline-none focus:border-emerald-500 bg-white shadow-sm transition-all">
                        </div>
                    `).join('')}
                </div>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveBudgets() })}" class="w-full bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-200">Update Targets</button>
            </div>`);
        };

actions.saveBudgets = async function () { state.data.expenseCategories.forEach(cat => { state.data.budgets[cat] = Math.max(0, parseFloat(document.getElementById(`budget-${cat}`).value) || 0); }); await updateDb(); actions.openModal('budget'); };

actions.runImpulseTest = function () {
            actions.showPrompt("Impulse Reality Check", "Cost of item you want to buy (AED)?", (priceStr) => {
                const price = parseFloat(priceStr);
                if (!price || isNaN(price)) return;

                // 1. Calc Passive Income Speed (Avg Monthly Gain)
                // Scan all investment accounts
                const investAccs = state.data.accounts.filter(a => ['Investment', 'Mutual Fund', 'Commodity'].includes(a.type));
                let totalGain = 0;
                let totalMonths = 0;
                let count = 0;

                investAccs.forEach(acc => {
                    const txs = state.data.transactions.filter(t => t.accountId === acc.id);
                    // Simple Net Cashflow
                    const tIn = txs.filter(t => t.type === 'transfer_in').reduce((s, t) => s + Number(t.amount), 0);
                    const tOut = txs.filter(t => t.type === 'transfer_out').reduce((s, t) => s + Number(t.amount), 0);
                    const netInvested = Math.max(0, tIn - tOut);

                    const curVal = acc.currency === 'AED' ? actions.toCurrency(acc.balance * state.data.settings.rate) : acc.balance;
                    const invVal = acc.currency === 'AED' ? actions.toCurrency(netInvested * state.data.settings.rate) : netInvested;

                    if (invVal > 0) {
                        totalGain += (curVal - invVal);
                        // Estimate age
                        const first = txs[0] ? new Date(txs[0].date) : new Date();
                        const ageMonths = Math.max(1, (new Date() - first) / (1000 * 60 * 60 * 24 * 30));
                        totalMonths += ageMonths;
                        count++;
                    }
                });

                // Conservative Estimate: Total Gain / Avg Age? 
                // Better: Sum of (Gain / Age) for each asset?
                // Let's do: Total Portfolio Gain / Max Age (to be safe)
                const maxAge = Math.max(1, totalMonths / (count || 1)); // Avg age
                const monthlyPassive = totalGain / maxAge;

                if (monthlyPassive <= 0) {
                    actions.showToast("📉 You have no passive income yet! Invest first!", "warning");
                    return;
                }

                const recoveryMonths = price / monthlyPassive;
                const years = (recoveryMonths / 12).toFixed(1);

                actions.showConfirm(
                    "? TIME TO RECOVERY",
                    `To earn back the cost of **AED ${price.toLocaleString()}** passively, it will take your portfolio:\n\n📅 **${recoveryMonths.toFixed(1)} MONTHS**\n\n(Based on avg growth of AED ${Math.round(monthlyPassive)}/mo).\n\nIs it worth ${Math.round(recoveryMonths * 30)} days of freedom?`,
                    () => { } // No action on OK, just info
                );
            }, "number");
        };

actions.printSalary = function () {
            window.print();
        };

actions.updateTxBudgetStatus = actions.checkBudgetWarning = function () {
    const typeEl = document.getElementById('tt');
    const warningEl = document.getElementById('tx-warning');
    const budgetCardEl = document.getElementById('tx-category-budget-info');
    if (!typeEl) return;
    
    const type = typeEl.value;
    const isExcluded = document.getElementById('tx-exclude-budget')?.checked || false;
    const cat = document.getElementById('tc')?.value;
    const amtRaw = parseFloat(document.getElementById('tam')?.value) || 0;

    // Convert amount to AED base currency if account currency is INR
    const aId = document.getElementById('ta')?.value;
    const acc = (state.data?.accounts || []).find(a => a.id === aId);
    const accCur = acc?.currency || 'AED';
    const r = parseFloat(state.data?.settings?.rate) || 22.75;
    const amtInAED = accCur === 'INR' ? (r > 0 ? amtRaw / r : amtRaw) : amtRaw;

    if (type !== 'expense') {
        if (warningEl) warningEl.classList.add('hidden');
        if (budgetCardEl) budgetCardEl.classList.add('hidden');
        return;
    }

    if (isExcluded) {
        if (warningEl) warningEl.classList.add('hidden');
        if (budgetCardEl) {
            budgetCardEl.classList.remove('hidden');
            FinzUI.setHTML(budgetCardEl, FinzUI.html`
                <div class="p-3.5 bg-slate-900/80 border border-slate-700/80 rounded-2xl flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2 text-slate-300 font-bold">
                        <div class="w-7 h-7 rounded-lg bg-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                            <i data-lucide="shield-check" class="w-4 h-4 text-emerald-400"></i>
                        </div>
                        <div>
                            <span class="text-[10px] text-slate-400 uppercase tracking-wider block">Monthly Budget Tracking</span>
                            <span class="text-xs text-slate-200 font-bold">Excluded from Budget (Paid from savings / capital)</span>
                        </div>
                    </div>
                    <span class="text-[10px] text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700 font-bold">Not Deducted</span>
                </div>
            `);
            if (libraries.lucide) libraries.lucide.createIcons();
        }
        return;
    }

    if (!cat) {
        if (warningEl) warningEl.classList.add('hidden');
        if (budgetCardEl) budgetCardEl.classList.add('hidden');
        return;
    }

    // Retrieve Envelope Stats (and legacy budget fallback if any)
    const stats = (typeof actions.getEnvelopeStats === 'function') ? actions.getEnvelopeStats() : null;
    const cStat = stats?.categories?.[cat] || { funded: 0, spent: 0, available: 0 };
    const funded = cStat.funded || 0;
    const spent = cStat.spent || 0;
    const available = cStat.available || 0;
    const legacyBudget = (state.data?.budgets && state.data.budgets[cat]) ? state.data.budgets[cat] : (state.data?.budgetTemplate && state.data.budgetTemplate[cat] ? state.data.budgetTemplate[cat] : 0);
    const effectiveBudget = funded > 0 ? funded : legacyBudget;

    if (warningEl) warningEl.classList.add('hidden'); // Modern card handles both status and alerts

    if (!budgetCardEl) return;
    budgetCardEl.classList.remove('hidden');

    if (effectiveBudget <= 0 && funded <= 0) {
        FinzUI.setHTML(budgetCardEl, FinzUI.html`
            <div class="p-3.5 bg-slate-900/80 border border-slate-700/80 rounded-2xl flex items-center justify-between text-xs">
                <div class="flex items-center gap-2.5 text-slate-300 font-bold">
                    <div class="w-7 h-7 rounded-lg bg-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                        <i data-lucide="info" class="w-4 h-4 text-slate-400"></i>
                    </div>
                    <div>
                        <span class="text-[10px] text-slate-400 uppercase tracking-wider block">Budget for ${cat}</span>
                        <span class="text-xs text-slate-300 font-bold">No budget envelope allocated (AED 0.00)</span>
                    </div>
                </div>
                <span class="text-[10px] text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700 font-bold">Unbudgeted</span>
            </div>
        `);
    } else {
        const remainingAfter = available - amtInAED;
        const isOver = remainingAfter < -0.005;
        const pctUsed = effectiveBudget > 0 ? Math.min(100, Math.round(((spent + amtInAED) / effectiveBudget) * 100)) : 100;
        const inrHint = (accCur === 'INR' && amtRaw > 0) ? FinzUI.html`<span class="text-[9px] text-slate-400 block font-normal">(INR ${amtRaw.toLocaleString()} ≈ AED ${amtInAED.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})</span>` : '';

        if (amtRaw <= 0) {
            // User just selected category, before typing amount
            if (available >= 0) {
                FinzUI.setHTML(budgetCardEl, FinzUI.html`
                    <div class="p-3.5 bg-emerald-950/30 border border-emerald-500/40 rounded-2xl flex items-center justify-between text-xs">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                                <i data-lucide="wallet" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Remaining Budget for ${cat}</span>
                                <span class="text-sm font-black text-emerald-400 num-font">AED ${available.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} left</span>
                            </div>
                        </div>
                        <div class="text-right">
                            <span class="text-[10px] font-bold text-slate-300 block">Spent AED ${spent.toLocaleString(undefined, {maximumFractionDigits: 2})} of AED ${effectiveBudget.toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
                            <div class="w-24 bg-slate-800 rounded-full h-1.5 mt-1 overflow-hidden ml-auto border border-slate-700">
                                <div class="bg-emerald-500 h-full rounded-full transition-all duration-300" style="width: ${Math.min(100, Math.round((spent / effectiveBudget) * 100))}%"></div>
                            </div>
                        </div>
                    </div>
                `);
            } else {
                FinzUI.setHTML(budgetCardEl, FinzUI.html`
                    <div class="p-3.5 bg-rose-950/40 border border-rose-500/50 rounded-2xl flex items-center justify-between text-xs">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                                <i data-lucide="alert-triangle" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold text-rose-300 uppercase tracking-wider block">Budget Exceeded for ${cat}</span>
                                <span class="text-sm font-black text-rose-400 num-font">AED ${Math.abs(available).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} deficit</span>
                            </div>
                        </div>
                        <div class="text-right">
                            <span class="text-[10px] font-bold text-rose-300 block">100% Spent (${spent.toLocaleString()} / ${effectiveBudget.toLocaleString()})</span>
                            <span class="text-[9px] text-slate-400">Additional expenses will increase deficit</span>
                        </div>
                    </div>
                `);
            }
        } else if (!isOver) {
            // Typing amount and WITHIN budget
            FinzUI.setHTML(budgetCardEl, FinzUI.html`
                <div class="p-3.5 bg-emerald-950/30 border border-emerald-500/40 rounded-2xl flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                            <i data-lucide="check-circle" class="w-4 h-4"></i>
                        </div>
                        <div>
                            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Remaining After This Expense</span>
                            <span class="text-sm font-black text-emerald-400 num-font">AED ${remainingAfter.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} left</span>
                            <span class="text-[10px] text-slate-400 block">(AED ${available.toLocaleString(undefined, {maximumFractionDigits: 2})} available - AED ${amtInAED.toLocaleString(undefined, {maximumFractionDigits: 2})})</span>
                            ${inrHint}
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-[10px] font-black text-emerald-300 block">✓ Within Budget (${pctUsed}%)</span>
                        <div class="w-24 bg-slate-800 rounded-full h-1.5 mt-1 overflow-hidden ml-auto border border-slate-700">
                            <div class="bg-emerald-500 h-full rounded-full transition-all duration-300" style="width: ${pctUsed}%"></div>
                        </div>
                    </div>
                </div>
            `);
        } else {
            // Typing amount and EXCEEDING budget
            const overAmount = Math.abs(remainingAfter);
            FinzUI.setHTML(budgetCardEl, FinzUI.html`
                <div class="p-3.5 bg-rose-950/50 border border-rose-500/60 rounded-2xl flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                            <i data-lucide="alert-octagon" class="w-4 h-4"></i>
                        </div>
                        <div>
                            <span class="text-[10px] font-black text-rose-300 uppercase tracking-wider block">WARNING: Exceeds Remaining Budget</span>
                            <span class="text-sm font-black text-rose-400 num-font">Exceeds budget by AED ${overAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                            <span class="text-[10px] text-slate-400 block">Available: AED ${Math.max(0, available).toLocaleString(undefined, {maximumFractionDigits: 2})} • Entering: AED ${amtInAED.toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
                            ${inrHint}
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-[10px] font-bold text-rose-300 block">Shortfall: AED ${overAmount.toLocaleString()}</span>
                        <span class="text-[9px] text-slate-400">Can cover later in Budget</span>
                    </div>
                </div>
            `);
        }
    }

    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.startBudgetWizard = function (step = 1) {
    actions.budgetWizardState = actions.budgetWizardState || {
        expectedSalary: state.data.settings.expectedSalary || 0,
        tempBudgets: { ...state.data.budgets }
    };

    let content = '';
    
    if (step === 1) {
        content = FinzUI.html`
            <div class="text-slate-900 max-w-md mx-auto bg-white/70 backdrop-blur-xl p-10 rounded-[3rem] border shadow-2xl text-center">
                <div class="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                    <i data-lucide="wallet" class="w-10 h-10 text-emerald-500"></i>
                </div>
                <h2 class="text-2xl font-black text-slate-900 mb-2">Monthly Income</h2>
                <p class="text-xs font-bold text-slate-500 mb-8">What is your expected total income for this month?</p>
                
                <div class="mb-8">
                    <input type="number" id="wizard-salary" value="${actions.budgetWizardState.expectedSalary}" class="w-full text-center text-4xl font-black text-emerald-600 bg-transparent border-b-4 border-slate-200 focus:border-emerald-500 outline-none pb-4 transition-colors" placeholder="0.00">
                    <p class="text-[10px] font-black uppercase text-slate-400 mt-2">Base Currency</p>
                </div>
                
                <button data-finz-click="${FinzUI.handler(function(event) { actions.budgetWizardState.expectedSalary = parseFloat(document.getElementById('wizard-salary').value) || 0; return actions.startBudgetWizard(2) })}" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest py-4 rounded-2xl transition-all shadow-lg">Next: Categories <i data-lucide="arrow-right" class="w-4 h-4 inline ml-2"></i></button>
            </div>
        `;
    } 
            else if (step === 2) {
        content = actions.render3PillarCategoryManager(function(event) { actions.renderBudgetUIOverride() });
    }
    else if (step === 3) {
        content = FinzUI.html`
            <div class="text-slate-900 max-w-xl mx-auto bg-white/70 backdrop-blur-xl p-10 rounded-[3rem] border shadow-2xl h-[85vh] flex flex-col">
                <div class="flex justify-between items-center mb-6">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.openCategoryManager(() => actions.renderBudgetUIOverride()) })}" class="text-slate-400 hover:text-slate-600"><i data-lucide="arrow-left" class="w-5 h-5"></i></button>
                    <h2 class="text-xl font-black text-slate-900">Allocate Funds</h2>
                    <div class="w-5"></div>
                </div>
                
                <div class="bg-slate-900 text-white p-6 rounded-3xl mb-6 shadow-xl relative overflow-hidden flex-shrink-0">
                    <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 relative z-10">Unallocated Left</p>
                    <h3 id="wizard-unallocated" class="text-3xl font-black text-emerald-400 num-font relative z-10">AED ${actions.budgetWizardState.expectedSalary.toLocaleString()}</h3>
                    <div class="absolute right-[-20px] bottom-[-20px] opacity-10"><i data-lucide="pie-chart" class="w-32 h-32"></i></div>
                    
                    <div class="w-full bg-slate-800 rounded-full h-2 mt-4 relative z-10">
                        <div id="wizard-progress" class="bg-emerald-500 h-2 rounded-full transition-all" style="width: 0%"></div>
                    </div>
                </div>
                
                <div class="flex-1 overflow-auto pr-2 space-y-4">
                    ${state.data.expenseCategories.map(cat => {
                        const val = actions.budgetWizardState.tempBudgets[cat] || 0;
                        return FinzUI.html`
                        <div class="text-slate-900 flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border">
                            <span class="w-1/3 text-xs font-black text-slate-700 uppercase truncate">${cat}</span>
                            <div class="text-slate-900 w-2/3 flex items-center bg-white border rounded-xl overflow-hidden focus-within:border-emerald-500 transition-colors">
                                <span class="pl-4 text-[10px] font-black text-slate-400">AED</span>
                                <input type="number" data-cat="${cat}" value="${val}" class="wizard-budget-input w-full p-3 font-black text-right outline-none text-slate-700" data-finz-input="${FinzUI.handler(function(event) { return actions.calcWizardUnallocated() })}">
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
                
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveBudgetWizard() })}" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase tracking-widest py-4 rounded-2xl transition-all shadow-lg mt-6 flex-shrink-0">Save & Finish <i data-lucide="check" class="w-4 h-4 inline ml-2"></i></button>
            </div>
        `;
        
        setTimeout(actions.calcWizardUnallocated, 50);
    }
    
    FinzUI.setHTML(document.getElementById('modal-content'), content);
    lucide.createIcons();
};

actions.calcWizardUnallocated = function() {
    const total = actions.budgetWizardState.expectedSalary;
    let allocated = 0;
    document.querySelectorAll('.wizard-budget-input').forEach(input => {
        allocated += parseFloat(input.value) || 0;
    });
    
    const unallocated = total - allocated;
    const el = document.getElementById('wizard-unallocated');
    const bar = document.getElementById('wizard-progress');
    
    if (el) {
        el.innerText = 'AED ' + unallocated.toLocaleString();
        el.className = unallocated < 0 ? 'text-3xl font-black text-rose-400 num-font relative z-10' : 'text-3xl font-black text-emerald-400 num-font relative z-10';
    }
    
    if (bar) {
        const pct = total > 0 ? (allocated / total) * 100 : 0;
        bar.style.width = Math.min(100, pct) + '%';
        bar.className = unallocated < 0 ? 'bg-rose-500 h-2 rounded-full transition-all' : 'bg-emerald-500 h-2 rounded-full transition-all';
    }
};

actions.saveBudgetWizard = async function() {
    state.data.settings.expectedSalary = actions.budgetWizardState.expectedSalary;
    document.querySelectorAll('.wizard-budget-input').forEach(input => {
        const cat = input.getAttribute('data-cat');
        const val = Math.max(0, parseFloat(input.value) || 0); // Negative budgets would make backups unrestorable
        state.data.budgets[cat] = val;
    });
    await actions.updateDb();
    actions.showToast("Budget successfully saved!", "success");
    actions.budgetWizardState = null; 
    actions.openModal('budget'); 
};

actions.getEnvelopeStats = function() {
    const el = state.data.envelopeLedger || [];
    const tx = state.data.transactions || [];
    
    // Ensure pillars exist in state.data
    if (!state.data.savingsCategories) {
        state.data.savingsCategories = ['Wedding Fund', 'Car Fund', 'Emergency Fund Top-Up', 'Annual Vacation'];
    }
    if (!state.data.investmentCategories) {
        state.data.investmentCategories = ['Mutual Funds', 'Sarwa', 'Crypto & Stocks'];
    }
    if (!state.data.expenseCategories) {
        state.data.expenseCategories = ['Rent', 'Food & Groceries', 'Utilities & Bills', 'Dining Out', 'Fuel & Transport', 'Personal & Other'];
    }
    
    const firstCredit = el.find(item => item.type === 'credit');
    let envelopeStartDate = null;
    if (state.data.settings?.lastSalaryDate) {
        envelopeStartDate = new Date(state.data.settings.lastSalaryDate);
    } else if (firstCredit) {
        envelopeStartDate = new Date(firstCredit.date);
    } else {
        envelopeStartDate = null;
    }
    
    let stats = {
        totalCredit: 0,
        totalFunded: 0,
        totalDefunded: 0,
        unallocatedCash: 0,
        categories: {},
        pillars: {
            expense: { funded: 0, spent: 0, available: 0 },
            savings: { funded: 0, spent: 0, available: 0 },
            investment: { funded: 0, spent: 0, available: 0 }
        }
    };

    el.forEach(item => {
        if (item.type === 'credit') stats.totalCredit += item.amount;
        if (item.type === 'fund') {
            stats.totalFunded += item.amount;
            if (!stats.categories[item.category]) stats.categories[item.category] = { funded: 0, spent: 0, available: 0 };
            stats.categories[item.category].funded += item.amount;
        }
        if (item.type === 'defund') {
            stats.totalDefunded += item.amount;
            if (!stats.categories[item.category]) stats.categories[item.category] = { funded: 0, spent: 0, available: 0 };
            stats.categories[item.category].funded -= item.amount;
        }
    });

    if (envelopeStartDate) {
        const startBoundary = new Date(envelopeStartDate);
        startBoundary.setHours(0, 0, 0, 0);

        tx.forEach(t => {
            const txDate = new Date(t.date);
            if (txDate >= startBoundary) {
                if ((t.type === 'expense' || t.type === 'transfer_out') && t.category && !t.excludeFromBudget) {
                    if (!stats.categories[t.category]) stats.categories[t.category] = { funded: 0, spent: 0, available: 0 };
                    stats.categories[t.category].spent += actions.getTransactionBaseAmount(t);
                }
            }
        });
    }

    stats.unallocatedCash = stats.totalCredit - (stats.totalFunded - stats.totalDefunded);

    // Calculate Available per category and aggregate per pillar
    const allCats = actions.getAllBudgetCategories();
    allCats.forEach(cat => {
        if (!stats.categories[cat]) stats.categories[cat] = { funded: 0, spent: 0, available: 0 };
        const c = stats.categories[cat];
        c.available = c.funded - c.spent;
        
        const pillar = actions.getCategoryPillar(cat);
        if (stats.pillars[pillar]) {
            stats.pillars[pillar].funded += c.funded;
            stats.pillars[pillar].spent += c.spent;
            stats.pillars[pillar].available += c.available;
        }
    });

    return stats;
};

actions.isProcessingSalary = false;

actions.processSalary = async function () {
    if (actions.isProcessingSalary) return;
    actions.isProcessingSalary = true;

    const btn = document.activeElement;
    let originalText = '';
    if (btn && btn.tagName === 'BUTTON') {
        originalText = FinzUI.capture(btn);
        FinzUI.setHTML(btn, FinzUI.html`<i data-lucide="loader-2" class="w-5 h-5 inline animate-spin"></i> Processing...`);
        btn.disabled = true;
        if (libraries.lucide) libraries.lucide.createIcons();
    }

    try {
        const amt = parseFloat(document.getElementById('sal-amount').value) || 0;
        const aId = document.getElementById('sal-acc').value;
        if (amt <= 0 || !aId) {
            actions.showToast("Please enter a valid amount and select account", "error");
            if (btn && btn.tagName === 'BUTTON') {
                FinzUI.setHTML(btn, originalText);
                btn.disabled = false;
                if (libraries.lucide) libraries.lucide.createIcons();
            }
            actions.isProcessingSalary = false;
            return;
        }
        
        const rateSnapshot = state.data.settings?.rate || 22.75;
        const date = new Date().toISOString();
        const salaryAccount = state.data.accounts.find(a => a.id === aId);
        if (!salaryAccount) throw new Error('Select the account that received the salary.');
        // Envelopes are budgeted in AED, so a salary paid into an INR account is converted.
        const creditAED = FinzCore.convert(amt, salaryAccount.currency, 'AED', rateSnapshot);

        // 1. Generate & Archive Report of outgoing cycle
        const oldStats = actions.getEnvelopeStats();
        if (!state.data.budgetReports) state.data.budgetReports = [];
        
        const prevStart = state.data.settings?.lastSalaryDate || (state.data.envelopeLedger?.find(e => e.type === 'credit')?.date) || date;
        state.data.budgetReports.push({
            id: actions.genId(),
            date: date, // End date of outgoing cycle
            startDate: prevStart,
            stats: JSON.parse(JSON.stringify(oldStats))
        });

        // 2. Determine planned envelope targets from new budget limits (not last month's envelopes)
        const targets = {};
        const allCats = actions.getAllBudgetCategories();
        allCats.forEach(cat => {
            const budgetLimit = (state.data.budgets && state.data.budgets[cat] !== undefined) ? Number(state.data.budgets[cat]) : null;
            const templateLimit = (state.data.budgetTemplate && state.data.budgetTemplate[cat] !== undefined) ? Number(state.data.budgetTemplate[cat]) : null;
            const target = (budgetLimit !== null && !isNaN(budgetLimit) && budgetLimit > 0)
                ? budgetLimit
                : ((templateLimit !== null && !isNaN(templateLimit) && templateLimit > 0) ? templateLimit : 0);
            if (target > 0) {
                targets[cat] = target;
            }
        });

        // Keep template in sync with active budget limits
        if (Object.keys(targets).length > 0) {
            state.data.budgetTemplate = state.data.budgetTemplate || {};
            Object.keys(targets).forEach(cat => {
                state.data.budgetTemplate[cat] = targets[cat];
            });
        }

        // 3. RESET BUDGET LEDGER (Wipe old allocations and negative balances)
        state.data.envelopeLedger = [];

        // 4. Log the income to the bank account
        state.data.transactions.push({
            id: actions.genId(), accountId: aId, amount: actions.toCurrency(amt), currency: salaryAccount.currency, type: 'income', category: 'Salary', note: `Salary Credited`, date, exchangeRate: rateSnapshot
        });

        // 5. Log the credit to the envelope system
        state.data.envelopeLedger.push({
            id: actions.genId(), date, type: 'credit', amount: creditAED, note: `Salary Cycle Income (${salaryAccount.name})`
        });

        // 6. Auto-fill envelopes with standard planned targets from incoming salary
        let remainingToFund = creditAED;
        let totalAutoFunded = 0;
        Object.keys(targets).forEach(cat => {
            const targetAmt = targets[cat];
            const toFund = Math.min(targetAmt, Math.max(0, remainingToFund));
            if (toFund > 0) {
                state.data.envelopeLedger.push({
                    id: actions.genId(),
                    date,
                    type: 'fund',
                    category: cat,
                    amount: toFund
                });
                remainingToFund -= toFund;
                totalAutoFunded += toFund;
            }
        });

        // 7. Set last salary date & expected salary for tracking period
        state.data.settings.lastSalaryDate = date;
        state.data.settings.expectedSalary = amt;

        actions.recalculateBalances();
        await actions.updateDb();
        actions.closeModal();
        actions.renderApp();
        if (actions.fireConfetti) actions.fireConfetti();
        actions.showToast(`🎉 Budget restarted! Envelopes auto-filled (AED ${totalAutoFunded.toLocaleString()}). Unallocated cash: AED ${Math.max(0, remainingToFund).toLocaleString()}.`, "success");
    } catch (err) {
        console.error(err);
        actions.showToast(err?.message ? `Salary not saved: ${err.message}` : "An error occurred while processing", "error");
        if (btn && btn.tagName === 'BUTTON') {
            FinzUI.setHTML(btn, originalText);
            btn.disabled = false;
            if (libraries.lucide) libraries.lucide.createIcons();
        }
    } finally {
        actions.isProcessingSalary = false;
    }
};

actions.promptFundCategory = function(cat) {
    const stats = actions.getEnvelopeStats();
    const currentFunded = stats.categories[cat]?.funded || 0;
    
    actions.showPrompt(
        `Fund ${cat}`,
        `Enter amount to add (e.g. 100) or subtract (e.g. -100).\nCurrently Funded: AED ${currentFunded.toLocaleString()} • Unallocated Cash: AED ${stats.unallocatedCash.toLocaleString()}.\n\nTip: You can also use the Edit (pencil) button on this envelope card to set the exact total or move funds directly.`,
        async (val) => {
            const amount = parseFloat(val);
            if (isNaN(amount) || amount === 0) return;
            
            // If they enter a positive number, it's funding. If negative, defunding.
            if (amount > 0 && amount > stats.unallocatedCash + 0.005) {
                actions.showToast("Not enough unallocated cash!", "error");
                return;
            }

            if (amount < 0 && Math.abs(amount) > currentFunded + 0.005) {
                actions.showToast(`Cannot subtract more than currently funded (AED ${currentFunded.toLocaleString()})`, "error");
                return;
            }

            const type = amount > 0 ? 'fund' : 'defund';
            
            state.data.envelopeLedger.push({
                id: actions.genId(),
                date: new Date().toISOString(),
                type: type,
                category: cat,
                amount: Math.abs(amount)
            });

            await actions.updateDb();
            actions.renderBudgetUIOverride();
        }
    );
};

actions.viewBudgetReports = function() {
    let content = FinzUI.html`
        <div class="max-w-4xl mx-auto space-y-6 pb-20 pt-2 fade-in text-left">
            <div class="flex items-center justify-between mb-6 px-2">
                <div class="flex items-center gap-3">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-2xl text-slate-300 hover:text-white transition-all">
                        <i data-lucide="arrow-left" class="w-5 h-5"></i>
                    </button>
                    <div>
                        <h2 class="text-2xl font-black text-white">Monthly Budget Reports</h2>
                        <p class="text-[10px] font-bold text-slate-400">Archived performance, PDF statements & leftover cash sweeps</p>
                    </div>
                </div>
            </div>
            
            <div class="space-y-4 px-2">
    `;
    
    if (!state.data.budgetReports || state.data.budgetReports.length === 0) {
        content += FinzUI.html`<div class="text-center py-16 bg-slate-800/60 rounded-[2.5rem] border border-slate-700/80"><p class="text-sm font-bold text-slate-400">No past reports available yet. They will appear here every time you process Salary Day!</p></div>`;
    } else {
        [...state.data.budgetReports].reverse().forEach(rep => {
            const dateStr = new Date(rep.date).toLocaleDateString(undefined, {month:'short', year:'numeric', day:'numeric'});
            const unallocated = rep.stats?.unallocatedCash || 0;
            
            // Calculate total leftover / surplus from all categories
            let categorySurplus = 0;
            if (rep.stats?.categories) {
                Object.values(rep.stats.categories).forEach(c => {
                    if (c.available > 0) categorySurplus += c.available;
                });
            }
            const totalSurplus = unallocated + categorySurplus;

            content += FinzUI.html`
                <div class="bg-slate-800/95 p-6 rounded-[2rem] border border-slate-700/80 shadow-xl space-y-4 hover:border-emerald-500/40 transition-all">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">Cycle Ended</span>
                            <h4 class="text-lg font-black text-white">${dateStr}</h4>
                        </div>
                        <div class="flex items-center gap-2">
                            ${totalSurplus > 0 ? FinzUI.html`
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.openSurplusSweepModal((totalSurplus)) })}" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 text-xs font-black shadow-lg shadow-emerald-500/20">
                                    <i data-lucide="arrow-right-circle" class="w-4 h-4"></i> Sweep to Vault
                                </button>
                            ` : ''}
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.downloadBudgetReportPDF(((rep.id))) })}" title="Download Executive PDF" class="bg-slate-700 hover:bg-slate-600 text-white px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold border border-slate-600">
                                <i data-lucide="file-down" class="w-4 h-4 text-emerald-400"></i> PDF Report
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.downloadBudgetReport(((rep.id))) })}" title="Download Text Summary" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white p-2 rounded-xl transition-all border border-slate-700">
                                <i data-lucide="file-text" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Leftover Cash Banner -->
                    <div class="bg-gradient-to-r from-emerald-950/40 to-slate-900 p-4 rounded-2xl border border-emerald-500/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div>
                            <p class="text-[10px] font-black uppercase text-emerald-400 tracking-wider flex items-center gap-1.5">
                                <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Total Leftover Cash / Savings Potential
                            </p>
                            <p class="text-[9px] text-slate-400 mt-0.5">Unallocated: AED ${unallocated.toLocaleString()} | Envelope Leftovers: AED ${categorySurplus.toLocaleString()}</p>
                        </div>
                        <span class="text-xl font-black text-emerald-400 num-font">AED ${totalSurplus.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    </div>

                    <!-- 3-Pillar Split -->
                    <div class="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-700/50">
                        <div class="p-2 bg-slate-900/60 rounded-xl">
                            <p class="text-[8px] font-bold text-slate-400 uppercase">Living Spent</p>
                            <p class="text-xs font-black text-rose-400 num-font">AED ${(rep.stats?.pillars?.expense?.spent || 0).toLocaleString()}</p>
                        </div>
                        <div class="p-2 bg-slate-900/60 rounded-xl">
                            <p class="text-[8px] font-bold text-slate-400 uppercase">Saved/Moved</p>
                            <p class="text-xs font-black text-emerald-400 num-font">AED ${(rep.stats?.pillars?.savings?.spent || 0).toLocaleString()}</p>
                        </div>
                        <div class="p-2 bg-slate-900/60 rounded-xl">
                            <p class="text-[8px] font-bold text-slate-400 uppercase">Invested</p>
                            <p class="text-xs font-black text-indigo-400 num-font">AED ${(rep.stats?.pillars?.investment?.spent || 0).toLocaleString()}</p>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    
    content += FinzUI.html`</div></div>`;
    FinzUI.setHTML(document.getElementById('modal-content'), content);
    lucide.createIcons();
};

actions.downloadBudgetReport = function(id) {
    const rep = state.data.budgetReports?.find(r => r.id === id);
    if (!rep) return;
    
    const start = new Date(rep.startDate);
    const end = new Date(rep.date);
    
    let text = `=======================================\n`;
    text += `       MONTHLY BUDGET REPORT\n`;
    text += `=======================================\n`;
    text += `Period: ${start.toLocaleDateString()} to ${end.toLocaleDateString()}\n`;
    text += `Unallocated Cash Remaining: AED ${rep.stats.unallocatedCash}\n`;
    text += `Total Salary/Credit: AED ${rep.stats.totalCredit}\n`;
    text += `Total Spent: AED ${Object.values(rep.stats.categories || {}).reduce((sum, c) => sum + (c.spent || 0), 0)}\n\n`;
    
    const txs = (state.data.transactions || []).filter(t => new Date(t.date) >= start && new Date(t.date) <= end && (t.type === 'expense' || t.type === 'transfer_out'));
    
    Object.keys(rep.stats.categories || {}).forEach(cat => {
        const cStat = rep.stats.categories[cat];
        text += `---------------------------------------\n`;
        text += `CATEGORY: ${cat.toUpperCase()}\n`;
        text += `Funded: AED ${cStat.funded} | Spent: AED ${cStat.spent} | Available: AED ${cStat.available}\n`;
        text += `---------------------------------------\n`;
        
        const catTxs = txs.filter(t => t.category === cat && !t.excludeFromBudget);
        if (catTxs.length === 0) {
            text += `  (No transactions)\n`;
        } else {
            catTxs.forEach(t => {
                const acc = state.data.accounts.find(a => a.id === t.accountId);
                const cur = t.currency || (acc ? acc.currency : 'AED');
                const baseAmt = actions.getTransactionBaseAmount(t);
                const nativeStr = cur !== 'AED' ? ` (${cur} ${Number(t.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})` : '';
                text += `  [${new Date(t.date).toLocaleDateString()}] ${t.note || 'Expense'} - AED ${baseAmt.toFixed(2)}${nativeStr}\n`;
            });
        }
        text += `\n`;
    });
    
    text += `=======================================\n`;
    text += `Generated by Personal Finance System\n`;
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Budget_Report_${FinzCore.localDateKey(end)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

actions.downloadBudgetReportPDF = function(id) {
    try {
        const rep = state.data.budgetReports?.find(r => r.id === id);
        if (!rep) {
            actions.showToast("Report not found", "error");
            return;
        }

        const { jsPDF } = libraries.jspdf;
        if (!jsPDF) {
            actions.showToast("PDF engine not loaded", "error");
            return;
        }

        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const start = new Date(rep.startDate || rep.date);
        const end = new Date(rep.date);
        const dateRangeStr = `${start.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})} - ${end.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}`;

        const unallocated = rep.stats?.unallocatedCash || 0;
        let categorySurplus = 0;
        if (rep.stats?.categories) {
            Object.values(rep.stats.categories).forEach(c => {
                if (c.available > 0) categorySurplus += c.available;
            });
        }
        const totalSurplus = unallocated + categorySurplus;

        const livingSpent = rep.stats?.pillars?.expense?.spent || 0;
        const livingFunded = rep.stats?.pillars?.expense?.funded || 0;
        const savingsSpent = rep.stats?.pillars?.savings?.spent || 0;
        const savingsFunded = rep.stats?.pillars?.savings?.funded || 0;
        const investSpent = rep.stats?.pillars?.investment?.spent || 0;
        const investFunded = rep.stats?.pillars?.investment?.funded || 0;
        const totalSalary = (rep.stats?.totalCredit || (livingFunded + savingsFunded + investFunded + unallocated)) || 0;

        // 1. TOP HEADER BANNER
        doc.setFillColor(15, 23, 42); // #0f172a
        doc.rect(0, 0, 210, 36, 'F');

        // Brand Title
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text("FINZ SHAANIREE", 14, 16);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text("Executive Monthly Budget & Wealth Performance Statement", 14, 23);

        // Date Range Badge (Right side)
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(52, 211, 153); // emerald-400
        doc.text("CYCLE ENDED: " + end.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}), 196, 16, { align: 'right' });
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(203, 213, 225);
        doc.text(`Period: ${dateRangeStr}`, 196, 23, { align: 'right' });

        // Accent line below header
        doc.setFillColor(16, 185, 129); // emerald-500
        doc.rect(0, 36, 210, 1.5, 'F');

        // 2. EXECUTIVE HIGHLIGHT CARDS
        let curY = 44;

        // Banner: Leftover Surplus Cash
        doc.setFillColor(240, 253, 244); // emerald-50
        doc.setDrawColor(167, 243, 208); // emerald-200
        doc.roundedRect(14, curY, 182, 20, 3, 3, 'FD');

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(6, 95, 70); // emerald-800
        doc.text("TOTAL LEFTOVER SURPLUS CASH (SAVINGS POTENTIAL)", 20, curY + 8);

        doc.setFontSize(14);
        doc.setTextColor(5, 150, 105); // emerald-600
        doc.text(`AED ${totalSurplus.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 20, curY + 16);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text(`(Unallocated: AED ${unallocated.toLocaleString()} + Envelope Leftover: AED ${categorySurplus.toLocaleString()})`, 190, curY + 14, { align: 'right' });

        curY += 26;

        // 4 Summary Metrics Chips
        const chipW = 43;
        const chipH = 18;
        const chips = [
            { title: "TOTAL INFLOW", val: `AED ${totalSalary.toLocaleString()}`, bg: [248, 250, 252], border: [226, 232, 240], text: [15, 23, 42] },
            { title: "LIVING SPENT", val: `AED ${livingSpent.toLocaleString()}`, bg: [255, 241, 242], border: [254, 205, 211], text: [225, 29, 72] },
            { title: "SAVED / MOVED", val: `AED ${savingsSpent.toLocaleString()}`, bg: [236, 253, 245], border: [167, 243, 208], text: [5, 150, 105] },
            { title: "INVESTED", val: `AED ${investSpent.toLocaleString()}`, bg: [238, 242, 255], border: [199, 210, 254], text: [79, 70, 229] },
        ];

        chips.forEach((c, idx) => {
            const x = 14 + (idx * 46.3);
            doc.setFillColor(...c.bg);
            doc.setDrawColor(...c.border);
            doc.roundedRect(x, curY, chipW, chipH, 2, 2, 'FD');

            doc.setFont("helvetica", "bold");
            doc.setFontSize(7);
            doc.setTextColor(100, 116, 139);
            doc.text(c.title, x + 4, curY + 6);

            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(...c.text);
            doc.text(c.val, x + 4, curY + 13);
        });

        curY += 24;

        // 3. TABLE: 3-PILLAR CATEGORY BREAKDOWN
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text("3-Pillar Envelope Audit & Breakdown", 14, curY);

        curY += 3;

        const tableRows = [];
        const cats = rep.stats?.categories || {};
        
        Object.keys(cats).forEach(catName => {
            const c = cats[catName];
            let pillarTag = 'Living';
            let pillarType = 'expense';
            
            if ((state.data?.savingsCategories || []).includes(catName)) {
                pillarTag = 'Savings';
                pillarType = 'savings';
            } else if ((state.data?.investmentCategories || []).includes(catName)) {
                pillarTag = 'Investment';
                pillarType = 'investment';
            }

            let status = 'On Track';
            if (pillarType === 'expense') {
                if (c.available < 0) status = `Over Budget (-AED ${Math.abs(c.available).toLocaleString()})`;
                else if (c.available === 0 && c.funded > 0) status = '100% Spent';
                else status = `${c.funded > 0 ? Math.round((c.spent/c.funded)*100) : 0}% Spent`;
            } else {
                if (c.spent > c.funded && c.funded > 0) status = `+AED ${(c.spent - c.funded).toLocaleString()} Extra`;
                else if (c.spent >= c.funded && c.funded > 0) status = '100% Completed';
                else status = `${c.funded > 0 ? Math.round((c.spent/c.funded)*100) : 0}% Deposited`;
            }

            tableRows.push([
                pillarTag,
                catName,
                `AED ${c.funded.toLocaleString()}`,
                `AED ${c.spent.toLocaleString()}`,
                `AED ${c.available.toLocaleString()}`,
                status
            ]);
        });

        doc.autoTable({
            startY: curY,
            head: [['Pillar', 'Category Envelope', 'Funded (AED)', 'Used (AED)', 'Available (AED)', 'Performance']],
            body: tableRows,
            theme: 'striped',
            headStyles: {
                fillColor: [15, 23, 42],
                textColor: [255, 255, 255],
                fontSize: 8,
                fontStyle: 'bold',
                halign: 'left'
            },
            bodyStyles: {
                fontSize: 8,
                textColor: [51, 65, 85]
            },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 26 },
                1: { fontStyle: 'bold', cellWidth: 44 },
                2: { halign: 'right', cellWidth: 26 },
                3: { halign: 'right', cellWidth: 26 },
                4: { halign: 'right', cellWidth: 28 },
                5: { fontStyle: 'bold', halign: 'center', cellWidth: 32 }
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252]
            },
            margin: { left: 14, right: 14 }
        });

        // 4. ACTIONABLE WEALTH ADVISORY BOX
        const finalY = doc.lastAutoTable.finalY + 8;
        if (finalY < 265) {
            doc.setFillColor(241, 245, 249); // slate-100
            doc.setDrawColor(203, 213, 225);
            doc.roundedRect(14, finalY, 182, 18, 2, 2, 'FD');

            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            doc.setTextColor(30, 41, 59);
            doc.text("Executive Sweep Recommendation:", 18, finalY + 6);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            doc.setTextColor(71, 85, 105);
            const advisory = `You have AED ${totalSurplus.toFixed(2)} in surplus cash from this cycle. Sweeping this entire amount into your high-yield UAE Vault (RUYA SAVE) or Wealth Growth assets (SARWA / Mutual Funds) ensures zero cash leakage.`;
            doc.text(doc.splitTextToSize(advisory, 174), 18, finalY + 11);
        }

        // 5. FOOTER
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7);
            doc.setTextColor(148, 163, 184);
            doc.text(`FINZ Intelligent Wealth Platform - Generated on ${new Date().toLocaleString()}`, 14, 290);
            doc.text(`Page ${i} of ${pageCount}`, 196, 290, { align: 'right' });
        }

        doc.save(`FINZ_Budget_Report_${FinzCore.localDateKey(end)}.pdf`);
        actions.showToast("Executive PDF Report Generated!", "success");
    } catch (err) {
        console.error("PDF generation failed", err);
        actions.showToast("Failed to generate PDF. Check console.", "error");
    }
};

actions.showCategoryDetails = function(cat) {
    const el = state.data.envelopeLedger || [];
    const firstCredit = el.find(item => item.type === 'credit');
    let envelopeStartDate = null;
    if (state.data.settings?.lastSalaryDate) {
        envelopeStartDate = new Date(state.data.settings.lastSalaryDate);
    } else if (firstCredit) {
        envelopeStartDate = new Date(firstCredit.date);
    }
    const startBoundary = envelopeStartDate ? new Date(envelopeStartDate) : null;
    if (startBoundary) startBoundary.setHours(0, 0, 0, 0);

    const txs = state.data.transactions.filter(t => {
        if (!((t.type === 'expense' || t.type === 'transfer_out') && t.category === cat && !t.excludeFromBudget)) return false;
        if (!startBoundary) return false;
        return new Date(t.date) >= startBoundary;
    }).sort((a,b) => new Date(b.date) - new Date(a.date));
                  
    const stats = actions.getEnvelopeStats().categories[cat] || { funded: 0, spent: 0, available: 0 };
    const envelopeHistory = (state.data.envelopeLedger || []).filter(e => e.category === cat)
                               .sort((a,b) => new Date(b.date) - new Date(a.date));

    let content = FinzUI.html`
        <div class="max-w-4xl mx-auto bg-slate-800/95 backdrop-blur-xl p-6 md:p-8 rounded-[2.5rem] border border-slate-700 shadow-2xl h-[85vh] flex flex-col fade-in">
            <div class="flex justify-between items-center mb-6">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-700/50 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all"><i data-lucide="arrow-left" class="w-5 h-5"></i></button>
                <h2 class="text-xl font-black text-white uppercase tracking-widest">${cat}</h2>
                <div class="w-10"></div>
            </div>
            
            <div class="bg-slate-900/90 border border-slate-700/80 rounded-[2rem] p-6 mb-4 text-center shadow-inner">
                <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Available Balance</p>
                <h3 class="text-3xl font-black ${stats.available < 0 ? 'text-rose-400' : 'text-emerald-400'} num-font mb-4">AED ${stats.available.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
                
                <div class="flex justify-between border-t border-slate-800 pt-4 px-2">
                    <div>
                        <p class="text-[9px] font-bold text-slate-400 uppercase">Funded</p>
                        <p class="text-sm font-black text-slate-200 num-font">AED ${stats.funded.toLocaleString()}</p>
                    </div>
                    <div>
                        <p class="text-[9px] font-bold text-slate-400 uppercase">Spent</p>
                        <p class="text-sm font-black text-slate-200 num-font">AED ${stats.spent.toLocaleString()}</p>
                    </div>
                </div>
            </div>

            <!-- Quick Action Toolbar -->
            <div class="flex flex-wrap gap-2 mb-6 justify-center">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.openEditCategoryBudget(((cat))) })}" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs uppercase px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all">
                    <i data-lucide="edit-3" class="w-4 h-4"></i> Edit Budget / Reallocate
                </button>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.openBudgetTransferModal(((cat))) })}" class="bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs uppercase px-4 py-2.5 rounded-xl border border-slate-700 flex items-center gap-2 transition-all">
                    <i data-lucide="arrow-right-left" class="w-4 h-4 text-sky-400"></i> Move Funds
                </button>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.promptFundCategory(((cat))) })}" class="bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs uppercase px-4 py-2.5 rounded-xl border border-slate-700 flex items-center gap-2 transition-all">
                    <i data-lucide="plus" class="w-4 h-4 text-emerald-400"></i> Add Funds
                </button>
            </div>
            
            <div class="flex-1 overflow-auto pr-2 space-y-6 custom-scrollbar">
                <!-- Envelope Allocation History -->
                ${envelopeHistory.length > 0 ? FinzUI.html`
                    <div>
                        <div class="flex justify-between items-center mb-3 px-1">
                            <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                                <i data-lucide="layers" class="w-3.5 h-3.5 text-indigo-400"></i> Envelope Allocations (${envelopeHistory.length})
                            </h4>
                            <span class="text-[9px] font-bold text-slate-500">Delete mistakes to restore cash</span>
                        </div>
                        <div class="space-y-2">
                            ${envelopeHistory.map(e => FinzUI.html`
                                <div class="flex justify-between items-center p-3 bg-slate-900/80 rounded-2xl border border-slate-700/60 text-xs">
                                    <div class="flex items-center gap-2.5">
                                        <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${e.type === 'fund' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}">
                                            ${e.type === 'fund' ? '+ Funded' : '- Defunded'}
                                        </span>
                                        <span class="font-black text-white num-font">AED ${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        <span class="text-[10px] text-slate-400 font-bold">${new Date(e.date).toLocaleDateString()}</span>
                                    </div>
                                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteEnvelopeLedgerEntry(((e.id)), ((cat))) })}" title="Delete this entry (reverses this allocation)" class="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all">
                                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <!-- Activity Log (Expenses / Spending) -->
                <div>
                    <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3 px-1 flex items-center gap-2">
                        <i data-lucide="history" class="w-3.5 h-3.5"></i> Activity Log (${txs.length})
                    </h4>
                    <div class="space-y-3">
                        ${txs.length === 0 ? FinzUI.literal('<p class="text-xs font-bold text-slate-500 text-center py-6 bg-slate-900/40 rounded-2xl">No transaction activity yet for this category.</p>') : txs.map(t => {
                            const acc = state.data.accounts.find(a => a.id === t.accountId);
                            const cur = t.currency || (acc ? acc.currency : 'AED');
                            const baseAmt = actions.getTransactionBaseAmount(t);
                            const isNonBase = cur !== 'AED';
                            return FinzUI.html`
                                <div class="flex justify-between items-center p-4 bg-slate-900/60 rounded-2xl border border-slate-700/70 shadow-sm hover:border-slate-600 transition-all">
                                    <div class="text-left">
                                        <p class="text-xs font-black text-white">${t.note || 'Expense'}</p>
                                        <p class="text-[9px] font-bold text-slate-400 uppercase mt-1">${new Date(t.date).toLocaleDateString()} • ${acc ? acc.name : ''}${isNonBase ? ` • Native: ${cur} ${Number(t.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : ''}</p>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-sm font-black text-rose-400 num-font">- AED ${baseAmt.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    FinzUI.setHTML(document.getElementById('modal-content'), content);
    lucide.createIcons();
};

actions.renderGuiltFreeModal = function() {
    const c = document.getElementById('modal-content');
    const r = state.data.settings?.rate || 22.75;
    
    // 1. Get Liquid Assets (Cash & Bank)
    const liquidAccounts = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type));
    const liquidTotalAED = liquidAccounts.reduce((s, a) => s + (a.currency === 'AED' ? a.balance : a.balance / r), 0);
    
    // 2. Get Comprehensive Envelope & Budget Allocations
    const stats = (typeof actions.getEnvelopeStats === 'function') ? actions.getEnvelopeStats() : { totalFunded: 0, totalDefunded: 0, categories: {} };
    
    const plannedEnvelopes = [];
    let totalBudgetsAED = 0;
    
    const allCats = (typeof actions.getAllBudgetCategories === 'function') ? actions.getAllBudgetCategories() : (state.data.expenseCategories || []);
    
    if (stats && stats.categories) {
        allCats.forEach(cat => {
            const cStat = stats.categories[cat];
            if (cStat && (cStat.funded > 0 || cStat.spent > 0)) {
                const pillar = (typeof actions.getCategoryPillar === 'function') ? actions.getCategoryPillar(cat) : 'expense';
                plannedEnvelopes.push({
                    name: cat,
                    pillar: pillar,
                    allocated: cStat.funded,
                    spent: cStat.spent,
                    available: cStat.available
                });
                totalBudgetsAED += cStat.funded;
            }
        });
    }

    // If envelope ledger had no funded entries, check budget template or budgets
    if (plannedEnvelopes.length === 0) {
        const sourceBudgets = (state.data.budgetTemplate && Object.keys(state.data.budgetTemplate).length > 0)
            ? state.data.budgetTemplate
            : (state.data.budgets || {});

        Object.keys(sourceBudgets).forEach(cat => {
            const val = parseFloat(sourceBudgets[cat]) || 0;
            if (val > 0) {
                const pillar = (typeof actions.getCategoryPillar === 'function') ? actions.getCategoryPillar(cat) : 'expense';
                plannedEnvelopes.push({
                    name: cat,
                    pillar: pillar,
                    allocated: val,
                    spent: 0,
                    available: val
                });
                totalBudgetsAED += val;
            }
        });
    }

    const guiltFree = liquidTotalAED - totalBudgetsAED;
    const isNegative = guiltFree < 0;

    // Helper for pillar badges
    const getPillarBadge = (p) => {
        if (p === 'savings') return FinzUI.html`<span class="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1"><i data-lucide="shield" class="w-3 h-3"></i> Savings</span>`;
        if (p === 'investment') return FinzUI.html`<span class="text-[9px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20 flex items-center gap-1"><i data-lucide="trending-up" class="w-3 h-3"></i> Invest</span>`;
        return FinzUI.html`<span class="text-[9px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20 flex items-center gap-1"><i data-lucide="shopping-bag" class="w-3 h-3"></i> Living</span>`;
    };

    let html = FinzUI.html`
        <div class="max-w-4xl mx-auto space-y-6 fade-in text-left pb-16">
            
            <!-- Hero Card: Available Guilt-Free Amount -->
            <div class="bg-gradient-to-br from-rose-500/20 via-slate-800 to-slate-900 border-2 border-rose-500/30 rounded-[2.5rem] p-8 text-center shadow-2xl backdrop-blur-md relative overflow-hidden">
                <div class="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
                    <i data-lucide="sparkles" class="w-48 h-48 text-rose-400"></i>
                </div>
                
                <h2 class="text-xs font-black text-rose-400 uppercase tracking-widest mb-2">Available Guilt-Free Amount</h2>
                <p class="text-5xl md:text-6xl font-black ${isNegative ? 'text-rose-400' : 'text-white'} tracking-tight num-font mb-4">
                    ${isNegative ? '0.00 AED' : actions.fmtMoney(guiltFree, 'AED')}
                </p>
                <p class="text-sm font-bold text-slate-300 max-w-md mx-auto">
                    This is money in your liquid accounts (Cash/Bank) that is <span class="text-rose-400 font-extrabold">not assigned</span> to any monthly envelope. Spend it however you like!
                </p>
                ${isNegative ? FinzUI.html`
                    <div class="mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl max-w-md mx-auto text-left flex items-center gap-3">
                        <i data-lucide="alert-triangle" class="w-5 h-5 text-rose-400 shrink-0"></i>
                        <p class="text-xs font-bold text-rose-300">
                            <b>Underfunded by ${actions.fmtMoney(Math.abs(guiltFree), 'AED')}:</b> Your current liquid cash cannot cover all planned envelopes.
                        </p>
                    </div>
                ` : ''}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- 1. Liquid Accounts Breakdown -->
                <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg flex flex-col justify-between">
                    <div>
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <i data-lucide="wallet" class="w-4 h-4 text-rose-400"></i> Liquid Accounts (${liquidAccounts.length})
                            </h3>
                            <span class="text-[9px] font-bold text-slate-500">Cash & Bank</span>
                        </div>
                        <div class="space-y-3">
                            ${liquidAccounts.map(a => FinzUI.html`
                                <div class="flex justify-between items-center border-b border-slate-700/50 pb-2.5">
                                    <div>
                                        <p class="text-xs font-black text-white">${a.name}</p>
                                        <p class="text-[9px] font-bold text-slate-400">${a.type} • ${a.currency}</p>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-xs font-black text-slate-200 num-font">${actions.fmtMoney(a.balance, a.currency)}</p>
                                        ${a.currency !== 'AED' ? FinzUI.html`<p class="text-[9px] font-bold text-slate-400">≈ ${actions.fmtMoney(a.balance / r, 'AED')}</p>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="flex justify-between items-center pt-4 border-t border-slate-700 mt-4">
                        <p class="text-xs font-black text-slate-300 uppercase">Total Liquid Cash</p>
                        <p class="text-base font-black text-emerald-400 num-font">${actions.fmtMoney(liquidTotalAED, 'AED')}</p>
                    </div>
                </div>

                <!-- 2. Planned Envelopes Breakdown -->
                <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg flex flex-col justify-between">
                    <div>
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <i data-lucide="layers" class="w-4 h-4 text-rose-400"></i> Planned Envelopes (${plannedEnvelopes.length})
                            </h3>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('budget') })}" class="text-[9px] font-bold text-rose-400 hover:text-rose-300 uppercase tracking-wider flex items-center gap-1">
                                <i data-lucide="edit-3" class="w-3 h-3"></i> Edit Budget
                            </button>
                        </div>
                        <div class="space-y-3 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                            ${plannedEnvelopes.length > 0 ? plannedEnvelopes.map(e => FinzUI.html`
                                <div class="flex justify-between items-center border-b border-slate-700/50 pb-2.5">
                                    <div class="space-y-0.5">
                                        <p class="text-xs font-black text-white">${e.name}</p>
                                        <div>${getPillarBadge(e.pillar)}</div>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-xs font-black text-slate-200 num-font">AED ${e.allocated.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                                        ${e.spent > 0 ? FinzUI.html`<p class="text-[9px] font-bold text-rose-400">Spent: AED ${e.spent.toLocaleString()}</p>` : ''}
                                    </div>
                                </div>
                            `).join('') : FinzUI.html`
                                <div class="text-center py-8">
                                    <p class="text-xs font-bold text-slate-400 mb-2">No envelopes planned yet.</p>
                                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('budget') })}" class="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-black uppercase tracking-wider transition-all">
                                        Set Up Envelopes
                                    </button>
                                </div>
                            `}
                        </div>
                    </div>
                    <div class="flex justify-between items-center pt-4 border-t border-slate-700 mt-4">
                        <p class="text-xs font-black text-slate-300 uppercase">Total Envelopes</p>
                        <p class="text-base font-black text-rose-400 num-font">${actions.fmtMoney(totalBudgetsAED, 'AED')}</p>
                    </div>
                </div>
            </div>

            <!-- Quick Action Footer -->
            <div class="pt-2">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('budget') })}" class="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg">
                    <i data-lucide="layers" class="w-4 h-4 text-emerald-400"></i> Open Monthly Budgeting Hub
                </button>
            </div>
        </div>
    `;

    FinzUI.setHTML(c, html);
    lucide.createIcons();
};

actions.renderStreakDetailsModal = function() {
    const c = document.getElementById('modal-content');
    
    // 1. Calculate the streak logic
    let currentStreak = actions.getNoSpendStreak();
    
    // Find all 'expense' transactions
    const txs = state.data.transactions.filter(t => t.type === 'expense').sort((a,b) => new Date(b.date) - new Date(a.date));
    
    let longestStreak = 0;
    let tempStreak = 0;
    let lastBrokenDate = null;
    
    const spendDays = {};
    txs.forEach(t => {
        const dStr = FinzCore.localDateKey(t.date);
        if (!dStr) return;
        if (!spendDays[dStr]) spendDays[dStr] = 0;
        spendDays[dStr] += actions.getTransactionBaseAmount(t);
    });

    if (txs.length > 0) {
        let firstTxDate = new Date(txs[txs.length-1].date);
        let now = new Date();
        
        let curr = new Date(firstTxDate);
        while (curr <= now) {
            const dStr = FinzCore.localDateKey(curr);
            if (spendDays[dStr]) {
                lastBrokenDate = dStr;
                tempStreak = 0;
            } else {
                tempStreak++;
                if (tempStreak > longestStreak) longestStreak = tempStreak;
            }
            curr.setDate(curr.getDate() + 1);
        }
    }

    const last14Days = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dStr = FinzCore.localDateKey(d);
        last14Days.push({
            dateStr: dStr,
            display: d.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'}),
            spent: spendDays[dStr] || 0
        });
    }

    let html = FinzUI.html`
    <div class="max-w-xl mx-auto space-y-6 fade-in text-left pb-16">
        
        <!-- CURRENT STREAK HERO CARD -->
        <div class="bg-gradient-to-br from-amber-500/20 via-slate-800/90 to-slate-900 border-2 border-amber-500/30 rounded-[2.5rem] p-8 text-center relative overflow-hidden shadow-2xl backdrop-blur-md">
            <div class="absolute -right-6 -bottom-6 w-40 h-40 text-amber-500/10 pointer-events-none">
                <i data-lucide="flame" class="w-full h-full"></i>
            </div>
            <div class="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 border border-amber-500/30 rounded-full mb-4">
                <i data-lucide="flame" class="w-3.5 h-3.5 text-amber-400"></i>
                <span class="text-[10px] font-black text-amber-300 uppercase tracking-widest">Current Streak</span>
            </div>
            <p class="text-6xl font-black text-white tracking-tight num-font mb-3">
                ${currentStreak} <span class="text-2xl text-amber-400 font-bold">Days</span>
            </p>
            <p class="text-xs font-bold text-slate-300 max-w-sm mx-auto">You haven't spent any money for ${currentStreak} consecutive days!</p>
        </div>

        <!-- STATS GRID -->
        <div class="grid grid-cols-2 gap-4">
            <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 text-center shadow-lg hover:border-slate-600 transition-all">
                <div class="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-2 border border-indigo-500/30">
                    <i data-lucide="trophy" class="w-4 h-4"></i>
                </div>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Longest Streak</p>
                <p class="text-2xl font-black text-white num-font">${longestStreak} Days</p>
            </div>
            <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 text-center shadow-lg hover:border-slate-600 transition-all">
                <div class="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-2 border border-rose-500/30">
                    <i data-lucide="calendar-x" class="w-4 h-4"></i>
                </div>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Last Broken</p>
                <p class="text-base font-black text-rose-400 num-font mt-1">${lastBrokenDate ? new Date(lastBrokenDate).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'Never'}</p>
            </div>
        </div>

        <!-- 14 DAYS ACTIVITY -->
        <div class="bg-slate-800/60 rounded-[2.5rem] p-6 border border-slate-700/80 shadow-xl space-y-4">
            <div class="flex items-center justify-between px-2">
                <h3 class="text-xs font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
                    <i data-lucide="history" class="w-4 h-4 text-rose-400"></i> Last 14 Days Activity
                </h3>
                <span class="text-[10px] font-bold text-slate-500 uppercase">Daily Record</span>
            </div>
            
            <div class="space-y-2.5">
                ${last14Days.map(day => {
                    const isSpend = day.spent > 0;
                    return FinzUI.html`
                    <div class="flex justify-between items-center p-4 rounded-2xl border ${isSpend ? 'bg-rose-500/10 border-rose-500/30 hover:border-rose-500/60' : 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/60'} transition-all shadow-sm">
                        <div class="flex items-center gap-3.5">
                            <div class="w-9 h-9 rounded-xl ${isSpend ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'} flex items-center justify-center shrink-0">
                                <i data-lucide="${isSpend ? 'trending-down' : 'check'}" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <p class="text-sm font-black text-white">${day.display}</p>
                                <p class="text-[10px] font-bold uppercase tracking-wider ${isSpend ? 'text-rose-400' : 'text-emerald-400'}">${isSpend ? 'Streak Broken' : 'No Spend Day'}</p>
                            </div>
                        </div>
                        <div class="text-right">
                            <span class="font-black text-lg ${isSpend ? 'text-rose-400' : 'text-emerald-400'} num-font">${isSpend ? '- ' + actions.fmtMoney(day.spent, 'AED') : '0.00 AED'}</span>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
        
    </div>`;
    
    FinzUI.setHTML(c, html);
    lucide.createIcons();
};

actions.renderBudgetUIOverride = function () {
    const stats = actions.getEnvelopeStats();
    let content = '';

    const hasUnallocated = stats.unallocatedCash > 0.01;
    const totalAllocated = stats.totalFunded - stats.totalDefunded;
    const expFunded = stats.pillars.expense.funded;
    const savFunded = stats.pillars.savings.funded;
    const invFunded = stats.pillars.investment.funded;

    const expPct = totalAllocated > 0 ? Math.round((expFunded / totalAllocated) * 100) : 0;
    const savPct = totalAllocated > 0 ? Math.round((savFunded / totalAllocated) * 100) : 0;
    const invPct = totalAllocated > 0 ? Math.max(0, 100 - expPct - savPct) : 0;

    // Wealth Accumulation Rate (Savings + Investments)
    const wealthAllocated = savFunded + invFunded;
    const wealthRate = totalAllocated > 0 ? Math.round((wealthAllocated / totalAllocated) * 100) : 0;

    const hasTemplate = !!state.data?.budgetTemplate && Object.keys(state.data.budgetTemplate).length > 0;
    const templateSum = hasTemplate ? Object.values(state.data.budgetTemplate).reduce((s, v) => s + v, 0) : 0;

    // Detect orphaned/inactive envelopes that still hold funds in the ledger
    const allRegisteredCats = actions.getAllBudgetCategories();
    const orphanEnvelopes = [];
    Object.keys(stats.categories).forEach(cat => {
        if (!allRegisteredCats.includes(cat) && Math.abs(stats.categories[cat].funded) > 0.005) {
            orphanEnvelopes.push({
                name: cat,
                funded: stats.categories[cat].funded,
                spent: stats.categories[cat].spent,
                available: stats.categories[cat].available
            });
        }
    });

    // Update modal title to be clean
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) modalTitle.innerText = 'Monthly Budgeting Hub';

    content += FinzUI.html`
        <div class="max-w-7xl mx-auto space-y-8 pb-24 fade-in text-left">
            <!-- 1. FULL-WIDTH HERO DASHBOARD -->
            <div class="bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-700/80 shadow-2xl text-white relative overflow-hidden">
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    <!-- Left: Unallocated Balance & Quick Smart Tools -->
                    <div class="lg:col-span-5 text-center lg:text-left">
                        <div class="flex items-center gap-2 justify-center lg:justify-start">
                            <span class="text-[9px] font-black uppercase text-emerald-400 tracking-widest bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">Monthly Salary Allocation</span>
                            <span class="text-[9px] font-black uppercase ${wealthRate >= 40 ? 'text-emerald-300 bg-emerald-400/20 border-emerald-400/30' : 'text-indigo-300 bg-indigo-500/20 border-indigo-500/30'} px-2.5 py-1 rounded-full border">
                                🔥 ${wealthRate}% Wealth Rate
                            </span>
                        </div>
                        
                        <h2 class="text-4xl md:text-5xl font-black ${hasUnallocated ? 'text-emerald-400' : 'text-white'} num-font mt-2">AED ${stats.unallocatedCash.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h2>
                        <p class="text-xs font-bold text-slate-400 mt-1">Unallocated cash remaining from current paycheck</p>
                        
                        <div class="flex flex-wrap items-center gap-2 mt-2 justify-center lg:justify-start">
                            <span class="text-xs text-slate-400 font-bold">Cycle Income: <span class="text-white num-font font-black">AED ${stats.totalCredit.toLocaleString()}</span></span>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openAdjustBudgetCredit() })}" title="Adjust starting paycheck income or fix balance mismatch" class="text-emerald-400 hover:text-emerald-300 text-[11px] font-black uppercase tracking-wider flex items-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-0.5 rounded-lg border border-emerald-500/30 transition-all">
                                <i data-lucide="edit-2" class="w-3 h-3"></i> Adjust Income
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openReconcileBudgetModal() })}" title="Compare budget allocations with real liquid bank balance" class="text-sky-400 hover:text-sky-300 text-[11px] font-black uppercase tracking-wider flex items-center gap-1 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-0.5 rounded-lg border border-sky-500/30 transition-all">
                                <i data-lucide="scale" class="w-3 h-3"></i> Reconcile Bank
                            </button>
                        </div>
                        
                        <div class="flex flex-wrap gap-2.5 mt-5 justify-center lg:justify-start">
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('salary') })}" title="Record incoming paycheck and restart the budget cycle" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20">
                                <i data-lucide="coins" class="w-4 h-4 text-slate-950"></i> Process Salary Day
                            </button>
                            ${hasTemplate && hasUnallocated ? FinzUI.html`
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.applyBudgetTemplate() })}" class="bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/40 px-3.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2">
                                    <i data-lucide="zap" class="w-4 h-4"></i> Apply Template (AED ${templateSum.toLocaleString()})
                                </button>
                            ` : ''}
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openBulkBudgetEditor() })}" title="Edit and adjust all envelope budgets on one screen" class="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-3.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md">
                                <i data-lucide="sliders" class="w-4 h-4 text-emerald-400"></i> Edit All Allocations
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openBudgetTransferModal() })}" title="Transfer funds between envelopes or unallocated cash" class="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 px-3.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md">
                                <i data-lucide="arrow-right-left" class="w-4 h-4 text-sky-400"></i> Transfer Between Envelopes
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openAdjustBudgetCredit() })}" title="Adjust the starting paycheck income of this budget cycle" class="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5">
                                <i data-lucide="sliders-horizontal" class="w-4 h-4 text-emerald-400"></i> Adjust Income
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openReconcileBudgetModal() })}" title="Compare envelope allocations with real bank account balances" class="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5">
                                <i data-lucide="scale" class="w-4 h-4 text-indigo-400"></i> Reconcile Bank
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveBudgetAsTemplate() })}" title="Save current envelope plan as default monthly template" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 border border-slate-700">
                                <i data-lucide="bookmark" class="w-4 h-4 text-emerald-400"></i> ${hasTemplate ? 'Update Template' : 'Save as Template'}
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openCategoryManager(() => actions.renderBudgetUIOverride()) })}" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 border border-slate-700">
                                <i data-lucide="settings" class="w-4 h-4"></i> Manage Categories
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.viewBudgetReports() })}" class="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5">
                                <i data-lucide="file-text" class="w-4 h-4"></i> Past Reports & PDF
                            </button>
                        </div>
                    </div>

                    <!-- Right: 3-Pillar Visual Bar & Stats -->
                    <div class="lg:col-span-7 bg-slate-900/90 p-6 rounded-3xl border border-slate-700/60 shadow-inner">
                        <div class="flex justify-between items-center text-xs font-black uppercase tracking-wider mb-3">
                            <span class="text-rose-400 flex items-center gap-1.5"><i data-lucide="shopping-bag" class="w-3.5 h-3.5"></i> Living (${expPct}%)</span>
                            <span class="text-emerald-400 flex items-center gap-1.5"><i data-lucide="shield" class="w-3.5 h-3.5"></i> Savings (${savPct}%)</span>
                            <span class="text-indigo-400 flex items-center gap-1.5"><i data-lucide="trending-up" class="w-3.5 h-3.5"></i> Invest (${invPct}%)</span>
                        </div>
                        
                        <div class="w-full bg-slate-800 rounded-full h-3.5 flex overflow-hidden p-0.5 gap-0.5 border border-slate-700/60 shadow-inner">
                            <div class="bg-rose-500 h-full rounded-l-full transition-all duration-500" style="width: ${expPct}%"></div>
                            <div class="bg-emerald-500 h-full transition-all duration-500" style="width: ${savPct}%"></div>
                            <div class="bg-indigo-500 h-full rounded-r-full transition-all duration-500" style="width: ${invPct}%"></div>
                        </div>

                        <div class="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-800 text-center">
                            <div class="bg-slate-800/60 p-3 rounded-2xl border border-rose-500/20">
                                <p class="text-[9px] font-bold text-slate-400 uppercase">Living Allocated</p>
                                <p class="text-sm font-black text-rose-400 num-font mt-0.5">AED ${expFunded.toLocaleString()}</p>
                            </div>
                            <div class="bg-slate-800/60 p-3 rounded-2xl border border-emerald-500/20">
                                <p class="text-[9px] font-bold text-slate-400 uppercase">Savings Allocated</p>
                                <p class="text-sm font-black text-emerald-400 num-font mt-0.5">AED ${savFunded.toLocaleString()}</p>
                            </div>
                            <div class="bg-slate-800/60 p-3 rounded-2xl border border-indigo-500/20">
                                <p class="text-[9px] font-bold text-slate-400 uppercase">Invest Allocated</p>
                                <p class="text-sm font-black text-indigo-400 num-font mt-0.5">AED ${invFunded.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- INACTIVE / DELETED ENVELOPE RECOVERY BANNER -->
            ${orphanEnvelopes.length > 0 ? FinzUI.html`
                <div class="bg-amber-500/10 border border-amber-500/30 p-5 rounded-3xl text-left space-y-3 shadow-lg shadow-amber-500/5">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                                <i data-lucide="alert-triangle" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <h4 class="text-sm font-black text-white uppercase tracking-wider">Deleted / Inactive Envelopes with Funds Detected</h4>
                                <p class="text-xs text-amber-200/90 font-medium">An envelope category was deleted, but still has allocations tied to it in the ledger. You can restore the envelope or release its money back to Unallocated Cash.</p>
                            </div>
                        </div>
                        <span class="text-xs font-black text-amber-300 bg-amber-500/20 px-3 py-1 rounded-full border border-amber-500/30 shrink-0">${orphanEnvelopes.length} Detected</span>
                    </div>

                    <div class="space-y-2 pt-1">
                        ${orphanEnvelopes.map(o => FinzUI.html`
                            <div class="flex flex-wrap items-center justify-between p-3.5 bg-slate-900/80 rounded-2xl border border-slate-700/60 text-xs gap-3">
                                <div class="flex items-center gap-3">
                                    <span class="font-black text-white uppercase text-sm">${o.name}</span>
                                    <span class="text-slate-400 font-bold">Allocated: <span class="text-amber-400 num-font font-black">AED ${o.funded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                                    ${o.spent > 0 ? FinzUI.html`<span class="text-slate-400 font-bold">• Spent: <span class="text-slate-300 num-font font-bold">AED ${o.spent.toLocaleString()}</span></span>` : ''}
                                </div>
                                <div class="flex items-center gap-2">
                                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.restoreDeletedCategory(((o.name))) })}" class="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl transition-all flex items-center gap-1.5 shadow-sm">
                                        <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Restore Envelope
                                    </button>
                                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.cleanOrphanEnvelopeFunds(((o.name))) })}" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold rounded-xl border border-slate-700 transition-all flex items-center gap-1.5">
                                        <i data-lucide="arrow-down-circle" class="w-3.5 h-3.5 text-amber-400"></i> Release Funds
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
    `;

    // 1. Render Living Expense Card (Spacious Grid Box with Cover Shortfall Button)
    const renderExpenseCard = (cat) => {
        const cStats = stats.categories[cat] || { funded: 0, spent: 0, available: 0 };
        const isOver = cStats.available < 0;
        const overAmount = Math.abs(cStats.available);
        const pct = cStats.funded > 0 ? Math.min(100, (cStats.spent / cStats.funded) * 100) : (cStats.spent > 0 ? 100 : 0);
        const realPct = cStats.funded > 0 ? Math.round((cStats.spent / cStats.funded) * 100) : 0;
        
        let barColor = 'bg-emerald-500';
        let statusBadge = FinzUI.html`<span class="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">${realPct}% Spent</span>`;
        
        if (realPct >= 85 && !isOver) {
            barColor = 'bg-amber-500';
            statusBadge = FinzUI.html`<span class="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">${realPct}% Spent</span>`;
        }
        if (isOver) {
            barColor = 'bg-rose-500';
            statusBadge = FinzUI.html`<span class="text-[9px] font-black text-rose-300 bg-rose-500/20 px-2.5 py-0.5 rounded-full border border-rose-500/40 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3 text-rose-400"></i> Over by AED ${overAmount.toLocaleString()}</span>`;
        }
        
        return FinzUI.html`
            <div class="bg-slate-800/90 p-5 rounded-[2rem] border ${isOver ? 'border-rose-500/60' : 'border-slate-700/80'} shadow-lg hover:border-rose-500/50 hover:bg-slate-800 transition-all cursor-pointer flex flex-col justify-between" data-finz-click="${FinzUI.handler(function(event) { return actions.showCategoryDetails(((cat))) })}">
                <div>
                    <!-- Top Row: Category Title & Badge -->
                    <div class="flex justify-between items-start gap-2 mb-3">
                        <h4 class="text-xs font-black uppercase text-slate-100 tracking-wider truncate">${cat}</h4>
                        <div class="shrink-0">${statusBadge}</div>
                    </div>

                    <!-- Middle Row: Balance & Subtitle -->
                    <div class="mb-4">
                        <div class="flex items-baseline gap-2">
                            <span class="text-2xl font-black ${isOver ? 'text-rose-400' : 'text-white'} num-font">
                                AED ${cStats.available.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </span>
                            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">${isOver ? 'Deficit' : 'Available'}</span>
                        </div>
                        ${isOver ? FinzUI.html`
                            <div class="flex items-center justify-between mt-2 pt-2 border-t border-rose-500/20" data-finz-click="${FinzUI.handler(function(event) { return event.stopPropagation() })}">
                                <p class="text-[9px] font-bold text-rose-400">Exceeded by AED ${overAmount.toLocaleString()}</p>
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.openCoverOverspending(((cat)), (overAmount)) })}" class="bg-rose-500 hover:bg-rose-600 text-white text-[9px] font-black uppercase px-2.5 py-1 rounded-lg transition-all shadow-md">
                                    Cover Shortfall
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div>
                    <!-- Bottom Row: Chips + Edit & Add Buttons -->
                    <div class="flex justify-between items-center pt-3 border-t border-slate-700/50">
                        <div class="text-[9px] font-bold text-slate-400 space-y-0.5 cursor-pointer hover:text-white transition-colors" data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.openEditCategoryBudget(((cat))) })}" title="Click to edit budget allocation">
                            <p>Funded: <span class="text-slate-200 font-black">AED ${cStats.funded.toLocaleString()}</span> <i data-lucide="edit-2" class="w-2.5 h-2.5 inline text-rose-400/80 ml-0.5"></i></p>
                            <p>Spent: <span class="${cStats.spent > 0 ? 'text-rose-400' : 'text-slate-300'} font-black">AED ${cStats.spent.toLocaleString()}</span></p>
                        </div>
                        
                        <div class="flex items-center gap-1.5 shrink-0" data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation() })}">
                            <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.openEditCategoryBudget(((cat))) })}" title="Edit Budget / Reallocate" class="bg-slate-700/80 hover:bg-slate-600 text-slate-200 hover:text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md">
                                <i data-lucide="edit-3" class="w-4 h-4"></i>
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.promptFundCategory(((cat))) })}" title="Assign / Add Funds" class="bg-rose-600 hover:bg-rose-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md shadow-rose-600/30 shrink-0">
                                <i data-lucide="plus" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Progress Bar -->
                    <div class="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-700/50 mt-3">
                        <div class="${barColor} h-full transition-all duration-500 rounded-full" style="width: ${pct}%"></div>
                    </div>
                </div>
            </div>
        `;
    };

    // 2. Render Savings / Sinking Fund Card
    const renderSavingsCard = (cat) => {
        const cStats = stats.categories[cat] || { funded: 0, spent: 0, available: 0 };
        const savedAmount = cStats.spent; // Transferred / moved to savings pot
        const isOverSaved = cStats.funded > 0 && savedAmount > cStats.funded;
        const extraSaved = savedAmount - cStats.funded;
        const realPct = cStats.funded > 0 ? Math.round((savedAmount / cStats.funded) * 100) : (savedAmount > 0 ? 100 : 0);
        const isExactlyComplete = cStats.funded > 0 && savedAmount === cStats.funded;
        
        let statusBadge = '';
        if (isOverSaved) {
            statusBadge = FinzUI.html`<span class="text-[9px] font-black bg-emerald-400 text-slate-950 px-2.5 py-0.5 rounded-full shadow-lg shadow-emerald-400/20 flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3 text-slate-950"></i> ${realPct}% (+AED ${extraSaved.toLocaleString()})</span>`;
        } else if (isExactlyComplete) {
            statusBadge = FinzUI.html`<span class="text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-0.5 rounded-full">✅ 100% Saved</span>`;
        } else {
            statusBadge = FinzUI.html`<span class="text-[9px] font-bold bg-slate-900 text-emerald-400 border border-slate-700 px-2.5 py-0.5 rounded-full">${realPct}% Deposited</span>`;
        }

        return FinzUI.html`
            <div class="bg-slate-800/90 p-5 rounded-[2rem] border ${isOverSaved ? 'border-emerald-400/60 shadow-emerald-500/10' : 'border-emerald-500/30'} shadow-lg hover:border-emerald-500/60 hover:bg-slate-800 transition-all cursor-pointer flex flex-col justify-between" data-finz-click="${FinzUI.handler(function(event) { return actions.showCategoryDetails(((cat))) })}">
                <div>
                    <!-- Top Row: Category Title & Badge -->
                    <div class="flex justify-between items-start gap-2 mb-3">
                        <h4 class="text-xs font-black uppercase text-emerald-300 tracking-wider truncate">${cat}</h4>
                        <div class="shrink-0">${statusBadge}</div>
                    </div>

                    <!-- Middle Row: Balance & Subtitle -->
                    <div class="mb-4">
                        <div class="flex items-baseline gap-2">
                            <span class="text-2xl font-black text-emerald-400 num-font">
                                AED ${savedAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </span>
                            <span class="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Saved / Moved</span>
                        </div>
                        ${isOverSaved ? FinzUI.html`
                            <p class="text-[10px] font-black text-emerald-300 mt-1 flex items-center gap-1">
                                <i data-lucide="trending-up" class="w-3.5 h-3.5 text-emerald-400"></i> +AED ${extraSaved.toLocaleString()} above target!
                            </p>
                        ` : FinzUI.html`
                            <p class="text-[9px] font-bold text-slate-400 mt-1">
                                ${cStats.available > 0 ? `AED ${cStats.available.toLocaleString()} ready to move to savings` : `Target allocated: AED ${cStats.funded.toLocaleString()}`}
                            </p>
                        `}
                    </div>
                </div>

                <div>
                    <!-- Bottom Row: Chips + Edit & Add Buttons -->
                    <div class="flex justify-between items-center pt-3 border-t border-slate-700/50">
                        <div class="text-[9px] font-bold text-slate-400 space-y-0.5 cursor-pointer hover:text-white transition-colors" data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.openEditCategoryBudget(((cat))) })}" title="Click to edit target allocation">
                            <p>Target: <span class="text-slate-200 font-black">AED ${cStats.funded.toLocaleString()}</span> <i data-lucide="edit-2" class="w-2.5 h-2.5 inline text-emerald-400/80 ml-0.5"></i></p>
                            <p>Moved: <span class="text-emerald-400 font-black">AED ${savedAmount.toLocaleString()}</span></p>
                        </div>
                        
                        <div class="flex items-center gap-1.5 shrink-0" data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation() })}">
                            <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.openEditCategoryBudget(((cat))) })}" title="Edit Target / Reallocate" class="bg-slate-700/80 hover:bg-slate-600 text-slate-200 hover:text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md">
                                <i data-lucide="edit-3" class="w-4 h-4"></i>
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.promptFundCategory(((cat))) })}" title="Assign / Add Funds" class="bg-emerald-600 hover:bg-emerald-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md shadow-emerald-600/30 shrink-0">
                                <i data-lucide="plus" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Progress Bar -->
                    <div class="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-700/50 mt-3 p-0.5">
                        <div class="bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 h-full transition-all duration-500 rounded-full" style="width: 100%"></div>
                    </div>
                </div>
            </div>
        `;
    };

    // 3. Render Investment Card
    const renderInvestmentCard = (cat) => {
        const cStats = stats.categories[cat] || { funded: 0, spent: 0, available: 0 };
        const investedAmount = cStats.spent; // Transferred / deployed into investments
        const isOverInvested = cStats.funded > 0 && investedAmount > cStats.funded;
        const extraInvested = investedAmount - cStats.funded;
        const realPct = cStats.funded > 0 ? Math.round((investedAmount / cStats.funded) * 100) : (investedAmount > 0 ? 100 : 0);
        const isExactlyComplete = cStats.funded > 0 && investedAmount === cStats.funded;
        
        let statusBadge = '';
        if (isOverInvested) {
            statusBadge = FinzUI.html`<span class="text-[9px] font-black bg-indigo-400 text-slate-950 px-2.5 py-0.5 rounded-full shadow-lg shadow-indigo-400/20 flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3 text-slate-950"></i> ${realPct}% (+AED ${extraInvested.toLocaleString()})</span>`;
        } else if (isExactlyComplete) {
            statusBadge = FinzUI.html`<span class="text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2.5 py-0.5 rounded-full">📈 100% Deployed</span>`;
        } else {
            statusBadge = FinzUI.html`<span class="text-[9px] font-bold bg-slate-900 text-indigo-400 border border-slate-700 px-2.5 py-0.5 rounded-full">${realPct}% Invested</span>`;
        }
        
        return FinzUI.html`
            <div class="bg-slate-800/90 p-5 rounded-[2rem] border ${isOverInvested ? 'border-indigo-400/60 shadow-indigo-500/10' : 'border-indigo-500/30'} shadow-lg hover:border-indigo-500/60 hover:bg-slate-800 transition-all cursor-pointer flex flex-col justify-between" data-finz-click="${FinzUI.handler(function(event) { return actions.showCategoryDetails(((cat))) })}">
                <div>
                    <!-- Top Row: Category Title & Badge -->
                    <div class="flex justify-between items-start gap-2 mb-3">
                        <h4 class="text-xs font-black uppercase text-indigo-300 tracking-wider truncate">${cat}</h4>
                        <div class="shrink-0">${statusBadge}</div>
                    </div>

                    <!-- Middle Row: Balance & Subtitle -->
                    <div class="mb-4">
                        <div class="flex items-baseline gap-2">
                            <span class="text-2xl font-black text-indigo-400 num-font">
                                AED ${investedAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </span>
                            <span class="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Capital Invested</span>
                        </div>
                        ${isOverInvested ? FinzUI.html`
                            <p class="text-[10px] font-black text-indigo-300 mt-1 flex items-center gap-1">
                                <i data-lucide="trending-up" class="w-3.5 h-3.5 text-indigo-400"></i> +AED ${extraInvested.toLocaleString()} extra deployed!
                            </p>
                        ` : FinzUI.html`
                            <p class="text-[9px] font-bold text-slate-400 mt-1">
                                ${cStats.available > 0 ? `AED ${cStats.available.toLocaleString()} ready to deploy` : `Total allocated: AED ${cStats.funded.toLocaleString()}`}
                            </p>
                        `}
                    </div>
                </div>

                <div>
                    <!-- Bottom Row: Chips + Edit & Add Buttons -->
                    <div class="flex justify-between items-center pt-3 border-t border-slate-700/50">
                        <div class="text-[9px] font-bold text-slate-400 space-y-0.5 cursor-pointer hover:text-white transition-colors" data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.openEditCategoryBudget(((cat))) })}" title="Click to edit target allocation">
                            <p>Target: <span class="text-slate-200 font-black">AED ${cStats.funded.toLocaleString()}</span> <i data-lucide="edit-2" class="w-2.5 h-2.5 inline text-indigo-400/80 ml-0.5"></i></p>
                            <p>Invested: <span class="text-indigo-400 font-black">AED ${investedAmount.toLocaleString()}</span></p>
                        </div>
                        
                        <div class="flex items-center gap-1.5 shrink-0" data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation() })}">
                            <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.openEditCategoryBudget(((cat))) })}" title="Edit Target / Reallocate" class="bg-slate-700/80 hover:bg-slate-600 text-slate-200 hover:text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md">
                                <i data-lucide="edit-3" class="w-4 h-4"></i>
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.promptFundCategory(((cat))) })}" title="Assign / Add Funds" class="bg-indigo-600 hover:bg-indigo-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-indigo-600/30 shrink-0">
                                <i data-lucide="plus" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Progress Bar -->
                    <div class="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-700/50 mt-3 p-0.5">
                        <div class="bg-gradient-to-r from-indigo-500 via-purple-400 to-indigo-300 h-full transition-all duration-500 rounded-full" style="width: 100%"></div>
                    </div>
                </div>
            </div>
        `;
    };

    const expenses = state.data.expenseCategories || [];
    const savings = state.data.savingsCategories || [];
    const investments = state.data.investmentCategories || [];

    // SECTION 1: 🛒 LIVING EXPENSES (SPACIOUS 3-4 COLUMN DESKTOP GRID)
    content += FinzUI.html`
        <div class="space-y-4">
            <div class="flex justify-between items-center px-2 pb-2 border-b border-rose-500/20">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                        <i data-lucide="shopping-bag" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <h3 class="text-sm font-black uppercase text-rose-400 tracking-wider">Living Expenses (Needs & Lifestyle)</h3>
                        <p class="text-[9px] font-bold text-slate-400">Monthly consumed necessities and lifestyle envelopes</p>
                    </div>
                </div>
                <span class="text-xs font-black bg-rose-500/10 text-rose-400 border border-rose-500/30 px-3 py-1 rounded-full">${expenses.length} Envelopes</span>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                ${expenses.map(cat => renderExpenseCard(cat)).join('') || FinzUI.literal("<p class=\"text-xs font-bold text-slate-500 text-center py-8 col-span-full bg-slate-800/40 rounded-2xl\">No living expense envelopes</p>")}
            </div>
        </div>
    `;

    // SECTION 2: 🛡️ SAVINGS & SINKING FUNDS (SPACIOUS 3-4 COLUMN DESKTOP GRID)
    content += FinzUI.html`
        <div class="space-y-4 pt-4">
            <div class="flex justify-between items-center px-2 pb-2 border-b border-emerald-500/20">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                        <i data-lucide="shield" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <h3 class="text-sm font-black uppercase text-emerald-400 tracking-wider">Savings & Sinking Funds (Future Goals)</h3>
                        <p class="text-[9px] font-bold text-slate-400">Wedding, Car, Vacation, and Long-Term Reserves</p>
                    </div>
                </div>
                <span class="text-xs font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full">${savings.length} Funds</span>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                ${savings.map(cat => renderSavingsCard(cat)).join('') || FinzUI.literal("<p class=\"text-xs font-bold text-slate-500 text-center py-8 col-span-full bg-slate-800/40 rounded-2xl\">No savings funds</p>")}
            </div>
        </div>
    `;

    // SECTION 3: 📈 INVESTMENTS & WEALTH GROWTH (SPACIOUS 3-4 COLUMN DESKTOP GRID)
    content += FinzUI.html`
        <div class="space-y-4 pt-4">
            <div class="flex justify-between items-center px-2 pb-2 border-b border-indigo-500/20">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                        <i data-lucide="trending-up" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <h3 class="text-sm font-black uppercase text-indigo-400 tracking-wider">Investments & Wealth Growth</h3>
                        <p class="text-[9px] font-bold text-slate-400">Mutual Funds, Sarwa, Gold, and Capital Assets</p>
                    </div>
                </div>
                <span class="text-xs font-black bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 px-3 py-1 rounded-full">${investments.length} Assets</span>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                ${investments.map(cat => renderInvestmentCard(cat)).join('') || FinzUI.literal("<p class=\"text-xs font-bold text-slate-500 text-center py-8 col-span-full bg-slate-800/40 rounded-2xl\">No investment envelopes</p>")}
            </div>
        </div>
    `;

    content += FinzUI.html`</div>`;
    
    const container = document.getElementById('modal-content');
    if (container) {
        FinzUI.setHTML(container, content);
        lucide.createIcons();
    }
};

actions.renderBudgetUI = function() {
    actions.renderBudgetUIOverride();
    return ""; 
};

actions.getNoSpendStreak = function() {
    const tx = state.data.transactions || [];
    const expenses = tx.filter(t => t.type === 'expense').map(t => new Date(t.date).toDateString());
    
    let currentStreak = 0;
    let checkDate = new Date();
    
    // Check up to 30 days back
    for (let i = 0; i < 30; i++) {
        const dStr = checkDate.toDateString();
        if (!expenses.includes(dStr)) {
            currentStreak++;
        } else {
            // Break streak if it's not today. If today has an expense, streak is 0.
            if (i === 0) currentStreak = 0;
            break;
        }
        checkDate.setDate(checkDate.getDate() - 1);
    }
    return currentStreak;
};

actions.getFinancialRunwayStats = function () {
    const r = state.data.settings?.rate || 22.75;
    const liquidAccs = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type));
    const liquidTotalAED = liquidAccs.reduce((sum, a) => sum + (a.currency === 'AED' ? Number(a.balance) : Number(a.balance) / r), 0);
    
    // Average monthly spending over the last 3 months of real history.
    // Transfers to your own savings/investments are not spending.
    const measuredBurn = FinzCore.monthlyBurn(state.data);
    const monthlyBurnAED = measuredBurn > 0 ? measuredBurn : (liquidTotalAED > 0 ? liquidTotalAED / 6 : 4500);
    const runwayMonths = monthlyBurnAED > 0 ? (liquidTotalAED / monthlyBurnAED).toFixed(1) : '∞';
    
    return {
        liquidTotalAED,
        monthlyBurnAED,
        runwayMonths: parseFloat(runwayMonths) || 0
    };
};

actions.getAllBudgetCategories = function() {
    const expenses = state.data?.expenseCategories || [];
    const savings = state.data?.savingsCategories || [];
    const investments = state.data?.investmentCategories || [];
    return [...expenses, ...savings, ...investments];
};

actions.getCategoryPillar = function(cat) {
    if ((state.data?.savingsCategories || []).includes(cat)) return 'savings';
    if ((state.data?.investmentCategories || []).includes(cat)) return 'investment';
    return 'expense';
};

actions.renderCategoryOptions = function (includeNone = false) {
    const exp = state.data?.expenseCategories || [];
    const sav = state.data?.savingsCategories || [];
    const inv = state.data?.investmentCategories || [];
    const stats = (typeof actions.getEnvelopeStats === 'function') ? actions.getEnvelopeStats() : null;

    const renderOpt = (c) => {
        const cStat = stats?.categories?.[c];
        const funded = cStat?.funded || 0;
        const legacyTarget = (state.data?.budgets && state.data.budgets[c]) || (state.data?.budgetTemplate && state.data.budgetTemplate[c]) || 0;
        const effectiveBudget = funded > 0 ? funded : legacyTarget;
        if (effectiveBudget > 0) {
            const avail = funded > 0 ? (cStat.available || 0) : (effectiveBudget - (cStat?.spent || 0));
            const availText = avail >= 0
                ? `AED ${avail.toLocaleString(undefined, { maximumFractionDigits: 0 })} left`
                : `AED ${Math.abs(avail).toLocaleString(undefined, { maximumFractionDigits: 0 })} over`;
            return FinzUI.html`<option value="${c}">${c} (${availText})</option>`;
        }
        return FinzUI.html`<option value="${c}">${c}</option>`;
    };
    
    let html = includeNone ? FinzUI.literal("<option value=\"\">-- None (Just a Transfer) --</option>") : '';
    if (exp.length > 0) {
        html += FinzUI.html`<optgroup label="🛒 Living Expenses">${exp.map(renderOpt).join('')}</optgroup>`;
    }
    if (sav.length > 0) {
        html += FinzUI.html`<optgroup label="🛡️ Savings & Sinking Funds">${sav.map(renderOpt).join('')}</optgroup>`;
    }
    if (inv.length > 0) {
        html += FinzUI.html`<optgroup label="📈 Investments">${inv.map(renderOpt).join('')}</optgroup>`;
    }
    return html;
};

actions.openCategoryManager = function(onBack = function(event) { actions.renderBudgetUIOverride() }) {
    actions.categoryManagerBackAction = onBack;
    const c = document.getElementById('modal-content');
    const t = document.getElementById('modal-title');
    const b = document.getElementById('modal-backdrop');
    if (b) b.classList.replace('hidden', 'flex');
    if (t) t.innerText = 'Manage 3-Pillar Categories';
    if (c) {
        FinzUI.setHTML(c, actions.render3PillarCategoryManager(actions.categoryManagerBackAction));
        if (libraries.lucide) libraries.lucide.createIcons();
    }
};

actions.refreshCategoryManager = function() {
    const c = document.getElementById('modal-content');
    const t = document.getElementById('modal-title');
    const currentTitle = t?.innerText || '';
    
    if (c) {
        if (currentTitle === 'Configuration Hub' || currentTitle === 'App Settings') {
            FinzUI.setHTML(c, actions.renderSettingsUI());
        } else {
            if (t) t.innerText = 'Manage 3-Pillar Categories';
            FinzUI.setHTML(c, actions.render3PillarCategoryManager(actions.categoryManagerBackAction || function(event) { actions.renderBudgetUIOverride() }));
        }
        if (libraries.lucide) libraries.lucide.createIcons();
    }
};

actions.deleteCategory = async function(cat) {
    if (!confirm(`Are you sure you want to delete "${cat}"?`)) return;
    
    const stats = (typeof actions.getEnvelopeStats === 'function') ? actions.getEnvelopeStats() : null;
    const catFunded = stats?.categories[cat]?.funded || 0;

    const keys = ['expenseCategories', 'savingsCategories', 'investmentCategories', 'incomeCategories'];
    keys.forEach(k => {
        if (state.data[k]) {
            state.data[k] = state.data[k].filter(c => c !== cat);
        }
    });

    // Auto-release active funds so they don't get trapped as orphaned entries in the envelope ledger
    if (catFunded > 0.005) {
        state.data.envelopeLedger = state.data.envelopeLedger || [];
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date: new Date().toISOString(),
            type: 'defund',
            category: cat,
            amount: catFunded,
            note: 'Auto-defund on category deletion'
        });
    }

    if (state.data.budgetTemplate && state.data.budgetTemplate[cat] !== undefined) {
        delete state.data.budgetTemplate[cat];
    }
    if (state.data.budgets && state.data.budgets[cat] !== undefined) {
        delete state.data.budgets[cat];
    }
    
    await actions.updateDb();
    actions.renderApp();
    actions.refreshCategoryManager();
    actions.showToast(`Deleted "${cat}"${catFunded > 0.005 ? ` and returned AED ${catFunded.toLocaleString()} to Unallocated Cash` : ''}`, "success");
};

actions.delWizardCategory = (cat) => actions.deleteCategory(cat);

actions.delCategory = (type, name) => actions.deleteCategory(name);

actions.setCategoryPillar = async function(cat, currentPillar, newPillar) {
    if (currentPillar === newPillar) return;
    
    const keyMap = {
        'expense': 'expenseCategories',
        'savings': 'savingsCategories',
        'investment': 'investmentCategories'
    };
    
    // Remove from all 3 pillars
    ['expenseCategories', 'savingsCategories', 'investmentCategories'].forEach(k => {
        if (state.data[k]) state.data[k] = state.data[k].filter(c => c !== cat);
    });
    
    // Add to target pillar
    const targetKey = keyMap[newPillar] || 'expenseCategories';
    if (!state.data[targetKey]) state.data[targetKey] = [];
    if (!state.data[targetKey].includes(cat)) {
        state.data[targetKey].push(cat);
    }
    
    await actions.updateDb();
    actions.renderApp();
    actions.refreshCategoryManager();
    actions.showToast(`Moved "${cat}" to ${newPillar.toUpperCase()}`, "success");
};

actions.addWizardCategory = async function () {
    const input = document.getElementById('wizard-new-cat') || document.getElementById('settings-new-cat');
    const typeSelect = document.getElementById('wizard-new-type') || document.getElementById('settings-new-type');
    const val = input?.value?.trim();
    if (!val) return;
    
    const type = typeSelect ? typeSelect.value : 'expenseCategories';
    if (!state.data[type]) state.data[type] = [];
    
    const allCats = actions.getAllBudgetCategories().map(c => c.toLowerCase()); // One pillar per category
    if (!allCats.includes(val.toLowerCase())) {
        state.data[type].push(val);
        await actions.updateDb();
        actions.renderApp();
        if (input) input.value = '';
        actions.refreshCategoryManager();
        actions.showToast(`Added "${val}"`, "success");
    } else {
        actions.showToast("Category already exists!", "error");
    }
};

actions.render3PillarCategoryManager = function(onBackAction = function(event) { actions.renderBudgetUIOverride() }) {
    actions.categoryManagerBackAction = onBackAction;
    
    const renderCatCard = (c, pillarType) => FinzUI.html`
        <div class="bg-slate-900/90 p-4 rounded-2xl border border-slate-700/70 hover:border-slate-500 transition-all flex items-center justify-between gap-4 group shadow-sm">
            <span class="font-black text-sm text-white min-w-0 flex-1 block overflow-hidden text-ellipsis whitespace-nowrap" title="${c}">${c}</span>
            <div class="flex items-center gap-2 shrink-0">
                <select data-finz-change="${FinzUI.handler(function(event) { return actions.setCategoryPillar(((c)), ((pillarType)), this.value) })}" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 rounded-xl px-3 py-2 font-bold outline-none cursor-pointer">
                    <option value="expense" ${pillarType === 'expense' ? 'selected' : ''}>🛒 Living</option>
                    <option value="savings" ${pillarType === 'savings' ? 'selected' : ''}>🛡️ Savings</option>
                    <option value="investment" ${pillarType === 'investment' ? 'selected' : ''}>📈 Invest</option>
                </select>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteCategory(((c))) })}" title="Delete Category" class="text-slate-400 hover:text-rose-400 p-2 rounded-xl hover:bg-rose-500/10 transition-all">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
    `;
    
    const expenses = state.data.expenseCategories || [];
    const savings = state.data.savingsCategories || [];
    const investments = state.data.investmentCategories || [];
    
    return FinzUI.html`
        <div class="text-slate-100 w-full max-w-7xl mx-auto bg-slate-900/95 backdrop-blur-2xl p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left flex flex-col max-h-[88vh] fade-in">
            <!-- Header -->
            <div class="flex justify-between items-center mb-6 shrink-0 border-b border-slate-800 pb-4">
                <div class="flex items-center gap-3">
                    <button data-finz-click="${FinzUI.handler(function(event) { return (onBackAction).call(this, event); })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-2xl text-slate-300 hover:text-white transition-all">
                        <i data-lucide="arrow-left" class="w-5 h-5"></i>
                    </button>
                    <div>
                        <h2 class="text-2xl font-black text-white">3-Pillar Category Architecture</h2>
                        <p class="text-xs font-bold text-slate-400">Configure your monthly budget pillars and envelopes</p>
                    </div>
                </div>
                <div class="hidden sm:flex items-center gap-2 text-xs font-bold">
                    <span class="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-3 py-1 rounded-full">${expenses.length} Living</span>
                    <span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full">${savings.length} Savings</span>
                    <span class="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-3 py-1 rounded-full">${investments.length} Invest</span>
                </div>
            </div>
            
            <!-- Quick Add Bar (Widescreen) -->
            <div class="bg-slate-800/80 p-5 rounded-2xl border border-slate-700/80 shrink-0 mb-6 shadow-md">
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">+ Add Category to Any Pillar</p>
                <div class="flex flex-col sm:flex-row gap-3">
                    <input type="text" id="wizard-new-cat" class="flex-1 bg-slate-900 border border-slate-700 text-white p-3.5 rounded-xl font-bold text-sm outline-none focus:border-emerald-500 placeholder-slate-500" placeholder="Category Name (e.g. Wedding Fund, Car Fund, Fuel, Groceries)...">
                    <select id="wizard-new-type" class="bg-slate-900 border border-slate-700 text-white p-3.5 rounded-xl text-xs font-bold outline-none cursor-pointer sm:w-60">
                        <option value="expenseCategories">🛒 Living Expense</option>
                        <option value="savingsCategories">🛡️ Savings & Sinking Fund</option>
                        <option value="investmentCategories">📈 Investment</option>
                    </select>
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.addWizardCategory() })}" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-8 py-3.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shrink-0 shadow-lg shadow-emerald-500/20 transition-all">
                        <i data-lucide="plus" class="w-4 h-4"></i> Add Category
                    </button>
                </div>
            </div>

            <!-- 3 Separate Tables / Columns Grid on PC -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-y-auto no-scrollbar pr-1">
                <!-- Column 1: Living Expenses -->
                <div class="bg-slate-800/60 p-5 rounded-[2rem] border border-rose-500/20 flex flex-col shadow-inner">
                    <div class="flex justify-between items-center mb-4 pb-3 border-b border-rose-500/20">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                                <i data-lucide="shopping-bag" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <h4 class="text-xs font-black uppercase text-rose-400 tracking-wider">Living Expenses</h4>
                                <p class="text-[9px] font-bold text-slate-400">Needs & Consumed Envelopes</p>
                            </div>
                        </div>
                        <span class="text-xs font-black bg-rose-500/20 text-rose-300 px-2.5 py-0.5 rounded-full">${expenses.length}</span>
                    </div>
                    <div class="space-y-2.5 flex-1 overflow-y-auto no-scrollbar">
                        ${expenses.map(c => renderCatCard(c, 'expense')).join('') || FinzUI.literal("<p class=\"text-xs text-slate-500 text-center py-8\">No living expense categories</p>")}
                    </div>
                </div>

                <!-- Column 2: Savings & Sinking Funds -->
                <div class="bg-slate-800/60 p-5 rounded-[2rem] border border-emerald-500/20 flex flex-col shadow-inner">
                    <div class="flex justify-between items-center mb-4 pb-3 border-b border-emerald-500/20">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                                <i data-lucide="shield" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <h4 class="text-xs font-black uppercase text-emerald-400 tracking-wider">Savings & Sinking</h4>
                                <p class="text-[9px] font-bold text-slate-400">Wedding, Car, Vacation Funds</p>
                            </div>
                        </div>
                        <span class="text-xs font-black bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full">${savings.length}</span>
                    </div>
                    <div class="space-y-2.5 flex-1 overflow-y-auto no-scrollbar">
                        ${savings.map(c => renderCatCard(c, 'savings')).join('') || FinzUI.literal("<p class=\"text-xs text-slate-500 text-center py-8\">No savings funds</p>")}
                    </div>
                </div>

                <!-- Column 3: Investments -->
                <div class="bg-slate-800/60 p-5 rounded-[2rem] border border-indigo-500/20 flex flex-col shadow-inner">
                    <div class="flex justify-between items-center mb-4 pb-3 border-b border-indigo-500/20">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                                <i data-lucide="trending-up" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <h4 class="text-xs font-black uppercase text-indigo-400 tracking-wider">Investments</h4>
                                <p class="text-[9px] font-bold text-slate-400">Sarwa, Mutual Funds, Assets</p>
                            </div>
                        </div>
                        <span class="text-xs font-black bg-indigo-500/20 text-indigo-300 px-2.5 py-0.5 rounded-full">${investments.length}</span>
                    </div>
                    <div class="space-y-2.5 flex-1 overflow-y-auto no-scrollbar">
                        ${investments.map(c => renderCatCard(c, 'investment')).join('') || FinzUI.literal("<p class=\"text-xs text-slate-500 text-center py-8\">No investment categories</p>")}
                    </div>
                </div>
            </div>
        </div>
    `;
};

actions.saveBudgetAsTemplate = async function() {
    const stats = actions.getEnvelopeStats();
    const template = {};
    Object.keys(stats.categories).forEach(cat => {
        if (stats.categories[cat].funded > 0) {
            template[cat] = stats.categories[cat].funded;
        }
    });
    if (Object.keys(template).length === 0) {
        actions.showToast("No funded envelopes to save as template", "warn");
        return;
    }
    state.data.budgetTemplate = template;
    await actions.updateDb();
    actions.showToast("Standard Budget Template Saved!", "success");
    actions.renderBudgetUIOverride();
};

actions.applyBudgetTemplate = async function() {
    const limits = (state.data.budgets && Object.keys(state.data.budgets).length > 0)
        ? state.data.budgets
        : (state.data.budgetTemplate || {});
    if (!limits || Object.keys(limits).length === 0) {
        actions.showToast("No saved budget limits found. Set category budgets first!", "info");
        return;
    }
    const template = limits;
    const stats = actions.getEnvelopeStats();
    const totalRequired = Object.values(template).reduce((sum, v) => sum + v, 0);
    
    if (stats.unallocatedCash < totalRequired) {
        if (!confirm(`You have AED ${stats.unallocatedCash.toLocaleString()} unallocated, but the template requires AED ${totalRequired.toLocaleString()}. Do you want to fund envelopes with available cash?`)) {
            return;
        }
    }
    
    const date = new Date().toISOString();
    let currentUnallocated = stats.unallocatedCash;
    
    Object.keys(template).forEach(cat => {
        const targetAmt = template[cat];
        const toFund = Math.min(targetAmt, Math.max(0, currentUnallocated));
        if (toFund > 0) {
            state.data.envelopeLedger.push({
                id: actions.genId(),
                date,
                type: 'fund',
                category: cat,
                amount: toFund
            });
            currentUnallocated -= toFund;
        }
    });
    
    await actions.updateDb();
    actions.renderBudgetUIOverride();
    actions.showToast("All envelopes auto-funded from template!", "success");
    if (actions.fireConfetti) actions.fireConfetti();
};

actions.openCoverOverspending = function(targetCat, deficit) {
    const stats = actions.getEnvelopeStats();
    const surplusCategories = Object.keys(stats.categories).filter(c => c !== targetCat && stats.categories[c].available > 0);
    
    let options = '';
    if (stats.unallocatedCash >= deficit) {
        options += FinzUI.html`<option value="__unallocated__">Unallocated Cash (Available: AED ${stats.unallocatedCash.toLocaleString()})</option>`;
    } else if (stats.unallocatedCash > 0) {
        options += FinzUI.html`<option value="__unallocated__">Unallocated Cash (Partial: AED ${stats.unallocatedCash.toLocaleString()})</option>`;
    }
    
    surplusCategories.forEach(c => {
        options += FinzUI.html`<option value="${c}">${c} (Surplus: AED ${stats.categories[c].available.toLocaleString()})</option>`;
    });
    
    if (!options) {
        actions.showToast("No surplus available in unallocated cash or other envelopes.", "warn");
        return;
    }
    
    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Cover Overspending';
    
    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-xl mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div>
                    <h3 class="text-xl font-black text-white">Cover Deficit: ${targetCat}</h3>
                    <p class="text-xs text-rose-400 font-bold">Over budget by AED ${deficit.toLocaleString()}</p>
                </div>
            </div>
            
            <div class="space-y-4">
                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Transfer From (Surplus Source)</label>
                    <select id="cover-source" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${options}
                    </select>
                </div>
                
                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Amount to Transfer</label>
                    <input type="number" id="cover-amount" value="${deficit}" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-emerald-400 font-black text-xl outline-none num-font">
                </div>
            </div>
            
            <button data-finz-click="${FinzUI.handler(function(event) { return actions.executeCoverOverspending(((targetCat))) })}" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                <i data-lucide="check-circle" class="w-5 h-5"></i> Rebalance & Cover Now
            </button>
        </div>
    `);
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.executeCoverOverspending = async function(targetCat) {
    const src = document.getElementById('cover-source')?.value;
    const amt = parseFloat(document.getElementById('cover-amount')?.value) || 0;
    if (amt <= 0) return actions.showToast('Enter an amount greater than zero.', 'error');
    // Never move more than the source actually holds (that would just push the deficit elsewhere).
    const stats = actions.getEnvelopeStats();
    const available = src === '__unallocated__' ? stats.unallocatedCash : (stats.categories[src]?.available || 0);
    if (amt > available + 0.005) return actions.showToast(`Only AED ${Math.max(0, available).toLocaleString(undefined, { maximumFractionDigits: 2 })} is available in that source.`, 'error');
    
    const date = new Date().toISOString();
    
    if (src === '__unallocated__') {
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'fund',
            category: targetCat,
            amount: amt
        });
    } else {
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'defund',
            category: src,
            amount: amt
        });
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'fund',
            category: targetCat,
            amount: amt
        });
    }
    
    await actions.updateDb();
    actions.renderBudgetUIOverride();
    actions.showToast(`Covered AED ${amt.toLocaleString()} for ${targetCat}!`, "success");
};

actions.setMoveBudgetAmount = function(amt) {
    const input = document.getElementById('move-cat-amount');
    if (input) input.value = amt;
};

actions.setModalTransferAmount = function(amt) {
    const input = document.getElementById('modal-transfer-amt');
    if (input) input.value = amt;
};

actions.calcCategoryEditDiff = function(cat, origFunded, unallocated) {
    const input = document.getElementById('edit-cat-amount');
    const preview = document.getElementById('edit-cat-preview');
    if (!input || !preview) return;
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) {
        FinzUI.setHTML(preview, FinzUI.html`<p class="text-xs font-bold text-rose-400">Please enter a valid amount (0 or more).</p>`);
        return;
    }
    const diff = val - origFunded;
    if (Math.abs(diff) < 0.005) {
        FinzUI.setHTML(preview, FinzUI.html`<p class="text-xs font-bold text-slate-400">No change to current allocation (AED ${origFunded.toLocaleString()}).</p>`);
    } else if (diff < 0) {
        const freed = Math.abs(diff);
        const newUnallocated = unallocated + freed;
        FinzUI.setHTML(preview, FinzUI.html`<p class="text-xs font-bold text-emerald-400 flex items-center gap-1.5"><i data-lucide="arrow-down-circle" class="w-4 h-4 text-emerald-400 shrink-0"></i> Decreasing by AED ${freed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — this will return AED ${freed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} back to Unallocated Cash (New unallocated: AED ${newUnallocated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).</p>`);
    } else {
        const needed = diff;
        const newUnallocated = unallocated - needed;
        if (needed > unallocated + 0.005) {
            FinzUI.setHTML(preview, FinzUI.html`<p class="text-xs font-bold text-rose-400 flex items-center gap-1.5"><i data-lucide="alert-triangle" class="w-4 h-4 text-rose-400 shrink-0"></i> Needs AED ${needed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, but only AED ${unallocated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} unallocated cash is available (short by AED ${(needed - unallocated).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).</p>`);
        } else {
            FinzUI.setHTML(preview, FinzUI.html`<p class="text-xs font-bold text-indigo-300 flex items-center gap-1.5"><i data-lucide="arrow-up-circle" class="w-4 h-4 text-indigo-400 shrink-0"></i> Increasing by AED ${needed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — remaining unallocated cash will be AED ${newUnallocated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.</p>`);
        }
    }
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.openEditCategoryBudget = function(cat) {
    const stats = actions.getEnvelopeStats();
    const cStat = stats.categories[cat] || { funded: 0, spent: 0, available: 0 };
    const currentFunded = cStat.funded || 0;
    const currentAvailable = cStat.available || 0;
    const currentSpent = cStat.spent || 0;
    const unallocated = stats.unallocatedCash || 0;
    const pillar = actions.getCategoryPillar(cat);
    const hasTemplate = !!(state.data.budgetTemplate && state.data.budgetTemplate[cat] !== undefined);

    const expenseCats = (state.data.expenseCategories || []).filter(c => c !== cat);
    const savingsCats = (state.data.savingsCategories || []).filter(c => c !== cat);
    const investCats = (state.data.investmentCategories || []).filter(c => c !== cat);

    let destOptions = '';
    // Place savings options first so users transferring mistake funds can immediately target savings!
    if (savingsCats.length > 0) {
        destOptions += FinzUI.html`<optgroup label="🛡️ Savings & Sinking Funds">${savingsCats.map(c => FinzUI.html`<option value="${c}">${c}</option>`).join('')}</optgroup>`;
    }
    if (investCats.length > 0) {
        destOptions += FinzUI.html`<optgroup label="📈 Investments">${investCats.map(c => FinzUI.html`<option value="${c}">${c}</option>`).join('')}</optgroup>`;
    }
    if (expenseCats.length > 0) {
        destOptions += FinzUI.html`<optgroup label="🛒 Living Expenses">${expenseCats.map(c => FinzUI.html`<option value="${c}">${c}</option>`).join('')}</optgroup>`;
    }

    const envelopeHistory = (state.data.envelopeLedger || []).filter(e => e.category === cat)
                               .sort((a,b) => new Date(b.date) - new Date(a.date));

    const pillarBadge = pillar === 'savings'
        ? FinzUI.html`<span class="text-[9px] font-black uppercase text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1"><i data-lucide="shield" class="w-3 h-3"></i> Savings & Sinking Fund</span>`
        : pillar === 'investment'
            ? FinzUI.html`<span class="text-[9px] font-black uppercase text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/30 flex items-center gap-1"><i data-lucide="trending-up" class="w-3 h-3"></i> Investment & Wealth</span>`
            : FinzUI.html`<span class="text-[9px] font-black uppercase text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/30 flex items-center gap-1"><i data-lucide="shopping-bag" class="w-3 h-3"></i> Living Expense</span>`;

    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Edit Envelope Budget';

    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-4xl mx-auto space-y-6 text-left fade-in pb-16">
            <!-- Header bar with category title -->
            <div class="flex items-center justify-between pb-4 border-b border-slate-800">
                <div class="flex items-center gap-3">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
                        <i data-lucide="arrow-left" class="w-5 h-5"></i>
                    </button>
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="text-xl font-black text-white uppercase tracking-wider">${cat}</h3>
                            ${pillarBadge}
                        </div>
                        <p class="text-xs text-slate-400 font-bold">Adjust allocation amount, move funds between envelopes, or view history</p>
                    </div>
                </div>
            </div>

            <!-- Overview Balances Grid -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div class="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60 text-center">
                    <p class="text-[9px] font-bold text-slate-400 uppercase">Currently Allocated</p>
                    <p class="text-lg font-black text-white num-font mt-0.5">AED ${currentFunded.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
                <div class="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60 text-center">
                    <p class="text-[9px] font-bold text-slate-400 uppercase">Spent / Used</p>
                    <p class="text-lg font-black text-slate-300 num-font mt-0.5">AED ${currentSpent.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
                <div class="bg-slate-800/80 p-4 rounded-2xl border ${currentAvailable < 0 ? 'border-rose-500/40 bg-rose-500/5' : 'border-emerald-500/40 bg-emerald-500/5'} text-center">
                    <p class="text-[9px] font-bold text-slate-400 uppercase">${currentAvailable < 0 ? 'Deficit' : 'Available Balance'}</p>
                    <p class="text-lg font-black ${currentAvailable < 0 ? 'text-rose-400' : 'text-emerald-400'} num-font mt-0.5">AED ${currentAvailable.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
                <div class="bg-slate-800/80 p-4 rounded-2xl border border-indigo-500/40 bg-indigo-500/5 text-center">
                    <p class="text-[9px] font-bold text-slate-400 uppercase">Unallocated Cash</p>
                    <p class="text-lg font-black text-indigo-400 num-font mt-0.5">AED ${unallocated.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
            </div>

            <!-- Main Interactive Controls: 2 Cards -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- CARD 1: Direct Budget Allocation (Edit Target) -->
                <div class="bg-slate-800/90 p-6 rounded-[2rem] border border-slate-700/80 shadow-xl space-y-4 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center gap-2 mb-2">
                            <div class="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                                <i data-lucide="edit-3" class="w-4 h-4"></i>
                            </div>
                            <h4 class="text-sm font-black uppercase text-white tracking-wider">Set Exact Allocation</h4>
                        </div>
                        <p class="text-xs text-slate-400 font-bold mb-4">Type the new desired total budget amount for this month. Decreasing frees money back to Unallocated Cash; increasing takes from Unallocated Cash.</p>

                        <div class="space-y-3">
                            <div>
                                <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">New Total Budget (AED)</label>
                                <input type="number" id="edit-cat-amount" value="${currentFunded}" min="0" step="any" class="w-full p-4 bg-slate-900 border border-slate-700 rounded-2xl text-white font-black text-2xl outline-none focus:border-emerald-500 num-font" data-finz-input="${FinzUI.handler(function(event) { return actions.calcCategoryEditDiff(((cat)), ((currentFunded)), ((unallocated))) })}">
                            </div>

                            <div id="edit-cat-preview" class="p-3 bg-slate-900/60 rounded-xl border border-slate-700/60 min-h-[3rem] flex items-center">
                                <p class="text-xs font-bold text-slate-400">Current allocation: AED ${currentFunded.toLocaleString()}. Change amount above to adjust.</p>
                            </div>

                            <div class="flex items-center gap-2 pt-1">
                                <input type="checkbox" id="edit-cat-sync-template" ${hasTemplate ? 'checked' : ''} class="w-4 h-4 rounded accent-emerald-500 cursor-pointer">
                                <label for="edit-cat-sync-template" class="text-xs font-bold text-slate-300 cursor-pointer">Also update my Standard Monthly Template</label>
                            </div>
                        </div>
                    </div>

                    <div class="space-y-2 pt-2">
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveCategoryBudgetAllocation(((cat))) })}" class="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black uppercase text-xs tracking-wider py-4 rounded-2xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                            <i data-lucide="check" class="w-4 h-4"></i> Save New Allocation
                        </button>
                        ${currentFunded > 0 ? FinzUI.html`
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.resetCategoryAllocation(((cat))) })}" class="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-black uppercase py-3 rounded-2xl transition-all flex items-center justify-center gap-1.5">
                                <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Clear Allocation (Release AED ${currentFunded.toLocaleString()} to Unallocated)
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- CARD 2: Move Funds to Another Envelope (User's Exact Issue!) -->
                <div class="bg-slate-800/90 p-6 rounded-[2rem] border border-slate-700/80 shadow-xl space-y-4 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center gap-2 mb-2">
                            <div class="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                                <i data-lucide="arrow-right-left" class="w-4 h-4"></i>
                            </div>
                            <h4 class="text-sm font-black uppercase text-white tracking-wider">Move to Another Envelope</h4>
                        </div>
                        <p class="text-xs text-slate-400 font-bold mb-4">Mistakenly funded the wrong category? Transfer funds directly from <span class="text-white font-extrabold">${cat}</span> to another envelope without affecting bank accounts.</p>

                        <div class="space-y-3">
                            <div>
                                <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Destination Envelope</label>
                                <select id="move-cat-dest" class="w-full p-3.5 bg-slate-900 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none focus:border-indigo-500">
                                    ${destOptions || FinzUI.html`<option value="">No other categories available</option>`}
                                </select>
                            </div>

                            <div>
                                <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Amount to Move (AED)</label>
                                <input type="number" id="move-cat-amount" value="${Math.max(0, currentAvailable)}" min="0" step="any" class="w-full p-4 bg-slate-900 border border-slate-700 rounded-2xl text-emerald-400 font-black text-2xl outline-none focus:border-indigo-500 num-font">
                            </div>

                            <!-- Quick preset pills -->
                            <div class="flex flex-wrap gap-2 pt-1">
                                <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setMoveBudgetAmount(50) })}" class="px-3 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-bold text-slate-300">50</button>
                                <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setMoveBudgetAmount(100) })}" class="px-3 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-bold text-slate-300">100</button>
                                <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setMoveBudgetAmount(250) })}" class="px-3 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-bold text-slate-300">250</button>
                                ${currentAvailable > 0 ? FinzUI.html`
                                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setMoveBudgetAmount(((currentAvailable))) })}" class="px-3 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 rounded-lg text-xs font-black text-indigo-300">All Available (${currentAvailable.toLocaleString()})</button>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="pt-2">
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.executeBudgetTransfer(((cat))) })}" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-xs tracking-wider py-4 rounded-2xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2">
                            <i data-lucide="arrow-right-left" class="w-4 h-4"></i> Transfer Funds Now
                        </button>
                    </div>
                </div>
            </div>

            <!-- Envelope Ledger History -->
            <div class="bg-slate-800/90 p-6 rounded-[2rem] border border-slate-700/80 shadow-xl space-y-4">
                <div class="flex justify-between items-center pb-2 border-b border-slate-700/60">
                    <div class="flex items-center gap-2">
                        <i data-lucide="layers" class="w-4 h-4 text-indigo-400"></i>
                        <h4 class="text-xs font-black uppercase text-white tracking-wider">Allocation Ledger History for ${cat}</h4>
                    </div>
                    <span class="text-[9px] font-bold text-slate-400">${envelopeHistory.length} entry/entries</span>
                </div>

                ${envelopeHistory.length === 0 ? FinzUI.html`
                    <p class="text-xs font-bold text-slate-500 text-center py-6 bg-slate-900/40 rounded-2xl">No allocation entries yet for this envelope.</p>
                ` : FinzUI.html`
                    <div class="space-y-2">
                        ${envelopeHistory.map(e => FinzUI.html`
                            <div class="flex justify-between items-center p-3 bg-slate-900/70 rounded-2xl border border-slate-700/50 text-xs">
                                <div class="flex items-center gap-3">
                                    <span class="text-[9px] font-black uppercase px-2.5 py-1 rounded-lg ${e.type === 'fund' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}">
                                        ${e.type === 'fund' ? '+ Funded' : '- Defunded'}
                                    </span>
                                    <div>
                                        <span class="font-black text-white num-font text-sm">AED ${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        <span class="text-[10px] text-slate-400 font-bold ml-2">${new Date(e.date).toLocaleString()}</span>
                                    </div>
                                </div>
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteEnvelopeLedgerEntry(((e.id)), ((cat))) })}" title="Delete this entry (reverses this allocation)" class="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all flex items-center gap-1 text-[10px] font-bold">
                                    <i data-lucide="trash-2" class="w-4 h-4"></i> Delete
                                </button>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        </div>
    `);
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.saveCategoryBudgetAllocation = async function(cat) {
    const input = document.getElementById('edit-cat-amount');
    if (!input) return;
    const newTarget = Math.max(0, parseFloat(input.value) || 0);
    const stats = actions.getEnvelopeStats();
    const currentFunded = stats.categories[cat]?.funded || 0;
    const diff = newTarget - currentFunded;

    if (Math.abs(diff) < 0.005) {
        actions.showToast("No change in allocation.", "info");
        actions.renderBudgetUIOverride();
        return;
    }

    const date = new Date().toISOString();
    state.data.envelopeLedger = state.data.envelopeLedger || [];

    if (diff > 0) {
        if (diff > stats.unallocatedCash + 0.005) {
            actions.showToast(`Not enough unallocated cash! Available: AED ${stats.unallocatedCash.toLocaleString()}`, "error");
            return;
        }
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'fund',
            category: cat,
            amount: diff
        });
    } else {
        const defundAmt = Math.abs(diff);
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'defund',
            category: cat,
            amount: defundAmt
        });
    }

    const syncTemplate = document.getElementById('edit-cat-sync-template')?.checked;
    if (syncTemplate) {
        state.data.budgetTemplate = state.data.budgetTemplate || {};
        if (newTarget > 0) state.data.budgetTemplate[cat] = newTarget;
        else delete state.data.budgetTemplate[cat];
    }
    if (state.data.budgets && state.data.budgets[cat] !== undefined) {
        state.data.budgets[cat] = newTarget;
    }

    await actions.updateDb();
    actions.showToast(`Budget for ${cat} updated to AED ${newTarget.toLocaleString()}!`, "success");
    actions.renderBudgetUIOverride();
};

actions.resetCategoryAllocation = async function(cat) {
    const stats = actions.getEnvelopeStats();
    const currentFunded = stats.categories[cat]?.funded || 0;
    const currentSpent = stats.categories[cat]?.spent || 0;
    const currentAvailable = stats.categories[cat]?.available || 0;

    if (currentFunded <= 0) {
        actions.showToast(`${cat} has no funds allocated.`, "info");
        return;
    }

    const releasable = Math.max(0, currentAvailable);
    if (currentSpent > 0 && releasable <= 0) {
        actions.showToast(`Cannot clear allocation: ${cat} has already spent AED ${currentSpent.toLocaleString()} this cycle. Defunding would create an active deficit.`, "error");
        return;
    }

    const amountToRelease = (currentSpent > 0) ? releasable : currentFunded;
    const confirmMsg = (currentSpent > 0)
        ? `${cat} has spent AED ${currentSpent.toLocaleString()} of its AED ${currentFunded.toLocaleString()} allocation.\n\nRelease the remaining unspent AED ${amountToRelease.toLocaleString()} back to Unallocated Cash?`
        : `Are you sure you want to release all AED ${amountToRelease.toLocaleString()} from ${cat} back to Unallocated Cash?`;

    actions.showConfirm(
        "Clear Envelope Allocation",
        confirmMsg,
        async () => {
            state.data.envelopeLedger = state.data.envelopeLedger || [];
            state.data.envelopeLedger.push({
                id: actions.genId(),
                date: new Date().toISOString(),
                type: 'defund',
                category: cat,
                amount: amountToRelease
            });

            if (state.data.budgetTemplate && state.data.budgetTemplate[cat] !== undefined) {
                delete state.data.budgetTemplate[cat];
            }
            if (state.data.budgets && state.data.budgets[cat] !== undefined) {
                state.data.budgets[cat] = currentSpent > 0 ? currentSpent : 0;
            }

            await actions.updateDb();
            actions.showToast(`Released AED ${amountToRelease.toLocaleString()} from ${cat} back to Unallocated Cash!`, "success");
            actions.renderBudgetUIOverride();
        }
    );
};

actions.executeBudgetTransfer = async function(sourceCat) {
    const dest = document.getElementById('move-cat-dest')?.value;
    const amt = parseFloat(document.getElementById('move-cat-amount')?.value) || 0;
    if (!dest) return actions.showToast("Select a destination category.", "error");
    if (dest === sourceCat) return actions.showToast("Source and destination categories must be different.", "error");
    if (amt <= 0) return actions.showToast("Enter an amount greater than zero.", "error");

    const stats = actions.getEnvelopeStats();
    const available = stats.categories[sourceCat]?.available || 0;
    if (amt > available + 0.005) {
        return actions.showToast(`Only AED ${Math.max(0, available).toLocaleString(undefined, { maximumFractionDigits: 2 })} is available in ${sourceCat}.`, "error");
    }

    const date = new Date().toISOString();
    state.data.envelopeLedger = state.data.envelopeLedger || [];

    state.data.envelopeLedger.push({
        id: actions.genId(),
        date,
        type: 'defund',
        category: sourceCat,
        amount: amt
    });
    state.data.envelopeLedger.push({
        id: actions.genId(),
        date,
        type: 'fund',
        category: dest,
        amount: amt
    });

    await actions.updateDb();
    actions.showToast(`Transferred AED ${amt.toLocaleString()} from ${sourceCat} to ${dest}!`, "success");
    actions.renderBudgetUIOverride();
};

actions.deleteEnvelopeLedgerEntry = async function(entryId, cat) {
    if (!state.data.envelopeLedger) return;
    const entry = state.data.envelopeLedger.find(e => e.id === entryId);
    if (!entry) return;

    actions.showConfirm(
        "Delete Allocation Entry",
        `Delete this ${entry.type === 'fund' ? 'Funding' : 'Defunding'} entry of AED ${entry.amount.toLocaleString()} for ${entry.category}?\n\nThis will adjust your envelope balance and unallocated cash immediately.`,
        async () => {
            state.data.envelopeLedger = state.data.envelopeLedger.filter(e => e.id !== entryId);
            await actions.updateDb();
            actions.showToast(`Allocation entry deleted!`, "success");
            if (cat) actions.openEditCategoryBudget(cat);
            else actions.renderBudgetUIOverride();
        }
    );
};

actions.openBulkBudgetEditor = function() {
    const stats = actions.getEnvelopeStats();
    const totalAllocated = stats.totalFunded - stats.totalDefunded;
    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Edit All Allocations';

    const expenses = state.data.expenseCategories || [];
    const savings = state.data.savingsCategories || [];
    const investments = state.data.investmentCategories || [];

    const renderPillarInputs = (title, icon, cats, colorClass) => {
        if (cats.length === 0) return '';
        return FinzUI.html`
            <div class="bg-slate-800/80 p-5 rounded-[2rem] border border-slate-700/80 space-y-3">
                <div class="flex items-center gap-2 pb-2 border-b border-slate-700/60">
                    <span class="${colorClass} font-black text-xs uppercase tracking-wider flex items-center gap-1.5">
                        <i data-lucide="${icon}" class="w-4 h-4"></i> ${title}
                    </span>
                    <span class="text-[10px] font-bold text-slate-400">(${cats.length} envelopes)</span>
                </div>
                <div class="space-y-2.5">
                    ${cats.map(cat => {
                        const cStat = stats.categories[cat] || { funded: 0, spent: 0, available: 0 };
                        return FinzUI.html`
                            <div class="flex items-center justify-between p-3 bg-slate-900/70 rounded-2xl border border-slate-700/50 hover:border-slate-600 transition-all">
                                <div class="text-left">
                                    <p class="text-xs font-black text-white">${cat}</p>
                                    <p class="text-[9px] font-bold text-slate-400">Spent: AED ${cStat.spent.toLocaleString()} • Available: AED ${cStat.available.toLocaleString()}</p>
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="text-[10px] font-black text-slate-400">AED</span>
                                    <input type="number" data-cat="${cat}" data-orig="${cStat.funded}" value="${cStat.funded}" min="0" step="any" class="bulk-budget-input w-28 md:w-36 text-right p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-black text-sm outline-none focus:border-emerald-500 num-font" data-finz-input="${FinzUI.handler(function(event) { return actions.calcBulkBudgetDiff() })}">
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    };

    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-4xl mx-auto space-y-6 text-left fade-in pb-16">
            <!-- Header bar -->
            <div class="flex items-center justify-between pb-4 border-b border-slate-800">
                <div class="flex items-center gap-3">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
                        <i data-lucide="arrow-left" class="w-5 h-5"></i>
                    </button>
                    <div>
                        <h3 class="text-xl font-black text-white">Bulk Budget Allocation Editor</h3>
                        <p class="text-xs text-slate-400 font-bold">Review and adjust all monthly envelopes on a single screen</p>
                    </div>
                </div>
            </div>

            <!-- Summary Bar -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-800/90 p-4 rounded-2xl border border-slate-700/80 shadow-lg text-center">
                <div>
                    <p class="text-[9px] font-bold text-slate-400 uppercase">Total Paycheck Inflow</p>
                    <p class="text-xl font-black text-white num-font mt-0.5">AED ${stats.totalCredit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
                <div>
                    <p class="text-[9px] font-bold text-slate-400 uppercase">Total Envelopes Allocated</p>
                    <p id="bulk-total-alloc-val" class="text-xl font-black text-indigo-400 num-font mt-0.5">AED ${totalAllocated.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
                <div>
                    <p class="text-[9px] font-bold text-slate-400 uppercase">Remaining Unallocated</p>
                    <p id="bulk-unallocated-val" class="text-xl font-black ${stats.unallocatedCash < 0 ? 'text-rose-400' : 'text-emerald-400'} num-font mt-0.5">AED ${stats.unallocatedCash.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
            </div>

            <!-- Pillars 1, 2, 3 Lists -->
            <div class="space-y-4">
                ${renderPillarInputs('Living Expenses (Needs & Lifestyle)', 'shopping-bag', expenses, 'text-rose-400')}
                ${renderPillarInputs('Savings & Sinking Funds (Future Goals)', 'shield', savings, 'text-emerald-400')}
                ${renderPillarInputs('Investments & Wealth Growth', 'trending-up', investments, 'text-indigo-400')}
            </div>

            <!-- Actions footer -->
            <div class="bg-slate-800/90 p-5 rounded-2xl border border-slate-700/80 space-y-3 sticky bottom-4 shadow-2xl backdrop-blur-md">
                <div class="flex items-center gap-2">
                    <input type="checkbox" id="bulk-sync-template" ${state.data.budgetTemplate && Object.keys(state.data.budgetTemplate).length > 0 ? 'checked' : ''} class="w-4 h-4 rounded accent-emerald-500 cursor-pointer">
                    <label for="bulk-sync-template" class="text-xs font-bold text-slate-300 cursor-pointer">Also save these targets as my Standard Monthly Template</label>
                </div>
                <div class="flex gap-3">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveBulkBudgetAllocations() })}" class="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black uppercase text-xs tracking-wider py-4 rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                        <i data-lucide="check" class="w-4 h-4"></i> Save All Allocations
                    </button>
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="px-6 bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold uppercase text-xs tracking-wider py-4 rounded-xl transition-all">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    `);
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.calcBulkBudgetDiff = function() {
    let totalAlloc = 0;
    const stats = actions.getEnvelopeStats();
    document.querySelectorAll('.bulk-budget-input').forEach(input => {
        totalAlloc += Math.max(0, parseFloat(input.value) || 0);
    });
    const totalCredit = stats.totalCredit;
    const remaining = totalCredit - totalAlloc;
    const unallocatedEl = document.getElementById('bulk-unallocated-val');
    const totalAllocEl = document.getElementById('bulk-total-alloc-val');
    if (unallocatedEl) {
        unallocatedEl.innerText = `AED ${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        unallocatedEl.className = remaining < -0.005
            ? 'text-xl font-black text-rose-400 num-font mt-0.5'
            : 'text-xl font-black text-emerald-400 num-font mt-0.5';
    }
    if (totalAllocEl) {
        totalAllocEl.innerText = `AED ${totalAlloc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
};

actions.saveBulkBudgetAllocations = async function() {
    const inputs = document.querySelectorAll('.bulk-budget-input');
    const stats = actions.getEnvelopeStats();
    let netChange = 0;
    const changes = [];

    inputs.forEach(input => {
        const cat = input.getAttribute('data-cat');
        const orig = parseFloat(input.getAttribute('data-orig')) || 0;
        const val = Math.max(0, parseFloat(input.value) || 0);
        const diff = val - orig;
        if (Math.abs(diff) > 0.005) {
            netChange += diff;
            changes.push({ cat, orig, val, diff });
        }
    });

    if (changes.length === 0) {
        actions.showToast("No changes detected in allocations.", "info");
        actions.renderBudgetUIOverride();
        return;
    }

    if (netChange > stats.unallocatedCash + 0.005) {
        actions.showToast(`Total increases exceed available unallocated cash by AED ${(netChange - stats.unallocatedCash).toLocaleString(undefined, { maximumFractionDigits: 2 })}!`, "error");
        return;
    }

    const date = new Date().toISOString();
    state.data.envelopeLedger = state.data.envelopeLedger || [];

    changes.forEach(ch => {
        if (ch.diff > 0) {
            state.data.envelopeLedger.push({
                id: actions.genId(),
                date,
                type: 'fund',
                category: ch.cat,
                amount: ch.diff
            });
        } else {
            state.data.envelopeLedger.push({
                id: actions.genId(),
                date,
                type: 'defund',
                category: ch.cat,
                amount: Math.abs(ch.diff)
            });
        }
        if (state.data.budgets && state.data.budgets[ch.cat] !== undefined) {
            state.data.budgets[ch.cat] = ch.val;
        }
    });

    const syncTemplate = document.getElementById('bulk-sync-template')?.checked;
    if (syncTemplate) {
        state.data.budgetTemplate = state.data.budgetTemplate || {};
        inputs.forEach(input => {
            const cat = input.getAttribute('data-cat');
            const val = Math.max(0, parseFloat(input.value) || 0);
            if (val > 0) state.data.budgetTemplate[cat] = val;
            else delete state.data.budgetTemplate[cat];
        });
    }

    await actions.updateDb();
    actions.showToast("All budget allocations updated successfully!", "success");
    actions.renderBudgetUIOverride();
};

actions.openBudgetTransferModal = function(initialSource = '') {
    const stats = actions.getEnvelopeStats();
    const allCats = actions.getAllBudgetCategories();
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) modalTitle.innerText = 'Transfer Between Envelopes';
    const c = document.getElementById('modal-content');
    if (!c) return;

    let sourceOptions = '';
    if (stats.unallocatedCash > 0) {
        sourceOptions += FinzUI.html`<option value="__unallocated__" ${initialSource === '__unallocated__' ? 'selected' : ''}>Unallocated Cash (Available: AED ${stats.unallocatedCash.toLocaleString()})</option>`;
    }
    allCats.forEach(cat => {
        const cStat = stats.categories[cat] || { funded: 0, spent: 0, available: 0 };
        const isSelected = initialSource === cat || (!initialSource && stats.unallocatedCash <= 0 && cStat.available > 0);
        sourceOptions += FinzUI.html`<option value="${cat}" ${isSelected ? 'selected' : ''}>${cat} (Available: AED ${cStat.available.toLocaleString()})</option>`;
    });

    let destOptions = '';
    destOptions += FinzUI.html`<option value="__unallocated__">Unallocated Cash (Return to paycheck pool)</option>`;
    
    const expenseCats = state.data.expenseCategories || [];
    const savingsCats = state.data.savingsCategories || [];
    const investCats = state.data.investmentCategories || [];

    if (savingsCats.length > 0) {
        destOptions += FinzUI.html`<optgroup label="🛡️ Savings & Sinking Funds">${savingsCats.map(cat => FinzUI.html`<option value="${cat}">${cat}</option>`).join('')}</optgroup>`;
    }
    if (investCats.length > 0) {
        destOptions += FinzUI.html`<optgroup label="📈 Investments">${investCats.map(cat => FinzUI.html`<option value="${cat}">${cat}</option>`).join('')}</optgroup>`;
    }
    if (expenseCats.length > 0) {
        destOptions += FinzUI.html`<optgroup label="🛒 Living Expenses">${expenseCats.map(cat => FinzUI.html`<option value="${cat}">${cat}</option>`).join('')}</optgroup>`;
    }

    let initialAvail = 0;
    if (initialSource === '__unallocated__') initialAvail = stats.unallocatedCash;
    else if (initialSource && stats.categories[initialSource]) initialAvail = stats.categories[initialSource].available;
    else if (stats.unallocatedCash > 0) initialAvail = stats.unallocatedCash;

    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-xl mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div>
                    <h3 class="text-xl font-black text-white">Transfer Between Envelopes</h3>
                    <p class="text-xs text-slate-400 font-bold">Rebalance funds between envelopes or unallocated paycheck cash</p>
                </div>
            </div>

            <div class="space-y-4">
                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">From Source</label>
                    <select id="modal-transfer-source" data-finz-change="${FinzUI.handler(function(event) { return actions.onBudgetTransferSourceChange() })}" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${sourceOptions}
                    </select>
                    <p id="modal-transfer-max-hint" class="text-[9px] font-bold text-slate-400 mt-1 pl-1">Available in selected source: AED ${Math.max(0, initialAvail).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">To Destination</label>
                    <select id="modal-transfer-dest" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${destOptions}
                    </select>
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Transfer Amount (AED)</label>
                    <input type="number" id="modal-transfer-amt" value="${initialAvail > 0 ? initialAvail : ''}" min="0" step="any" placeholder="0.00" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-emerald-400 font-black text-2xl outline-none num-font">
                </div>

                <div class="flex flex-wrap gap-2 pt-1">
                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setModalTransferAmount(50) })}" class="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-bold text-slate-300">50</button>
                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setModalTransferAmount(100) })}" class="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-bold text-slate-300">100</button>
                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setModalTransferAmount(250) })}" class="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-bold text-slate-300">250</button>
                    ${initialAvail > 0 ? FinzUI.html`
                        <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setModalTransferAmount(((initialAvail))) })}" class="px-3 py-1 bg-sky-600/30 hover:bg-sky-600/50 border border-sky-500/40 rounded-lg text-xs font-black text-sky-300">All Available (${initialAvail.toLocaleString()})</button>
                    ` : ''}
                </div>
            </div>

            <button data-finz-click="${FinzUI.handler(function(event) { return actions.executeModalBudgetTransfer() })}" class="w-full bg-sky-500 hover:bg-sky-600 text-slate-950 p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-sky-500/20 transition-all flex items-center justify-center gap-2">
                <i data-lucide="arrow-right-left" class="w-5 h-5"></i> Execute Transfer
            </button>
        </div>
    `);
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.onBudgetTransferSourceChange = function() {
    const src = document.getElementById('modal-transfer-source')?.value;
    const stats = actions.getEnvelopeStats();
    let max = 0;
    if (src === '__unallocated__') {
        max = stats.unallocatedCash;
    } else if (src && stats.categories[src]) {
        max = stats.categories[src].available;
    }
    const maxHint = document.getElementById('modal-transfer-max-hint');
    if (maxHint) {
        maxHint.innerText = `Available in selected source: AED ${Math.max(0, max).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
};

actions.executeModalBudgetTransfer = async function() {
    const src = document.getElementById('modal-transfer-source')?.value;
    const dest = document.getElementById('modal-transfer-dest')?.value;
    const amt = parseFloat(document.getElementById('modal-transfer-amt')?.value) || 0;

    if (!src || !dest) return actions.showToast("Select both source and destination.", "error");
    if (src === dest) return actions.showToast("Source and destination must be different.", "error");
    if (amt <= 0) return actions.showToast("Enter an amount greater than zero.", "error");

    const stats = actions.getEnvelopeStats();
    const available = src === '__unallocated__' ? stats.unallocatedCash : (stats.categories[src]?.available || 0);

    if (amt > available + 0.005) {
        return actions.showToast(`Only AED ${Math.max(0, available).toLocaleString(undefined, { maximumFractionDigits: 2 })} is available in ${src === '__unallocated__' ? 'Unallocated Cash' : src}.`, "error");
    }

    const date = new Date().toISOString();
    state.data.envelopeLedger = state.data.envelopeLedger || [];

    if (src === '__unallocated__') {
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'fund',
            category: dest,
            amount: amt
        });
    } else if (dest === '__unallocated__') {
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'defund',
            category: src,
            amount: amt
        });
    } else {
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'defund',
            category: src,
            amount: amt
        });
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date,
            type: 'fund',
            category: dest,
            amount: amt
        });
    }

    await actions.updateDb();
    const srcName = src === '__unallocated__' ? 'Unallocated Cash' : src;
    const destName = dest === '__unallocated__' ? 'Unallocated Cash' : dest;
    actions.showToast(`Transferred AED ${amt.toLocaleString()} from ${srcName} to ${destName}!`, "success");
    actions.renderBudgetUIOverride();
};

actions.getLiquidCashTotal = function() {
    const r = state.data.settings?.rate || 22.75;
    const liquidAccs = (state.data.accounts || []).filter(a => ['Bank Account', 'Cash'].includes(a.type));
    return liquidAccs.reduce((sum, a) => sum + (a.currency === 'AED' ? Number(a.balance || 0) : Number(a.balance || 0) / r), 0);
};

actions.openAdjustBudgetCredit = function() {
    const stats = actions.getEnvelopeStats();
    const liquidTotal = actions.getLiquidCashTotal();
    const totalAllocated = stats.totalFunded - stats.totalDefunded;
    const currentCredit = stats.totalCredit;

    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Adjust Starting Budget Income';

    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-xl mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div>
                    <h3 class="text-xl font-black text-white">Adjust Starting Cycle Income</h3>
                    <p class="text-xs text-slate-400 font-bold">Align your budget's starting income with your real-world money</p>
                </div>
            </div>

            <!-- Balances overview -->
            <div class="grid grid-cols-2 gap-3 text-center">
                <div class="bg-slate-800/80 p-4 rounded-2xl border border-slate-700">
                    <p class="text-[10px] font-bold text-slate-400 uppercase">Starting Budget Credit</p>
                    <p class="text-xl font-black text-white num-font mt-0.5">AED ${currentCredit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
                <div class="bg-slate-800/80 p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5">
                    <p class="text-[10px] font-bold text-emerald-400 uppercase">Real Bank & Cash Balance</p>
                    <p class="text-xl font-black text-emerald-400 num-font mt-0.5">AED ${liquidTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
                <div class="bg-slate-800/80 p-4 rounded-2xl border border-slate-700">
                    <p class="text-[10px] font-bold text-slate-400 uppercase">Envelopes Allocated</p>
                    <p class="text-xl font-black text-slate-300 num-font mt-0.5">AED ${totalAllocated.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
                <div class="bg-slate-800/80 p-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/5">
                    <p class="text-[10px] font-bold text-indigo-400 uppercase">Unallocated Cash</p>
                    <p class="text-xl font-black text-indigo-400 num-font mt-0.5">AED ${stats.unallocatedCash.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
            </div>

            <div class="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/60 text-xs text-slate-300 space-y-1.5">
                <p class="font-bold text-white flex items-center gap-1.5">
                    <i data-lucide="info" class="w-4 h-4 text-emerald-400"></i> Why adjust starting income?
                </p>
                <p>If you mistakenly credited too much salary, deleted an envelope that refunded extra unallocated cash, or don't have enough balance in real life, lowering this number reduces your Unallocated Cash so your budget matches your actual bank account.</p>
            </div>

            <!-- Amount input -->
            <div class="space-y-3">
                <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 block">New Starting Budget Income (AED)</label>
                <div class="relative">
                    <span class="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">AED</span>
                    <input type="number" id="adjust-budget-credit-input" value="${currentCredit}" step="any" min="0" class="w-full pl-14 pr-4 py-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-black text-xl outline-none focus:border-emerald-500 num-font">
                </div>

                <!-- Shortcut Buttons -->
                <div class="flex flex-wrap gap-2 pt-1">
                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setAdjustBudgetCreditVal(((liquidTotal))) })}" class="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold transition-all">
                        Match Real Bank Cash (${liquidTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                    </button>
                    ${currentCredit >= 250 ? FinzUI.html`
                        <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setAdjustBudgetCreditVal(((Math.max(0, currentCredit - 250)))) })}" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold transition-all">
                            Reduce by 250 AED (${Math.max(0, currentCredit - 250).toLocaleString()})
                        </button>
                    ` : ''}
                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { return actions.setAdjustBudgetCreditVal(((totalAllocated))) })}" class="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-bold transition-all">
                        Zero-Out Unallocated Cash (${totalAllocated.toLocaleString()})
                    </button>
                </div>
            </div>

            <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveBudgetCredit() })}" class="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black uppercase text-xs tracking-wider py-4 rounded-2xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                <i data-lucide="check-circle" class="w-4 h-4"></i> Save Updated Income
            </button>
        </div>
    `);
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.setAdjustBudgetCreditVal = function(val) {
    const input = document.getElementById('adjust-budget-credit-input');
    if (input) input.value = Math.max(0, val);
};

actions.saveBudgetCredit = async function() {
    const input = document.getElementById('adjust-budget-credit-input');
    if (!input) return;
    const newCredit = Math.max(0, parseFloat(input.value) || 0);
    const stats = actions.getEnvelopeStats();
    const oldCredit = stats.totalCredit;

    if (Math.abs(newCredit - oldCredit) < 0.005) {
        actions.showToast("No change in starting budget income.", "info");
        actions.renderBudgetUIOverride();
        return;
    }

    state.data.envelopeLedger = state.data.envelopeLedger || [];
    const credits = state.data.envelopeLedger.filter(e => e.type === 'credit');

    if (credits.length === 0) {
        state.data.envelopeLedger.unshift({
            id: actions.genId(),
            date: state.data.settings?.lastSalaryDate || new Date().toISOString(),
            type: 'credit',
            amount: newCredit,
            note: 'Budget Cycle Income'
        });
    } else {
        credits[0].amount = newCredit;
        credits[0].note = (credits[0].note ? credits[0].note.replace(/\s*\(Adjusted\)/g, '') + ' (Adjusted)' : 'Adjusted Cycle Income');
        if (credits.length > 1) {
            const extraIds = new Set(credits.slice(1).map(c => c.id));
            state.data.envelopeLedger = state.data.envelopeLedger.filter(e => !extraIds.has(e.id));
        }
    }

    await actions.updateDb();
    const updatedStats = actions.getEnvelopeStats();
    actions.showToast(`Starting budget income updated to AED ${newCredit.toLocaleString()}! Unallocated cash is now AED ${updatedStats.unallocatedCash.toLocaleString()}.`, "success");
    actions.renderBudgetUIOverride();
};

actions.openReconcileBudgetModal = function() {
    const stats = actions.getEnvelopeStats();
    const r = state.data.settings?.rate || 22.75;
    const liquidAccs = (state.data.accounts || []).filter(a => ['Bank Account', 'Cash'].includes(a.type));
    const liquidTotalAED = liquidAccs.reduce((sum, a) => sum + (a.currency === 'AED' ? Number(a.balance || 0) : Number(a.balance || 0) / r), 0);
    const totalAllocated = stats.totalFunded - stats.totalDefunded;
    const variance = liquidTotalAED - totalAllocated;

    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Reconcile Budget with Bank';

    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-2xl mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div>
                    <h3 class="text-xl font-black text-white">Bank Balance vs. Budget Envelopes</h3>
                    <p class="text-xs text-slate-400 font-bold">Ensure your digital budget envelopes match your real bank cash</p>
                </div>
            </div>

            <!-- Variance Hero -->
            <div class="p-6 rounded-3xl border ${variance >= 0 ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-rose-950/20 border-rose-500/40'} text-center space-y-1">
                <p class="text-[10px] font-black uppercase tracking-widest ${variance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                    ${variance >= 0 ? 'Real Cash Buffer / Surplus' : 'Real-World Balance Shortfall'}
                </p>
                <h3 class="text-3xl font-black num-font ${variance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                    AED ${Math.abs(variance).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </h3>
                <p class="text-xs text-slate-300 font-medium">
                    ${variance >= 0 
                        ? 'You have enough real bank cash to back all your envelope allocations.' 
                        : 'Your real bank balance is lower than your budgeted envelope allocations! You do not have enough real balance to cover everything.'}
                </p>
            </div>

            <!-- Accounts Breakdown -->
            <div class="space-y-3">
                <h4 class="text-xs font-black uppercase text-slate-400 tracking-wider">Your Liquid Bank & Cash Accounts</h4>
                <div class="space-y-2">
                    ${liquidAccs.length === 0 ? FinzUI.html`
                        <p class="text-xs text-slate-500 py-3 text-center bg-slate-800/40 rounded-xl">No Bank Account or Cash accounts found.</p>
                    ` : liquidAccs.map(a => {
                        const aedVal = a.currency === 'AED' ? Number(a.balance || 0) : Number(a.balance || 0) / r;
                        return FinzUI.html`
                            <div class="flex justify-between items-center p-3.5 bg-slate-800/70 rounded-2xl border border-slate-700/60 text-xs">
                                <div>
                                    <span class="font-bold text-white">${a.name}</span>
                                    <span class="text-slate-400 ml-2">(${a.type})</span>
                                </div>
                                <div class="text-right">
                                    <span class="font-black text-white num-font">${a.currency} ${Number(a.balance || 0).toLocaleString()}</span>
                                    ${a.currency !== 'AED' ? FinzUI.html`<span class="text-slate-400 block text-[10px]">≈ AED ${aedVal.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- Reconciliation Solutions -->
            <div class="space-y-3 pt-2">
                <h4 class="text-xs font-black uppercase text-slate-400 tracking-wider">Recommended Actions</h4>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.syncBudgetToBankBalance() })}" class="p-4 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-2xl text-left transition-all space-y-1">
                        <div class="flex items-center gap-2 text-emerald-400 font-black text-xs uppercase tracking-wider">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i> Sync Budget to Bank
                        </div>
                        <p class="text-[11px] text-slate-300 font-medium">Sets budget starting income to match your real cash (AED ${liquidTotalAED.toLocaleString()}).</p>
                    </button>

                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.openBulkBudgetEditor() })}" class="p-4 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-2xl text-left transition-all space-y-1">
                        <div class="flex items-center gap-2 text-indigo-400 font-black text-xs uppercase tracking-wider">
                            <i data-lucide="sliders" class="w-4 h-4"></i> Adjust Envelopes
                        </div>
                        <p class="text-[11px] text-slate-300 font-medium">Reduce non-essential envelopes (Dining, Shopping, Investments) to match available cash.</p>
                    </button>
                </div>
            </div>
        </div>
    `);
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.syncBudgetToBankBalance = async function() {
    const liquidTotalAED = actions.getLiquidCashTotal();
    state.data.envelopeLedger = state.data.envelopeLedger || [];
    const credits = state.data.envelopeLedger.filter(e => e.type === 'credit');
    
    if (credits.length === 0) {
        state.data.envelopeLedger.unshift({
            id: actions.genId(),
            date: state.data.settings?.lastSalaryDate || new Date().toISOString(),
            type: 'credit',
            amount: liquidTotalAED,
            note: 'Synced to Bank Balance'
        });
    } else {
        credits[0].amount = liquidTotalAED;
        credits[0].note = 'Synced to Bank Balance';
        if (credits.length > 1) {
            const extraIds = new Set(credits.slice(1).map(c => c.id));
            state.data.envelopeLedger = state.data.envelopeLedger.filter(e => !extraIds.has(e.id));
        }
    }
    
    await actions.updateDb();
    actions.showToast(`Budget cycle income synced to real bank balance (AED ${liquidTotalAED.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})!`, "success");
    actions.renderBudgetUIOverride();
};

actions.restoreDeletedCategory = async function(cat) {
    if (!cat) return;
    const lower = cat.toLowerCase();
    let targetPillar = 'expenseCategories';
    if (lower.includes('saving') || lower.includes('fund') || lower.includes('emergency') || lower.includes('car') || lower.includes('vacation')) {
        targetPillar = 'savingsCategories';
    } else if (lower.includes('invest') || lower.includes('mf') || lower.includes('mutual') || lower.includes('stock') || lower.includes('sarwa') || lower.includes('crypto')) {
        targetPillar = 'investmentCategories';
    }
    
    state.data[targetPillar] = state.data[targetPillar] || [];
    if (!state.data[targetPillar].includes(cat)) {
        state.data[targetPillar].push(cat);
    }
    await actions.updateDb();
    actions.showToast(`Restored envelope "${cat}"! It is now visible in the budget.`, "success");
    actions.renderBudgetUIOverride();
};

actions.cleanOrphanEnvelopeFunds = async function(cat) {
    if (!cat) return;
    const stats = actions.getEnvelopeStats();
    const cStat = stats.categories[cat];
    const funded = cStat ? cStat.funded : 0;
    
    if (Math.abs(funded) < 0.005) {
        state.data.envelopeLedger = (state.data.envelopeLedger || []).filter(e => e.category !== cat);
    } else {
        state.data.envelopeLedger = state.data.envelopeLedger || [];
        state.data.envelopeLedger.push({
            id: actions.genId(),
            date: new Date().toISOString(),
            type: 'defund',
            category: cat,
            amount: funded,
            note: 'Defund deleted envelope'
        });
    }
    await actions.updateDb();
    actions.showToast(`Released AED ${funded.toLocaleString()} from "${cat}" back to Unallocated Cash!`, "success");
    actions.renderBudgetUIOverride();
};

actions.openSurplusSweepModal = function(surplusAmt) {
    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Sweep Surplus to Savings / Assets';
    
    const mainAccs = actions.activeAccounts().filter(a => ['Bank Account', 'Cash'].includes(a.type));
    const targetAccs = actions.activeAccounts().filter(a => ['Savings', 'Investment', 'Mutual Fund', 'Emergency Fund'].includes(a.type));
    
    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-xl mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.viewBudgetReports() })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div>
                    <h3 class="text-xl font-black text-white">Direct Surplus Sweep</h3>
                    <p class="text-xs text-emerald-400 font-bold">Transfer leftover monthly cash to wealth assets</p>
                </div>
            </div>

            <div class="bg-emerald-500/10 p-5 rounded-2xl border border-emerald-500/30 text-center">
                <p class="text-[10px] font-black uppercase tracking-widest text-emerald-400">Total Unspent Surplus Available</p>
                <h3 class="text-3xl font-black text-emerald-400 num-font mt-1">AED ${surplusAmt.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
            </div>
            
            <div class="space-y-4">
                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">From Account (Source)</label>
                    <select id="sweep-source" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${mainAccs.map(a => FinzUI.html`<option value="${a.id}">${a.name} - Balance: ${a.currency} ${a.balance.toLocaleString()}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">To Wealth Asset (Destination)</label>
                    <select id="sweep-target" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${targetAccs.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.type})</option>`).join('')}
                    </select>
                </div>
                
                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Sweep Amount (AED)</label>
                    <input type="number" id="sweep-amt" value="${surplusAmt}" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-emerald-400 font-black text-xl outline-none num-font">
                </div>
            </div>
            
            <button data-finz-click="${FinzUI.handler(function(event) { return actions.executeSurplusSweep() })}" class="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                <i data-lucide="arrow-right-circle" class="w-5 h-5"></i> Execute Sweep Transfer
            </button>
        </div>
    `);
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.executeSurplusSweep = async function() {
    const sId = document.getElementById('sweep-source')?.value;
    const tId = document.getElementById('sweep-target')?.value;
    const amt = parseFloat(document.getElementById('sweep-amt')?.value) || 0;
    if (!sId || !tId) return actions.showToast('Select a source and a destination account.', 'error');
    if (amt <= 0) return actions.showToast('Enter an amount greater than zero.', 'error');
    const sAcc = state.data.accounts.find(a => a.id === sId);

    // The surplus is an AED figure; both sides are booked as one linked transfer in their own currencies.
    const { to, outAmount } = await actions.recordInternalTransfer({
        fromId: sId, toId: tId, amount: amt, amountCurrency: 'AED', category: 'Transfer',
        outNote: `Surplus Sweep to ${state.data.accounts.find(a => a.id === tId)?.name || 'Savings'}`,
        inNote: `Surplus Sweep from ${sAcc?.name || 'Bank'}`
    });

    actions.renderApp();
    actions.viewBudgetReports();
    actions.showToast(`Swept ${sAcc.currency} ${outAmount.toLocaleString()} to ${to.name}!`, "success");
    if (actions.fireConfetti) actions.fireConfetti();
};

actions.getNetWorthMilestoneStats = function() {
    const r = state.data.settings?.rate || 22.75;
    
    // Calculate total net worth in INR and AED
    let totalAssetsAed = 0;
    let totalLiabilitiesAed = 0;

    (state.data.accounts || []).forEach(a => {
        const bal = a.balance || 0;
        if (a.currency === 'INR') totalAssetsAed += (bal / r);
        else totalAssetsAed += bal;
    });

    (state.data.debts || []).forEach(d => {
        if (!d.settled) {
            const amt = Number(d.amount) || 0;
            const amtAed = d.currency === 'INR' ? (amt / r) : amt;
            if (d.type === 'payable' || d.subtype === 'bnpl' || d.isBnpl) totalLiabilitiesAed += amtAed;
            else if (d.type === 'receivable') totalAssetsAed += amtAed;
        }
    });

    const netWorthAed = Math.max(0, totalAssetsAed - totalLiabilitiesAed);
    const netWorthInr = netWorthAed * r;

        const milestones = [
        { label: '₹ 10 Lakhs', inr: 1000000, desc: '1 Million INR Club' },
        { label: '₹ 15 Lakhs', inr: 1500000, desc: '1.5 Million Foundation' },
        { label: '₹ 20 Lakhs', inr: 2000000, desc: '2 Million Growth Tier' },
        { label: '₹ 25 Lakhs', inr: 2500000, desc: 'Quarter Crore Milestone' },
        { label: '₹ 30 Lakhs', inr: 3000000, desc: '3 Million Milestone' },
        { label: '₹ 35 Lakhs', inr: 3500000, desc: '3.5 Million Expansion' },
        { label: '₹ 40 Lakhs', inr: 4000000, desc: '4 Million Velocity' },
        { label: '₹ 45 Lakhs', inr: 4500000, desc: '4.5 Million Gateway' },
        { label: '₹ 50 Lakhs', inr: 5000000, desc: 'Half Crore Milestone' },
        { label: '₹ 75 Lakhs', inr: 7500000, desc: 'Three Quarter Crore' },
        { label: '₹ 1 Crore', inr: 10000000, desc: 'Crorepati Club (10M INR)' },
        { label: '₹ 1.5 Crores', inr: 15000000, desc: 'Multi-Crore Tier' },
        { label: '₹ 2 Crores', inr: 20000000, desc: 'Double Crore Milestone' },
        { label: '₹ 3 Crores', inr: 30000000, desc: 'Triple Crore Freedom' },
        { label: '₹ 5 Crores', inr: 50000000, desc: 'Financial Independence (FIRE)' }
    ];

    let currentMilestone = milestones[0];
    let prevMilestoneInr = 0;

    for (let i = 0; i < milestones.length; i++) {
        if (netWorthInr < milestones[i].inr) {
            currentMilestone = milestones[i];
            prevMilestoneInr = i > 0 ? milestones[i-1].inr : 0;
            break;
        }
        if (i === milestones.length - 1) {
            currentMilestone = { label: '₹ 10 Crores', inr: 100000000, desc: 'Ultra High Net Worth' };
            prevMilestoneInr = milestones[i].inr;
        }
    }

    const range = currentMilestone.inr - prevMilestoneInr;
    const progressInStage = Math.min(100, Math.max(0, ((netWorthInr - prevMilestoneInr) / range) * 100));
    const totalProgress = Math.min(100, (netWorthInr / currentMilestone.inr) * 100);
    const shortfallInr = Math.max(0, currentMilestone.inr - netWorthInr);
    const shortfallAed = shortfallInr / r;

    return {
        netWorthAed,
        netWorthInr,
        currentMilestone,
        progressInStage,
        totalProgress,
        shortfallInr,
        shortfallAed,
        milestones
    };
};

actions.openMilestoneModal = function() {
    const stats = actions.getNetWorthMilestoneStats();
    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    const b = document.getElementById('modal-backdrop');
    
    if (b) b.classList.replace('hidden', 'flex');
    if (titleEl) titleEl.innerText = 'Lifetime Net Worth Roadmap';

    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-4xl mx-auto space-y-6 text-left fade-in pb-16">
            <!-- Hero Card -->
            <div class="bg-gradient-to-br from-amber-500/20 via-slate-800 to-slate-900 border-2 border-amber-500/30 p-8 rounded-[2.5rem] text-center shadow-2xl relative overflow-hidden">
                <div class="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
                    <i data-lucide="trophy" class="w-48 h-48 text-amber-400"></i>
                </div>
                
                <span class="text-[10px] font-black uppercase text-amber-400 tracking-widest bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/30">Next Target Milestone</span>
                <h2 class="text-4xl md:text-5xl font-black text-white num-font mt-2">${stats.currentMilestone.label}</h2>
                <p class="text-xs font-bold text-slate-300 mt-1">${stats.currentMilestone.desc}</p>
                
                <div class="max-w-md mx-auto my-6">
                    <div class="flex justify-between items-center text-xs font-bold text-slate-300 mb-2">
                        <span>Current: ₹ ${Math.round(stats.netWorthInr).toLocaleString()}</span>
                        <span class="text-amber-400 font-black">${stats.totalProgress.toFixed(1)}% Complete</span>
                    </div>
                    <div class="w-full bg-slate-900 rounded-full h-3.5 p-0.5 border border-slate-700/60 overflow-hidden shadow-inner">
                        <div class="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full transition-all duration-1000" style="width: ${stats.totalProgress}%"></div>
                    </div>
                </div>

                <div class="inline-flex items-center gap-2 bg-slate-900/80 px-4 py-2 rounded-2xl border border-slate-700/80">
                    <i data-lucide="sparkles" class="w-4 h-4 text-amber-400"></i>
                    <span class="text-xs font-black text-emerald-400">Shortfall: ₹ ${Math.round(stats.shortfallInr).toLocaleString()} (≈ AED ${Math.round(stats.shortfallAed).toLocaleString()}) to unlock!</span>
                </div>
            </div>

            <!-- Milestone Stages Roadmap List -->
            <div class="space-y-3">
                <h3 class="text-xs font-black uppercase tracking-widest text-slate-400 px-2 flex items-center gap-2">
                    <i data-lucide="map" class="w-4 h-4 text-amber-400"></i> Wealth Milestone Progression
                </h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${stats.milestones.map(m => {
                        const isReached = stats.netWorthInr >= m.inr;
                        const isCurrent = m.inr === stats.currentMilestone.inr;
                        const pct = Math.min(100, (stats.netWorthInr / m.inr) * 100);

                        return FinzUI.html`
                            <div class="p-5 rounded-[2rem] border ${isReached ? 'bg-emerald-950/20 border-emerald-500/40 shadow-emerald-500/5' : (isCurrent ? 'bg-amber-950/20 border-amber-500/50 shadow-amber-500/10' : 'bg-slate-900/40 border-slate-800')} flex flex-col justify-between space-y-4">
                                <div class="flex justify-between items-start">
                                    <div class="flex items-center gap-3">
                                        <div class="w-10 h-10 rounded-2xl ${isReached ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : (isCurrent ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-500')} flex items-center justify-center">
                                            <i data-lucide="${isReached ? 'check-circle-2' : (isCurrent ? 'target' : 'lock')}" class="w-5 h-5"></i>
                                        </div>
                                        <div>
                                            <h4 class="text-base font-black text-white">${m.label}</h4>
                                            <p class="text-[10px] font-bold text-slate-400">${m.desc}</p>
                                        </div>
                                    </div>
                                    <span class="text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${isReached ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : (isCurrent ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-slate-800 text-slate-500')}">
                                        ${isReached ? 'Unlocked' : (isCurrent ? 'In Progress' : 'Locked')}
                                    </span>
                                </div>

                                <div>
                                    <div class="flex justify-between text-[9px] font-bold text-slate-400 mb-1">
                                        <span>Progress</span>
                                        <span class="num-font text-white">${pct.toFixed(0)}%</span>
                                    </div>
                                    <div class="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                                        <div class="h-full ${isReached ? 'bg-emerald-500' : (isCurrent ? 'bg-amber-500' : 'bg-slate-700')}" style="width: ${pct}%"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `);

    if (libraries.lucide) libraries.lucide.createIcons();
};
}
