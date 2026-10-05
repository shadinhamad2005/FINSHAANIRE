// Debts behavior and screens. Dependencies stay inside the application context.
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

actions.checkDueDebts = async function checkDueDebts() {
            const today = new Date().toISOString().split('T')[0];
            let dueItem = null;
            let dueType = 'standard'; // or 'bnpl'
            let dueIdx = -1;
            let dataChanged = false;

            // Priority: Check Defaults first, then BNPL logic overrides or adds? 
            // Let's just find the *first* due item.
            for (const d of state.data.debts) {
                if (d.settled) continue;



                // 1. BNPL Schedule Check
                if (d.subtype === 'bnpl' && d.schedule && d.schedule.length > 0) {
                    const pending = d.schedule.find(s => s.status === 'pending');
                    if (pending && new Date(pending.date).toISOString().split('T')[0] <= today) {
                        if (!dueItem) { // Only grab first for UI
                            dueItem = d;
                            dueType = 'bnpl';
                            dueIdx = pending.index;
                        }
                    }
                }
                // 2. Standard Debt Check
                else if (d.repaymentDate && d.repaymentDate <= today) {
                    if (!dueItem) { // Only grab first for UI
                        dueItem = d;
                        dueType = 'standard';
                    }
                }
            }

            if (dataChanged) await updateDb();

            if (dueItem) {
                const overlay = document.getElementById('reminder-overlay'), details = document.getElementById('reminder-details');
                if (overlay && details) {
                    let amount = dueItem.amount;
                    let party = dueItem.party;
                    let settleFn = () => actions.openSettleFlow(dueItem.id);

                    if (dueType === 'bnpl') {
                        const inst = dueItem.schedule[dueIdx];
                        amount = inst.amount;
                        party = `${dueItem.party} (Inst #${inst.index + 1})`;
                        settleFn = () => actions.settleInstallment(dueItem.id, dueIdx);
                    }

                    // SNOOZE CHECK: Check if snoozed in last 5 hours
                    let snoozed = null;
                    try { snoozed = localStorage.getItem('reminder_snooze'); } catch(e) {}
                    // 5 hours = 5 * 60 * 60 * 1000 = 18000000 ms
                    if (snoozed && (Date.now() - parseInt(snoozed)) < 18000000) return;

                    FinzUI.setHTML(details, FinzUI.html`<p class="text-xl font-bold">${amount} ${dueItem.currency}</p><p class="text-sm font-medium text-slate-500">Party: ${party}</p>`);
                    document.getElementById('remit-settle-btn').onclick = settleFn;

                    // ACTION 1: Schedule Later (Reschedule)
                    document.getElementById('remit-resched-btn').onclick = () => actions.openRescheduleFlow(dueItem.id);

                    // ACTION 2: Ignore (Snooze for 5h)
                    document.getElementById('remit-ignore-btn').onclick = () => {
                        try { localStorage.setItem('reminder_snooze', Date.now().toString()); } catch(e) {}
                        overlay.classList.add('hidden');
                        actions.showToast("Reminders snoozed for 5 hours", "info");
                    };

                    overlay.classList.replace('hidden', 'flex'); lucide.createIcons();
                }
            }
        };

actions.renderInstallments = function () {
            const list = document.getElementById('installments-list'), panel = document.getElementById('installments-panel');
            if (!list) return;

            const today = new Date();
            const limit = new Date();
            limit.setDate(today.getDate() + 2);

            // FIXED: Use Local Time
            const toStr = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            };
            const limitStr = toStr(limit);

            const items = [];

            state.data.debts.forEach(d => {
                // Filter: Must check schedule existence (generalized for Loans/BNPL)
                if (d.settled || !d.schedule || d.schedule.length === 0) return;
                // FIXED: Filter out receivables
                if (d.type === 'receivable') return;

                // FIXED: Handle empty status and missing index for legacy data
                const pendingIdx = d.schedule.findIndex(s => s.status === 'pending' || !s.status);

                if (pendingIdx !== -1) {
                    const pending = d.schedule[pendingIdx];
                    // CHANGED: Restricted to Urgent Only (<= 2 Days) per User Request
                    if (pending.date <= limitStr) {
                        items.push({
                            id: d.id,
                            party: d.party, // e.g. "iPhone 15"
                            date: pending.date,
                            amount: pending.amount,
                            currency: d.currency,
                            instIndex: pendingIdx, // Use calculated index
                            totalInst: d.schedule.length
                        });
                    }
                }
            });

            const sorted = items.sort((a, b) => new Date(a.date) - new Date(b.date));

            // CHANGED: Revert debug message - Hide if empty
            if (sorted.length === 0) {
                panel.classList.add('hidden');
                return;
            }
            panel.classList.remove('hidden');
            // panel.style.border = ""; // Clean up styles if any persisted (not needed with class manipulation but safe)

            FinzUI.setHTML(list, sorted.map(d => FinzUI.html`
                <div class="text-slate-900 bg-white p-4 rounded-2xl border-l-4 border-indigo-500 shadow-sm flex flex-col justify-between text-center">
                    <div class="flex justify-between items-start mb-3 text-center">
                        <div class="text-left text-center">
                            <p class="text-[8px] font-black uppercase text-indigo-400 mb-0.5">Installment ${d.instIndex + 1}/${d.totalInst}</p>
                            <p class="font-bold text-slate-800 text-sm text-center">${d.party}</p>
                            <p class="text-[9px] font-bold text-slate-400 uppercase text-center text-center">Due: ${d.date}</p>
                        </div>
                        <p class="font-black text-slate-900">${d.amount} ${d.currency}</p>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-center text-center">
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.settleInstallment(((d.id)), (d.instIndex)) })}" class="bg-indigo-500 text-white py-1.5 rounded-lg text-[9px] font-bold uppercase shadow-sm text-center text-center">Pay Now</button>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.openRescheduleFlow(((d.id))) })}" class="text-slate-900 bg-slate-50 text-slate-600 py-1.5 rounded-lg text-[9px] font-bold uppercase text-center text-center">Later</button>
                    </div>
                </div>`).join(''));
        };

actions.calcInstallment = function () {
            const amt = parseFloat(document.getElementById('da').value) || 0;
            const split = parseInt(document.getElementById('db-split').value) || 1;
            const el = document.getElementById('bnpl-preview');
            if (el) el.innerText = `Monthly: ${(amt / split).toFixed(2)}`;
        };

actions.toggleBnplDetails = function (id) {
            document.getElementById(`bnpl-det-${id}`)?.classList.toggle('hidden');
        };

actions.openFriendLedger = function (name) {
            const history = state.data.debts.filter(d => d.party === name).sort((a, b) => new Date(b.date) - new Date(a.date));
            const contact = (state.data.contacts && state.data.contacts.find(c => c.name === name)) || { relation: 'Friend', creditScore: 100 };

            const t = document.getElementById('modal-title');
            const c = document.getElementById('modal-content');
            const b = document.getElementById('modal-backdrop');

            t.innerText = `${name}'s Ledger`;
            FinzUI.setHTML(c, FinzUI.html`
                <div class="space-y-6">
                     <div class="text-slate-900 flex justify-between items-center bg-slate-50 p-6 rounded-3xl border border-slate-100">
                         <div>
                             <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Relationship</p>
                             <p class="text-xl font-black text-slate-800">${contact.relation || 'Contact'}</p>
                         </div>
                         <div class="text-right">
                             <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Lifetime Score</p>
                             <p class="text-xl font-black text-indigo-500">${actions.calcTrustScore(name)}%</p>
                         </div>
                     </div>
                     
                     <div class="space-y-3">
                         ${history.length > 0 ? history.map(d => FinzUI.html`
                             <div class="text-slate-900 bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center ${d.settled ? 'opacity-60' : ''}">
                                 <div class="text-left">
                                     <p class="font-bold text-sm text-slate-800 flex items-center gap-2">
                                        ${d.type === 'receivable' ? 'Lent' : 'Borrowed'}
                                        ${d.settled ? FinzUI.literal("<span class=\"text-[8px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-black uppercase\">Settled</span>") : ''}
                                     </p>
                                     <p class="text-[10px] text-slate-400 font-bold uppercase">${d.repaymentDate || d.date ? (d.date || '').split('T')[0] : 'No Date'}</p>
                                 </div>
                                 <div class="text-right">
                                     <p class="font-black text-slate-900">${d.amount} ${d.currency}</p>
                                 </div>
                             </div>
                         `).join('') : FinzUI.literal("<p class=\"text-center text-slate-300 font-bold py-10\">No records found.</p>")}
                     </div>
                </div>
            `);
            b.classList.replace('hidden', 'flex');
            lucide.createIcons();
        };

actions.payBnplSplit = (id, idx) => actions.openBnplSettleModal(id, idx);

