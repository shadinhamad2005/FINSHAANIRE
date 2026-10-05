// Reports behavior and screens. Dependencies stay inside the application context.
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

actions.setChartCurrency = function (cur) {
            actions.chartCurrency = cur;
            actions.renderDashboard(true);
        };

actions.toChartCur = function (val, nativeCur, rate) {
            if (!rate) rate = (typeof state !== 'undefined' && state && state.data && state.data.settings && state.data.settings.rate) ? state.data.settings.rate : 22.75;
            if (actions.chartCurrency === 'INR') {
                return nativeCur === 'AED' ? val * rate : val;
            } else {
                return nativeCur === 'INR' ? val / rate : val;
            }
        };

actions.renderReportsTab = function () {
            const container = document.getElementById('annual-report-container');
            if (!container) return;
            
            const txCount = state.data.transactions ? state.data.transactions.length : 0;
            let firstDateStr = 'Recent';
            if (txCount > 0) {
                const sorted = [...state.data.transactions].sort((a,b) => new Date(a.date) - new Date(b.date));
                firstDateStr = new Date(sorted[0].date).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
            }
            const todayStr = new Date().toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});

            FinzUI.setHTML(container, FinzUI.html`
                <div class="absolute -top-10 -right-10 w-40 h-40 bg-rose-500/10 rounded-full blur-3xl"></div>
                <div class="absolute -bottom-10 -left-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl"></div>
                <div class="relative z-10 flex flex-col items-center justify-center space-y-4 py-4 text-center">
                    <div class="w-16 h-16 bg-gradient-to-br from-rose-500 to-rose-700 rounded-3xl flex items-center justify-center mb-1 shadow-lg shadow-rose-600/30 transform transition-transform hover:scale-105 cursor-pointer" data-finz-click="${FinzUI.handler(function(event) { return actions.generateAnnualReport() })}">
                        <i data-lucide="file-text" class="w-8 h-8 text-white"></i>
                    </div>
                    <div>
                        <h4 class="text-white font-black uppercase tracking-widest text-lg">Financial Statement & Annual Report</h4>
                        <div class="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full mt-2">
                            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span class="text-[10px] font-black text-emerald-300 uppercase tracking-wider">Unlocked & Ready (${txCount} Records)</span>
                        </div>
                    </div>
                    <p class="text-slate-300 text-xs font-medium max-w-md text-center leading-relaxed">
                        Complete institutional-grade PDF statement with inflow/outflow analysis, expense breakdown, and transaction ledger audit from <b>${firstDateStr}</b> to <b>${todayStr}</b>.
                    </p>
                    
                    <div class="w-full max-w-sm mt-4">
                       <button data-finz-click="${FinzUI.handler(function(event) { return actions.generateAnnualReport() })}" class="w-full bg-rose-600 hover:bg-rose-500 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest transition-all shadow-xl shadow-rose-600/30 flex items-center justify-center gap-2">
                            <i data-lucide="download" class="w-4 h-4"></i> Download PDF Statement
                       </button>
                    </div>
                </div>
            `);
            lucide.createIcons();
        };

