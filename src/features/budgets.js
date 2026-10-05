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

                if (['Bank Account', 'Cash', 'Savings'].includes(a.type)) {
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
                if (!isNaN(val)) {
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
                        ).reduce((s, t) => s + parseFloat(t.amount), 0);

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
                                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Target: ${actions.fmtMoney(g.target, g.currency)} | Saved: ${actions.fmtMoney(g.saved, g.currency)}</p>
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.addGoalFunds(((g.id))) })}" class="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-bold uppercase hover:bg-emerald-100">+ Add Funds</button>
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

            if (!name || !target) return actions.showToast("Fill required fields", "error");

            if (!state.data.goals) state.data.goals = [];
            state.data.goals.push({
                id: actions.genId(),
                name, target: parseFloat(target), saved: 0, currency, icon
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

actions.saveBudgets = async function () { state.data.expenseCategories.forEach(cat => { state.data.budgets[cat] = parseFloat(document.getElementById(`budget-${cat}`).value) || 0; }); await updateDb(); actions.openModal('budget'); };

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

actions.checkBudgetWarning = function () {
            const typeEl = document.getElementById('tt');
            const warningEl = document.getElementById('tx-warning');
            if (!typeEl || !warningEl) return;
            
            const type = typeEl.value;
            const isExcluded = document.getElementById('tx-exclude-budget')?.checked || false;
            if (type !== 'expense' || isExcluded) {
                warningEl.classList.add('hidden');
                return;
            }
            const cat = document.getElementById('tc').value;
            const amt = parseFloat(document.getElementById('tam').value) || 0;
            
            // Calculate current spending for this category this month
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            
            let spent = 0;
            state.data.transactions.forEach(t => {
                if (t.type === 'expense' && t.category === cat && !t.excludeFromBudget && t.date >= startOfMonth) {
                    spent += actions.getTransactionBaseAmount(t);
                }
            });

            const budget = state.data.budgets ? (state.data.budgets[cat] || 0) : 0;
            
            if (budget > 0 && (spent + amt) > budget) {
                warningEl.innerText = `WARNING: This expense exceeds your monthly ${cat} budget by ${((spent + amt) - budget).toFixed(2)}`;
                warningEl.classList.remove('hidden');
            } else {
                warningEl.classList.add('hidden');
            }
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
        const val = parseFloat(input.value) || 0;
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
    if (firstCredit) {
        envelopeStartDate = new Date(firstCredit.date);
    } else {
        envelopeStartDate = new Date();
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

    tx.forEach(t => {
        if (new Date(t.date) >= envelopeStartDate) {
            if ((t.type === 'expense' || t.type === 'transfer_out') && t.category && !t.excludeFromBudget) {
                if (!stats.categories[t.category]) stats.categories[t.category] = { funded: 0, spent: 0, available: 0 };
                stats.categories[t.category].spent += actions.getTransactionBaseAmount(t);
            }
        }
    });

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
        
        const rateSnapshot = state.data.settings.rate;
        const date = new Date().toISOString();

        // Generate Report of outgoing cycle
        const oldStats = actions.getEnvelopeStats();
        if (!state.data.budgetReports) state.data.budgetReports = [];
        
        if (state.data.settings.lastSalaryDate) {
            state.data.budgetReports.push({
                id: actions.genId(),
                date: date, // End date of report
                startDate: state.data.settings.lastSalaryDate,
                stats: JSON.parse(JSON.stringify(oldStats))
            });
            actions.showToast("Monthly Budget Report generated!", "info");
        }

        // RESET BUDGET LEDGER (Wipe old allocations and negative balances)
        state.data.envelopeLedger = [];

        // Log the income to the bank
        state.data.transactions.push({
            id: actions.genId(), accountId: aId, amount: actions.toCurrency(amt), type: 'income', category: 'Salary', note: `Salary Credited`, date, exchangeRate: rateSnapshot
        });

        // Log the credit to the envelope system
        state.data.envelopeLedger.push({
            id: actions.genId(), date, type: 'credit', amount: amt
        });

        // Set last salary date for tracking period
        state.data.settings.lastSalaryDate = date;

        await actions.updateDb();
        actions.showToast("Salary Credited! Now allocate it.", "success");
        actions.fireConfetti();
        
        // Jump straight to the Checklist
        actions.renderBudgetUIOverride();
    } catch (err) {
        console.error(err);
        actions.showToast("An error occurred while processing", "error");
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
    
    actions.showPrompt(`Fund ${cat}`, `Enter amount to assign to ${cat}. (Unallocated Cash: ${stats.unallocatedCash})`, async (val) => {
        const amount = parseFloat(val);
        if (isNaN(amount) || amount === 0) return;
        
        // If they enter a positive number, it's funding. If negative, defunding.
        if (amount > 0 && amount > stats.unallocatedCash) {
            actions.showToast("Not enough unallocated cash!", "error");
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
    });
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
    a.download = `Budget_Report_${end.toISOString().slice(0, 10)}.txt`;
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

        doc.save(`FINZ_Budget_Report_${end.toISOString().split('T')[0]}.pdf`);
        actions.showToast("Executive PDF Report Generated!", "success");
    } catch (err) {
        console.error("PDF generation failed", err);
        actions.showToast("Failed to generate PDF. Check console.", "error");
    }
};

actions.showCategoryDetails = function(cat) {
    const txs = state.data.transactions.filter(t => (t.type === 'expense' || t.type === 'transfer_out') && t.category === cat && !t.excludeFromBudget)
                  .sort((a,b) => new Date(b.date) - new Date(a.date));
                  
    const stats = actions.getEnvelopeStats().categories[cat] || { funded: 0, spent: 0, available: 0 };

    let content = FinzUI.html`
        <div class="max-w-4xl mx-auto bg-slate-800/95 backdrop-blur-xl p-8 rounded-[2.5rem] border border-slate-700 shadow-2xl h-[85vh] flex flex-col fade-in">
            <div class="flex justify-between items-center mb-6">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.renderBudgetUIOverride() })}" class="p-2.5 bg-slate-700/50 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all"><i data-lucide="arrow-left" class="w-5 h-5"></i></button>
                <h2 class="text-xl font-black text-white uppercase tracking-widest">${cat}</h2>
                <div class="w-10"></div>
            </div>
            
            <div class="bg-slate-900/90 border border-slate-700/80 rounded-[2rem] p-6 mb-6 text-center shadow-inner">
                <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Available Balance</p>
                <h3 class="text-3xl font-black ${stats.available < 0 ? 'text-rose-400' : 'text-emerald-400'} num-font mb-4">AED ${stats.available.toLocaleString()}</h3>
                
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
            
            <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4 flex items-center gap-2"><i data-lucide="history" class="w-3.5 h-3.5"></i> Activity Log</h4>
            <div class="flex-1 overflow-auto pr-2 space-y-3 custom-scrollbar">
    `;

    if (txs.length === 0) {
        content += FinzUI.html`<p class="text-xs font-bold text-slate-400 text-center mt-10">No activity yet for this category.</p>`;
    } else {
        txs.forEach(t => {
            const acc = state.data.accounts.find(a => a.id === t.accountId);
            const cur = t.currency || (acc ? acc.currency : 'AED');
            const baseAmt = actions.getTransactionBaseAmount(t);
            const isNonBase = cur !== 'AED';
            content += FinzUI.html`
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
        });
    }

    content += FinzUI.html`</div></div>`;
    
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
        const dStr = new Date(t.date).toISOString().split('T')[0];
        if (!spendDays[dStr]) spendDays[dStr] = 0;
        spendDays[dStr] += t.amount;
    });

    if (txs.length > 0) {
        let firstTxDate = new Date(txs[txs.length-1].date);
        let now = new Date();
        
        let curr = new Date(firstTxDate);
        while (curr <= now) {
            const dStr = curr.toISOString().split('T')[0];
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
        const dStr = d.toISOString().split('T')[0];
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
                        
                        <div class="flex flex-wrap gap-2.5 mt-5 justify-center lg:justify-start">
                            ${hasTemplate && hasUnallocated ? FinzUI.html`
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.applyBudgetTemplate() })}" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20">
                                    <i data-lucide="zap" class="w-4 h-4"></i> 1-Click Auto-Fund (AED ${templateSum.toLocaleString()})
                                </button>
                            ` : ''}
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
                    <!-- Bottom Row: Chips + Add Fund Button -->
                    <div class="flex justify-between items-center pt-3 border-t border-slate-700/50">
                        <div class="text-[9px] font-bold text-slate-400 space-y-0.5">
                            <p>Funded: <span class="text-slate-200 font-black">AED ${cStats.funded.toLocaleString()}</span></p>
                            <p>Spent: <span class="${cStats.spent > 0 ? 'text-rose-400' : 'text-slate-300'} font-black">AED ${cStats.spent.toLocaleString()}</span></p>
                        </div>
                        
                        <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.promptFundCategory(((cat))) })}" title="Assign / Add Funds" class="bg-rose-600 hover:bg-rose-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md shadow-rose-600/30 shrink-0">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                        </button>
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
                    <!-- Bottom Row: Chips + Add Fund Button -->
                    <div class="flex justify-between items-center pt-3 border-t border-slate-700/50">
                        <div class="text-[9px] font-bold text-slate-400 space-y-0.5">
                            <p>Target: <span class="text-slate-200 font-black">AED ${cStats.funded.toLocaleString()}</span></p>
                            <p>Moved: <span class="text-emerald-400 font-black">AED ${savedAmount.toLocaleString()}</span></p>
                        </div>
                        
                        <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.promptFundCategory(((cat))) })}" title="Assign / Add Funds" class="bg-emerald-600 hover:bg-emerald-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md shadow-emerald-600/30 shrink-0">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                        </button>
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
                    <!-- Bottom Row: Chips + Add Fund Button -->
                    <div class="flex justify-between items-center pt-3 border-t border-slate-700/50">
                        <div class="text-[9px] font-bold text-slate-400 space-y-0.5">
                            <p>Target: <span class="text-slate-200 font-black">AED ${cStats.funded.toLocaleString()}</span></p>
                            <p>Invested: <span class="text-indigo-400 font-black">AED ${investedAmount.toLocaleString()}</span></p>
                        </div>
                        
                        <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return actions.promptFundCategory(((cat))) })}" title="Assign / Add Funds" class="bg-indigo-600 hover:bg-indigo-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-indigo-600/30 shrink-0">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                        </button>
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
    
    // Average Monthly Burn over last 90 days
    const now = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(now.getDate() - 90);
    
    const recentExpenses = state.data.transactions.filter(t => (t.type === 'expense' || t.type === 'transfer_out') && new Date(t.date) >= ninetyDaysAgo);
    
    let totalSpentAED = 0;
    recentExpenses.forEach(t => {
        const acc = state.data.accounts.find(a => a.id === t.accountId);
        const cur = acc ? acc.currency : 'AED';
        totalSpentAED += (cur === 'AED' ? Number(t.amount) : Number(t.amount) / r);
    });
    
    // Monthly burn rate (average per month)
    const monthlyBurnAED = totalSpentAED > 0 ? (totalSpentAED / 3) : (liquidTotalAED > 0 ? liquidTotalAED / 6 : 4500);
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
    
    let html = includeNone ? FinzUI.literal("<option value=\"\">-- None (Just a Transfer) --</option>") : '';
    if (exp.length > 0) {
        html += FinzUI.html`<optgroup label="🛒 Living Expenses">${exp.map(c => FinzUI.html`<option value="${c}">${c}</option>`).join('')}</optgroup>`;
    }
    if (sav.length > 0) {
        html += FinzUI.html`<optgroup label="🛡️ Savings & Sinking Funds">${sav.map(c => FinzUI.html`<option value="${c}">${c}</option>`).join('')}</optgroup>`;
    }
    if (inv.length > 0) {
        html += FinzUI.html`<optgroup label="📈 Investments">${inv.map(c => FinzUI.html`<option value="${c}">${c}</option>`).join('')}</optgroup>`;
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
    
    const keys = ['expenseCategories', 'savingsCategories', 'investmentCategories', 'incomeCategories'];
    keys.forEach(k => {
        if (state.data[k]) {
            state.data[k] = state.data[k].filter(c => c !== cat);
        }
    });
    
    await actions.updateDb();
    actions.renderApp();
    actions.refreshCategoryManager();
    actions.showToast(`Deleted "${cat}"`, "success");
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
    
    if (!state.data[type].includes(val)) {
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
    const template = state.data.budgetTemplate;
    if (!template || Object.keys(template).length === 0) {
        actions.showToast("No saved template found. Click 'Save Current as Template' first!", "info");
        return;
    }
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
    if (amt <= 0) return;
    
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

actions.openSurplusSweepModal = function(surplusAmt) {
    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Sweep Surplus to Savings / Assets';
    
    const mainAccs = state.data.accounts.filter(a => ['Bank Account', 'Cash'].includes(a.type));
    const targetAccs = state.data.accounts.filter(a => ['Savings', 'Investment', 'Mutual Fund', 'Emergency Fund'].includes(a.type));
    
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
                        ${mainAccs.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency}) - Balance: AED ${a.balance.toLocaleString()}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">To Wealth Asset (Destination)</label>
                    <select id="sweep-target" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${targetAccs.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.type})</option>`).join('')}
                    </select>
                </div>
                
                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Sweep Amount</label>
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
    if (amt <= 0 || !sId || !tId) return;

    const sAcc = state.data.accounts.find(a => a.id === sId);
    const tAcc = state.data.accounts.find(a => a.id === tId);
    const date = new Date().toISOString();
    const rateSnapshot = state.data.settings?.rate || 22.75;

    // Outflow from Source
    state.data.transactions.push({
        id: actions.genId(),
        accountId: sId,
        amount: -amt,
        type: 'transfer_out',
        category: 'Transfer',
        note: `Surplus Sweep to ${tAcc?.name || 'Savings'}`,
        date,
        exchangeRate: rateSnapshot
    });

    // Inflow to Target
    state.data.transactions.push({
        id: actions.genId(),
        accountId: tId,
        amount: amt,
        type: 'transfer_in',
        category: 'Transfer',
        note: `Surplus Sweep from ${sAcc?.name || 'Bank'}`,
        date,
        exchangeRate: rateSnapshot
    });

    actions.recalculateBalances();
    await actions.updateDb();
    actions.renderApp();
    actions.viewBudgetReports();
    actions.showToast(`Swept AED ${amt.toLocaleString()} to ${tAcc?.name || 'Savings'}!`, "success");
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
