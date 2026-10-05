// Accounts behavior and screens. Dependencies stay inside the application context.
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

actions.fetchMetalsRate = async function fetchMetalsRate() { return; };

actions.recalcDynamicAssets = function () { return; };

actions.toggleGroup = function (id) {
            // Deprecated
        };

actions.openGroupDetails = function (type, subtype, currency) {
            const items = state.data.accounts.filter(a => {
                if (a.currency !== currency) return false;
                if (type === 'Commodity') return a.type === 'Commodity' && (a.subtype || 'Commodity') === subtype;
                if (type === 'Mutual Fund') return a.type === 'Mutual Fund';
                return false;
            });

            if (items.length === 0) return;

            const t = document.getElementById('modal-title');
            const c = document.getElementById('modal-content');
            const b = document.getElementById('modal-backdrop');

            // 1. Calculate Stats
            const totalVal = items.reduce((s, a) => s + (Number(a.balance) || 0), 0);
            const isPriv = state.data.settings?.isPrivate;

            let statHtml = '';
            if (type === 'Commodity') {
                const totalWeight = items.reduce((s, a) => s + (a.weight || 0), 0);
                statHtml = FinzUI.html`<div class="bg-slate-800/80 p-5 rounded-3xl border border-amber-500/30 text-center">
                    <p class="text-[10px] font-black uppercase text-amber-400 tracking-widest mb-1">Total Weight</p>
                    <p class="text-2xl font-black text-white">${totalWeight.toFixed(2)}g</p>
                </div>`;
            } else if (type === 'Mutual Fund') {
                statHtml = FinzUI.html`<div class="bg-slate-800/80 p-5 rounded-3xl border border-blue-500/30 text-center">
                    <p class="text-[10px] font-black uppercase text-blue-400 tracking-widest mb-1">Portfolio Count</p>
                    <p class="text-2xl font-black text-white">${items.length} <span class="text-xs text-slate-400 font-bold">Funds</span></p>
                </div>`;
            }

            t.innerText = `${subtype || type} (${currency})`;
            FinzUI.setHTML(c, FinzUI.html`
                <div class="space-y-6 max-w-xl mx-auto text-left">
                    <!-- Dashboard Header -->
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-slate-800/80 p-5 rounded-3xl border border-emerald-500/30 text-center">
                            <p class="text-[10px] font-black uppercase text-emerald-400 tracking-widest mb-1">Total Portfolio Value</p>
                            <p class="text-2xl font-black text-white num-font">${isPriv ? '••••' : actions.fmtMoney(totalVal, currency)}</p>
                        </div>
                        ${statHtml}
                    </div>

                    <!-- Distribution Chart -->
                    ${items.length > 1 ? FinzUI.html`
                    <div class="bg-slate-900/90 p-6 rounded-[2.5rem] border border-slate-800 shadow-xl text-center">
                        <h4 class="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Fund Allocation Breakdown</h4>
                        <div class="relative h-44 w-full">
                            <canvas id="group-chart"></canvas>
                        </div>
                    </div>` : ''}

                    <!-- Item List -->
                    <div class="space-y-3">
                        <div class="flex justify-between items-center px-1">
                            <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest">Holdings in Portfolio (${items.length})</h4>
                            <span class="text-[9px] font-bold text-slate-500">Tap fund to view ledger</span>
                        </div>
                        <div class="space-y-2">
                            ${items.map(a => actions.renderAssetCard(a)).join('')}
                        </div>
                    </div>

                    <!-- Quick Action -->
                    <div class="pt-2">
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('accounts') })}" class="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2">
                            <i data-lucide="plus" class="w-4 h-4 text-emerald-400"></i> Add New Fund
                        </button>
                    </div>
                </div>
            `);
            b.classList.replace('hidden', 'flex');
            lucide.createIcons();

            // Render Chart
            if (items.length > 1) {
                setTimeout(() => {
                    const ctx = document.getElementById('group-chart');
                    if (ctx) {
                        const labels = items.map(a => a.name);
                        const data = items.map(a => a.balance);
                        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316'];

                        let existingChart = Chart.getChart(ctx);
                        if (existingChart) existingChart.destroy();
                        new Chart(ctx, {
                            type: 'doughnut',
                            data: {
                                labels: labels,
                                datasets: [{
                                    data: data,
                                    backgroundColor: colors,
                                    borderWidth: 0,
                                    hoverOffset: 8
                                }]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: {
                                        display: true,
                                        position: 'bottom',
                                        labels: {
                                            color: '#94a3b8',
                                            font: { size: 10, weight: 'bold' },
                                            boxWidth: 10,
                                            padding: 12
                                        }
                                    }
                                },
                                cutout: '65%'
                            }
                        });
                    }
                }, 100);
            }
        };

actions.renderAssetsList = function renderAssetsList(reg, items) {
            const container = document.getElementById(`${reg}-list`); if (!container) return;
            if (items.length === 0) { FinzUI.setHTML(container, FinzUI.html`<div class="p-8 border border-dashed border-slate-700 rounded-[2rem] text-center text-slate-500 uppercase text-[10px] font-black">No accounts</div>`); return; }

            // Grouping for Mutual Funds
            const mfItems = items.filter(a => a.type === 'Mutual Fund');
            const otherItems = items.filter(a => a.type !== 'Mutual Fund');

            let html = '';

            // If there are 2 or more Mutual Funds in this list, aggregate them into a single Mutual Funds card
            if (mfItems.length > 1) {
                const totalBal = mfItems.reduce((s, a) => s + (Number(a.balance) || 0), 0);
                const cur = mfItems[0]?.currency || (reg === 'uae' ? 'AED' : 'INR');
                const isPriv = state.data.settings?.isPrivate;

                html += FinzUI.html`
                    <div data-finz-click="${FinzUI.handler(function(event) { return actions.openGroupDetails('Mutual Fund', 'Mutual Funds', ((cur))) })}" class="bg-gradient-to-r from-blue-900/20 via-slate-800/60 to-slate-800/80 backdrop-blur-md p-4 rounded-[1.5rem] flex justify-between items-center border border-blue-500/30 shadow-sm cursor-pointer hover:border-blue-400/60 hover:bg-slate-800 transition-all text-center group">
                        <div class="flex items-center space-x-4 text-left">
                            <div class="w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner bg-blue-500/15 border border-blue-500/30 text-blue-400">
                                <i data-lucide="pie-chart" class="w-6 h-6"></i>
                            </div>
                            <div>
                                <p class="font-bold text-slate-100 text-sm flex items-center gap-2 tracking-wide">
                                    Mutual Funds
                                    <span class="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full text-[9px] font-black">${mfItems.length} Funds</span>
                                    <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform"></i>
                                </p>
                                <p class="text-[9px] text-blue-400/80 uppercase font-black tracking-widest">Aggregated Portfolio • Tap to View All</p>
                            </div>
                        </div>
                        <div class="text-right">
                            <p class="font-black text-slate-100 text-base num-font">${isPriv ? '••••' : actions.fmtMoney(totalBal, cur)}</p>
                            <span class="text-[8px] font-black text-slate-400 uppercase tracking-wider">Total Value</span>
                        </div>
                    </div>
                `;
            } else if (mfItems.length === 1) {
                html += actions.renderAssetCard(mfItems[0]);
            }

            // Render all other accounts (Bank Accounts, Cash, Savings, Commodities, Real Estate, Crypto, etc.)
            html += otherItems.map(a => actions.renderAssetCard(a)).join('');

            FinzUI.setHTML(container, FinzUI.html`<div class="space-y-3">${html}</div>`);
        };