actions.generateAnnualReport = function () {
            try {
                const { jsPDF } = libraries.jspdf;
                const doc = new jsPDF();
                
                const today = new Date();
                let firstDate = new Date();
                if (state.data.transactions && state.data.transactions.length > 0) {
                    const sorted = [...state.data.transactions].sort((a,b) => new Date(a.date) - new Date(b.date));
                    firstDate = new Date(sorted[0].date);
                }
                
                const lastYear = new Date();
                lastYear.setDate(today.getDate() - 365);
                const startDate = firstDate > lastYear ? firstDate : lastYear;
                
                let yearlyTx = (state.data.transactions || []).filter(t => new Date(t.date) >= startDate);
                if (yearlyTx.length === 0) yearlyTx = [...(state.data.transactions || [])];
                
                let sumInc = 0;
                let sumExp = 0;
                let cats = {};
                
                yearlyTx.forEach(t => {
                    const acc = state.data.accounts.find(a => a.id === t.accountId);
                    const currency = acc ? acc.currency : 'AED';
                    t._currency = currency;
                    
                    const amtBas = actions.toChartCur(parseFloat(t.amount), currency);

                    if (['income', 'transfer_in'].includes(t.type)) sumInc += amtBas;
                    if (['expense', 'transfer_out'].includes(t.type)) {
                        sumExp += amtBas;
                        cats[t.category] = (cats[t.category] || 0) + amtBas;
                    }
                });
                
                // PAGE 1: Corporate Title Page
                doc.setFillColor(15, 23, 42); 
                doc.rect(0, 0, 210, 297, 'F'); // Full bleed dark
                
                // Logo/Accent
                doc.setDrawColor(225, 29, 72);
                doc.setLineWidth(1.5);
                doc.line(20, 140, 190, 140);
                
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(32);
                doc.setFont("helvetica", "bold");
                doc.text("FINZSHAANIREE", 20, 120);
                
                doc.setTextColor(225, 29, 72);
                doc.setFontSize(18);
                doc.text("FINANCIAL STATEMENT & ANNUAL REPORT", 20, 130);
                
                doc.setTextColor(150, 150, 150);
                doc.setFontSize(11);
                doc.setFont("helvetica", "normal");
                const cycleText = `Reporting Period: ${startDate.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`;
                doc.text(cycleText, 20, 150);
                doc.text(`Account Holder: ${state.user?.email || 'Valued Client'}`, 20, 158);
                
                doc.text("Generated securely by the FINZSHAANIREE Wealth Engine.", 20, 280);
                
                // PAGE 2: Financial Summary
                doc.addPage();
                doc.setFillColor(250, 250, 250);
                doc.rect(0, 0, 210, 297, 'F');
                
                doc.setFillColor(15, 23, 42);
                doc.rect(0, 0, 210, 30, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(14);
                doc.setFont("helvetica", "bold");
                doc.text("EXECUTIVE FINANCIAL SUMMARY", 14, 20);
                
                doc.setTextColor(50, 50, 50);
                doc.setFontSize(12);
                doc.text("Cashflow & Allocation Overview", 14, 45);
                
                doc.setFontSize(10);
                doc.setFont("helvetica", "normal");
                doc.text(`Gross Inflows: ${actions.chartCurrency || 'AED'} ${sumInc.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 14, 55);
                doc.text(`Gross Outflows: ${actions.chartCurrency || 'AED'} ${sumExp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 14, 62);
                const netCashflow = sumInc - sumExp;
                doc.setTextColor(netCashflow >= 0 ? 16 : 225, netCashflow >= 0 ? 185 : 29, netCashflow >= 0 ? 129 : 72);
                doc.setFont("helvetica", "bold");
                doc.text(`Net Inflow / Savings: ${actions.chartCurrency || 'AED'} ${netCashflow.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 14, 69);
                
                doc.setTextColor(50, 50, 50);
                doc.setFont("helvetica", "bold");
                doc.text("Category Breakdown (Expenses & Outflows)", 14, 90);
                
                let sortCats = Object.entries(cats).sort((a,b) => b[1] - a[1]);
                let y = 100;
                doc.setFont("helvetica", "normal");
                for (let i = 0; i < Math.min(sortCats.length, 10); i++) {
                    let pct = sumExp > 0 ? ((sortCats[i][1] / sumExp) * 100).toFixed(1) : 0;
                    doc.text(`• ${sortCats[i][0]}: ${actions.chartCurrency || 'AED'} ${sortCats[i][1].toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${pct}%)`, 14, y);
                    y += 7;
                }
                
                // Algorithmic Persona Generation
                y += 15;
                doc.setFont("helvetica", "bold");
                doc.setTextColor(15, 23, 42);
                doc.text("Financial Profile Diagnosis:", 14, y);
                
                y += 8;
                doc.setFont("helvetica", "italic");
                doc.setTextColor(80, 80, 80);
                let persona = "Balanced Accumulator";
                let personaDesc = "Stable inflows with disciplined, categorized spending across life priorities.";
                
                const foodAmt = cats['Food'] || 0;
                const invAmt = cats['Investment'] || 0;
                
                if (sumExp > 0) {
                    if ((foodAmt / sumExp) > 0.3) {
                        persona = "Lifestyle Spender";
                        personaDesc = "A significant portion of capital is deployed towards dining and lifestyle maintenance.";
                    } else if ((invAmt / sumExp) > 0.4) {
                        persona = "Aggressive Saver & Investor";
                        personaDesc = "High capital allocation towards long-term asset accumulation relative to outflows.";
                    } else if (netCashflow < 0) {
                        persona = "Capital Depleter";
                        personaDesc = "Outflows exceeded inflows over this period. Budget re-alignment recommended.";
                    }
                }
                
                doc.text(`"${persona}"`, 14, y);
                y += 7;
                doc.setFont("helvetica", "normal");
                doc.text(personaDesc, 14, y);
                
                // PAGE 3: Ledger Appendices
                doc.addPage();
                doc.setFillColor(15, 23, 42);
                doc.rect(0, 0, 210, 30, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(14);
                doc.setFont("helvetica", "bold");
                doc.text("TRANSACTION LEDGER AUDIT LOG", 14, 20);
                
                // Sort by date desc
                const topTx = yearlyTx.sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 60);
                
                const tableBody = topTx.map(t => [
                    new Date(t.date).toLocaleDateString(),
                    t.category || 'General',
                    t.type || 'expense',
                    `${t._currency || 'AED'} ${parseFloat(t.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}`
                ]);
                
                doc.autoTable({
                    startY: 40,
                    head: [['Date', 'Category', 'Type', 'Amount']],
                    body: tableBody,
                    theme: 'striped',
                    headStyles: { fillColor: [15, 23, 42] },
                    styles: { fontSize: 8 },
                    columnStyles: { 3: { halign: 'right' } }
                });
                
                doc.save(`FINZ_Financial_Report_${today.toISOString().split('T')[0]}.pdf`);
                actions.showToast("Financial Statement PDF Downloaded!", "success");
            } catch (err) {
                console.error("PDF Generate Error", err);
                actions.showToast("Failed to generate PDF: " + err.message, "error");
            }
        };

actions.renderZakatCalculator = function () {
            const r = state.data.settings.rate;
            // 1. Calculate Qualifying Assets
            let qualifying = 0;
            const breakdown = { 'Gold': 0, 'Cash': 0, 'Shares': 0 };

            state.data.accounts.forEach(a => {
                const val = a.currency === 'AED' ? a.balance * r : a.balance;

                // INCLUSIONS
                if (['Bank Account', 'Cash', 'Savings'].includes(a.type)) {
                    qualifying += val;
                    breakdown['Cash'] += val;
                }
                else if (a.type === 'Commodity' && (a.subtype === 'Gold' || a.subtype === 'Silver')) {
                    qualifying += val;
                    breakdown['Gold'] += val;
                }
                else if (a.type === 'Mutual Fund' || a.type === 'Investment') {
                    qualifying += val;
                    breakdown['Shares'] += val;
                }
                // EXCLUSIONS: Real Estate, Vehicle, Collectibles
            });

            // 2. Liabilities (Immedaite) -> Deductible
            // Simplified: All Payable Debts not settled
            let liabilities = 0;
            state.data.debts.filter(d => d.type === 'payable' && !d.settled).forEach(d => {
                const val = Number(d.amount) * (d.currency === 'AED' ? r : 1);
                liabilities += val;
            });

            const netZakatable = Math.max(0, qualifying - liabilities);
            const zakatDue = netZakatable * 0.025; // 2.5%

            // Nisab Check (Silver Standard: 595 grams of pure Silver)
            const silverRate = (state.data.commodityRates && state.data.commodityRates.Silver) ? state.data.commodityRates.Silver : 90;
            const nisab = silverRate * 595;
            const isEligible = netZakatable >= nisab;

            // BNPL Calculation (assuming this is a separate section within the same UI)
            const totalIncome = state.data.transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + parseFloat(t.amount), 0);
            const totalExpenses = state.data.transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + parseFloat(t.amount), 0);
            const freeCash = totalIncome - totalExpenses;
            const discretionary = Math.max(0, freeCash - (state.data.fixedCategories || []).reduce((sum, cat) => sum + ((state.data.budgets && state.data.budgets[cat]) || 0), 0));
            const availableCapacity = discretionary * 0.20; // 20% of discretionary income for BNPL

            // Save zakatDue globally for the payment modal
            actions.currentZakatDue = zakatDue;

            return FinzUI.html`<div class="max-w-xl mx-auto space-y-8 text-center">
                 <div class="bg-slate-900 text-white p-8 rounded-[3rem] shadow-xl relative overflow-hidden">
                    <div class="relative z-10">
                        <p class="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1">Zakat Liability (2.5%)</p>
                        <h3 class="text-5xl font-black text-emerald-400 mb-2 num-font">₹${Math.round(zakatDue).toLocaleString()}</h3>
                        <p class="text-slate-400 font-medium text-xs">${isEligible ? 'Passed Nisab Threshold' : 'Below Nisab Threshold (Optional)'}</p>
                    </div>
                </div>

                <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm text-left">
                     <h4 class="text-[10px] font-black uppercase text-slate-400 mb-6 tracking-widest px-2">Calculation Breakdown</h4>
                     
                     <div class="space-y-4 text-sm font-bold text-slate-700">
                        <div class="text-slate-900 flex justify-between items-center p-3 bg-slate-50 rounded-2xl">
                            <span>Qualifying: Gold & Silver</span>
                             <span class="num-font">₹${Math.round(breakdown['Gold']).toLocaleString()}</span>
                        </div>
                        <div class="text-slate-900 flex justify-between items-center p-3 bg-slate-50 rounded-2xl">
                            <span>Qualifying: Cash & Bank</span>
                             <span class="num-font">₹${Math.round(breakdown['Cash']).toLocaleString()}</span>
                        </div>
                        <div class="text-slate-900 flex justify-between items-center p-3 bg-slate-50 rounded-2xl">
                            <span>Qualifying: Shares & Investments</span>
                             <span class="num-font">₹${Math.round(breakdown['Shares']).toLocaleString()}</span>
                        </div>
                        <hr class="border-slate-100">
                        <div class="flex justify-between items-center px-3 text-red-500">
                            <span>Less: Immediate Debts</span>
                             <span class="num-font">- ₹${Math.round(liabilities).toLocaleString()}</span>
                        </div>
                        <div class="flex justify-between items-center px-3 text-lg font-black text-slate-900 pt-2 border-b border-slate-100 pb-2">
                            <span>Net Zakatable Wealth</span>
                             <span class="num-font">₹${Math.round(netZakatable).toLocaleString()}</span>
                        </div>
                        <div class="flex justify-between items-center px-3 text-slate-500 text-xs pt-1">
                            <span>Nisab Threshold (Silver: 595g @ ₹${silverRate}/g)</span>
                             <span class="num-font">₹${Math.round(nisab).toLocaleString()}</span>
                        </div>
                     </div>
                </div>

                <button data-finz-click="${FinzUI.handler(function(event) { return actions.initZakatPaymentFlow() })}" class="w-full bg-emerald-500 text-white p-5 rounded-3xl font-black uppercase shadow-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2">
                    <i data-lucide="check-circle" class="w-5 h-5"></i> Record Zakat Payment
                </button>
            </div>`;
        };

actions.renderZakatPaymentModal = function () {
            const zakatAmount = actions.currentZakatDue ? Math.round(actions.currentZakatDue) : 0;
            const validAccounts = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type));
            
            let accountOptions = validAccounts.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency} ${a.balance.toLocaleString()})</option>`).join('');

            return FinzUI.html`<div class="text-slate-900 max-w-md mx-auto bg-white p-8 rounded-[2.5rem] text-left space-y-6">
                <div class="text-center">
                    <div class="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-500">
                        <i data-lucide="heart-handshake" class="w-8 h-8"></i>
                    </div>
                    <h3 class="text-2xl font-black text-slate-900 mb-1">Pay Zakat</h3>
                    <p class="text-sm text-slate-500 font-medium">Fulfill your obligation accurately.</p>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Payment Amount (INR Base)</label>
                        <input type="number" id="zakat-pay-amount" value="${zakatAmount}" class="text-slate-900 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-all num-font">
                    </div>
                    <div>
                        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Pay From Account</label>
                        <select id="zakat-pay-account" class="text-slate-900 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-bold">
                            ${accountOptions}
                        </select>
                    </div>
                </div>

                <button id="btn-process-zakat" data-finz-click="${FinzUI.handler(function(event) { return actions.processZakatPayment() })}" class="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg flex items-center justify-center space-x-2">
                    <span id="btn-process-zakat-text">Confirm Payment</span>
                </button>
            </div>`;
        };

actions.processZakatPayment = async function () {
            const amt = parseFloat(document.getElementById('zakat-pay-amount').value);
            const accId = document.getElementById('zakat-pay-account').value;

            if (!amt || amt <= 0 || !accId) {
                actions.showToast("Please enter a valid amount and select an account.", "error");
                return;
            }

            const acc = state.data.accounts.find(a => a.id === accId);
            if (!acc) return;

            // Convert INR base amount to account's currency
            const r = state.data.settings.rate;
            let finalDeduction = amt;
            if (acc.currency === 'AED') {
                finalDeduction = amt / r;
            }

            if (acc.balance < finalDeduction) {
                actions.showToast("Insufficient funds in selected account.", "error");
                return;
            }

            actions.setBtnLoading('btn-process-zakat', true);

            // Deduct from account
            acc.balance -= finalDeduction;

            // Create Transaction
            const newTx = {
                id: actions.genId(),
                accountId: accId,
                type: 'expense',
                amount: finalDeduction,
                currency: acc.currency,
                category: 'Zakat',
                date: new Date().toISOString().split('T')[0],
                note: 'Annual Zakat Payment',
                timestamp: Date.now()
            };

            state.data.transactions.push(newTx);
            
            await actions.updateDb();
            actions.showToast("Zakat payment recorded successfully! May Allah accept it.", "success");
            actions.closeModal();
            actions.renderDashboard(true);
        };

actions.initZakatPaymentFlow = function () {
            const currentRate = (state.data.commodityRates && state.data.commodityRates.Silver) ? state.data.commodityRates.Silver : 90;
            actions.showPrompt('Confirm Silver Rate', `Enter current silver market rate (INR/gram). Current stored rate is ₹${currentRate}.`, async (val) => {
                const rate = parseFloat(val);
                if (isNaN(rate) || rate <= 0) {
                    actions.showToast("Invalid rate entered.", "error");
                    return;
                }
                
                if (!state.data.commodityRates) state.data.commodityRates = {};
                state.data.commodityRates.Silver = rate;
                
                // Recalculate implicitly by running render function (updates global window.currentZakatDue)
                actions.renderZakatCalculator();
                
                // Persist new rate
                await actions.updateDb();
                
                // Open payment modal
                actions.openModal('zakat_payment');
            }, 'number');
        };

actions.renderCalculator = function () {
            // Simple SIP Projector
            return FinzUI.html`<div class="text-slate-900 max-w-md mx-auto bg-white p-8 rounded-[3rem] border shadow-xl text-center space-y-6">
                <h3 class="font-black text-xl">SIP Projector</h3>
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="text-[9px] font-bold uppercase text-slate-400">Monthly Inv</label><input type="number" id="sip-amt" value="5000" class="w-full p-3 border rounded-xl font-bold text-center"></div>
                    <div><label class="text-[9px] font-bold uppercase text-slate-400">Return %</label><input type="number" id="sip-rate" value="12" class="w-full p-3 border rounded-xl font-bold text-center"></div>
                </div>
                <div><label class="text-[9px] font-bold uppercase text-slate-400">Time Period (Years)</label><input type="range" id="sip-years" min="1" max="30" value="10" class="w-full accent-emerald-500" data-finz-input="${FinzUI.handler(function(event) { document.getElementById('yr-val').innerText = this.value + ' Years'; return actions.calcSIP() })}"> <p id="yr-val" class="font-black text-emerald-600">10 Years</p></div>
                <div class="text-slate-900 bg-slate-50 p-6 rounded-3xl"><p class="text-xs text-slate-400 font-bold uppercase">Estimated Value</p><p id="sip-result" class="text-4xl font-black text-emerald-600 mt-2">₹0</p></div>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.calcSIP() })}" class="w-full bg-slate-900 text-white py-3 rounded-xl font-bold uppercase text-xs">Calculate</button>
            </div> `;
        };

actions.renderDashboard = function (instant = false) {
            const c = document.getElementById('modal-content');

            // --- DATA PREP ---
            const r = state.data.settings.rate;
            const d = new Date(); d.setMonth(d.getMonth() - 1); // Last 30 Days snapshot for velocity/rhythm
            const txs = state.data.transactions;

            // 1. CALC FINANCIAL HEALTH SCORE VARIABLES
            // A. Savings Rate (Last 30 Days)
            const last30Inc = txs.filter(t => t.type === 'income' && new Date(t.date) >= d).reduce((s, t) => s + actions.toChartCur(Number(t.amount), t.currency || 'AED', r), 0);
            const last30Exp = txs.filter(t => t.type === 'expense' && new Date(t.date) >= d).reduce((s, t) => s + actions.toChartCur(Number(t.amount), t.currency || 'AED', r), 0);
            const savingsRate = last30Inc > 0 ? Math.max(0, ((last30Inc - last30Exp) / last30Inc) * 100) : 0;

            // B. Runway (Months)
            const liquid = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).reduce((s, a) => s + actions.toChartCur(a.balance, a.currency || 'AED', r), 0);
            const avgExp = last30Exp > 0 ? last30Exp : 1; // Avoid div by 0
            const runway = liquid / avgExp;

            // C. Debt Load (Debt / Assets)
            const totalAssets = state.data.accounts.reduce((s, a) => s + actions.toChartCur(a.balance, a.currency || 'AED', r), 0);
            const totalDebt = state.data.debts.filter(d => !d.settled).reduce((s, d) => s + actions.toChartCur(d.amount, d.currency || 'AED', r), 0);
            const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0;

            // Score Formula: (Savings * 0.4) + (RunwayCapped * 0.4) + (DebtInverted * 0.2)
            // Runway: 6 months = 100 pts. 
            const sScore = Math.min(100, savingsRate * 2); // 50% savings = 100 pts
            const rScore = Math.min(100, (runway / 6) * 100);
            const dScore = Math.max(0, 100 - debtRatio);

            const healthScore = Math.round((sScore * 0.4) + (rScore * 0.4) + (dScore * 0.2));
            const healthColor = healthScore > 80 ? '#10b981' : (healthScore > 50 ? '#f59e0b' : '#ef4444');

            // 2. SPENDING RHYTHM (Day of Week)
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayCounts = [0, 0, 0, 0, 0, 0, 0];
            txs.filter(t => t.type === 'expense').forEach(t => {
                const day = new Date(t.date).getDay();
                dayCounts[day] += actions.toChartCur(Number(t.amount), t.currency || 'AED', r);
            });

            // 3. EXPENSE RADAR (Categories)
            const catMap = {};
            txs.filter(t => t.type === 'expense').forEach(t => {
                catMap[t.category] = (catMap[t.category] || 0) + actions.toChartCur(Number(t.amount), t.currency || 'AED', r);
            });
            const top5Cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

            // 4. FREEDOM RATIO (Fixed vs Free)
            // Fixed = Sum of Subscriptions + Debt EMI (Approx)
            const monthlyFixed = (state.data.subscriptions || []).reduce((s, sub) => s + Number(sub.amount), 0); // Simplified
            const monthlyIncAvg = last30Inc || 1;
            const fixedPct = Math.min(100, Math.round((monthlyFixed / monthlyIncAvg) * 100));
            const freePct = 100 - fixedPct;

            // 5. ASSET POLAR (Type Distribution)
            const assetMap = {};
            state.data.accounts.forEach(a => {
                const k = a.subtype || a.type; // Use subtype if valid (e.g. Gold), else type
                const val = actions.toChartCur(a.balance, a.currency || 'AED', r);
                if (val > 0) assetMap[k] = (assetMap[k] || 0) + val;
            });

            // --- OLD ANALYTICS LOGIC MERGE ---
            // 1. Net Worth (Liquid + Invested - Debts)
            let totalNW = 0;
            state.data.accounts.forEach(a => totalNW += actions.toChartCur(a.balance, a.currency || 'AED', r));
            state.data.debts.forEach(d => {
                if (!d.settled) {
                    const val = actions.toChartCur(Number(d.amount), d.currency || 'AED', r);
                    totalNW += (d.type === 'receivable' ? val : -val);
                }
            });

            // 2. Annual Expenses (Extrapolated from last 6 months)
            const d6m = new Date(); d6m.setMonth(d6m.getMonth() - 6);
            const recentExp = state.data.transactions.filter(t => t.type === 'expense' && new Date(t.date) >= d6m).reduce((s, t) => {
                const acc = state.data.accounts.find(a => a.id === t.accountId);
                const cur = t.currency || acc?.currency || 'AED';
                return s + actions.toChartCur(Number(t.amount), cur, r);
            }, 0);

            const avgMonthlyExpOLD = recentExp / 6;
            const annualExp = avgMonthlyExpOLD * 12;

            // Output Metrics
            const freedomYears = annualExp > 0 ? (totalNW / annualExp).toFixed(1) : '∞';
            const freedomDate = annualExp > 0 ? new Date(new Date().setFullYear(new Date().getFullYear() + parseFloat(freedomYears))) : 'Forever';
            const dateStr = freedomDate === 'Forever' ? 'Infinity' : freedomDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            // HTML MERGE
            const currSym = actions.chartCurrency === 'AED' ? 'AED' : '₹';
            
            // Get Personal Credit Score Stats
            const cs = (typeof actions.getPersonalCreditScore === 'function') ? actions.getPersonalCreditScore() : null;
            let creditScoreHtml = '';
            if (cs) {
                const scorePct = Math.min(100, Math.max(0, ((cs.score - 300) / 600) * 100));
                const strokeDashoffset = 283 - (283 * scorePct) / 100;
                let scoreTextColor = cs.color === 'emerald' ? 'text-emerald-400' : (cs.color === 'teal' ? 'text-teal-400' : (cs.color === 'indigo' ? 'text-indigo-400' : (cs.color === 'amber' ? 'text-amber-400' : 'text-rose-400')));
                let themeGradient = cs.color === 'emerald' ? 'from-emerald-500/20 via-slate-800 to-slate-900 border-emerald-500/30' : (cs.color === 'teal' ? 'from-teal-500/20 via-slate-800 to-slate-900 border-teal-500/30' : (cs.color === 'indigo' ? 'from-indigo-500/20 via-slate-800 to-slate-900 border-indigo-500/30' : (cs.color === 'amber' ? 'from-amber-500/20 via-slate-800 to-slate-900 border-amber-500/30' : 'from-rose-500/20 via-slate-800 to-slate-900 border-rose-500/30')));

                creditScoreHtml = FinzUI.html`
                    <!-- 1. CREDIT SCORE & FINANCIAL HEALTH HUB -->
                    <div class="bg-gradient-to-br ${themeGradient} border-2 rounded-[2.5rem] p-6 md:p-8 text-center shadow-2xl backdrop-blur-md relative overflow-hidden text-left mb-6">
                        <div class="flex flex-col md:flex-row items-center justify-between gap-6">
                            <div class="relative w-36 h-36 shrink-0 flex items-center justify-center mx-auto md:mx-0">
                                <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                                    <circle cx="50" cy="50" r="45" fill="transparent" stroke="#1e293b" stroke-width="8" stroke-dasharray="283" stroke-dashoffset="0"></circle>
                                    <circle cx="50" cy="50" r="45" fill="transparent" stroke="currentColor" stroke-width="8" stroke-dasharray="283" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round" class="${scoreTextColor} transition-all duration-1000"></circle>
                                </svg>
                                <div class="absolute flex flex-col items-center justify-center text-center">
                                    <span class="text-3xl font-black text-white num-font leading-none">${cs.score}</span>
                                    <span class="text-[9px] font-black uppercase tracking-widest ${scoreTextColor} mt-1">${cs.tier}</span>
                                    <span class="text-[8px] font-bold text-slate-400">300 - 900</span>
                                </div>
                            </div>

                            <div class="flex-1 text-center md:text-left space-y-2">
                                <div class="inline-flex items-center gap-2 bg-slate-900/80 px-3.5 py-1 rounded-full border border-slate-700/80 mb-1">
                                    <i data-lucide="award" class="w-3.5 h-3.5 ${scoreTextColor}"></i>
                                    <span class="text-[9px] font-black uppercase tracking-widest text-slate-300">Financial Health Index • Grade ${cs.grade}</span>
                                </div>
                                <h3 class="text-xl md:text-2xl font-black text-white">Credit Score & Health Diagnostic</h3>
                                <p class="text-xs font-bold text-slate-300 max-w-xl">${cs.statusSummary}</p>
                                
                                <div class="pt-2 flex flex-wrap gap-2 justify-center md:justify-start">
                                    <span class="text-[9px] font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">Payment: ${cs.pillars.paymentHistory.pct}%</span>
                                    <span class="text-[9px] font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">Debt Ratio: ${cs.pillars.debtRatio.ratio}%</span>
                                    <span class="text-[9px] font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">Runway: ~${cs.pillars.runway.months} mo</span>
                                    <span class="text-[9px] font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">Wealth Rate: ${cs.pillars.wealthRate.rate}%</span>
                                </div>
                            </div>

                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('credit_score') })}" class="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl text-xs font-black uppercase tracking-wider shrink-0 transition-all flex items-center gap-2 shadow-lg">
                                <i data-lucide="activity" class="w-4 h-4 text-indigo-400"></i> Full Diagnostics
                            </button>
                        </div>
                    </div>
                `;
            }

            FinzUI.setHTML(c, FinzUI.html`
            <div class="space-y-8 py-4">
                
                <!-- CURRENCY TOGGLE -->
                <div class="flex justify-center mb-6">
                    <div class="bg-slate-200 p-1 rounded-xl flex items-center gap-1">
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.setChartCurrency('AED') })}" class="text-slate-900 px-6 py-2 text-[10px] uppercase font-black tracking-widest rounded-lg transition-all ${actions.chartCurrency === 'AED' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">AED</button>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.setChartCurrency('INR') })}" class="text-slate-900 px-6 py-2 text-[10px] uppercase font-black tracking-widest rounded-lg transition-all ${actions.chartCurrency === 'INR' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">INR</button>
                    </div>
                </div>

                <!-- 1. CREDIT SCORE EMBED -->
                ${creditScoreHtml}

                <!-- 6. CASHFLOW WATERFALL -->
                <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm text-center">
                    <h4 class="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest">Cashflow Waterfall (Last 30 Days)</h4>
                    <div class="relative h-64 w-full mb-4">
                        <canvas id="waterfall-chart"></canvas>
                    </div>
                </div>

                <!-- 5. INTERACTIVE WEALTH COMPOSITION -->
                <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm text-center">
                    <h4 class="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest">Cost-Basis Asset Allocation</h4>
                    
                    <p class="text-[9px] font-black uppercase text-slate-400 tracking-widest mt-4">Gross Invested Assets</p>
                    <p id="chart-center-val" class="text-2xl font-black text-slate-800 text-center leading-tight mx-auto mb-4"></p>
                    
                    <div class="relative h-64 w-full mb-8">
                        <canvas id="allocation-chart"></canvas>
                    </div>

                    <!-- Liability Bar -->
                    <div class="mt-8 mb-4">
                        <div class="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                            <span>Debt-to-Asset Ratio</span>
                            <span id="debt-ratio-val">0%</span>
                        </div>
                        <div class="w-full h-3 bg-emerald-100 rounded-full overflow-hidden flex">
                            <div id="liability-bar" class="h-full bg-red-500 transition-all duration-1000" style="width: 0%"></div>
                        </div>
                        <div class="flex justify-between text-[10px] font-bold mt-2">
                            <span class="text-emerald-600" id="gross-assets-label">Assets: </span>
                            <span class="text-red-500" id="liabilities-label">Liabilities: </span>
                        </div>
                    </div>
                    
                    <!-- Drill-Down Container -->
                    <div id="category-details-container" class="mt-6 text-left hidden fade-in"></div>
                </div>


            </div>`);

            // --- HELPER: FORMAT MONEY PLAIN TEXT ---
            if (!actions.fmtMoneyText) {
                actions.fmtMoneyText = (val, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(val);
            }

            // --- CHARTS REMOVED PER USER REQUEST ---

            // RENDER RADAR (REMOVED)

            // RENDER POLAR
            const polarCanvas = document.getElementById('polarChart');
            if (polarCanvas) {
                const existing = Chart.getChart(polarCanvas);
                if (existing) existing.destroy();
                new Chart(polarCanvas, {
                    type: 'polarArea',
                    data: {
                        labels: Object.keys(assetMap),
                        datasets: [{
                            data: Object.values(assetMap),
                            backgroundColor: ['#3b82f6', '#f59e0b', '#10b981', '#6366f1', '#8b5cf6', '#ec4899']
                        }]
                    },
                    options: { plugins: { legend: { position: 'bottom', labels: { font: { size: 9, weight: 'bold' }, usePointStyle: true } } }, scales: { r: { ticks: { display: false }, grid: { display: false } } } }
                });
            }

            lucide.createIcons();




            if (instant) {
                actions.renderCharts();
                actions.renderAllocationChart();
            } else {
                setTimeout(() => {
                    actions.renderCharts();
                    actions.renderAllocationChart();
                }, 500); // Trigger Old Charts logic with animation delay
            }
        };

actions.renderDistributionInsights = function () {
            const spend = state.data.transactions.filter(t => t.type === 'expense'), total = spend.reduce((s, t) => { const acc = state.data.accounts.find(a => a.id === t.accountId); const cur = t.currency || acc?.currency || 'AED'; return s + (Number(t.amount) * (cur === 'AED' ? state.data.settings.rate : 1)); }, 0);
            return FinzUI.html`<div class="text-slate-900 max-w-xl mx-auto p-10 bg-white rounded-[3rem] border text-center shadow-sm text-center text-center text-center text-center text-center"><h4 class="text-[10px] font-black uppercase text-slate-400 mb-10 tracking-widest text-center text-center text-center">Weight distribution</h4>
                <div class="text-right mb-6 flex justify-end gap-2">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.csvExport() })}" class="bg-slate-100 text-slate-600 py-2 px-4 rounded-xl font-bold text-[10px] uppercase hover:bg-slate-200">CSV</button>
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.generatePDF() })}" class="bg-slate-900 text-white py-2 px-4 rounded-xl font-bold text-[10px] uppercase shadow-lg hover:bg-emerald-500 transition-colors">Download Official PDF</button>
                </div>
                <div class="space-y-4">
                    ${[...new Set(spend.map(t => t.category))].map(cat => { const val = spend.filter(t => t.category === cat).reduce((s, t) => { const acc = state.data.accounts.find(a => a.id === t.accountId); const cur = t.currency || acc?.currency || 'AED'; return s + (Number(t.amount) * (cur === 'AED' ? state.data.settings.rate : 1)); }, 0), p = total > 0 ? (val / total * 100) : 0; return FinzUI.html`<div class="flex justify-between items-center space-y-3"><span class="font-black text-xs uppercase w-24 text-left">${cat}</span><div class="text-slate-900 flex-1 mx-4 h-2 bg-slate-50 rounded-full overflow-hidden"><div class="h-full bg-slate-900" style="width: ${p}%"></div></div><span class="font-bold text-xs text-slate-400 w-12 text-right num-font">${Math.round(p)}%</span></div>`; }).join('') || FinzUI.literal("<p class=\"text-xs italic text-slate-300\">No records</p>")}
                </div>
            </div>`;
        }

actions.csvExport = function () {
            if (!state.data.transactions || state.data.transactions.length === 0) {
                actions.showToast("No transactions to export", "error");
                return;
            }

            const headers = ['Date', 'Account', 'Type', 'Category', 'Amount', 'Currency', 'Note'];
            const rows = [headers.join(',')];

            state.data.transactions.forEach(t => {
                const acc = state.data.accounts.find(a => a.id === t.accountId);
                const accName = acc ? acc.name : 'Unknown';
                
                const cleanNote = (t.note || '').replace(/"/g, '""');
                const cleanCat = (t.category || '').replace(/"/g, '""');
                const cleanAcc = accName.replace(/"/g, '""');
                
                const row = [
                    t.date ? t.date.split('T')[0] : '',
                    `"${cleanAcc}"`,
                    t.type || '',
                    `"${cleanCat}"`,
                    t.amount || 0,
                    t.currency || (acc ? acc.currency : ''),
                    `"${cleanNote}"`
                ];
                rows.push(row.join(','));
            });

            const csvString = rows.join('\n');
            const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `FI_SHAANIRE_Transactions_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            actions.showToast("CSV Exported Successfully", "success");
        };

actions.renderRemittance = function () {
            // 1. Identify Cross-Currency Transfers (AED -> INR)
            const remittance = [];
            const r = state.data.settings.rate;

            // Find "Transfer Out" from AED accounts
            const outTx = state.data.transactions.filter(t => t.type === 'transfer_out');

            outTx.forEach(tx => {
                const acc = state.data.accounts.find(a => a.id === tx.accountId);
                if (!acc || acc.currency !== 'AED') return;

                // Look for matching "Transfer In" (Checking by Note content or Timeframe is tricky without Link ID)
                // Reliable Method: We rely on the "Note" we auto-generated: "To [Name]: [UserNote]"
                // Or better, we just check if the user *explicitly* logged a rate in the note? NO.
                // We need to match the Pair. 
                // In `doTransfer`, we created two TXs with nearly identical timestamps.

                // Let's use a blurred timestamp match (+/- 1 sec) and opposite amount approx?
                // Actually, `doTransfer` pushes them sequentially. ID is random.
                // Let's assume for V1: We visualize "Implied Rate" based on the Manual Log if available?
                // BETTER: We can't robustly link past transfers without a `relatedTxId`.
                // FUTURE FIX: Update `doTransfer` to link IDs.

                // FOR NOW: We will assume any "Transfer Out" from AED account that mentions "Transfer" 
                // and has a "Transfer In" to an INR account with same User Note is a match.

                const matchIn = state.data.transactions.find(t2 =>
                    t2.type === 'transfer_in' &&
                    t2.note.includes(tx.note.split(':')[1]?.trim()) &&
                    Math.abs(new Date(t2.date) - new Date(tx.date)) < 2000 // 2 seconds tolerance
                );

                if (matchIn) {
                    const accIn = state.data.accounts.find(a => a.id === matchIn.accountId);
                    if (accIn && accIn.currency === 'INR') {
                        const sent = parseFloat(tx.amount);
                        const received = parseFloat(matchIn.amount);
                        const realizedRate = received / sent;

                        remittance.push({
                            date: tx.date,
                            sent, received, rate: realizedRate,
                            note: tx.note
                        });
                    }
                }
            });

            remittance.sort((a, b) => new Date(a.date) - new Date(b.date));

            // metrics
            const totalSent = remittance.reduce((s, i) => s + i.sent, 0); // AED
            const totalRec = remittance.reduce((s, i) => s + i.received, 0); // INR
            const avgRate = totalSent > 0 ? (totalRec / totalSent).toFixed(2) : 0;
            const marketRate = state.data.settings.rate;
            const diff = (avgRate - marketRate).toFixed(2);

            const beatsMarket = parseFloat(avgRate) > marketRate;

            return FinzUI.html`<div class="max-w-xl mx-auto space-y-8">
                <div class="bg-gradient-to-br from-indigo-900 to-slate-900 text-white p-8 rounded-[3rem] shadow-2xl relative overflow-hidden group text-center">
                    <div class="relative z-10">
                        <p class="text-[10px] uppercase font-black text-indigo-300 tracking-[0.3em] mb-4">Arbitrage Performance</p>
                        <h3 class="text-6xl font-black text-white mb-2">${avgRate}<span class="text-2xl text-slate-400 font-bold"> INR/AED</span></h3>
                        <p class="text-indigo-200 font-medium text-xs">Your Realized Average</p>
                        
                        <div class="mt-8 flex justify-center items-center gap-4 text-xs font-bold border-t border-white/10 pt-6">
                            <div class="text-slate-900 bg-white/10 px-4 py-2 rounded-xl">Market: ${marketRate}</div>
                            <div class="${beatsMarket ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'} px-4 py-2 rounded-xl border border-white/5">
                                ${beatsMarket ? `Winning by +${diff}` : `Losing by ${diff}`}
                            </div>
                        </div>
                    </div>
                </div>

                <!--CHART -->
                <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm text-center">
                    <h4 class="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Rate History</h4>
                    <div class="relative h-64 w-full">
                        <canvas id="chart-remit"></canvas>
                    </div>
                </div>

                <!--LOG -->
                <div class="space-y-4">
                    <h4 class="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest text-left px-4">Transfer Log</h4>
                    ${remittance.length > 0 ? remittance.map(r => FinzUI.html`
                        <div class="text-slate-900 p-5 bg-white border border-slate-100 rounded-3xl flex justify-between items-center shadow-sm">
                            <div class="text-left">
                                <p class="font-bold text-sm text-slate-800">Sent AED ${Math.round(r.sent).toLocaleString()}</p>
                                <p class="text-[9px] font-black text-slate-400 uppercase">${new Date(r.date).toLocaleDateString()}</p>
                            </div>
                            <div class="text-right">
                                <p class="font-black text-lg text-emerald-600 num-font">${r.rate.toFixed(2)}</p>
                                <p class="text-[8px] font-bold text-slate-400 uppercase">Rate Secured</p>
                            </div>
                        </div>
                     `).join('') : FinzUI.literal("<p class=\"text-center text-slate-300 text-xs font-bold uppercase py-10\">No AED -> INR transfers detected</p>")}
                </div>
            </div>`;
        };

actions.renderRemitChart = function () {
            // Need to fetch data again or store it? Re-calc is cheap.
            const r = state.data.settings.rate;
            const remittance = [];
            // ... Logic duplication for simplicity in "script" context, or attach to window ...
            // Let's DRY: we need to extract this logic if possible, but for now inline to avoid globals pollution
            const outTx = state.data.transactions.filter(t => t.type === 'transfer_out');
            outTx.forEach(tx => {
                const acc = state.data.accounts.find(a => a.id === tx.accountId);
                if (!acc || acc.currency !== 'AED') return;
                const matchIn = state.data.transactions.find(t2 => t2.type === 'transfer_in' && t2.note.includes(tx.note.split(':')[1]?.trim()) && Math.abs(new Date(t2.date) - new Date(tx.date)) < 2000);
                if (matchIn) {
                    const accIn = state.data.accounts.find(a => a.id === matchIn.accountId);
                    if (accIn && accIn.currency === 'INR') {
                        remittance.push({ date: tx.date, rate: parseFloat(matchIn.amount) / parseFloat(tx.amount) });
                    }
                }
            });
            remittance.sort((a, b) => new Date(a.date) - new Date(b.date));

            const ctx = document.getElementById('chart-remit');
            if (remittance.length === 0 || !ctx) return;

            let existingChart = Chart.getChart(ctx);
            if (existingChart) existingChart.destroy();
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: remittance.map(r => new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
                    datasets: [
                        {
                            label: 'Your Rate',
                            data: remittance.map(r => r.rate),
                            borderColor: '#6366f1', // Indigo
                            backgroundColor: 'rgba(99, 102, 241, 0.1)',
                            borderWidth: 3,
                            tension: 0.3,
                            pointRadius: 4,
                            pointBackgroundColor: '#fff',
                            pointBorderWidth: 2
                        },
                        {
                            label: 'Market Base',
                            data: Array(remittance.length).fill(r),
                            borderColor: '#cbd5e1', // Slate 300
                            borderWidth: 2,
                            borderDash: [5, 5],
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'bottom' } },
                    scales: { y: { beginAtZero: false } }
                }
            });
        };

actions.renderCharts = function () {
            const r = state.data.settings.rate;
            const cur = actions.chartCurrency || 'AED';

            const canvas = document.getElementById('waterfall-chart');
            if (!canvas) return;

            const existingChart = Chart.getChart(canvas);
            if (existingChart) existingChart.destroy();

            // Calculate Waterfall Data (Last 30 Days)
            const d = new Date(); d.setMonth(d.getMonth() - 1);
            let inc = 0;
            let exp = 0;
            state.data.transactions.forEach(t => {
                if (new Date(t.date) >= d) {
                    const val = actions.toChartCur(Number(t.amount), t.currency || 'AED', r);
                    if (t.type === 'income') inc += val;
                    if (t.type === 'expense') exp += val;
                }
            });

            const net = inc - exp;

            new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: ['Income', 'Expenses', 'Net Cashflow'],
                    datasets: [{
                        data: [inc, -exp, net],
                        backgroundColor: [
                            '#10b981', // green for income
                            '#ef4444', // red for expenses
                            net >= 0 ? '#3b82f6' : '#ef4444' // blue for positive net, red for negative
                        ],
                        borderWidth: 0,
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const val = Math.abs(context.raw);
                                    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(val);
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: '#f1f5f9' },
                            ticks: {
                                callback: function(value) {
                                    return Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : value;
                                },
                                font: { family: "'Plus Jakarta Sans'", size: 10, weight: 'bold' }
                            }
                        },
                        x: { 
                            grid: { display: false },
                            ticks: { font: { family: "'Plus Jakarta Sans'", size: 12, weight: 'bold' } }
                        }
                    }
                }
            });
        };
}