actions.renderDebtUI = function () {
            // 1. Split Data
            const bnpl = state.data.debts.filter(d => !d.settled && (d.subtype === 'bnpl' || d.isBnpl));
            const personal = state.data.debts.filter(d => !d.settled && d.subtype !== 'bnpl' && !d.isBnpl);

            // 2. Render BNPL (Active Installments) - Granular & Corrected
            // 2. Render BNPL (Active Installments) - Enhanced Card UI
            const renderBnplItem = (d) => {
                const nextDue = d.schedule.find(s => !s.paid);
                const nextDate = nextDue ? (nextDue.date || nextDue.dueDate) : 'Settled';
                let progress = 0;
                if (d.originalAmount && d.originalAmount > 0) {
                    progress = ((d.originalAmount - d.currentAmount) / d.originalAmount) * 100;
                }
                
                const now = new Date();
                const isDueSoon = nextDue && (new Date(nextDate) - now) / (1000 * 60 * 60 * 24) < 3;

                return FinzUI.html`<div class="bg-slate-900/40 rounded-[1.5rem] border border-slate-700/50 shadow-sm relative overflow-hidden group transition-all hover:border-slate-500/50 cursor-pointer flex flex-col h-full hover:-translate-y-1" data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('bnpl_ledger', ((d.id))) })}">
                    
                    <div class="p-5 flex flex-col relative z-10 flex-grow text-left">
                        ${isDueSoon ? FinzUI.html`<div class="absolute top-4 right-4 w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]"></div>` : ''}
                        
                        <!-- Top Left Icon -->
                        <div class="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-4">
                            <i data-lucide="shopping-bag" class="w-5 h-5"></i>
                        </div>
                        
                        <!-- Name & Subtitle -->
                        <h3 class="font-black text-slate-100 text-lg leading-none mb-1 truncate">${d.party}</h3>
                        <span class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-6 block">Installment Plan</span>
                        
                        <!-- Details -->
                        <div class="space-y-3 mt-auto">
                            <div class="flex justify-between items-center border-b border-slate-800 pb-2">
                                <span class="text-[10px] font-bold text-slate-400">Total Plan</span>
                                <span class="text-xs font-black text-slate-300">${d.originalAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-[8px]">${d.currency}</span></span>
                            </div>
                            <div class="flex justify-between items-center border-b border-slate-800 pb-2">
                                <span class="text-[10px] font-bold text-slate-400">Next Due</span>
                                <span class="text-xs font-black text-rose-400">${nextDate}</span>
                            </div>
                            <div class="flex justify-between items-center pb-2">
                                <span class="text-[10px] font-bold text-slate-400">Remaining</span>
                                <span class="text-sm font-black text-rose-500">${d.currentAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-[8px]">${d.currency}</span></span>
                            </div>
                            <div class="w-full bg-slate-800/80 rounded-full h-1 mt-1 overflow-hidden">
                                <div class="bg-emerald-500 h-full rounded-full" style="width: ${progress}%"></div>
                            </div>
                        </div>
                    </div>
                </div>`;
            };

            // NEW: Full Modal for BNPL Payment
            // Moved global definitions to window scope (see below)

            // 3. Render People (Grouped)
            const people = {};
            // Helper to aggregate based on currency
            personal.forEach(d => {
                const p = d.party;
                if (!people[p]) people[p] = { name: p, totals: {}, items: [], trust: actions.calcTrustScore(p), virtualNet: 0 };

                // Init currency bucket if needed
                if (!people[p].totals[d.currency]) people[p].totals[d.currency] = 0;

                let v = parseFloat(d.amount);

                // Add to specific currency bucket
                if (d.type === 'payable') people[p].totals[d.currency] -= v;
                else people[p].totals[d.currency] += v;

                // Virtual Net (For Sorting Only)
                // Convert to Base (AED) for simple weight sorting
                const r = state.data.settings.rate;
                const vInAed = d.currency === 'AED' ? v : v / r;
                if (d.type === 'payable') people[p].virtualNet -= vInAed;
                else people[p].virtualNet += vInAed;

                people[p].items.push(d);
            });

            // Sort by Virtual Net (Debtors First)
            const sortedPeople = Object.values(people).sort((a, b) => a.virtualNet - b.virtualNet);

            const renderHistory = (debtId) => {
                const txs = state.data.transactions.filter(t => t.debtId === debtId).sort((a, b) => new Date(b.date) - new Date(a.date));
                if (txs.length === 0) return '';
                return FinzUI.html`
                    <div class="mt-3 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                        <p class="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-2">Payment History</p>
                        <div class="space-y-2">
                            ${txs.map(t => FinzUI.html`
                                <div class="flex justify-between items-center text-[9px]">
                                    <span class="text-slate-500 font-bold">${new Date(t.date).toLocaleDateString()}</span>
                                    <span class="font-black text-slate-300">${t.amount}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
            };

            const renderPerson = (p) => {
                const isNetOwe = p.virtualNet < -1.0;
                const isSettled = Math.abs(p.virtualNet) < 20.0;
                
                // We will calculate Total Lent and Total Borrowed in Base Currency (AED) to match the 3-row design
                const r = state.data.settings.rate;
                let totalLent = 0;
                let totalBorrowed = 0;
                p.items.forEach(d => {
                    const val = Number(d.amount) * (d.currency === 'AED' ? 1 : 1/r);
                    if(d.type === 'receivable') totalLent += val;
                    if(d.type === 'payable') totalBorrowed += val;
                });

                const netColor = isNetOwe ? "text-rose-500" : (isSettled ? "text-slate-500" : "text-emerald-500");
                const lentColor = totalLent > 0 ? "text-emerald-500" : "text-slate-500";
                const bowColor = totalBorrowed > 0 ? "text-rose-500" : "text-slate-500";

                const now = new Date();
                const dueSoon = p.items.some(d => {
                    if (!d.repaymentDate) return false;
                    return (new Date(d.repaymentDate) - now) / (1000 * 60 * 60 * 24) < 3 && !d.settled;
                });

                const trust = (typeof actions.getContactTrustScore === 'function') ? actions.getContactTrustScore(p.name) : { score: 100, tier: 'Clean Slate', color: 'emerald' };
                const trustBadgeColor = trust.color === 'emerald' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : (trust.color === 'teal' ? 'bg-teal-500/10 text-teal-400 border-teal-500/30' : (trust.color === 'amber' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'));

                return FinzUI.html`<div class="bg-slate-900/40 rounded-[1.5rem] border border-slate-700/50 shadow-sm relative overflow-hidden group transition-all hover:border-slate-500/50 cursor-pointer flex flex-col h-full hover:-translate-y-1" data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('person_ledger', ((p.name))) })}">
                    
                    <div class="p-5 flex flex-col relative z-10 flex-grow text-left">
                        ${dueSoon ? FinzUI.html`<div class="absolute top-4 right-4 w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]"></div>` : ''}
                        
                        <!-- Top Left Icon & Trust Rating Badge -->
                        <div class="flex justify-between items-center mb-4">
                            <div class="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                                <i data-lucide="user" class="w-5 h-5"></i>
                            </div>
                            <span class="text-[8px] font-black uppercase px-2.5 py-1 rounded-full border ${trustBadgeColor}">
                                ⭐ ${trust.score}/100
                            </span>
                        </div>
                        
                        <!-- Name & Subtitle -->
                        <h3 class="font-black text-slate-100 text-lg leading-none mb-1 truncate">${p.name}</h3>
                        <span class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-4 block">${trust.tier}</span>
                        
                        <!-- 3 Rows (Staff Ledger Style) -->
                        <div class="space-y-3 mt-auto">
                            <div class="flex justify-between items-center border-b border-slate-800 pb-2">
                                <span class="text-[10px] font-bold text-slate-400">Total Lent</span>
                                <span class="text-xs font-black ${lentColor}">${totalLent.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-[8px]">AED</span></span>
                            </div>
                            <div class="flex justify-between items-center border-b border-slate-800 pb-2">
                                <span class="text-[10px] font-bold text-slate-400">Total Borrowed</span>
                                <span class="text-xs font-black ${bowColor}">${totalBorrowed.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-[8px]">AED</span></span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-[10px] font-bold text-slate-400">Net Balance</span>
                                <span class="text-xs font-black ${netColor}">${Math.abs(p.virtualNet).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-[8px]">AED</span></span>
                            </div>
                        </div>
                    </div>
                </div>`;
            };

            // --- COPY LEDGER STATEMENT ---
            actions.copyLedgerStatement = function (pName) {
                const pItems = state.data.debts.filter(d => d.party === pName);
                if (pItems.length === 0) return actions.showToast("No records found", "error");

                let txt = `🧾 *STATEMENT: ${pName.toUpperCase()}*\n\n`;
                let netBalances = {};
                
                txt += `*ACTIVE RECORDS:*\n`;
                pItems.filter(d => !d.settled).forEach(d => {
                    const amt = Number(d.amount);
                    if (!netBalances[d.currency]) netBalances[d.currency] = 0;
                    
                    if(d.type === 'receivable') { 
                        netBalances[d.currency] += amt; 
                        txt += `🟢 Lent: ${d.amount} ${d.currency} (Due: ${d.repaymentDate || 'N/A'})\n`; 
                    }
                    if(d.type === 'payable') { 
                        netBalances[d.currency] -= amt; 
                        txt += `🔴 Borrowed: ${d.amount} ${d.currency} (Due: ${d.repaymentDate || 'N/A'})\n`; 
                    }
                });

                txt += `\n*SUMMARY:*\n`;
                let hasUnsettled = false;
                Object.entries(netBalances).forEach(([currency, amount]) => {
                    if (Math.abs(amount) > 0.01) {
                        hasUnsettled = true;
                        if (amount > 0) {
                            txt += `📌 Please pay: ${amount.toFixed(2)} ${currency}\n`;
                        } else {
                            txt += `📌 I owe you: ${Math.abs(amount).toFixed(2)} ${currency}\n`;
                        }
                    }
                });
                
                if (!hasUnsettled) {
                    txt += `✅ Accounts are fully settled.`;
                }

                navigator.clipboard.writeText(txt).then(() => {
                    actions.showToast("Statement Copied to Clipboard!", "success");
                }).catch(() => {
                    actions.showToast("Failed to copy", "error");
                });
            };

            // --- WRITE OFF LOGIC ---
            actions.writeOffDebt = function (id) {
                const d = state.data.debts.find(x => x.id === id);
                if (!d) return;

                actions.showConfirm(
                    "Write Off Debt?",
                    `Mark ${d.amount} ${d.currency} as settled WITHOUT any payment? (Use for bad debts or corrections)`,
                    async () => {
                        d.settled = true;
                        d.notes = (d.notes || '') + " [Written Off]";
                        // No transaction created.
                        await updateDb();
                        actions.renderDebtUI();
                        actions.showToast("Debt Written Off (Archived)", "success");
                    },
                    "Write Off"
                );
            };

            // Split Logic
            const iOwe = sortedPeople.filter(p => p.virtualNet < -0.1);
            const owesMe = sortedPeople.filter(p => p.virtualNet >= -0.1); // Fix: Include 0 (Settled/Balanced)

            // STATE MANAGEMENT FOR TABS
            // Default to 'home' if not set
            if (!state.ui) state.ui = {};
            if (!state.ui.debtView) state.ui.debtView = 'home';

            const goHome = () => {
                state.ui.debtView = 'home';
                const html = actions.renderDebtUI();
                const c = document.getElementById('modal-content');
                if (c) { FinzUI.setHTML(c, html); lucide.createIcons(); }
            };
            const goView = (v, payload = null) => {
                state.ui.debtView = v;
                state.ui.debtPayload = payload;
                const html = actions.renderDebtUI();
                const c = document.getElementById('modal-content');
                if (c) { FinzUI.setHTML(c, html); lucide.createIcons(); }
            };
            actions.navDebt = goView; // Exposure for onclick
            actions.navDebtHome = goHome;

                        // --- MAIN DASHBOARD (HOME - WIDESCREEN 2-COLUMN DESKTOP COMMAND CENTER) ---
            if (state.ui.debtView === 'home') {
                const r = state.data.settings.rate || 22.75;
                
                // Aggregate Dual Currency Exposures
                let aedLent = 0, inrLent = 0;
                let aedOwed = 0, inrOwed = 0;
                
                personal.forEach(d => {
                    const amt = Number(d.amount) || 0;
                    if (d.type === 'receivable') {
                        if (d.currency === 'AED') aedLent += amt;
                        else inrLent += amt;
                    } else if (d.type === 'payable') {
                        if (d.currency === 'AED') aedOwed += amt;
                        else inrOwed += amt;
                    }
                });

                const totalLentInAed = aedLent + (inrLent / r);
                const totalOwedInAed = aedOwed + (inrOwed / r);
                const netPositionAed = totalLentInAed - totalOwedInAed;

                return FinzUI.html`<div class="max-w-6xl mx-auto space-y-6 text-left fade-in pb-12">
                    <!-- 1. TOP DUAL-CURRENCY EXPOSURE KPI CARDS -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <!-- Owed To Me Card -->
                        <div class="bg-gradient-to-br from-emerald-950/40 to-slate-900 p-6 rounded-[2rem] border border-emerald-500/30 shadow-lg relative overflow-hidden">
                            <div class="flex justify-between items-start mb-2">
                                <span class="text-[9px] font-black uppercase tracking-widest text-emerald-400">Owed To Me (Lent Out)</span>
                                <div class="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                                    <i data-lucide="arrow-down-left" class="w-4 h-4"></i>
                                </div>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-black text-emerald-400 num-font">AED ${totalLentInAed.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
                            <div class="flex items-center gap-3 text-[10px] font-bold text-slate-400 mt-2 pt-2 border-t border-slate-800">
                                <span>🇦🇪 AED ${aedLent.toLocaleString()}</span>
                                <span class="text-slate-600">•</span>
                                <span>🇮🇳 ₹ ${inrLent.toLocaleString()}</span>
                            </div>
                        </div>

                        <!-- I Owe Card -->
                        <div class="bg-gradient-to-br from-rose-950/40 to-slate-900 p-6 rounded-[2rem] border border-rose-500/30 shadow-lg relative overflow-hidden">
                            <div class="flex justify-between items-start mb-2">
                                <span class="text-[9px] font-black uppercase tracking-widest text-rose-400">I Owe (Borrowings)</span>
                                <div class="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
                                    <i data-lucide="arrow-up-right" class="w-4 h-4"></i>
                                </div>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-black text-rose-400 num-font">AED ${totalOwedInAed.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
                            <div class="flex items-center gap-3 text-[10px] font-bold text-slate-400 mt-2 pt-2 border-t border-slate-800">
                                <span>🇦🇪 AED ${aedOwed.toLocaleString()}</span>
                                <span class="text-slate-600">•</span>
                                <span>🇮🇳 ₹ ${inrOwed.toLocaleString()}</span>
                            </div>
                        </div>

                        <!-- Net Position Card -->
                        <div class="bg-gradient-to-br from-indigo-950/40 to-slate-900 p-6 rounded-[2rem] border border-indigo-500/30 shadow-lg relative overflow-hidden">
                            <div class="flex justify-between items-start mb-2">
                                <span class="text-[9px] font-black uppercase tracking-widest text-indigo-400">Net Liability Position</span>
                                <div class="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                                    <i data-lucide="scale" class="w-4 h-4"></i>
                                </div>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-black ${netPositionAed >= 0 ? 'text-emerald-400' : 'text-rose-400'} num-font">${netPositionAed >= 0 ? '+' : ''}AED ${netPositionAed.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
                            <p class="text-[10px] font-bold text-slate-400 mt-2 pt-2 border-t border-slate-800">${netPositionAed >= 0 ? '🟢 Net positive asset (More owed to you)' : '🔴 Net liability (You owe more)'}</p>
                        </div>
                    </div>

                    <!-- 2. WIDESCREEN 2-COLUMN LAYOUT -->
                    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        <!-- LEFT 5 COLS: ADD DEBT FORM -->
                        <div class="lg:col-span-5 bg-slate-800/80 backdrop-blur-xl p-6 rounded-[2.5rem] border border-slate-700/70 shadow-2xl relative overflow-hidden">
                            <div class="mb-5 flex justify-between items-center">
                                <div>
                                    <h2 class="text-white font-black text-lg">Add New Debt Record</h2>
                                    <p class="text-slate-400 text-xs">Record lent cash, borrowings, or BNPL.</p>
                                </div>
                                <span class="text-[9px] font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/20">New Entry</span>
                            </div>

                            <div class="space-y-4">
                                <!-- Amount Input & Currency -->
                                <div class="bg-slate-900/90 border border-slate-700/60 rounded-2xl p-4 focus-within:border-rose-500/50">
                                    <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1.5 block">Debt Amount</label>
                                    <div class="flex items-center">
                                        <select id="dc" class="bg-slate-800 text-slate-100 font-black text-lg outline-none cursor-pointer px-3 py-1.5 rounded-xl border border-slate-700 mr-3">
                                            <option value="AED" class="bg-slate-800">AED</option>
                                            <option value="INR" class="bg-slate-800">INR</option>
                                        </select>
                                        <input type="number" id="da" placeholder="0.00" data-finz-input="${FinzUI.handler(function(event) { return actions.calcInstallment() })}" class="w-full bg-transparent text-white font-black text-3xl outline-none placeholder-slate-600 num-font">
                                    </div>
                                </div>

                                <!-- Pill Toggles -->
                                <div class="flex bg-slate-900/90 p-1 rounded-xl border border-slate-700/60">
                                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { document.getElementById('dt').value='payable'; actions.toggleDebtFields(); this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-slate-700','text-white')); return this.classList.add('bg-slate-700','text-white') })}" class="flex-1 py-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-700 text-white transition-all">I Owe</button>
                                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { document.getElementById('dt').value='receivable'; actions.toggleDebtFields(); this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-slate-700','text-white')); return this.classList.add('bg-slate-700','text-white') })}" class="flex-1 py-2 rounded-lg text-xs font-bold text-slate-400 transition-all hover:text-slate-300">Owed To Me</button>
                                    <button type="button" data-finz-click="${FinzUI.handler(function(event) { document.getElementById('dt').value='bnpl'; actions.toggleDebtFields(); this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-slate-700','text-white')); return this.classList.add('bg-slate-700','text-white') })}" class="flex-1 py-2 rounded-lg text-xs font-bold text-slate-400 transition-all hover:text-slate-300">BNPL</button>
                                </div>
                                <input type="hidden" id="dt" value="payable">

                                <!-- Contact Selector -->
                                <div id="debt-party-container">
                                    <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1.5 block">Contact / Counterparty</label>
                                    <div class="flex items-center gap-2">
                                        <select id="dw" class="w-full bg-slate-900/90 border border-slate-700 p-3.5 rounded-xl text-white font-bold text-xs outline-none">
                                            <option value="" class="bg-slate-800 text-slate-400">-- Select Person --</option>
                                            ${(state.data.contacts || []).map(c => FinzUI.html`<option value="${c.name}" class="bg-slate-800">${c.name}</option>`).join('')}
                                        </select>
                                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.openContactModal() })}" class="bg-rose-500/20 text-rose-400 p-3.5 rounded-xl border border-rose-500/30 hover:bg-rose-500/30 transition-colors shrink-0" title="Add New Contact">
                                            <i data-lucide="user-plus" class="w-4 h-4"></i>
                                        </button>
                                    </div>
                                </div>

                                <!-- Meta Info (Account & Date) -->
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1.5 block">Account Link</label>
                                        <select id="ds" class="w-full bg-slate-900/90 border border-slate-700 p-3 rounded-xl text-white font-bold text-xs outline-none">
                                            <option value="" class="bg-slate-800">-- No Account --</option>
                                            ${state.data.accounts.map(a => FinzUI.html`<option value="${a.id}" class="bg-slate-800">${a.name}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div>
                                        <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1.5 block">Credit Dates</label>
                                        <label class="text-xs text-slate-400">Credit given / borrowed date</label>
                                        <input type="date" id="debt-given-date" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}" class="w-full bg-slate-900/90 border border-slate-700 p-2.5 rounded-xl text-white font-bold text-xs outline-none">
                                        <label class="text-xs text-slate-400">Repayment due date</label>
                                        <input type="date" id="drd" class="w-full bg-slate-900/90 border border-slate-700 p-2.5 rounded-xl text-white font-bold text-xs outline-none">
                                    </div>
                                </div>

                                <!-- Note -->
                                <div>
                                    <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1.5 block">Note / Reason</label>
                                    <input type="text" id="dn" placeholder="e.g. Loan, Dinner split, Car advance" class="w-full bg-slate-900/90 border border-slate-700 p-3 rounded-xl text-white font-bold text-xs outline-none">
                                </div>

                                <!-- BNPL Fields -->
                                <div id="bnpl-fields" class="hidden bg-slate-900/90 p-4 rounded-2xl border border-slate-700 space-y-3">
                                    <input type="text" id="bnpl-product" placeholder="Product / Service Name (e.g. Tabby/Tamara)" class="w-full bg-slate-800 border border-slate-700 p-2.5 rounded-xl text-white font-bold text-xs outline-none">
                                    <div class="grid grid-cols-2 gap-3 items-center">
                                        <div>
                                            <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1 block">Split (Months)</label>
                                            <input type="number" id="db-split" value="4" data-finz-input="${FinzUI.handler(function(event) { return actions.calcInstallment() })}" class="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white font-black text-center text-sm">
                                        </div>
                                        <div class="text-right">
                                            <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1 block">Monthly EMI</label>
                                            <p id="bnpl-preview" class="text-rose-400 font-black text-base num-font">...</p>
                                        </div>
                                    </div>
                                </div>

                                <button id="btn-commit-debt" data-finz-click="${FinzUI.handler(function(event) { return actions.commitDebt() })}" class="w-full bg-rose-500 hover:bg-rose-600 text-white p-4 rounded-2xl font-black uppercase text-xs tracking-wider shadow-lg shadow-rose-500/30 transition-all mt-2">Commit Record</button>
                            </div>
                        </div>

                        <!-- RIGHT 7 COLS: DTI GAUGE & NAVIGATION FOLDERS -->
                        <div class="lg:col-span-7 space-y-6">
                            <!-- DTI Financial Health Gauge -->
                            ${actions.renderFinancialHealth()}

                            <!-- 3 Quick Navigation Folders (Grid) -->
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <!-- 1. Personal Liabilities Folder -->
                                <div data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('personal') })}" class="bg-gradient-to-br from-indigo-900/60 to-slate-900 p-5 rounded-[2rem] border border-indigo-500/30 shadow-lg relative overflow-hidden cursor-pointer hover:border-indigo-400 transition-all group flex flex-col justify-between h-40">
                                    <div class="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-2">
                                        <i data-lucide="users" class="w-5 h-5"></i>
                                    </div>
                                    <div>
                                        <h3 class="text-base font-black text-white leading-tight">Personal<br>Liabilities</h3>
                                        <p class="text-indigo-300 text-[10px] font-bold mt-1">${sortedPeople.length} Contacts</p>
                                    </div>
                                </div>

                                <!-- 2. Active BNPL Installments -->
                                <div data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('bnpl') })}" class="bg-gradient-to-br from-rose-900/60 to-slate-900 p-5 rounded-[2rem] border border-rose-500/30 shadow-lg relative overflow-hidden cursor-pointer hover:border-rose-400 transition-all group flex flex-col justify-between h-40">
                                    <div class="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-2">
                                        <i data-lucide="shopping-bag" class="w-5 h-5"></i>
                                    </div>
                                    <div>
                                        <h3 class="text-base font-black text-white leading-tight">Active<br>Installments</h3>
                                        <p class="text-rose-300 text-[10px] font-bold mt-1">${bnpl.length} Items</p>
                                    </div>
                                </div>

                                <!-- 3. Settled Archive -->
                                <div data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('archive') })}" class="bg-gradient-to-br from-slate-800 to-slate-900 p-5 rounded-[2rem] border border-slate-700 shadow-lg relative overflow-hidden cursor-pointer hover:border-slate-500 transition-all group flex flex-col justify-between h-40">
                                    <div class="w-10 h-10 rounded-2xl bg-slate-700 text-slate-300 flex items-center justify-center mb-2">
                                        <i data-lucide="archive" class="w-5 h-5"></i>
                                    </div>
                                    <div>
                                        <h3 class="text-base font-black text-white leading-tight">Settled<br>Archive</h3>
                                        <p class="text-slate-400 text-[10px] font-bold mt-1">Past Records</p>
                                    </div>
                                </div>
                            </div>

                            <!-- Payment Timeline -->
                            ${actions.renderPaymentTimeline()}
                        </div>
                    </div>
                </div>`;
            }

            // --- FOLDER: PERSONAL (Merged Payables/Receivables) ---
            if (state.ui.debtView === 'personal') {
                return FinzUI.html`<div class="w-full max-w-6xl mx-auto space-y-6 min-h-[50vh]">
                    <div class="flex items-center gap-4 mb-4 px-2">
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('home') })}" class="p-3 bg-slate-800 rounded-xl shadow-sm border border-slate-700/50 hover:bg-slate-700 transition-colors"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                        <h3 class="text-xl md:text-3xl font-black text-slate-100 flex-grow">Personal Liability</h3>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.bulkRemindOverdue() })}" class="p-3 bg-rose-500/10 text-rose-400 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-rose-500/20 transition-colors shadow-sm whitespace-nowrap flex items-center gap-2 border border-rose-500/20">
                            <i data-lucide="bell-ring" class="w-4 h-4"></i> Bulk Remind
                        </button>
                    </div>

                    <!-- SEARCH / FILTER BAR (Optional Future?) -->

                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start px-2">
                        ${sortedPeople.length > 0 ? sortedPeople.map(renderPerson).join('') :
                        FinzUI.literal("<div class=\"text-center py-20 opacity-50 col-span-2 md:col-span-3 lg:col-span-4\"><i data-lucide=\"users\" class=\"w-16 h-16 mx-auto mb-4 text-slate-500\"></i><p class=\"font-bold text-slate-400\">No active personal debts.</p></div>")}
                    </div>
                </div>`;
            }

                        // --- FOLDER: PERSON LEDGER PROFILE ---
            if (state.ui.debtView === 'person_ledger') {
                const pName = state.ui.debtPayload;
                const pItems = state.data.debts.filter(d => d.party === pName);
                
                const r = state.data.settings.rate || 22.75;
                let totalLent = 0;
                let totalBorrowed = 0;
                let virtualNet = 0;
                
                pItems.filter(d => !d.settled).forEach(d => {
                    const val = Number(d.amount) * (d.currency === 'AED' ? 1 : 1/r);
                    if(d.type === 'receivable') { totalLent += val; virtualNet += val; }
                    if(d.type === 'payable') { totalBorrowed += val; virtualNet -= val; }
                });

                const isNetOwe = virtualNet < -1.0;
                const isSettled = Math.abs(virtualNet) < 20.0;
                const netColor = isNetOwe ? "text-rose-400" : (isSettled ? "text-slate-400" : "text-emerald-400");

                const activeItems = pItems.filter(d => !d.settled);
                const settledItems = pItems.filter(d => d.settled);
                
                return FinzUI.html`<div class="max-w-4xl mx-auto space-y-6 min-h-[50vh] fade-in pb-20 text-left">
                    <!-- HEADER -->
                    <div class="flex items-center gap-4 mb-2">
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('personal') })}" class="p-3 bg-slate-800 rounded-xl shadow-sm border border-slate-700/50 hover:bg-slate-700 transition-colors"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                        <h3 class="text-xl md:text-2xl font-black text-slate-100 flex-grow">Contact Profile</h3>
                    </div>
                    
                    <!-- PROFILE HERO CARD WITH TRUST SCORE -->
                    <div class="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-[2.5rem] border border-slate-700/60 p-8 text-center relative overflow-hidden shadow-2xl">
                        ${(() => {
                            const t = (typeof actions.getContactTrustScore === 'function') ? actions.getContactTrustScore(pName) : { score: 100, tier: 'Clean Slate', color: 'emerald' };
                            const tBadgeColor = t.color === 'emerald' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : (t.color === 'teal' ? 'bg-teal-500/10 text-teal-400 border-teal-500/30' : (t.color === 'amber' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'));
                            const tStats = t.stats || {};
                            const repaymentRate = tStats.totalLent > 0 ? Math.round((tStats.totalRepaid / tStats.totalLent) * 100) : 100;
                            
                            return FinzUI.html`
                                <div class="w-20 h-20 mx-auto rounded-3xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4 shadow-inner">
                                    <i data-lucide="user" class="w-10 h-10"></i>
                                </div>
                                <h2 class="text-3xl font-black text-slate-100 mb-1 tracking-tight">${pName}</h2>
                                <div class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border ${tBadgeColor} mb-6">
                                    <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>
                                    <span class="text-[10px] font-black uppercase tracking-wider">Peer Trust Score: ${t.score}/100 • ${t.tier}</span>
                                </div>

                                <!-- Trust & Reliability KPI Strip -->
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl mx-auto mb-6 text-left">
                                    <div class="bg-slate-900/60 p-3 rounded-2xl border border-slate-700/50">
                                        <p class="text-[8px] font-bold text-slate-400 uppercase">Total Lent</p>
                                        <p class="text-xs font-black text-slate-200 num-font mt-0.5">${(tStats.totalLent || 0).toLocaleString()} AED</p>
                                    </div>
                                    <div class="bg-slate-900/60 p-3 rounded-2xl border border-slate-700/50">
                                        <p class="text-[8px] font-bold text-slate-400 uppercase">Total Repaid</p>
                                        <p class="text-xs font-black text-emerald-400 num-font mt-0.5">${(tStats.totalRepaid || 0).toLocaleString()} AED</p>
                                    </div>
                                    <div class="bg-slate-900/60 p-3 rounded-2xl border border-slate-700/50">
                                        <p class="text-[8px] font-bold text-slate-400 uppercase">Pay Rate</p>
                                        <p class="text-xs font-black text-indigo-400 num-font mt-0.5">${repaymentRate}%</p>
                                    </div>
                                    <div class="bg-slate-900/60 p-3 rounded-2xl border border-slate-700/50">
                                        <p class="text-[8px] font-bold text-slate-400 uppercase">Overdues</p>
                                        <p class="text-xs font-black ${tStats.overdueCount > 0 ? 'text-rose-400' : 'text-emerald-400'} num-font mt-0.5">${tStats.overdueCount || 0} active</p>
                                    </div>
                                </div>
                            `;
                        })()}
                        
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Overall Net Balance</p>
                        <p class="text-4xl font-black ${netColor} num-font tracking-tighter">${Math.abs(virtualNet).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-lg text-slate-400">AED</span></p>
                        <p class="text-xs font-bold text-slate-400 mt-1 uppercase">${isNetOwe ? '🔴 You Owe Them' : (isSettled ? '✅ Fully Settled' : '🟢 They Owe You')}</p>
                        
                        <div class="flex flex-wrap gap-3 mt-8 justify-center">
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.shareWhatsAppReminder(((pName))) })}" class="flex items-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-xl transition-all font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20">
                                <i data-lucide="message-circle" class="w-4 h-4"></i> WhatsApp Reminder
                            </button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.copyLedgerStatement(((pName))) })}" class="flex items-center gap-2 px-4 py-3 bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-xl transition-colors font-bold text-xs uppercase tracking-wider border border-slate-700 shadow-sm">
                                <i data-lucide="copy" class="w-4 h-4"></i> Copy Statement
                            </button>
                        </div>
                    </div>
                    
                    <!-- ACTIVE DEBTS -->
                    <div class="space-y-4 mt-8">
                        <h4 class="text-xs font-black text-slate-300 uppercase tracking-widest flex items-center gap-2 px-2">
                            <i data-lucide="activity" class="w-4 h-4 text-emerald-400"></i> Active Records (${activeItems.length})
                        </h4>
                        ${activeItems.length > 0 ? activeItems.map(d => {
                            let progress = 0;
                            if (d.originalAmount && d.originalAmount > 0) {
                                progress = ((d.originalAmount - d.amount) / d.originalAmount) * 100;
                            }
                            return FinzUI.html`
                                <div class="bg-slate-800/80 p-5 rounded-2xl border border-slate-700/70 hover:border-slate-600 transition-all shadow-md">
                                    <div class="flex justify-between items-start mb-4">
                                        <div class="flex items-center gap-3">
                                            <div class="w-2 h-10 rounded-full ${d.type === 'receivable' ? 'bg-emerald-400' : 'bg-rose-400'} shadow-sm"></div>
                                            <div>
                                                <p class="text-xs font-black text-slate-200 uppercase tracking-wide">${d.type === 'receivable' ? 'Lent to ' + pName : 'Borrowed from ' + pName}</p>
                                                <p class="text-[10px] text-slate-400 font-bold uppercase mt-0.5">${d.notes || 'General Debt'} • Due: ${d.repaymentDate || 'No Due Date'}</p>
                                            </div>
                                        </div>
                                        <div class="text-right bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-700/60">
                                            <p class="font-black text-xl ${d.type === 'receivable' ? 'text-emerald-400' : 'text-rose-400'} num-font">${Number(d.amount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-xs text-slate-400">${d.currency}</span></p>
                                        </div>
                                    </div>
                                    
                                    ${progress > 0 ? FinzUI.html`
                                        <div class="w-full bg-slate-900 rounded-full h-2 mb-4 overflow-hidden border border-slate-800">
                                            <div class="bg-emerald-400 h-full rounded-full" style="width: ${progress}%"></div>
                                        </div>
                                    ` : ''}
                                    
                                    <div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-700/50">
                                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.openPartialSettleModal(((d.id))) })}" class="py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold uppercase tracking-wider rounded-xl transition-all border border-slate-600">
                                            Partial Pay
                                        </button>
                                        ${d.type === 'payable' ?
                                        FinzUI.html`<button data-finz-click="${FinzUI.handler(function(event) { return actions.openSettleFlow(((d.id))) })}" class="py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md transition-all">Settle Full</button>` :
                                        FinzUI.html`<button data-finz-click="${FinzUI.handler(function(event) { return actions.openSettleFlow(((d.id))) })}" class="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md transition-all">Received Full</button>`}
                                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.writeOffDebt(((d.id))) })}" class="py-2.5 bg-slate-800 text-xs text-slate-400 hover:text-rose-400 font-bold uppercase tracking-wider rounded-xl hover:bg-rose-500/10 transition-colors border border-slate-700">Write Off</button>
                                    </div>
                                    ${renderHistory(d.id)}
                                </div>
                            `;
                        }).join('') : FinzUI.literal("<p class=\"text-center text-slate-500 font-bold text-xs py-8 bg-slate-900/40 rounded-2xl\">No active records for this contact.</p>")}
                    </div>
                    
                    <!-- ARCHIVED / SETTLED -->
                    <div class="space-y-3 mt-8 opacity-75">
                        <h4 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 px-2">
                            <i data-lucide="archive" class="w-4 h-4"></i> Settled History
                        </h4>
                        ${settledItems.length > 0 ? settledItems.map(d => FinzUI.html`
                            <div class="bg-slate-900/50 p-4 rounded-xl border border-slate-800/80 flex justify-between items-center">
                                <div class="flex items-center gap-3">
                                    <i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-400"></i>
                                    <div>
                                        <p class="text-xs font-bold text-slate-300 uppercase">${d.type === 'receivable' ? 'Lent' : 'Borrowed'} ${d.currency}</p>
                                        <p class="text-[9px] text-slate-500 font-bold uppercase mt-0.5">${d.notes || 'Settled'}</p>
                                    </div>
                                </div>
                                <p class="font-black text-slate-400 text-sm num-font line-through">${Math.round(d.originalAmount || d.amount).toLocaleString()} ${d.currency}</p>
                            </div>
                        `).join('') : FinzUI.literal("<p class=\"text-center text-slate-600 font-bold text-xs py-4\">No past history.</p>")}
                    </div>
                </div>`;
            }

            // --- FOLDER: BNPL ---
            if (state.ui.debtView === 'bnpl') {
                // Sort by next due
                bnpl.sort((a, b) => {
                    const nextA = a.schedule?.find(s => !s.paid)?.date || '9999';
                    const nextB = b.schedule?.find(s => !s.paid)?.date || '9999';
                    return nextA.localeCompare(nextB);
                });

                return FinzUI.html`<div class="w-full max-w-6xl mx-auto space-y-6 min-h-[50vh]">
                <div class="flex items-center gap-4 mb-4 px-2">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('home') })}" class="p-3 bg-slate-800 rounded-xl shadow-sm border border-slate-700/50 hover:bg-slate-700 transition-colors"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                    <h3 class="text-xl md:text-3xl font-black text-slate-100">Active Installments</h3>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 px-2">
                     ${bnpl.length > 0 ? bnpl.map(renderBnplItem).join('') : FinzUI.literal("<div class=\"p-10 text-center border-2 border-dashed border-slate-700/50 rounded-3xl col-span-full\"><p class=\"text-slate-500 font-bold uppercase text-xs mb-2\">No active installments</p><p class=\"text-[10px] text-slate-600\">Purchases will appear here</p></div>")}
                </div>
                </div>`;
            }

            // --- FOLDER: BNPL LEDGER ---
            if (state.ui.debtView === 'bnpl_ledger') {
                const d = state.data.debts.find(x => x.id === state.ui.debtPayload);
                if (!d) return actions.navDebt('bnpl');
                
                const nextDue = d.schedule.find(s => !s.paid);
                const nextDate = nextDue ? (nextDue.date || nextDue.dueDate) : 'Settled';
                let progress = 0;
                if (d.originalAmount && d.originalAmount > 0) {
                    progress = ((d.originalAmount - d.currentAmount) / d.originalAmount) * 100;
                }

                return FinzUI.html`<div class="max-w-2xl mx-auto space-y-6 min-h-[50vh] fade-in pb-20">
                    <!-- HEADER -->
                    <div class="flex items-center gap-4 mb-2">
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('bnpl') })}" class="p-3 bg-slate-800 rounded-xl shadow-sm border border-slate-700/50 hover:bg-slate-700 transition-colors"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                        <h3 class="text-xl font-black text-slate-100 flex-grow">Installment Details</h3>
                    </div>

                    <!-- PROFILE CARD -->
                    <div class="bg-slate-900/40 rounded-[2.5rem] border border-slate-700/50 p-8 text-center relative overflow-hidden shadow-lg">
                        <div class="w-16 h-16 mx-auto rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-4 shadow-inner">
                            <i data-lucide="shopping-bag" class="w-8 h-8"></i>
                        </div>
                        <h2 class="text-3xl font-black text-slate-100 mb-1 tracking-tight">${d.party}</h2>
                        <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6">Original Plan: ${d.originalAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ${d.currency}</p>
                        
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Remaining Balance</p>
                        <p class="text-4xl font-black text-rose-500 num-font tracking-tighter">${d.currentAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-lg text-slate-500">${d.currency}</span></p>
                        
                        <div class="w-full max-w-sm mx-auto bg-slate-800/80 rounded-full h-2 mt-6 overflow-hidden">
                            <div class="bg-emerald-500 h-full rounded-full" style="width: ${progress}%"></div>
                        </div>
                    </div>

                    <!-- PAYMENT PLAN -->
                    <div class="space-y-3 mt-8">
                        <h4 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 px-2">
                            <i data-lucide="calendar" class="w-4 h-4"></i> Schedule
                        </h4>
                        ${d.schedule.map((s, idx) => FinzUI.html`
                            <div class="bg-slate-800/40 p-4 rounded-2xl border border-slate-700/50 hover:bg-slate-800/60 transition-colors flex justify-between items-center ${s.paid ? 'opacity-50' : ''}">
                                <div class="flex items-center gap-4">
                                    <div class="w-10 h-10 rounded-xl ${s.paid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'} flex items-center justify-center text-sm font-black shadow-inner">
                                        ${idx + 1}
                                    </div>
                                    <div>
                                        <p class="text-xs font-black text-slate-200">${s.paid ? 'Paid' : (s.date || s.dueDate || 'Pending')}</p>
                                        <p class="text-[9px] text-slate-400 font-bold uppercase mt-0.5">${s.paid ? 'Completed' : 'Pending'}</p>
                                    </div>
                                </div>
                                <div class="flex items-center gap-3">
                                    <span class="font-black text-sm ${s.paid ? 'text-slate-400 line-through' : 'text-slate-200'} num-font">${s.amount} <span class="text-[9px] text-slate-500">${d.currency}</span></span>
                                    ${!s.paid ?
                                    FinzUI.html`<button data-finz-click="${FinzUI.handler(function(event) { return actions.openBnplSettleModal(((d.id)), (idx)) })}" class="w-10 h-10 flex items-center justify-center bg-rose-600 text-white rounded-xl hover:bg-rose-500 transition-colors shadow-[0_0_10px_rgba(244,63,94,0.3)] active:scale-95">
                                        <i data-lucide="banknote" class="w-5 h-5"></i>
                                    </button>`
                                    :
                                    FinzUI.html`<div class="w-10 h-10 flex items-center justify-center text-emerald-500"><i data-lucide="check-circle-2" class="w-6 h-6"></i></div>`}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            }

            // --- FOLDER: ARCHIVE ---
            if (state.ui.debtView === 'archive') {
                const settled = state.data.debts.filter(d => d.settled);
                return FinzUI.html`<div class="max-w-xl mx-auto space-y-6 min-h-[50vh]">
                <div class="flex items-center gap-4 mb-6">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.navDebtHome() })}" class="bg-slate-800 p-3 rounded-xl hover:bg-slate-700 border border-slate-700/50"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                    <h2 class="text-2xl font-black text-slate-100">Archive / Settled</h2>
                </div>
                     ${settled.length > 0 ? settled.map(d => {
                    // Simple Render for Archive
                    return FinzUI.html`<div class="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 mb-2 opacity-75 grayscale hover:grayscale-0 transition-all">
                                 <div class="flex justify-between items-center">
                                      <div class="text-left">
                                          <p class="font-black text-slate-100 text-sm">${d.party}</p>
                                          <p class="text-[9px] font-bold text-slate-400 uppercase">${d.type} • ${d.amount} ${d.currency}</p>
                                      </div>
                                      <p class="font-bold text-xs text-slate-500">${new Date(d.date).toLocaleDateString()}</p>
                                 </div>
                                 <div class="mt-2 text-[9px] text-slate-400 border-t border-slate-700/50 pt-2">
                                     ${renderHistory(d.id)}
                                 </div>
                            </div>`;
                }).join('') :
                        FinzUI.html`<div class="text-center py-20 opacity-50"><i data-lucide="archive" class="w-16 h-16 mx-auto mb-4 text-slate-300"></i><p class="font-bold">No archival records.</p></div>`}
                </div>`;
            }
        };

actions.renderBNPLAnalyzer = function () {
            const r = state.data.settings.rate;

            // 1. Calculate Avg Income (3 Months)
            const now = new Date();
            const threeMonthsAgo = new Date(); threeMonthsAgo.setDate(now.getDate() - 90);
            const incomeTxs = state.data.transactions.filter(t => t.type === 'income' && new Date(t.date) >= threeMonthsAgo);
            const totalInc = incomeTxs.reduce((s, t) => {
                const acc = state.data.accounts.find(a => a.id === t.accountId);
                const cur = t.currency || acc?.currency || 'AED';
                return s + (Number(t.amount) * (cur === 'AED' ? 1 : (1 / r)));
            }, 0);
            const uniqueMonths = new Set(incomeTxs.map(t => new Date(t.date).getMonth() + '-' + new Date(t.date).getFullYear())).size;
            const avgIncome = totalInc / (uniqueMonths || 1);

            // 2. Fixed Obligations
            const fixedCats = state.data.fixedCategories || [];
            const fixedBudgetSum = fixedCats.reduce((s, cat) => s + (state.data.budgets[cat] || 0), 0);
            const discretionary = Math.max(0, avgIncome - fixedBudgetSum);
            const safeLimit = discretionary * 0.20;
            const availableCapacity = safeLimit;

            return FinzUI.html`<div class="bg-indigo-50 p-6 rounded-[2.5rem] border border-indigo-100 relative overflow-hidden text-center mb-8">
                <div class="flex justify-between items-center mb-4 relative z-10 px-2">
                    <h4 class="text-[10px] font-black uppercase text-indigo-400 tracking-widest flex items-center gap-2">
                        <i data-lucide="shopping-bag" class="w-4 h-4"></i> BNPL Power
                    </h4>
                    <div class="flex items-center gap-2 bg-indigo-100 px-2 py-1 rounded-lg">
                        <span class="text-[9px] font-bold text-indigo-400 uppercase">Split:</span>
                        <input type="number" id="bnpl-split" value="4" min="1" max="60" data-finz-input="${FinzUI.handler(function(event) { return actions.calcBNPLSafe((availableCapacity)) })}" class="bg-transparent text-indigo-600 w-8 font-black text-[9px] text-center border-none outline-none num-font">
                        <span class="text-[9px] font-bold text-indigo-400 uppercase">Months</span>
                    </div>
                </div>

                <div class="relative z-10">
                    <p class="text-[10px] uppercase font-black text-slate-400 mb-1">Safe Monthly Capacity</p>
                    <h3 class="text-3xl font-black text-slate-800 mb-1 num-font">AED ${Math.round(availableCapacity).toLocaleString()}</h3>
                    <p class="text-xs text-slate-400 font-bold mb-6">Based on 20% of your free cash (AED ${Math.round(discretionary).toLocaleString()})</p>

                    <!-- SIMULATOR -->
                    <div class="text-slate-900 bg-white p-4 rounded-2xl border border-indigo-50 shadow-sm text-left">
                        <div class="flex justify-between items-center mb-2">
                            <label class="text-[9px] font-black uppercase text-slate-400 block ml-1">Purchase Simulator</label>
                            <span class="text-[8px] font-bold text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-md uppercase">Interest-Free Only</span>
                        </div>
                        <div class="flex gap-4 items-center">
                            <input type="number" id="bnpl-price" data-finz-input="${FinzUI.handler(function(event) { return actions.calcBNPLSafe((availableCapacity)) })}" placeholder="Total Price (AED)" class="w-full p-3 border rounded-xl font-bold text-center outline-none focus:border-indigo-500 num-font">
                            <i data-lucide="arrow-right" class="w-4 h-4 text-slate-300"></i>
                            <div id="bnpl-result" class="text-slate-900 w-full p-3 bg-slate-50 rounded-xl font-bold text-xs text-center text-slate-400">
                                Enter Amount
                            </div>
                        </div>
                    </div>
                    <p id="bnpl-warning" class="text-[9px] text-slate-400 mt-3 italic opacity-60">"Avoid plans > 4 months to pay zero interest."</p>
                </div>
            </div>`;
        };

actions.calcBNPLSafe = function (limit) {
            const val = parseFloat(document.getElementById('bnpl-price').value);
            const split = parseInt(document.getElementById('bnpl-split').value) || 4;
            const res = document.getElementById('bnpl-result');

            if (isNaN(val) || val <= 0) {
                FinzUI.setHTML(res, "Enter Amount");
                res.className = "w-full p-3 bg-slate-50 rounded-xl font-bold text-xs text-center text-slate-400";
                return;
            }

            const installment = val / split;
            const isSafe = installment <= limit;

            if (isSafe) {
                FinzUI.setHTML(res, FinzUI.html`<span class="text-emerald-500 block">✅ AED ${Math.round(installment)} /mo</span> <span class="text-[8px] uppercase">Safe over ${split} mo</span>`);
                res.className = "w-full p-2 bg-emerald-50 border border-emerald-100 rounded-xl font-bold text-xs text-center";
            } else {
                FinzUI.setHTML(res, FinzUI.html`<span class="text-red-500 block">? AED ${Math.round(installment)} /mo</span> <span class="text-[8px] uppercase">Too Risky</span>`);
                res.className = "w-full p-2 bg-red-50 border border-red-100 rounded-xl font-bold text-xs text-center";
            }

            // Update Warning
            const warn = document.getElementById('bnpl-warning');
            if (warn) {
                if (split > 4) {
                    warn.innerText = "⚠? Caution: Ensure 0% Interest. Banks often charge processing fees for 12 months.";
                    warn.className = "text-[9px] text-amber-500 mt-3 italic font-bold";
                } else {
                    warn.innerText = "\"Avoid plans> 4 months to pay zero interest.\"";
                    warn.className = "text-[9px] text-slate-400 mt-3 italic opacity-60";
                }
            }
        };

actions.checkContactSelect = function () {
            const val = document.getElementById('dw').value;
            if (val === 'new') actions.openContactModal();
        };

actions.toggleDebtFields = function () {
            const type = document.getElementById('dt').value;
            const bnplFields = document.getElementById('bnpl-fields');
            const partyContainer = document.getElementById('debt-party-container');

            if (type === 'bnpl') {
                if (bnplFields) bnplFields.classList.remove('hidden');
                if (partyContainer) partyContainer.classList.add('hidden');
            } else {
                if (bnplFields) bnplFields.classList.add('hidden');
                if (partyContainer) partyContainer.classList.remove('hidden');
            }
        };

actions.commitDebt = function () {
            const type = document.getElementById('dt').value;
            let who = document.getElementById('dw').value;
            const cur = document.getElementById('dc').value;
            const amt = parseFloat(document.getElementById('da').value);
            const date = document.getElementById('drd').value;
            const givenDate = document.getElementById('debt-given-date').value;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(givenDate) || !Number.isFinite(Date.parse(givenDate)) || new Date(givenDate).toISOString().slice(0, 10) !== givenDate) return actions.showToast('Enter a valid credit date.', 'error');
            if (date && date < givenDate) return actions.showToast('Repayment date cannot be before the credit date.', 'error');
            const note = document.getElementById('dn').value;
            const accId = document.getElementById('ds').value;

            // BNPL Override: Auto-assign "who" if empty
            if (type === 'bnpl') {
                const prod = document.getElementById('bnpl-product').value;
                who = prod || "BNPL Purchase"; // Use product name or default
            } else {
                // Personal Debt requires a person
                if (!who) return actions.showToast('Please select a person', 'error');
            }

            // BNPL FLAG: If BNPL selected in dropdown, force 'bnpl' type logic if user missed it?
            // User selects "BNPL" in 'dt' (Debt Type). 'dt' value is 'bnpl'.
            // So type IS 'bnpl'. Consistency check handled.

            if (isNaN(amt)) return actions.showToast('Please enter amount', 'error');

            if (amt <= 0) return actions.showToast('Amount must be positive', 'error');

            actions.setBtnLoading('btn-commit-debt', true);

            // Stash
            actions.dataToCommit = { type, who, cur, amt, date, givenDate, note, accId };

            // LENDING SAFE CHECK
            if (type === 'receivable') {
                const limit = state.data.settings.lendingLimit || 50000; // Default warning threshold
                if (amt > limit) {
                    return actions.showConfirm(
                        "High Value Lending",
                        `You are about to lend ${amt} ${cur}. Ensure you have proper documentation.Proceed ? `,
                        () => actions.finalizeCommitDebt(),
                        "Proceed", // Context aware label
                        () => actions.setBtnLoading('btn-commit-debt', false) // FIX: Reset loading on cancel
                    );
                }

                const r = state.data.settings.rate;
                const liquidAssets = state.data.accounts
                    .filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type))
                    .reduce((s, a) => s + (a.currency === 'AED' ? a.balance : a.balance / r), 0);

                const now = new Date();
                const last30 = new Date(); last30.setDate(now.getDate() - 30);
                const burn = state.data.transactions
                    .filter(t => t.type === 'expense' && new Date(t.date) > last30)
                    .reduce((s, t) => {
                        const acc = state.data.accounts.find(a => a.id === t.accountId);
                        const tCur = t.currency || (acc ? acc.currency : 'AED');
                        return s + (parseFloat(t.amount) * (tCur === 'AED' ? 1 : 1 / r));
                    }, 0) || 3000;

                const loanAmt = (cur === 'AED' ? amt : amt / r);
                const runwayAfterLoan = (liquidAssets - loanAmt) / (burn || 1);

                if (runwayAfterLoan < 1) {
                    actions.showConfirm(
                        `⚠? High Risk Warning`,
                        `Lending leaves only ~${runwayAfterLoan.toFixed(1)} months of runway.Proceed ? `,
                        () => actions.finalizeCommitDebt(),
                        "Proceed",
                        () => actions.setBtnLoading('btn-commit-debt', false) // Reset loading on cancel
                    );
                    return;
                }
            }

            return actions.finalizeCommitDebt();
        };

actions.finalizeCommitDebt = async function () {
            const { type, who, cur, amt, date, givenDate, note, accId } = actions.dataToCommit;
            const r = state.data.settings.rate;

            // Balance Check for Lending
            if (accId && type === 'receivable') {
                const acc = state.data.accounts.find(a => a.id === accId);
                if (acc) {
                    const checkAmt = (cur === 'AED' ? amt : (cur === acc.currency ? amt : (acc.currency === 'AED' ? amt * r : amt)));
                    // Simplified: Convert entered 'amt' (in 'cur') to Account Currency
                    // If cur == acc.currency, amount is amt.
                    // If cur != acc.currency... e.g. I lend 1000 INR from AED account.
                    // amt=1000, cur=INR. acc=AED.
                    // cost = 1000 / rate.

                    let cost = amt;
                    if (cur !== acc.currency) {
                        if (cur === 'INR' && acc.currency === 'AED') cost = amt / r;
                        else if (cur === 'AED' && acc.currency === 'INR') cost = amt * r;
                    }

                    if (acc.balance < cost) {
                        actions.showToast(`Insufficient Funds in ${acc.name} (Need ${cost.toFixed(2)} ${acc.currency})`, "error");
                        actions.setBtnLoading('btn-commit-debt', false);
                        return;
                    }
                }
            }

            if (type === 'bnpl') {
                const split = parseInt(document.getElementById('db-split').value) || 3;
                const schedule = [];
                const perMonth = amt / split;
                const start = date ? new Date(date) : new Date();

                for (let i = 0; i < split; i++) {
                    const d = new Date(start);
                    // 29-day logic as per user request (buffer)
                    d.setDate(d.getDate() + (29 * i));
                    schedule.push({
                        date: d.toISOString().split('T')[0],
                        amount: perMonth.toFixed(2),
                        paid: false
                    });
                }

                state.data.debts.push({
                    id: actions.genId(),
                    type: 'payable',
                    subtype: 'bnpl',
                    party: who,
                    amount: amt,
                    currentAmount: amt,
                    originalAmount: amt,
                    currency: cur,
                    installments: split,
                    schedule: schedule,
                    date: givenDate,
                    repaymentDate: schedule[0].date, // Fixed: use .date not .dueDate
                    notes: 'BNPL Split',
                    settled: false,
                    isBnpl: true
                });
            } else {
                state.data.debts.push({
                    id: actions.genId(),
                    type: type,
                    party: who,
                    amount: amt,
                    originalAmount: amt,
                    currency: cur,
                    date: givenDate,
                    repaymentDate: date,
                    notes: note || '',
                    settled: false
                });


            }

            // Save the debt and its cash movement atomically using the selected credit date.
            if (accId && type !== 'bnpl') {
                const acc = state.data.accounts.find(a => a.id === accId);
                if (!acc) throw new Error('Select an available account.');
                state.data.transactions.push({ id: actions.genId(), accountId: acc.id,
                    type: type === 'receivable' ? 'expense' : 'income',
                    amount: FinzCore.convert(amt, cur, acc.currency, r), currency: acc.currency,
                    category: type === 'receivable' ? 'Loan Given' : 'Loan',
                    note: type === 'receivable' ? `Lent to ${who}` : `Borrowed from ${who}`,
                    date: new Date(givenDate + 'T12:00:00').toISOString(), exchangeRate: r });
            }

            await actions.updateDb();
            actions.renderApp();
            
            // Render a beautiful, centered success message
            const modalContent = document.getElementById('modal-content');
            if (modalContent) {
                FinzUI.setHTML(modalContent, FinzUI.html`
                    <div class="flex flex-col items-center justify-center space-y-6 py-20 fade-in text-center">
                        <div class="w-24 h-24 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(16,185,129,0.3)] transform scale-in">
                            <i data-lucide="check-circle-2" class="w-12 h-12"></i>
                        </div>
                        <div>
                            <h3 class="text-3xl font-black text-slate-100 tracking-tight">Debt Recorded</h3>
                            <p class="text-slate-400 font-bold mt-2">The liability has been securely logged.</p>
                        </div>
                        <div class="flex gap-4 pt-4">
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.navDebtHome() })}" class="px-8 py-4 bg-slate-800 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-700 transition-colors border border-slate-700/50 shadow-lg">Done</button>
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('home') })}" class="px-8 py-4 bg-rose-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-rose-500 transition-colors shadow-[0_0_15px_rgba(225,29,72,0.3)]">Add Another</button>
                        </div>
                    </div>
                `);
                if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
            }

            actions.setBtnLoading('btn-commit-debt', false);
        };

actions.openSettleFlow = function (id) {
            const d = state.data.debts.find(x => x.id === id), c = document.getElementById('modal-content');
            document.getElementById('modal-title').innerText = "Process Settlement";
            FinzUI.setHTML(c, FinzUI.html`<div class="text-slate-900 max-w-md mx-auto bg-slate-50 p-10 rounded-[3rem] border space-y-6 text-center shadow-xl">
                <p class="text-[10px] font-black uppercase">Entity: ${d.party}</p>
                <p class="text-3xl font-black">${d.amount} <span class="text-xs opacity-30">${d.currency}</span></p>
                <div class="text-left text-center"><label class="text-[10px] font-black uppercase block mb-1">Enter Volume (${d.currency})</label><input type="number" id="samt" step="0.01" value="${d.amount}" class="w-full p-4 border rounded-xl font-black text-xl text-center outline-none"></div>
                <div class="text-left text-center"><label class="text-[10px] font-black uppercase block mb-1">Select account</label><select id="sacc" class="text-slate-900 w-full p-4 border rounded-xl bg-white font-bold text-center">${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(acc => FinzUI.html`<option value="${acc.id}">${acc.name} (${acc.currency})</option>`).join('')}</select></div>
                <button id="btn-finalize-settle" data-finz-click="${FinzUI.handler(function(event) { return actions.finalizeSettle(((id))) })}" class="w-full bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase shadow-lg text-center text-center">Authorize Movement</button>
            </div> `);
            actions.closeReminder(); document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
        };

actions.finalizeSettle = async function (id) {
            const aId = document.getElementById('sacc').value;
            const enteredAmt = parseFloat(document.getElementById('samt').value);

            const dIdx = state.data.debts.findIndex(d => d.id === id);
            const d = state.data.debts[dIdx];
            const aIdx = state.data.accounts.findIndex(a => a.id === aId);

            if (aIdx === -1 || isNaN(enteredAmt) || enteredAmt <= 0 || enteredAmt > d.amount) return;

            const acc = state.data.accounts[aIdx];
            const rate = state.data.settings.rate;
            let finalTxAmt = enteredAmt;

            if (d.currency !== acc.currency) {
                if (d.currency === 'AED' && acc.currency === 'INR') finalTxAmt = enteredAmt * rate;
                else if (d.currency === 'INR' && acc.currency === 'AED') finalTxAmt = enteredAmt / rate;
            }

            // Balance Check
            if (d.type !== 'receivable' && acc.balance < finalTxAmt) {
                actions.showToast(`Insufficient Funds in ${acc.name}`, "error");
                return;
            }

            actions.setBtnLoading('btn-finalize-settle', true);




            if (d.currency !== acc.currency) {
                if (d.currency === 'AED' && acc.currency === 'INR') finalTxAmt = enteredAmt * rate;
                else if (d.currency === 'INR' && acc.currency === 'AED') finalTxAmt = enteredAmt / rate;
            }

            const currentBal = acc.balance;
            // LEDGER-BASED REFACTOR: Do not manually update balance
            // state.data.accounts[aIdx].balance = window.toCurrency(d.type === 'receivable' ? currentBal + finalTxAmt : currentBal - finalTxAmt);

            const fxNote = [];
            if (d.currency !== acc.currency) {
                // FX Calculation
                // valueOfDebtPaid (Base) = enteredAmt (in Debt Cur) * (Debt Rate? We don't track historical debt rate perfectly yet, 
                // but let's assume current rate for "Cost to Pay" vs "Value Extinguished")

                // Simplified: User paid 'finalTxAmt' in Account Currency.
                // Value of Debt extinguished = enteredAmt in Debt Currency.
                // We need to compare them in ONE currency (Base AED usually).

                const baseRate = state.data.settings.rate;
                let costInAED = 0;
                let valueInAED = 0;

                // 1. Cost in AED
                if (acc.currency === 'AED') costInAED = finalTxAmt;
                else costInAED = finalTxAmt / baseRate; // INR -> AED

                // 2. Value in AED
                if (d.currency === 'AED') valueInAED = enteredAmt;
                else valueInAED = enteredAmt / baseRate; // INR -> AED

                const diff = valueInAED - costInAED; // Positive = Gain (Paid less than value), Negative = Loss
                if (Math.abs(diff) > 1) {
                    fxNote.push(`(FX ${diff >= 0 ? 'Gain' : 'Loss'}: ${Math.abs(diff).toFixed(2)} AED)`);
                }
            }

            state.data.transactions.push({
                id: actions.genId(),
                accountId: aId,
                amount: actions.toCurrency(finalTxAmt),
                type: d.type === 'receivable' ? 'income' : 'expense',
                category: 'Settlement',
                currency: acc.currency,
                note: `${d.party} (${enteredAmt} ${d.currency}) ${fxNote.join(' ')}`,
                debtId: id, // Link to Debt
                debtAmount: enteredAmt,
                date: new Date().toISOString(),
                exchangeRate: rate
            });

            // Math Safety & Auto-Settle
            const newAmount = d.amount - enteredAmt;
            if (newAmount <= 0.1) { // Threshold for float dust
                state.data.debts[dIdx].amount = 0;
                state.data.debts[dIdx].settled = true;
            } else {
                state.data.debts[dIdx].amount = actions.toCurrency(newAmount);
            }

            actions.recalculateBalances();
            await updateDb();
            actions.setBtnLoading('btn-finalize-settle', false);
            renderApp();
            FinzUI.setHTML(document.getElementById('modal-content'), FinzUI.html`<div class="flex flex-col items-center justify-center space-y-4 py-20 fade-in text-center text-center"><div class="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-center"><i data-lucide="check-circle-2" class="w-10 h-10"></i></div><h3 class="text-2xl font-black">Success!</h3><button data-finz-click="${FinzUI.handler(function(event) { return actions.closeModal() })}" class="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold uppercase text-[10px] text-center">Done</button></div> `);
            lucide.createIcons();
        };

actions.openRescheduleFlow = function (id) {
            const d = state.data.debts.find(x => x.id === id), b = document.getElementById('modal-backdrop'), t = document.getElementById('modal-title'), c = document.getElementById('modal-content');
            t.innerText = "Schedule Later";
            FinzUI.setHTML(c, FinzUI.html`<div class="text-slate-900 max-w-md mx-auto bg-white p-10 rounded-[3rem] border shadow-xl space-y-6 text-center text-center"><p class="text-[10px] font-black uppercase text-slate-400">Extension for ${d.party}</p><div class="text-left text-center"><label class="text-[10px] font-black uppercase block mb-2 text-center text-center">New Date</label><input type="date" id="new-date" class="w-full p-4 border rounded-xl font-bold text-center outline-none"></div><button id="btn-resched" data-finz-click="${FinzUI.handler(function(event) { return actions.finalizeReschedule(((id))) })}" class="w-full bg-slate-900 text-white p-5 rounded-3xl font-black uppercase shadow-lg text-center text-center">Commit</button></div> `);
            b.classList.replace('hidden', 'flex'); actions.closeReminder(); lucide.createIcons();
        };

actions.finalizeReschedule = async function (id) {
            const dt = document.getElementById('new-date').value; if (!dt) return;
            actions.setBtnLoading('btn-resched', true);
            state.data.debts[state.data.debts.findIndex(i => i.id === id)].repaymentDate = dt;
            await updateDb(); renderApp();
            FinzUI.setHTML(document.getElementById('modal-content'), FinzUI.html`<div class="flex flex-col items-center justify-center space-y-6 py-20 fade-in text-center text-center text-center"><div class="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto text-center"><i data-lucide="calendar-check" class="w-12 h-12"></i></div><h3 class="text-2xl font-black text-center text-center">Updated</h3><button data-finz-click="${FinzUI.handler(function(event) { return actions.closeModal() })}" class="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold uppercase text-[10px] text-center">Done</button></div> `);
            lucide.createIcons();
        };

actions.openBnplSettleModal = function (id, idx) {
            const d = state.data.debts.find(x => x.id === id);
            if (!d || !d.schedule[idx] || d.schedule[idx].paid) return;

            const inst = d.schedule[idx];
            const amt = inst.amount;

            actions.showConfirm("Process Settlement", FinzUI.html`
                <div class="space-y-4 text-left">
                    <div class="bg-indigo-50 p-4 rounded-xl text-center">
                        <p class="text-[10px] uppercase font-black text-indigo-400">Payment Amount</p>
                        <h3 class="text-3xl font-black text-indigo-600">${amt} <span class="text-xs text-indigo-400">${d.currency}</span></h3>
                        <p class="text-[10px] font-bold text-indigo-400 mt-1">${d.party} • Installment ${idx + 1}/${d.installments}</p>
                    </div>
                    
                    <div>
                            <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Paid From</label>
                            <select id="bnpl-pay-acc" class="text-slate-900 w-full p-3 bg-slate-50 border rounded-xl font-bold text-xs outline-none focus:border-indigo-500">
                                ${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Wallet'].includes(a.type)).map(a =>
                FinzUI.html`<option value="${a.id}">${a.name} (${actions.toCurrency(a.balance)} ${a.currency})</option>`
            ).join('')}
                            </select>
                    </div>

                    <div>
                        <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Date Paid</label>
                        <input type="date" id="bnpl-pay-date" value="${new Date().toISOString().split('T')[0]}" class="text-slate-900 w-full p-3 bg-slate-50 border rounded-xl font-bold text-xs outline-none focus:border-indigo-500">
                    </div>

                        <div>
                        <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Note</label>
                        <input type="text" id="bnpl-pay-note" value="Paid ${d.party} Installment ${idx + 1}" class="text-slate-900 w-full p-3 bg-slate-50 border rounded-xl font-bold text-xs outline-none focus:border-indigo-500">
                    </div>
                </div>
            `, async () => {
                // Action Callback
                const accId = document.getElementById('bnpl-pay-acc').value;
                const dateVal = document.getElementById('bnpl-pay-date').value;
                const note = document.getElementById('bnpl-pay-note').value;
                const acc = state.data.accounts.find(a => a.id === accId);

                if (!acc) return;

                if (inst.paid) return;
                actions.recalculateBalances();
                const finalAmt = Number(amt);
                const baseAmt = FinzCore.convert(finalAmt, d.currency, acc.currency, state.data.settings.rate);
                if (!(baseAmt > 0) || acc.balance < baseAmt) throw new Error('Insufficient Funds');
                if (!dateVal || !Number.isFinite(Date.parse(dateVal))) throw new Error('Select a valid payment date.');
                const transactionId = actions.genId();

                // Date Logic: Use current time if selected date is Today (for Sorting Visibility)
                const selDate = new Date(dateVal);
                const today = new Date();
                let finalDateIso = selDate.toISOString();
                if (selDate.toDateString() === today.toDateString()) {
                    finalDateIso = today.toISOString();
                }

                // Note Logic: Append original amount if currency converted
                let finalNote = note;
                if (Math.abs(baseAmt - finalAmt) > 0.01) {
                    finalNote += ` (Paid ${finalAmt} ${d.currency})`;
                }

                inst.paid = true; inst.status = 'paid'; inst.paymentTransactionId = transactionId;
                // The installment change and its debit are saved together.
                // 3. Log Transaction (Handles State Push + DB Save + Recalc Balances)
                // We save the amount in the ACCOUNT'S Check currency to ensure the Ledger subtracts correctly.
                await actions.saveTransaction({
                    id: transactionId,
                    installmentIndex: idx,
                    debtAmount: finalAmt,
                    exchangeRate: state.data.settings.rate,
                    accountId: acc.id,
                    type: 'expense',
                    amount: actions.toCurrency(baseAmt),
                    currency: acc.currency,
                    category: 'BNPL Payment',
                    note: finalNote,
                    date: finalDateIso,
                    debtId: d.id,
                    tags: ['#BNPL']
                });

                // 4. UI Refresh
                actions.renderApp();

                // Refresh Modal Content (Instant Feedback)
                const modalContent = document.getElementById('modal-content');
                if (modalContent) { FinzUI.setHTML(modalContent, actions.renderDebtUI()); lucide.createIcons(); }

                actions.showToast("Payment Recorded Successfully", "success");

            }, "Confirm Payment");
        };

actions.settleInstallment = actions.openBnplSettleModal;

actions.openContactModal = function () {
    const m = document.getElementById('contact-modal');
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    document.getElementById('contact-relation').value = 'Friend';
    m.classList.replace('hidden', 'flex');
};

actions.saveNewContact = async function () {
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const rel = document.getElementById('contact-relation').value;

    if (!name) {
        actions.showToast("Name is required", "error");
        return;
    }
    if (!phone) {
        actions.showToast("Mobile Number is mandatory!", "error");
        return;
    }

    if (!state.data.contacts) state.data.contacts = [];
    if (state.data.contacts.find(c => c.name.toLowerCase() === name.toLowerCase())) {
        actions.showToast("Contact already exists", "warn");
        return;
    }

    const newC = { id: actions.genId(), name: name, phone: phone, relation: rel, creditScore: 100 };
    state.data.contacts.push(newC);
    
    document.getElementById('contact-modal').classList.replace('flex', 'hidden');
    actions.showToast("Contact Added Successfully", "success");

    await actions.updateDb();
    
    // Re-render UI
    if (typeof renderApp === 'function') renderApp();
    const modalContent = document.getElementById('modal-content');
    if (modalContent && !document.getElementById('modal-backdrop').classList.contains('hidden') && typeof actions.renderDebtUI === 'function') {
        FinzUI.setHTML(modalContent, actions.renderDebtUI());
        lucide.createIcons();
        // Set the dropdown to the new contact
        setTimeout(() => {
            const dw = document.getElementById('dw');
            if (dw) dw.value = name;
        }, 50);
    }
};

actions.openPartialSettleModal = function(debtId) {
    const d = state.data.debts.find(x => x.id === debtId);
    if (!d) return;

    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Record Partial Repayment';

    const accounts = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type));

    FinzUI.setHTML(c, FinzUI.html`
        <div class="max-w-lg mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.navDebt('person_ledger', ((d.party))) })}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div>
                    <h3 class="text-xl font-black text-white">Partial Payment: ${d.party}</h3>
                    <p class="text-xs text-slate-400 font-bold">Original: ${Number(d.originalAmount || d.amount).toLocaleString()} ${d.currency} | Current: ${Number(d.amount).toLocaleString()} ${d.currency}</p>
                </div>
            </div>

            <div class="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60 text-center">
                <p class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Remaining Outstanding</p>
                <p class="text-3xl font-black text-white num-font mt-1">${Number(d.amount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-sm text-slate-400">${d.currency}</span></p>
            </div>

            <div class="space-y-4">
                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Amount ${d.type === 'receivable' ? 'Received' : 'Paid'} (${d.currency})</label>
                    <input type="number" id="partial-pay-amt" placeholder="0.00" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-emerald-400 font-black text-2xl outline-none num-font focus:border-emerald-500">
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">${d.type === 'receivable' ? 'Deposit Into Account' : 'Pay From Account'}</label>
                    <select id="partial-pay-acc" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${accounts.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency}) - Balance: ${a.balance.toLocaleString()}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Payment Date</label>
                    <input type="date" id="partial-pay-date" value="${new Date().toISOString().split('T')[0]}" class="w-full p-3.5 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                </div>
            </div>

            <button data-finz-click="${FinzUI.handler(function(event) { return actions.commitPartialPayment(((d.id))) })}" class="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                <i data-lucide="check-circle-2" class="w-5 h-5"></i> Commit Partial Payment
            </button>
        </div>
    `);
    if (libraries.lucide) libraries.lucide.createIcons();
};

actions.commitPartialPayment = async function(debtId) {
    const d = state.data.debts.find(x => x.id === debtId);
    if (!d) return;

    const amt = parseFloat(document.getElementById('partial-pay-amt')?.value) || 0;
    const accId = document.getElementById('partial-pay-acc')?.value;
    const payDate = document.getElementById('partial-pay-date')?.value || new Date().toISOString();

    if (!Number.isFinite(amt) || amt <= 0) {
        actions.showToast("Please enter a valid payment amount", "error");
        return;
    }

    if (amt > Number(d.amount)) {
        actions.showToast(`Amount cannot exceed outstanding balance of ${d.amount} ${d.currency}`, "error");
        return;
    }

    if (!d.originalAmount) d.originalAmount = Number(d.amount);

    const acc = state.data.accounts.find(a => a.id === accId);
    const rateSnapshot = state.data.settings?.rate || 22.75;

    // Currency conversion if debt currency differs from target account currency
    let finalTxAmt = amt;
    const fxInfo = [];
    if (acc && d.currency !== acc.currency) {
        if (d.currency === 'AED' && acc.currency === 'INR') {
            finalTxAmt = amt * rateSnapshot;
            fxInfo.push(`(≈ ₹${finalTxAmt.toFixed(2)})`);
        } else if (d.currency === 'INR' && acc.currency === 'AED') {
            finalTxAmt = amt / rateSnapshot;
            fxInfo.push(`(≈ AED ${finalTxAmt.toFixed(2)})`);
        }
    }

    // Log the transaction
    const isReceivable = d.type === 'receivable';
    actions.recalculateBalances();
    if (!acc || !Number.isFinite(Date.parse(payDate)) || (!isReceivable && acc.balance < finalTxAmt)) {
        actions.showToast('Select a valid payment account and date with sufficient funds.', 'error'); return;
    }
    state.data.transactions.push({
        id: actions.genId(),
        accountId: accId,
        amount: actions.toCurrency(finalTxAmt),
        type: isReceivable ? 'income' : 'expense',
        category: 'Debt Settlement',
        currency: acc ? acc.currency : d.currency,
        note: `Partial payment ${isReceivable ? 'from' : 'to'} ${d.party} (${amt} ${d.currency}) ${fxInfo.join(' ')}`,
        date: new Date(payDate).toISOString(),
        exchangeRate: rateSnapshot,
        debtId: d.id,
        debtAmount: amt
    });

    // Reduce debt
    d.amount = Number(d.amount) - amt;
    if (d.amount <= 0.01) {
        d.settled = true;
        d.amount = 0;
        d.settledDate = new Date().toISOString();
    }

    actions.recalculateBalances();
    await actions.updateDb();
    actions.showToast(`Recorded partial payment of ${amt.toLocaleString()} ${d.currency}!`, "success");
    actions.renderApp();
    actions.navDebt('person_ledger', d.party);
    if (actions.fireConfetti) actions.fireConfetti();
};

actions.getContactTrustScore = function(contactName) {
    if (!contactName) return { score: 100, tier: 'New Contact', color: 'indigo', label: '100 • Clean Slate', stats: {} };
    
    const debts = (state.data?.debts || []).filter(d => d.party?.toLowerCase() === contactName.toLowerCase() && d.type === 'receivable');
    if (debts.length === 0) {
        return { 
            score: 100, 
            tier: 'Clean Slate', 
            color: 'indigo', 
            icon: 'sparkles',
            label: '100/100 • Clean Slate', 
            stats: { totalLent: 0, totalRepaid: 0, overdueCount: 0, reschedules: 0, settledLateCount: 0, onTimeCount: 0 } 
        };
    }

    let score = 100;
    const now = new Date();

    let overdueDaysMax = 0;
    let overdueCount = 0;
    let reschedules = 0;
    let settledLateCount = 0;
    let onTimeCount = 0;
    let totalLent = 0;
    let totalRepaid = 0;

    debts.forEach(d => {
        const orig = Number(d.originalAmount) || Number(d.amount) || 0;
        const cur = Number(d.amount) || 0;
        totalLent += orig;
        totalRepaid += Math.max(0, orig - cur);

        reschedules += (d.rescheduledCount || 0);

        if (d.settled) {
            if (d.repaymentDate && d.settledDate && d.repaymentDate !== 'N/A') {
                const due = new Date(d.repaymentDate);
                const settled = new Date(d.settledDate);
                if (!isNaN(due.getTime()) && !isNaN(settled.getTime())) {
                    const diffDays = Math.ceil((settled - due) / (1000 * 60 * 60 * 24));
                    if (diffDays > 1) settledLateCount++;
                    else onTimeCount++;
                } else {
                    onTimeCount++;
                }
            } else {
                onTimeCount++;
            }
        }

        if (!d.settled && d.repaymentDate && d.repaymentDate !== 'N/A' && d.repaymentDate !== 'null') {
            const due = new Date(d.repaymentDate);
            if (!isNaN(due.getTime()) && due < now) {
                overdueCount++;
                const diffDays = Math.ceil((now - due) / (1000 * 60 * 60 * 24));
                if (diffDays > overdueDaysMax) overdueDaysMax = diffDays;
            }
        }
    });

    // 1. Deductions for Active Overdue Debts
    if (overdueDaysMax > 30) score -= 45;
    else if (overdueDaysMax > 14) score -= 30;
    else if (overdueDaysMax > 0) score -= 15;

    // 2. Deductions for Past Late Settlements
    score -= Math.min(25, settledLateCount * 10);

    // 3. Deductions for Postponements / Reschedules
    score -= Math.min(20, reschedules * 5);

    // 4. Bonus for Repayment Consistency
    if (totalRepaid > 0 && totalLent > 0 && (totalRepaid / totalLent) >= 0.5 && overdueCount === 0) {
        score = Math.min(100, score + 10);
    }

    score = Math.max(10, Math.min(100, Math.round(score)));

    let tier = 'Highly Reliable';
    let color = 'emerald';
    let icon = 'shield-check';

    if (score >= 90) {
        tier = 'Highly Reliable';
        color = 'emerald';
        icon = 'shield-check';
    } else if (score >= 75) {
        tier = 'Good Standing';
        color = 'teal';
        icon = 'check-circle';
    } else if (score >= 50) {
        tier = 'Moderate Risk';
        color = 'amber';
        icon = 'alert-circle';
    } else {
        tier = 'High Default Risk';
        color = 'rose';
        icon = 'alert-triangle';
    }

    return {
        score,
        tier,
        color,
        icon,
        label: `${score}/100 • ${tier}`,
        stats: { totalLent, totalRepaid, overdueCount, overdueDaysMax, reschedules, settledLateCount, onTimeCount }
    };
};

actions.calcTrustScore = function(contactName) {
    const t = actions.getContactTrustScore(contactName);
    return `${t.score}/100 (${t.tier})`;
};

actions.getPersonalCreditScore = function() {
    const r = state.data?.settings?.rate || 22.75;
    const now = new Date();
    
    // --- 1. PAYMENT & BNPL HISTORY (35% = Max 210 pts) ---
    const allDebts = state.data?.debts || [];
    const payables = allDebts.filter(d => d.type === 'payable' || d.subtype === 'bnpl' || d.isBnpl);
    
    let overduePayablesCount = 0;
    let maxOverdueDays = 0;
    
    payables.forEach(d => {
        if (!d.settled) {
            if (d.repaymentDate && d.repaymentDate !== 'N/A') {
                const due = new Date(d.repaymentDate);
                if (!isNaN(due.getTime()) && due < now) {
                    overduePayablesCount++;
                    const diffDays = Math.ceil((now - due) / (1000 * 60 * 60 * 24));
                    if (diffDays > maxOverdueDays) maxOverdueDays = diffDays;
                }
            }
            if (d.schedule && Array.isArray(d.schedule)) {
                d.schedule.forEach(s => {
                    if (!s.paid) {
                        const sDate = s.date || s.dueDate;
                        if (sDate && new Date(sDate) < now) {
                            overduePayablesCount++;
                            const diffDays = Math.ceil((now - new Date(sDate)) / (1000 * 60 * 60 * 24));
                            if (diffDays > maxOverdueDays) maxOverdueDays = diffDays;
                        }
                    }
                });
            }
        }
    });

    let p1Score = 210;
    if (overduePayablesCount > 0) {
        if (maxOverdueDays > 30) p1Score = 40;
        else if (maxOverdueDays > 14) p1Score = 90;
        else p1Score = 140;
    }

    // --- 2. DEBT BURDEN & UTILIZATION RATIO (30% = Max 180 pts) ---
    let totalLiabilitiesAED = 0;
    let totalAssetsAED = 0;

    (state.data?.accounts || []).forEach(a => {
        const b = Number(a.balance) || 0;
        totalAssetsAED += (a.currency === 'AED' ? b : b / r);
    });

    payables.forEach(d => {
        if (!d.settled) {
            const amt = Number(d.amount || d.currentAmount || 0);
            totalLiabilitiesAED += (d.currency === 'AED' ? amt : amt / r);
        }
    });

    const netWorthAED = Math.max(0, totalAssetsAED - totalLiabilitiesAED);
    const debtRatio = (totalAssetsAED > 0) ? (totalLiabilitiesAED / totalAssetsAED) : (totalLiabilitiesAED > 0 ? 1 : 0);

    let p2Score = 180;
    if (debtRatio > 0.75) p2Score = 20;
    else if (debtRatio > 0.50) p2Score = 70;
    else if (debtRatio > 0.30) p2Score = 120;
    else if (debtRatio > 0.15) p2Score = 160;
    else p2Score = 180;

    // --- 3. EMERGENCY FUND & LIQUIDITY RUNWAY (15% = Max 90 pts) ---
    const liquidAccs = (state.data?.accounts || []).filter(a => ['Bank Account', 'Cash', 'Savings', 'Emergency Fund'].includes(a.type));
    const liquidCashAED = liquidAccs.reduce((s, a) => s + (a.currency === 'AED' ? (a.balance || 0) : (a.balance || 0) / r), 0);

    let monthlyExpenseBase = 3500;
    if (state.data?.envelopeLedger && state.data.envelopeLedger.length > 0) {
        const stats = (typeof actions.getEnvelopeStats === 'function') ? actions.getEnvelopeStats() : null;
        if (stats && stats.pillars && stats.pillars.expense && stats.pillars.expense.funded > 0) {
            monthlyExpenseBase = stats.pillars.expense.funded;
        }
    } else if (state.data?.budgetTemplate && Object.keys(state.data.budgetTemplate).length > 0) {
        monthlyExpenseBase = Object.values(state.data.budgetTemplate).reduce((s, v) => s + (parseFloat(v)||0), 0) || 3500;
    }

    const runwayMonths = monthlyExpenseBase > 0 ? (liquidCashAED / monthlyExpenseBase) : 1;
    let p3Score = 90;
    if (runwayMonths >= 6) p3Score = 90;
    else if (runwayMonths >= 3) p3Score = 75;
    else if (runwayMonths >= 1.5) p3Score = 55;
    else if (runwayMonths >= 0.5) p3Score = 30;
    else p3Score = 10;

    // --- 4. WEALTH ACCUMULATION & SAVINGS RATE (10% = Max 60 pts) ---
    let wealthRate = 0.25;
    if (typeof actions.getEnvelopeStats === 'function') {
        const eStats = actions.getEnvelopeStats();
        const sav = (eStats.pillars?.savings?.funded || 0) + (eStats.pillars?.investment?.funded || 0);
        const tot = eStats.totalFunded || state.data?.settings?.expectedSalary || (sav + (eStats.pillars?.expense?.funded || 0));
        if (tot > 0) wealthRate = sav / tot;
    }

    let p4Score = 60;
    if (wealthRate >= 0.40) p4Score = 60;
    else if (wealthRate >= 0.25) p4Score = 50;
    else if (wealthRate >= 0.10) p4Score = 35;
    else p4Score = 15;

    // --- 5. BUDGET ENVELOPE DISCIPLINE (10% = Max 60 pts) ---
    let overspentCount = 0;
    if (typeof actions.getEnvelopeStats === 'function') {
        const eStats = actions.getEnvelopeStats();
        Object.values(eStats.categories || {}).forEach(c => {
            if (c.available < -0.5) overspentCount++;
        });
    }

    let p5Score = 60;
    if (overspentCount === 0) p5Score = 60;
    else if (overspentCount === 1) p5Score = 40;
    else if (overspentCount === 2) p5Score = 25;
    else p5Score = 10;

    // Total Score (300 to 900)
    const rawScore = 300 + p1Score + p2Score + p3Score + p4Score + p5Score;
    const finalScore = Math.max(300, Math.min(900, Math.round(rawScore)));

    let tier = 'Excellent';
    let color = 'emerald';
    let grade = 'A+';
    let statusSummary = 'Prime Tier • Top 5% Financial Health';
    
    if (finalScore >= 800) {
        tier = 'Excellent';
        color = 'emerald';
        grade = 'A+';
        statusSummary = 'Prime Tier • Elite Financial Health';
    } else if (finalScore >= 740) {
        tier = 'Very Good';
        color = 'teal';
        grade = 'A';
        statusSummary = 'Low Risk • Robust Wealth Profile';
    } else if (finalScore >= 670) {
        tier = 'Good';
        color = 'indigo';
        grade = 'B+';
        statusSummary = 'Moderate Risk • Stable Standing';
    } else if (finalScore >= 580) {
        tier = 'Fair';
        color = 'amber';
        grade = 'C';
        statusSummary = 'High Debt Leverage • Needs Improvement';
    } else {
        tier = 'Needs Attention';
        color = 'rose';
        grade = 'D';
        statusSummary = 'Overdue Liabilities or High Debt Burden';
    }

    const recommendations = [];
    if (overduePayablesCount > 0) {
        recommendations.push({
            title: `Settle ${overduePayablesCount} Overdue Liability`,
            impact: '+60 to +120 Pts',
            desc: 'Clearing overdue payables immediately restores full payment history points.',
            actionText: 'Manage Liabilities',
            actionFn: function(event) { actions.openModal('debt') }
        });
    }
    if (runwayMonths < 3) {
        recommendations.push({
            title: 'Boost Emergency Reserve to 3 Months',
            impact: '+25 to +40 Pts',
            desc: `Current liquid reserves cover ~${runwayMonths.toFixed(1)} mo. Top up Ruya Save / Emergency Fund to reach 3+ months.`,
            actionText: 'View Emergency Fund',
            actionFn: function(event) { actions.openEmergencyFundDashboard() }
        });
    }
    if (debtRatio > 0.25) {
        recommendations.push({
            title: 'Reduce Debt-to-Asset Leverage (< 20%)',
            impact: '+20 to +50 Pts',
            desc: `Liabilities make up ${(debtRatio * 100).toFixed(0)}% of assets. Pay down BNPL or loans to lower leverage.`,
            actionText: 'Review Liabilities',
            actionFn: function(event) { actions.openModal('debt') }
        });
    }
    if (overspentCount > 0) {
        recommendations.push({
            title: `Rebalance ${overspentCount} Overspent Envelope`,
            impact: '+20 to +35 Pts',
            desc: 'Use budget sweep or cover overspending to restore positive envelope balances.',
            actionText: 'Open Budget Hub',
            actionFn: function(event) { actions.openModal('budget') }
        });
    }
    if (recommendations.length === 0) {
        recommendations.push({
            title: 'Maintain Current Wealth Discipline',
            impact: 'Max Tier Retained',
            desc: 'Your financial pillars are optimal. Keep automating monthly savings and investment transfers.',
            actionText: 'View Lifetime Roadmap',
            actionFn: function(event) { actions.openMilestoneModal() }
        });
    }

    return {
        score: finalScore,
        tier,
        color,
        grade,
        statusSummary,
        pillars: {
            paymentHistory: { score: p1Score, max: 210, label: 'Payment & BNPL History', pct: Math.round((p1Score / 210) * 100), overdues: overduePayablesCount },
            debtRatio: { score: p2Score, max: 180, label: 'Debt-to-Asset Ratio', pct: Math.round((p2Score / 180) * 100), ratio: (debtRatio * 100).toFixed(1) },
            runway: { score: p3Score, max: 90, label: 'Emergency Runway', pct: Math.round((p3Score / 90) * 100), months: runwayMonths.toFixed(1) },
            wealthRate: { score: p4Score, max: 60, label: 'Wealth Accumulation Rate', pct: Math.round((p4Score / 60) * 100), rate: (wealthRate * 100).toFixed(0) },
            discipline: { score: p5Score, max: 60, label: 'Budget Envelope Discipline', pct: Math.round((p5Score / 60) * 100), overspent: overspentCount }
        },
        recommendations,
        totalAssetsAED,
        totalLiabilitiesAED,
        netWorthAED
    };
};

actions.renderCreditScoreModal = function() {
    const cs = actions.getPersonalCreditScore();
    const c = document.getElementById('modal-content');
    if (!c) return;

    // Meter circumference math for SVG arc
    const scorePct = Math.min(100, Math.max(0, ((cs.score - 300) / 600) * 100));
    const strokeDashoffset = 283 - (283 * scorePct) / 100;

    let themeGradient = 'from-emerald-500/20 via-slate-800 to-slate-900 border-emerald-500/30';
    let scoreTextColor = 'text-emerald-400';
    if (cs.color === 'teal') {
        themeGradient = 'from-teal-500/20 via-slate-800 to-slate-900 border-teal-500/30';
        scoreTextColor = 'text-teal-400';
    } else if (cs.color === 'indigo') {
        themeGradient = 'from-indigo-500/20 via-slate-800 to-slate-900 border-indigo-500/30';
        scoreTextColor = 'text-indigo-400';
    } else if (cs.color === 'amber') {
        themeGradient = 'from-amber-500/20 via-slate-800 to-slate-900 border-amber-500/30';
        scoreTextColor = 'text-amber-400';
    } else if (cs.color === 'rose') {
        themeGradient = 'from-rose-500/20 via-slate-800 to-slate-900 border-rose-500/30';
        scoreTextColor = 'text-rose-400';
    }

    let html = FinzUI.html`
        <div class="max-w-4xl mx-auto space-y-6 text-left fade-in pb-16">
            
            <!-- HERO RADIAL GAUGE CARD -->
            <div class="bg-gradient-to-br ${themeGradient} border-2 rounded-[2.5rem] p-8 text-center shadow-2xl backdrop-blur-md relative overflow-hidden">
                <div class="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
                    <i data-lucide="shield-check" class="w-48 h-48 text-indigo-400"></i>
                </div>

                <div class="inline-flex items-center gap-2 bg-slate-900/80 px-4 py-1.5 rounded-full border border-slate-700/80 mb-4">
                    <i data-lucide="award" class="w-4 h-4 ${scoreTextColor}"></i>
                    <span class="text-[10px] font-black uppercase tracking-widest text-slate-300">Financial Health Index • Grade ${cs.grade}</span>
                </div>

                <div class="relative w-48 h-48 mx-auto my-2 flex items-center justify-center">
                    <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="transparent" stroke="#1e293b" stroke-width="8" stroke-dasharray="283" stroke-dashoffset="0"></circle>
                        <circle cx="50" cy="50" r="45" fill="transparent" stroke="currentColor" stroke-width="8" stroke-dasharray="283" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round" class="${scoreTextColor} transition-all duration-1000"></circle>
                    </svg>
                    <div class="absolute flex flex-col items-center justify-center text-center">
                        <span class="text-5xl font-black text-white num-font leading-none">${cs.score}</span>
                        <span class="text-[10px] font-black uppercase tracking-widest ${scoreTextColor} mt-1">${cs.tier}</span>
                        <span class="text-[9px] font-bold text-slate-400">300 - 900</span>
                    </div>
                </div>

                <p class="text-sm font-bold text-slate-300 max-w-md mx-auto mt-2">
                    ${cs.statusSummary}
                </p>

                <!-- Score Spectrum Indicator -->
                <div class="max-w-md mx-auto mt-6 pt-4 border-t border-slate-700/60">
                    <div class="flex justify-between text-[8px] font-black uppercase text-slate-400 mb-1.5">
                        <span>300 Poor</span>
                        <span>580 Fair</span>
                        <span>670 Good</span>
                        <span>740 Prime</span>
                        <span>900 Elite</span>
                    </div>
                    <div class="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700/60 flex">
                        <div class="bg-rose-500 h-full w-[20%]"></div>
                        <div class="bg-amber-500 h-full w-[20%]"></div>
                        <div class="bg-indigo-500 h-full w-[20%]"></div>
                        <div class="bg-teal-500 h-full w-[20%]"></div>
                        <div class="bg-emerald-500 h-full w-[20%]"></div>
                    </div>
                </div>
            </div>

            <!-- 5-PILLAR DIAGNOSTIC BREAKDOWN -->
            <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg space-y-4">
                <div class="flex justify-between items-center border-b border-slate-700/60 pb-3">
                    <h3 class="text-xs font-black uppercase tracking-widest text-slate-300 flex items-center gap-2">
                        <i data-lucide="activity" class="w-4 h-4 text-indigo-400"></i> 5-Pillar Health Diagnostic
                    </h3>
                    <span class="text-[9px] font-bold text-slate-400">Calculated in Real-Time</span>
                </div>

                <div class="space-y-4">
                    <!-- Pillar 1: Payment History -->
                    <div class="p-3.5 bg-slate-900/60 rounded-2xl border border-slate-700/50">
                        <div class="flex justify-between items-center text-xs font-bold mb-1.5">
                            <span class="text-slate-200 flex items-center gap-2">
                                <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-400"></i> ${cs.pillars.paymentHistory.label} (35%)
                            </span>
                            <span class="text-white num-font font-black">${cs.pillars.paymentHistory.score} / ${cs.pillars.paymentHistory.max} pts</span>
                        </div>
                        <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden mb-1">
                            <div class="bg-emerald-500 h-full rounded-full" style="width: ${cs.pillars.paymentHistory.pct}%"></div>
                        </div>
                        <div class="flex justify-between text-[9px] font-bold text-slate-400">
                            <span>${cs.pillars.paymentHistory.overdues === 0 ? '🟢 Zero Overdue Debts/BNPL' : `🔴 ${cs.pillars.paymentHistory.overdues} Overdue Items`}</span>
                            <span>${cs.pillars.paymentHistory.pct}% Perfect</span>
                        </div>
                    </div>

                    <!-- Pillar 2: Debt-to-Asset Ratio -->
                    <div class="p-3.5 bg-slate-900/60 rounded-2xl border border-slate-700/50">
                        <div class="flex justify-between items-center text-xs font-bold mb-1.5">
                            <span class="text-slate-200 flex items-center gap-2">
                                <i data-lucide="scale" class="w-3.5 h-3.5 text-indigo-400"></i> ${cs.pillars.debtRatio.label} (30%)
                            </span>
                            <span class="text-white num-font font-black">${cs.pillars.debtRatio.score} / ${cs.pillars.debtRatio.max} pts</span>
                        </div>
                        <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden mb-1">
                            <div class="bg-indigo-500 h-full rounded-full" style="width: ${cs.pillars.debtRatio.pct}%"></div>
                        </div>
                        <div class="flex justify-between text-[9px] font-bold text-slate-400">
                            <span>Debt Burden: ${cs.pillars.debtRatio.ratio}% of Total Assets</span>
                            <span>${cs.pillars.debtRatio.pct}% Optimal</span>
                        </div>
                    </div>

                    <!-- Pillar 3: Emergency Runway -->
                    <div class="p-3.5 bg-slate-900/60 rounded-2xl border border-slate-700/50">
                        <div class="flex justify-between items-center text-xs font-bold mb-1.5">
                            <span class="text-slate-200 flex items-center gap-2">
                                <i data-lucide="shield" class="w-3.5 h-3.5 text-teal-400"></i> ${cs.pillars.runway.label} (15%)
                            </span>
                            <span class="text-white num-font font-black">${cs.pillars.runway.score} / ${cs.pillars.runway.max} pts</span>
                        </div>
                        <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden mb-1">
                            <div class="bg-teal-500 h-full rounded-full" style="width: ${cs.pillars.runway.pct}%"></div>
                        </div>
                        <div class="flex justify-between text-[9px] font-bold text-slate-400">
                            <span>Liquidity Reserve: ~${cs.pillars.runway.months} Months Runway</span>
                            <span>${cs.pillars.runway.pct}% Optimal</span>
                        </div>
                    </div>

                    <!-- Pillar 4: Wealth Accumulation Rate -->
                    <div class="p-3.5 bg-slate-900/60 rounded-2xl border border-slate-700/50">
                        <div class="flex justify-between items-center text-xs font-bold mb-1.5">
                            <span class="text-slate-200 flex items-center gap-2">
                                <i data-lucide="trending-up" class="w-3.5 h-3.5 text-amber-400"></i> ${cs.pillars.wealthRate.label} (10%)
                            </span>
                            <span class="text-white num-font font-black">${cs.pillars.wealthRate.score} / ${cs.pillars.wealthRate.max} pts</span>
                        </div>
                        <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden mb-1">
                            <div class="bg-amber-500 h-full rounded-full" style="width: ${cs.pillars.wealthRate.pct}%"></div>
                        </div>
                        <div class="flex justify-between text-[9px] font-bold text-slate-400">
                            <span>Savings & Investment Rate: ${cs.pillars.wealthRate.rate}%</span>
                            <span>${cs.pillars.wealthRate.pct}% Optimal</span>
                        </div>
                    </div>

                    <!-- Pillar 5: Budget Envelope Discipline -->
                    <div class="p-3.5 bg-slate-900/60 rounded-2xl border border-slate-700/50">
                        <div class="flex justify-between items-center text-xs font-bold mb-1.5">
                            <span class="text-slate-200 flex items-center gap-2">
                                <i data-lucide="layers" class="w-3.5 h-3.5 text-rose-400"></i> ${cs.pillars.discipline.label} (10%)
                            </span>
                            <span class="text-white num-font font-black">${cs.pillars.discipline.score} / ${cs.pillars.discipline.max} pts</span>
                        </div>
                        <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden mb-1">
                            <div class="bg-rose-500 h-full rounded-full" style="width: ${cs.pillars.discipline.pct}%"></div>
                        </div>
                        <div class="flex justify-between text-[9px] font-bold text-slate-400">
                            <span>${cs.pillars.discipline.overspent === 0 ? '🟢 All Envelopes Healthy' : `⚠️ ${cs.pillars.discipline.overspent} Overspent Categories`}</span>
                            <span>${cs.pillars.discipline.pct}% Optimal</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ACTIONABLE SCORE BOOSTERS (AI DOCTOR) -->
            <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg space-y-4">
                <h3 class="text-xs font-black uppercase tracking-widest text-slate-300 flex items-center gap-2 border-b border-slate-700/60 pb-3">
                    <i data-lucide="zap" class="w-4 h-4 text-amber-400"></i> Actionable Score Boosters
                </h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${cs.recommendations.map(r => FinzUI.html`
                        <div class="p-4 bg-slate-900/60 rounded-2xl border border-slate-700/60 flex flex-col justify-between space-y-3">
                            <div>
                                <div class="flex justify-between items-start mb-1">
                                    <h4 class="text-xs font-black text-white">${r.title}</h4>
                                    <span class="text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">${r.impact}</span>
                                </div>
                                <p class="text-[10px] font-bold text-slate-400">${r.desc}</p>
                            </div>
                            <button data-finz-click="${FinzUI.handler(function(event) { return (r.actionFn).call(this, event); })}" class="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-bold uppercase text-[9px] tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm">
                                ${r.actionText} <i data-lucide="chevron-right" class="w-3 h-3"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- PEER TRUST RATING BANNER -->
            <div class="p-6 bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-900 rounded-[2rem] border border-indigo-500/30 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                        <i data-lucide="users" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <h4 class="text-xs font-black text-white">Peer Contact Trust Ratings</h4>
                        <p class="text-[10px] font-bold text-slate-400">FINZ automatically scores people you lend money to (0-100) based on their on-time repayment history.</p>
                    </div>
                </div>
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('debt') })}" class="px-5 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-wider shrink-0 transition-all shadow-lg shadow-indigo-500/20">
                    Open Liability Hub
                </button>
            </div>
        </div>
    `;

    FinzUI.setHTML(c, html);
    if (libraries.lucide) libraries.lucide.createIcons();
};
}