actions.delAccount = async function (id) {
            actions.showConfirm("Permanently wipe?", "This will delete the account and cannot be undone.", async () => {
                state.data.accounts = state.data.accounts.filter(x => x.id !== id);
                await updateDb();
                actions.closeModal();
            });
        };

actions.calcCommodityBalance = function () {
            const at = document.getElementById('at')?.value;
            const invType = document.getElementById('inv-type')?.value;
            if (at !== 'Commodity' && !(at === 'Investment' && invType === 'Commodity')) return;

            const metal = document.getElementById('commodity-type')?.value || 'Gold';
            const currency = document.getElementById('ac')?.value || 'AED';
            const weight = parseFloat(document.getElementById('aw')?.value) || 0;
            const hintEl = document.getElementById('commodity-rate-hint');
            
            // Get Rate per gram
            let rate = 0;
            if (currency === 'AED') {
                rate = (state.data.commodityRatesAED && state.data.commodityRatesAED[metal]) ? state.data.commodityRatesAED[metal] : (metal === 'Gold' ? 315 : (metal === 'Silver' ? 3.5 : 0));
            } else {
                rate = (state.data.commodityRates && state.data.commodityRates[metal]) ? state.data.commodityRates[metal] : (metal === 'Gold' ? 7200 : (metal === 'Silver' ? 90 : 0));
            }

            if (hintEl) {
                if (rate > 0) {
                    hintEl.innerText = `Current rate: ${currency} ${rate}/g${weight > 0 ? ` • Est. Value: ${currency} ${(rate * weight).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : ''}`;
                } else {
                    hintEl.innerText = '';
                }
            }

            // If weight is entered and rate is available, auto-populate the balance field
            const balInput = document.getElementById('ab');
            if (balInput && weight > 0 && rate > 0) {
                balInput.value = (weight * rate).toFixed(2);
            }
        };

actions.toggleAssetFields = function () {
            const type = document.getElementById('at')?.value;
            const invType = document.getElementById('inv-type')?.value;

            // Toggle Secondary Dropdown logic
            const isInv = type === 'Investment';
            const invContainer = document.getElementById('inv-type-container');
            if (invContainer) invContainer.classList.toggle('hidden', !isInv);

            // Hide All Dynamic First
            ['inp-commodity', 'inp-fund', 'inp-re', 'inp-crypto', 'inp-bond', 'inp-emf'].forEach(id => {
                document.getElementById(id)?.classList.add('hidden');
            });

            // Balance note & label customization
            const lblBal = document.getElementById('lbl-balance');
            const noteBal = document.getElementById('inp-balance-note');
            const balDiv = document.getElementById('inp-balance');
            if (balDiv) balDiv.classList.remove('hidden'); // ALWAYS visible for all account types!

            if (type === 'Real Estate') {
                document.getElementById('inp-re')?.classList.remove('hidden');
                if (lblBal) lblBal.innerText = 'Property Valuation';
                if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Enter total estimated property market value'; }
            }
            else if (isInv) {
                if (invType === 'Commodity') {
                    document.getElementById('inp-commodity')?.classList.remove('hidden');
                    if (lblBal) lblBal.innerText = 'Total Valuation / Cost';
                    if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Auto-calculated from weight or enter manual total value'; }
                    actions.calcCommodityBalance();
                }
                else if (invType === 'Mutual Fund') {
                    document.getElementById('inp-fund')?.classList.remove('hidden');
                    if (lblBal) lblBal.innerText = 'Invested / Current Fund Value';
                    if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Enter initial invested amount or current fund value'; }
                }
                else if (invType === 'Crypto') {
                    document.getElementById('inp-crypto')?.classList.remove('hidden');
                    if (lblBal) lblBal.innerText = 'Total Crypto Value';
                    if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Enter total current crypto holding value'; }
                }
                else if (invType === 'Bond') {
                    document.getElementById('inp-bond')?.classList.remove('hidden');
                    if (lblBal) lblBal.innerText = 'Principal / Deposit Amount';
                    if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Enter deposit principal amount'; }
                }
                else {
                    if (lblBal) lblBal.innerText = 'Investment Value / Initial Amount';
                    if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Enter current value or invested amount'; }
                }
            }
            else if (type === 'Emergency Fund') {
                document.getElementById('inp-emf')?.classList.remove('hidden');
                if (lblBal) lblBal.innerText = 'Current Saved Balance';
                if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Enter current liquid emergency funds already saved'; }
            }
            else if (type === 'Bank Account') {
                if (lblBal) lblBal.innerText = 'Current Account Balance';
                if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Enter available liquid cash in bank'; }
            }
            else {
                if (lblBal) lblBal.innerText = 'Current Balance';
                if (noteBal) { noteBal.classList.remove('hidden'); noteBal.innerText = 'Enter current cash/wallet balance'; }
            }
        };

actions.saveAccount = async function () {
            const n = document.getElementById('an')?.value?.trim();
            const c = document.getElementById('ac')?.value || 'AED';
            let t = document.getElementById('at')?.value;
            // Resolve Nested Type
            if (t === 'Investment') {
                t = document.getElementById('inv-type')?.value || 'General';
                if (t === 'General') t = 'Investment'; // Fallback to generic
            }

            const bal = parseFloat(document.getElementById('ab')?.value) || 0;
            const w = parseFloat(document.getElementById('aw')?.value) || 0;
            const u = parseFloat(document.getElementById('au')?.value) || 0;
            const code = document.getElementById('asc')?.value;
            const emfTarget = document.getElementById('emf-target') ? parseFloat(document.getElementById('emf-target').value) : null;

            // Capture Extra Fields
            let subtype = (t === 'Commodity') ? (document.getElementById('commodity-type')?.value || 'Gold') :
                (t === 'Asset' ? 'General' : null);

            const category = document.getElementById('mf-cat')?.value || document.getElementById('re-type')?.value || 'General';
            const location = document.getElementById('re-loc')?.value;
            const area = document.getElementById('re-area')?.value;
            const vehicle = { make: document.getElementById('veh-make')?.value, model: document.getElementById('veh-model')?.value, year: document.getElementById('veh-year')?.value };
            const crypto = { sym: document.getElementById('cry-sym')?.value, net: document.getElementById('cry-net')?.value };
            const collectible = { brand: document.getElementById('col-brand')?.value, cond: document.getElementById('col-cond')?.value };

            if (!n) {
                actions.showToast("Please enter an asset identifier/name", "error");
                return;
            }
            actions.setBtnLoading('btn-save-acc', true);

            const newAcc = {
                id: actions.genId(),
                name: n,
                currency: c,
                type: t,
                balance: bal,
                weight: w,
                units: u,
                schemeCode: code,
                subtype: subtype,
                category: category,
                details: { location, area, ...vehicle, ...crypto, ...collectible }
            };
            if (t === 'Emergency Fund' && !isNaN(emfTarget) && emfTarget !== null) {
                newAcc.target = emfTarget;
                if (!state.data.settings) state.data.settings = {};
                state.data.settings.emfTarget = emfTarget;
            }

            if (t === 'Commodity') {
                newAcc.subtype = document.getElementById('commodity-type')?.value || 'Gold';
            } else if (t === 'Mutual Fund') {
                newAcc.category = document.getElementById('mf-cat')?.value || 'Equity';
            }

            if (bal !== 0) {
                newAcc.balance = 0; // Starts at 0, transaction will fill it
                state.data.transactions.push({
                    id: actions.genId(),
                    accountId: newAcc.id,
                    amount: actions.toCurrency(bal),
                    type: 'income',
                    category: 'Opening Balance',
                    note: 'Initial Balance',
                    tags: ['#init'],
                    date: new Date().toISOString(),
                    exchangeRate: state.data.settings.rate
                });
            } else {
                newAcc.balance = 0;
            }

            state.data.accounts.push(newAcc);

            try {
                await actions.updateDb();
            } catch (err) {
                console.error("Error saving account to DB:", err);
                actions.setBtnLoading('btn-save-acc', false);
                return;
            }
            
            actions.setBtnLoading('btn-save-acc', false);
            actions.closeModal();
            actions.showToast(`Asset "${n}" added successfully!`, "success");
            actions.recalculateBalances();
            actions.renderApp();
        };

actions.viewAccountLedger = function (id) {
            const a = state.data.accounts.find(x => x.id === id);
            if (!a) return;

            const ts = state.data.transactions.filter(t => t.accountId === id).sort((x, y) => new Date(y.date) - new Date(x.date));
            const t = document.getElementById('modal-title'), c = document.getElementById('modal-content');

            t.innerText = a.name;

            // --- METRICS CALCULATION ---
            const r = state.data.settings.rate;
            const isInv = !['Bank Account', 'Cash', 'Savings'].includes(a.type);

            // 1. Current Value (in INR for uniform display, or native?)
            // Let's show Native + INR equivalent
            const curNative = a.balance;
            const curINR = a.currency === 'AED' ? curNative * r : curNative;

            // 2. Invested Amount (Net Inflow)
            // Transfer In / Income = Deposit, Transfer Out / Expense = Withdrawal
            const deps = ts.filter(t => t.type === 'transfer_in' || t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
            const withs = ts.filter(t => t.type === 'transfer_out' || t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);

            // For commodities OR Mutual Funds OR any investment, use originalCost if available + net transfers
            let investedNative;

            // Base calculation from ledger (Deposits - Withdrawals)
            const netTransfers = deps - withs;

            // If historical cost is set, add it. This is the "Base".
            if (a.originalCost !== undefined && a.originalCost > 0) {
                investedNative = a.originalCost + netTransfers;
            } else {
                investedNative = Math.max(0, netTransfers);
            }
            if (investedNative === 0 && curNative > 0) {
                investedNative = curNative;
            }

            const investedINR = a.currency === 'AED' ? investedNative * r : investedNative;

            // 3. Profit / Loss & Projections (REMOVED: Cost-Basis Only)

            // --- RENDER UI ---
            FinzUI.setHTML(c, FinzUI.html`
                <div class="space-y-8 max-w-2xl mx-auto">
                    
                    <!--HERO CARD-->
                    <div class="bg-slate-900 text-white p-8 rounded-[3rem] text-center shadow-xl relative overflow-hidden">
                        <div class="relative z-10">
                            <p class="text-[10px] text-emerald-400 font-black uppercase mb-1 tracking-widest">${isInv ? 'Total Invested Amount' : 'Current Balance'}</p>
                            <div class="flex items-baseline justify-center space-x-2">
                                <span class="text-4xl font-black">${a.currency} ${curNative.toLocaleString()}</span>
                            </div>
                            ${a.currency === 'AED' ? FinzUI.html`<p class="text-xs text-slate-500 font-bold mt-1">≈ ₹${Math.round(curINR).toLocaleString()}</p>` : ''}
                        </div>
                    </div>

                    <!--ACTIONS -->
                    ${isInv ? FinzUI.html`
                      <div class="grid grid-cols-3 gap-2 mb-4">
                           <button data-finz-click="${FinzUI.handler(function(event) { return actions.quickInvest(((id))) })}" class="w-full py-4 bg-emerald-500 text-white rounded-2xl font-black uppercase text-[9px] tracking-widest hover:bg-emerald-600 transition-all shadow-md">+ Invest More</button>
                           <button data-finz-click="${FinzUI.handler(function(event) { return actions.quickLiquidate(((id))) })}" class="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black uppercase text-[9px] tracking-widest hover:bg-slate-200 transition-all">- Liquidate</button>
                           <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('subscriptions') })}" class="w-full py-4 bg-indigo-500 text-white rounded-2xl font-black uppercase text-[9px] tracking-widest hover:bg-indigo-600 transition-all shadow-md"><i data-lucide="refresh-cw" class="w-3 h-3 inline mr-1"></i> Auto-SIP</button>
                      </div>` : ''}
                      <div class="flex justify-center space-x-4">
                         ${isInv ? FinzUI.html`<button data-finz-click="${FinzUI.handler(function(event) { return actions.editOriginalCost(((id))) })}" class="px-6 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs uppercase hover:bg-slate-200 transition-all">Set Initial Investment</button>` : ''}
                         <button data-finz-click="${FinzUI.handler(function(event) { return actions.delAccount(((id))) })}" class="px-6 py-3 bg-red-50 text-red-500 rounded-xl font-bold text-xs uppercase hover:bg-red-100 transition-all">Delete Asset</button>
                    </div>

                    <!--LEDGER -->
                    <div class="space-y-4 text-left mt-8">
                        <h4 class="text-xs font-black uppercase text-slate-400 tracking-widest px-2">Recent History</h4>
                        ${ts.map(t => {
                            const isPositive = t.type === 'income' || t.type === 'transfer_in';
                            const color = isPositive ? 'text-emerald-400' : 'text-rose-400';
                            const sign = isPositive ? '+' : '-';
                            return FinzUI.html`<div class="p-5 bg-slate-900/50 border border-slate-700/50 rounded-[2rem] flex justify-between items-center hover:bg-slate-800/80 transition-colors">
                                        <div class="truncate pr-4">
                                            <p class="font-black text-sm text-slate-100 truncate">${t.category || 'Transfer'}</p>
                                            <p class="text-[9px] font-bold text-slate-500 uppercase mt-0.5 truncate">${new Date(t.date).toLocaleDateString()} — ${t.note || '-'}</p>
                                        </div>
                                        <p class="font-black text-sm ${color} whitespace-nowrap">${sign}${Number(t.amount).toLocaleString()}</p>
                                    </div>`;
                        }).join('') || FinzUI.literal("<div class=\"p-8 text-center border border-dashed border-slate-700/50 rounded-3xl text-slate-500 text-xs font-bold uppercase tracking-widest mt-4\">No transactions recorded</div>")}
                    </div>
                </div> `);

            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
        };

actions.setOriginalCost = async function () {
            const commodities = state.data.accounts.filter(a =>
                a.type === 'Commodity' || (a.subtype && ['Gold', 'Silver', 'Platinum', 'Palladium', 'Oil', 'Diamond'].includes(a.subtype))
            );

            if (commodities.length === 0) {
                actions.showToast('No commodity accounts found', 'info');
                return;
            }

            // Show list of commodities
            const list = commodities.map((acc, idx) =>
                `${idx + 1}. ${acc.name} (${acc.subtype || 'Commodity'}) - Current: ${acc.originalCost !== undefined ? acc.currency + ' ' + acc.originalCost : 'Not Set'}`
            ).join('\n');

            actions.showPrompt(
                'Set Original Cost',
                `Select commodity by number:\n\n${list}\n\nEnter: [Number] [Amount]\nExample: 1 750`,
                async (input) => {
                    const parts = input.trim().split(' ');
                    if (parts.length !== 2) {
                        actions.showToast('Invalid format. Use: [Number] [Amount]', 'error');
                        return;
                    }

                    const idx = parseInt(parts[0]) - 1;
                    const cost = parseFloat(parts[1]);

                    if (isNaN(idx) || idx < 0 || idx >= commodities.length || isNaN(cost)) {
                        actions.showToast('Invalid input', 'error');
                        return;
                    }

                    const acc = commodities[idx];
                    const accIdx = state.data.accounts.findIndex(a => a.id === acc.id);
                    state.data.accounts[accIdx].originalCost = cost;

                    await updateDb();
                    actions.showToast(`Original cost set to ${acc.currency} ${cost} for ${acc.name}`, 'success');
                    actions.renderApp();
                },
                'text'
            );
        };

actions.editOriginalCost = function (id) {
            const acc = state.data.accounts.find(a => a.id === id);
            if (!acc) return;

            actions.showPrompt(
                "Set Initial Investment",
                `Enter the amount you invested BEFORE you started using this app.\n\n(Current Set Value: ${acc.originalCost || 0} ${acc.currency})`,
                async (val) => {
                    const cost = parseFloat(val);
                    if (isNaN(cost) || cost < 0) {
                        return actions.showToast("Invalid Amount", "error");
                    }

                    acc.originalCost = cost;
                    await updateDb();
                    actions.recalculateBalances(); // Instantly apply new base value
                    actions.showToast("Initial Investment Updated!", "success");

                    // Refresh View
                    actions.viewAccountLedger(id);
                    actions.renderApp();
                },
                'number',
                acc.originalCost || '' // Pre-fill
            );
        };

actions.quickInvest = function(accId) {
            const acc = state.data.accounts.find(a => a.id === accId);
            if (!acc) return;

            actions.showConfirm("Invest Funds", FinzUI.html`
                <div class="space-y-4 text-left">
                    <p class="text-xs text-slate-500 font-bold mb-4">Add capital to <span class="text-emerald-600">${acc.name}</span>.</p>
                    <div>
                        <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Investment Amount (${acc.currency})</label>
                        <input type="number" id="quick-inv-amt" class="w-full p-4 bg-emerald-50 border-emerald-100 rounded-xl font-black text-2xl text-emerald-700 outline-none focus:border-emerald-500 text-center" placeholder="0.00">
                    </div>
                    <div>
                        <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Paid From</label>
                        <select id="quick-inv-source" class="text-slate-900 w-full p-3 bg-slate-50 border rounded-xl font-bold text-xs outline-none focus:border-emerald-500">
                            ${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(a =>
                                FinzUI.html`<option value="${a.id}">${a.name} (${actions.toCurrency(a.balance)} ${a.currency})</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
            `, async () => {
                const amt = parseFloat(document.getElementById('quick-inv-amt').value);
                const sId = document.getElementById('quick-inv-source').value;
                if (!amt || amt <= 0 || !sId) return actions.showToast("Invalid Amount", "error");
                
                const sAcc = state.data.accounts.find(a => a.id === sId);
                const tIdx = state.data.accounts.findIndex(a => a.id === accId);
                if (!sAcc || tIdx === -1) return;

                // Create Expense on Source
                await actions.saveTransaction({
                    id: actions.genId(),
                    accountId: sAcc.id,
                    type: 'transfer_out',
                    amount: amt,
                    currency: acc.currency, // Input is in dest currency
                    category: 'Investment',
                    note: `Transfer to ${acc.name}`,
                    date: new Date().toISOString(),
                    transferTo: acc.id
                });

                // Create Income on Dest
                await actions.saveTransaction({
                    id: actions.genId(),
                    accountId: acc.id,
                    type: 'transfer_in',
                    amount: amt,
                    currency: acc.currency,
                    category: 'Investment',
                    note: `Transfer from ${sAcc.name}`,
                    date: new Date().toISOString(),
                    transferFrom: sAcc.id
                });

                // Note: originalCost is strictly for the manual 'Initial Investment' opening balance now.
                // The ledger will automatically sum this 'transfer_in' during recalculateBalances.

                actions.renderApp();
                actions.viewAccountLedger(acc.id);
                actions.showToast("Investment Recorded Successfully", "success");
            }, "Confirm Investment");
        };

actions.quickLiquidate = function(accId) {
            const acc = state.data.accounts.find(a => a.id === accId);
            if (!acc) return;

            actions.showConfirm("Liquidate Asset", FinzUI.html`
                <div class="space-y-4 text-left">
                    <p class="text-xs text-slate-500 font-bold mb-4">Withdraw capital from <span class="text-indigo-600">${acc.name}</span>.</p>
                    <div>
                        <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Withdrawal Amount (${acc.currency})</label>
                        <input type="number" id="quick-liq-amt" class="text-slate-900 w-full p-4 bg-slate-50 border rounded-xl font-black text-2xl text-slate-700 outline-none focus:border-indigo-500 text-center" placeholder="0.00">
                    </div>
                    <div>
                        <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Deposit To</label>
                        <select id="quick-liq-dest" class="text-slate-900 w-full p-3 bg-slate-50 border rounded-xl font-bold text-xs outline-none focus:border-indigo-500">
                            ${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(a =>
                                FinzUI.html`<option value="${a.id}">${a.name} (${actions.toCurrency(a.balance)} ${a.currency})</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
            `, async () => {
                const amt = parseFloat(document.getElementById('quick-liq-amt').value);
                const tId = document.getElementById('quick-liq-dest').value;
                if (!amt || amt <= 0 || !tId) return actions.showToast("Invalid Amount", "error");
                
                const tAcc = state.data.accounts.find(a => a.id === tId);
                const sIdx = state.data.accounts.findIndex(a => a.id === accId);
                if (!tAcc || sIdx === -1) return;

                // Create Expense on Source (Asset)
                await actions.saveTransaction({
                    id: actions.genId(),
                    accountId: acc.id,
                    type: 'transfer_out',
                    amount: amt,
                    currency: acc.currency,
                    category: 'Liquidation',
                    note: `Withdrawal to ${tAcc.name}`,
                    date: new Date().toISOString(),
                    transferTo: tAcc.id
                });

                // Create Income on Dest (Bank)
                await actions.saveTransaction({
                    id: actions.genId(),
                    accountId: tAcc.id,
                    type: 'transfer_in',
                    amount: amt,
                    currency: acc.currency, // Sent in Asset's currency, auto-converted by ledger logic if Bank is different
                    category: 'Liquidation',
                    note: `Liquidation from ${acc.name}`,
                    date: new Date().toISOString(),
                    transferFrom: acc.id
                });

                // Note: originalCost is strictly for the manual 'Initial Investment' opening balance now.
                // The ledger will automatically sum this 'transfer_out' during recalculateBalances.

                actions.renderApp();
                actions.viewAccountLedger(acc.id);
                actions.showToast("Liquidation Recorded Successfully", "success");
            }, "Confirm Liquidation");
        };

actions.getMetalsInvestedStats = function () {
    const r = state.data.settings?.rate || 22.75;
    const goldHoldings = state.data.accounts.filter(a => (a.type === 'Investment' || a.type === 'Commodity') && (a.subtype === 'Gold' || (a.name || '').toLowerCase().includes('gold')));
    const silverHoldings = state.data.accounts.filter(a => (a.type === 'Investment' || a.type === 'Commodity') && (a.subtype === 'Silver' || (a.name || '').toLowerCase().includes('silver')));
    
    const totalGoldAED = goldHoldings.reduce((sum, a) => sum + (a.currency === 'AED' ? Number(a.balance) : Number(a.balance) / r), 0);
    const totalGoldINR = totalGoldAED * r;
    
    const totalSilverAED = silverHoldings.reduce((sum, a) => sum + (a.currency === 'AED' ? Number(a.balance) : Number(a.balance) / r), 0);
    const totalSilverINR = totalSilverAED * r;
    
    return {
        totalGoldAED,
        totalGoldINR,
        goldCount: goldHoldings.length,
        goldHoldings,
        totalSilverAED,
        totalSilverINR,
        silverCount: silverHoldings.length,
        silverHoldings
    };
};

actions.openEmergencyFundWizard = function () {
    // Auto-calculate monthly burn
    const r = state.data.settings?.rate || 22.75;
    const now = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(now.getDate() - 90);

    const recentExp = (state.data.transactions || []).filter(t =>
        ['expense', 'transfer_out'].includes(t.type) && new Date(t.date) >= ninetyDaysAgo
    );

    let totalExpAED = 0;
    recentExp.forEach(t => {
        const acc = state.data.accounts.find(a => a.id === t.accountId);
        const cur = acc ? acc.currency : 'AED';
        totalExpAED += cur === 'AED' ? Number(t.amount) : Number(t.amount) / r;
    });
    const monthlyBurn = recentExp.length > 0 ? totalExpAED / 3 : (state.data.settings?.expectedSalary || 5000) * 0.7;
    const salary = state.data.settings?.expectedSalary || 0;

    const c = document.getElementById('modal-content');
    const t = document.getElementById('modal-title');
    if (t) t.innerText = 'Emergency Fund Setup';

    FinzUI.setHTML(c, FinzUI.html`
    <div class="max-w-md mx-auto space-y-6 fade-in pb-10">
        <!-- Hero -->
        <div class="bg-gradient-to-br from-emerald-500/20 via-slate-800 to-slate-900 border-2 border-emerald-500/30 rounded-[2.5rem] p-8 text-center shadow-2xl">
            <div class="w-16 h-16 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 rounded-3xl flex items-center justify-center mx-auto mb-4">
                <i data-lucide="shield" class="w-8 h-8"></i>
            </div>
            <h2 class="text-xl font-black text-white mb-2">Set Up Your Safety Net</h2>
            <p class="text-xs font-bold text-slate-300 leading-relaxed">Your Emergency Fund is cash set aside to cover life's unexpected shocks — job loss, medical emergencies, urgent travel home. We'll calculate the right target for you.</p>
        </div>

        <!-- Auto-detected stats -->
        <div class="grid grid-cols-2 gap-4">
            <div class="bg-slate-800/90 rounded-2xl p-4 border border-slate-700/80 text-center">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Avg Monthly Spend</p>
                <p class="text-lg font-black text-rose-400 num-font">AED ${monthlyBurn.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                <p class="text-[9px] font-bold text-slate-500">90-day average</p>
            </div>
            <div class="bg-slate-800/90 rounded-2xl p-4 border border-slate-700/80 text-center relative">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Monthly Salary</p>
                <div class="flex justify-center items-center gap-1">
                    <span class="text-lg font-black text-emerald-400">AED</span>
                    <input type="number" value="${salary > 0 ? salary : ''}" placeholder="0" class="text-lg font-black text-emerald-400 num-font bg-transparent border-b border-emerald-500/30 outline-none w-24 text-center focus:border-emerald-500" data-finz-change="${FinzUI.handler(function(event) { return actions.updateEmfSalary(this.value) })}">
                </div>
                <p class="text-[9px] font-bold text-slate-500 mt-1">editable</p>
            </div>
        </div>

        <!-- Step 1: Buffer months selection -->
        <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg space-y-4">
            <p class="text-xs font-black text-white">Step 1 — How many months of safety buffer do you need?</p>
            <p class="text-[10px] font-bold text-slate-400">Choose based on your financial situation:</p>
            <div class="grid grid-cols-2 gap-3">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.selectEmfMonths(3) })}" id="emf-btn-3" class="p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-left hover:border-emerald-500/60 transition-all emf-month-btn">
                    <p class="text-lg font-black text-white">3 Months</p>
                    <p class="text-[10px] font-bold text-slate-400">Stable job, dual income</p>
                </button>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.selectEmfMonths(6) })}" id="emf-btn-6" class="p-4 rounded-2xl border-2 border-emerald-500/60 bg-emerald-500/10 text-left transition-all emf-month-btn">
                    <p class="text-lg font-black text-emerald-300">6 Months</p>
                    <p class="text-[10px] font-bold text-slate-400">Single income expat <span class="text-emerald-400">★ Recommended</span></p>
                </button>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.selectEmfMonths(9) })}" id="emf-btn-9" class="p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-left hover:border-emerald-500/60 transition-all emf-month-btn">
                    <p class="text-lg font-black text-white">9 Months</p>
                    <p class="text-[10px] font-bold text-slate-400">Family breadwinner</p>
                </button>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.selectEmfMonths(12) })}" id="emf-btn-12" class="p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-left hover:border-emerald-500/60 transition-all emf-month-btn">
                    <p class="text-lg font-black text-white">12 Months</p>
                    <p class="text-[10px] font-bold text-slate-400">Business owner / self-employed</p>
                </button>
            </div>
        </div>

        <!-- Step 2: Calculated Target Preview -->
        <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg space-y-4">
            <p class="text-xs font-black text-white">Step 2 — Your Emergency Fund Target</p>
            <div class="bg-slate-900/90 rounded-2xl p-4 border border-slate-700/50 text-center">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Formula: Monthly Burn × Months Buffer</p>
                <p id="emf-formula-line" class="text-[10px] font-bold text-slate-300 mb-3">AED ${monthlyBurn.toLocaleString(undefined, {maximumFractionDigits: 0})} × 6 months</p>
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Calculated Target</p>
                <p id="emf-target-display" class="text-3xl font-black text-emerald-400 num-font mt-1">AED ${(monthlyBurn * 6).toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                <input type="number" id="emf-custom-target" class="mt-4 w-full bg-slate-800 border border-slate-700 text-white p-3 rounded-xl text-center font-black text-sm outline-none focus:border-emerald-500 placeholder-slate-500" placeholder="Or enter custom target..." data-finz-input="${FinzUI.handler(function(event) { return document.getElementById('emf-target-display').innerText = 'AED ' + (parseFloat(this.value) || 0).toLocaleString() })}">
            </div>

            <!-- Monthly top-up suggestion -->
            <div id="emf-topup-info" class="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                <p class="text-[10px] font-bold text-emerald-300">To reach your target in 12 months, top up <span id="emf-monthly-topup" class="font-black text-emerald-400">AED ${((monthlyBurn * 6) / 12).toLocaleString(undefined, {maximumFractionDigits: 0})}</span> per month</p>
            </div>
        </div>

        <!-- Step 3: Account Name -->
        <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg space-y-3">
            <p class="text-xs font-black text-white">Step 3 — Name & Currency</p>
            <input type="text" id="emf-name" value="Emergency Fund" class="w-full bg-slate-900 border border-slate-700 text-white p-4 rounded-2xl font-bold outline-none focus:border-emerald-500">
            <select id="emf-currency" class="w-full bg-slate-900 border border-slate-700 text-white p-4 rounded-2xl font-bold">
                <option value="AED">AED (UAE Dirham)</option>
                <option value="INR">INR (Indian Rupee)</option>
            </select>
            <input type="number" id="emf-initial-balance" placeholder="Current balance (if any)" class="w-full bg-slate-900 border border-slate-700 text-white p-4 rounded-2xl font-bold outline-none focus:border-emerald-500 placeholder-slate-500">
        </div>

        <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveEmergencyFund() })}" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 text-sm">
            <i data-lucide="shield-check" class="w-5 h-5"></i> Create My Emergency Fund
        </button>
    </div>`);

    // Store auto-calculated values for use in wizard
    actions._emfMonthlyBurn = monthlyBurn;
    actions._emfSelectedMonths = 6; // default
    lucide.createIcons();
};

actions.updateEmfSalary = function(val) {
    const newVal = Number(val) || 0;
    if (!state.data.settings) state.data.settings = {};
    state.data.settings.expectedSalary = newVal;
    actions.showToast("Salary updated. Recalculating...", "success");
    // Recalculate target
    const burn = state.data.settings.expectedSalary * 0.7; // Fallback if no transactions
    // Wait, the wizard calculates it as totalExpAED / 3 or expectedSalary * 0.7
    // To make it easy, just re-render the wizard which will recalculate everything
    setTimeout(() => actions.openEmergencyFundWizard(), 500);
};

actions.selectEmfMonths = function (months) {
    actions._emfSelectedMonths = months;
    // Update button styles
    [3, 6, 9, 12].forEach(m => {
        const btn = document.getElementById(`emf-btn-${m}`);
        if (btn) {
            if (m === months) {
                btn.className = 'p-4 rounded-2xl border-2 border-emerald-500/60 bg-emerald-500/10 text-left transition-all emf-month-btn';
            } else {
                btn.className = 'p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-left hover:border-emerald-500/60 transition-all emf-month-btn';
            }
        }
    });

    // Update target preview
    const burn = actions._emfMonthlyBurn || 0;
    const target = burn * months;
    const formulaEl = document.getElementById('emf-formula-line');
    const targetEl = document.getElementById('emf-target-display');
    const topupEl = document.getElementById('emf-monthly-topup');

    if (formulaEl) formulaEl.innerText = `AED ${burn.toLocaleString(undefined, {maximumFractionDigits: 0})} × ${months} months`;
    if (targetEl) targetEl.innerText = `AED ${target.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
    if (topupEl) topupEl.innerText = `AED ${(target / 12).toLocaleString(undefined, {maximumFractionDigits: 0})}`;
};

actions.saveEmergencyFund = async function () {
    const name = document.getElementById('emf-name')?.value || 'Emergency Fund';
    const currency = document.getElementById('emf-currency')?.value || 'AED';
    const initialBalance = parseFloat(document.getElementById('emf-initial-balance')?.value) || 0;
    const customTarget = parseFloat(document.getElementById('emf-custom-target')?.value);
    const months = actions._emfSelectedMonths || 6;
    const burn = actions._emfMonthlyBurn || 0;
    const target = customTarget > 0 ? customTarget : (burn * months);

    // Create the account
    const newAcc = {
        id: 'acc_' + Date.now(),
        name: name,
        type: 'Emergency Fund',
        currency: currency,
        balance: initialBalance,
        createdAt: new Date().toISOString()
    };

    if (!state.data.accounts) state.data.accounts = [];
    state.data.accounts.push(newAcc);

    // Store target in settings
    if (!state.data.settings) state.data.settings = {};
    state.data.settings.emfTarget = target;
    state.data.settings.emfMonths = months;
    state.data.settings.emfMonthlyBurn = burn;
    state.data.settings.emfAccountId = newAcc.id;

    await actions.updateDb();
    actions.recalculateBalances();
    actions.renderApp();
    actions.closeModal();
    actions.showToast(`Emergency Fund created! Target: AED ${target.toLocaleString(undefined, {maximumFractionDigits: 0})}`, 'success');

    // Auto-open the dashboard
    setTimeout(() => actions.openEmergencyFundDashboard(), 300);
};

actions.openEmergencyFundDashboard = function (accId) {
    let emfAcc;
    if (accId) {
        emfAcc = state.data.accounts.find(a => a.id === accId);
    } else {
        emfAcc = state.data.accounts.find(a => a.type === 'Emergency Fund');
    }
    if (!emfAcc) {
        actions.openEmergencyFundWizard();
        return;
    }
    
    const target = emfAcc.target || state.data.settings?.emfTarget || 0;
    if (target === 0) {
        actions.editEmfTarget(emfAcc.id);
        return;
    }

    const balance = emfAcc.balance || 0;
    const currency = emfAcc.currency || 'AED';
    const months = state.data.settings?.emfMonths || 6;
    const burn = state.data.settings?.emfMonthlyBurn || 0;
    const progress = Math.min(100, (balance / target) * 100);
    const shortfall = Math.max(0, target - balance);
    const monthsToComplete = burn > 0 && shortfall > 0 ? (shortfall / (burn * 0.2)).toFixed(1) : '0';
    const r = state.data.settings?.rate || 22.75;

    const b = document.getElementById('modal-backdrop');
    const titleEl = document.getElementById('modal-title');
    const c = document.getElementById('modal-content');
    if (b) b.classList.replace('hidden', 'flex');
    if (titleEl) titleEl.innerText = 'Emergency Fund';

    let statusLabel = 'Building Safety Net';
    let statusColor = 'text-amber-400';
    if (progress >= 100) { statusLabel = '✅ Fully Funded'; statusColor = 'text-emerald-400'; }
    else if (progress >= 50) { statusLabel = '🔥 Halfway There!'; statusColor = 'text-amber-300'; }
    else if (progress < 20) { statusLabel = '⚠️ Just Started'; statusColor = 'text-rose-400'; }

    // Get recent top-ups (income to EMF)
    const emfTxs = (state.data.transactions || [])
        .filter(t => t.accountId === emfAcc.id)
        .sort((a,b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);

    FinzUI.setHTML(c, FinzUI.html`
    <div class="max-w-md mx-auto space-y-6 fade-in pb-12">
        <!-- Hero Progress Card -->
        <div class="bg-gradient-to-br from-emerald-500/20 via-slate-800 to-slate-900 border-2 border-emerald-500/30 rounded-[2.5rem] p-8 text-center shadow-2xl relative overflow-hidden">
            <div class="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
                <i data-lucide="shield" class="w-40 h-40 text-emerald-400"></i>
            </div>
            <p class="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">Emergency Fund</p>
            <h2 class="text-5xl font-black text-white num-font mb-1">${actions.fmtMoney(balance, currency)}</h2>
            <p class="${statusColor} text-xs font-black uppercase tracking-wider mb-6">${statusLabel}</p>
            
            <!-- Ring Progress Indicator -->
            <div class="relative w-32 h-32 mx-auto mb-4">
                <svg class="w-full h-full -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#1e293b" stroke-width="10"/>
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#10b981" stroke-width="10"
                        stroke-dasharray="${Math.PI * 100}"
                        stroke-dashoffset="${Math.PI * 100 * (1 - progress / 100)}"
                        stroke-linecap="round"
                        class="transition-all duration-1000"/>
                </svg>
                <div class="absolute inset-0 flex items-center justify-center">
                    <p class="text-2xl font-black text-white">${progress.toFixed(0)}%</p>
                </div>
            </div>
            
            <div class="w-full bg-slate-900/80 rounded-full h-2.5 overflow-hidden border border-slate-700/50 mt-2">
                <div class="h-full bg-gradient-to-r from-emerald-700 to-emerald-400 transition-all duration-700" style="width: ${progress}%"></div>
            </div>
        </div>

        <!-- Stats Grid -->
        <div class="grid grid-cols-2 gap-4">
            <div class="bg-slate-800/90 rounded-[2rem] p-5 border border-slate-700/80 text-center">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Target</p>
                <p class="text-lg font-black text-white num-font">${actions.fmtMoney(target, currency)}</p>
                <p class="text-[9px] font-bold text-slate-400">${months} months buffer</p>
            </div>
            <div class="bg-slate-800/90 rounded-[2rem] p-5 border border-slate-700/80 text-center">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Shortfall</p>
                <p class="text-lg font-black ${shortfall > 0 ? 'text-rose-400' : 'text-emerald-400'} num-font">${shortfall > 0 ? actions.fmtMoney(shortfall, currency) : 'Fully Funded!'}</p>
                ${shortfall > 0 ? FinzUI.html`<p class="text-[9px] font-bold text-slate-400">~${monthsToComplete} months to complete</p>` : ''}
            </div>
        </div>

        <!-- Monthly Burn Info -->
        <div class="bg-slate-800/90 rounded-2xl p-5 border border-slate-700/80 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                    <i data-lucide="trending-down" class="w-5 h-5"></i>
                </div>
                <div>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Avg Monthly Burn</p>
                    <p class="text-base font-black text-white num-font">AED ${burn.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-[9px] font-bold text-slate-400">To fund in 6 months:</p>
                <p class="text-sm font-black text-emerald-400">+AED ${(shortfall / 6).toLocaleString(undefined, {maximumFractionDigits: 0})}/mo</p>
            </div>
        </div>

        <!-- Recent Activity -->
        <div class="bg-slate-800/90 rounded-[2rem] p-5 border border-slate-700/80 space-y-3">
            <p class="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2"><i data-lucide="history" class="w-4 h-4 text-emerald-400"></i> Recent EMF Transactions</p>
            ${emfTxs.length > 0 ? emfTxs.map(t => FinzUI.html`
            <div class="flex justify-between items-center p-3 rounded-xl bg-slate-900/60 border border-slate-700/50">
                <div>
                    <p class="text-xs font-black text-white">${t.note || 'Top-up'}</p>
                    <p class="text-[9px] font-bold text-slate-400">${new Date(t.date).toLocaleDateString()}</p>
                </div>
                <p class="text-sm font-black ${t.type === 'income' || t.type === 'transfer_in' ? 'text-emerald-400' : 'text-rose-400'} num-font">
                    ${t.type === 'income' || t.type === 'transfer_in' ? '+' : '-'} ${actions.fmtMoney(t.amount, currency)}
                </p>
            </div>`).join('') : FinzUI.html`<p class="text-xs font-bold text-slate-400 text-center py-4">No transactions yet. Start topping up your fund!</p>`}
        </div>

        <!-- Action Buttons -->
        <div class="grid grid-cols-2 gap-4">
            <button data-finz-click="${FinzUI.handler(function(event) { return actions.viewAccountLedger(((emfAcc.id))) })}" class="p-4 bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 rounded-2xl text-center transition-all">
                <i data-lucide="list" class="w-5 h-5 text-slate-300 mx-auto mb-1.5"></i>
                <p class="text-[10px] font-black text-slate-300 uppercase tracking-wider">Ledger</p>
            </button>
            <button data-finz-click="${FinzUI.handler(function(event) { return actions.editEmfTarget(((emfAcc.id))) })}" class="p-4 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-2xl text-center transition-all">
                <i data-lucide="edit-3" class="w-5 h-5 text-emerald-400 mx-auto mb-1.5"></i>
                <p class="text-[10px] font-black text-emerald-400 uppercase tracking-wider">Edit Target</p>
            </button>
            <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteEmfAccount(((emfAcc.id))) })}" class="p-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-2xl text-center transition-all col-span-2">
                <i data-lucide="trash-2" class="w-5 h-5 text-rose-400 mx-auto mb-1.5"></i>
                <p class="text-[10px] font-black text-rose-400 uppercase tracking-wider">Delete Fund</p>
            </button>
        </div>
    </div>`);

    lucide.createIcons();
};

actions.editEmfTarget = async function (id) {
    const acc = state.data.accounts.find(a => a.id === id) || state.data.accounts.find(a => a.type === 'Emergency Fund');
    if (!acc) return;
    const currentTarget = acc.target || state.data.settings?.emfTarget || 0;
    const val = prompt(`Enter new target amount for ${acc.name} (${acc.currency || 'AED'}):`, currentTarget || '');
    if (val !== null && val.trim() !== '') {
        const parsed = parseFloat(val);
        if (!isNaN(parsed) && parsed >= 0) {
            acc.target = parsed;
            if (!state.data.settings) state.data.settings = {};
            state.data.settings.emfTarget = parsed;
            await actions.updateDb();
            actions.recalculateBalances();
            actions.renderApp();
            actions.openEmergencyFundDashboard(acc.id);
            actions.showToast("Emergency Fund target updated!", "success");
        } else {
            alert("Please enter a valid positive number.");
        }
    }
};

actions.deleteEmfAccount = async function (id) {
    const acc = state.data.accounts.find(a => a.id === id);
    const name = acc ? acc.name : 'this Emergency Fund';
    if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) return;
    
    state.data.accounts = (state.data.accounts || []).filter(a => a.id !== id);
    state.data.transactions = (state.data.transactions || []).filter(t => t.accountId !== id);
    if (state.data.settings?.emfAccountId === id) {
        delete state.data.settings.emfAccountId;
    }
    await actions.updateDb();
    actions.closeModal();
    actions.recalculateBalances();
    actions.renderApp();
    actions.showToast(`Deleted ${name}`, "success");
};
}
