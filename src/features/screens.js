// Screens behavior and screens. Dependencies stay inside the application context.
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

actions.reportAppError = function reportAppError(message) {
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;background:#991b1b;color:white;padding:16px;z-index:999999;white-space:pre-wrap';
            box.textContent = String(message);
            (document.body || document.documentElement).appendChild(box);
        };

actions.convert = function (amt, currency) {
            let r = 22.75; // Fallback
            if (typeof state !== 'undefined' && state.data && state.data.settings) {
                r = state.data.settings.rate;
            }
            if (currency === 'AED') return parseFloat(amt);
            if (currency === 'INR') return parseFloat(amt) / r;
            return parseFloat(amt);
        };

actions.chartCurrency = actions.chartCurrency || 'INR';

actions.closeModal = () => {
            const c = document.getElementById('modal-content');
            c.classList.remove('max-w-[95vw]');
            c.classList.add('max-w-4xl');
            document.getElementById('modal-backdrop').classList.replace('flex', 'hidden');
        };

actions.toCurrency = (num) => parseFloat(Number(num).toFixed(2));

actions.setBtnLoading = (btnId, isLoading) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            if (isLoading) {
                btn.disabled = true;
                btn.dataset.originalText = btn.innerText;
                btn.innerText = "Processing...";
                btn.classList.add('opacity-70', 'cursor-not-allowed');
            } else {
                btn.disabled = false;
                if (btn.dataset.originalText) btn.innerText = btn.dataset.originalText;
                btn.classList.remove('opacity-70', 'cursor-not-allowed');
            }
        };

actions.handleSignOut = async function () {
            try {
                await signOut(auth);
                location.reload();
            } catch (err) {
                console.error("Sign out error", err);
            }
        };

actions.handleChangePassword = async function () {
            const oldP = document.getElementById('cp-old').value;
            const newP = document.getElementById('cp-new').value;
            const cnfP = document.getElementById('cp-cnf').value;

            if (!oldP || !newP || !cnfP) {
                actions.showToast("Please fill all fields.", "error"); return;
            }
            if (newP !== cnfP) {
                actions.showToast("New passwords do not match.", "error"); return;
            }
            if (newP.length < 6) {
                actions.showToast("Password must be at least 6 chars.", "error"); return;
            }

            // Lock UI
            const btn = document.getElementById('btn-change-password');
            const originalText = btn.innerText;
            btn.innerText = "Verifying...";
            btn.disabled = true;
            btn.classList.add('opacity-50');

            try {
                const cred = EmailAuthProvider.credential(state.user.email, oldP);
                await reauthenticateWithCredential(state.user, cred);

                btn.innerText = "Updating...";
                await updatePassword(state.user, newP);

                actions.closeModal();
                actions.showToast("Password Change Successful!", "success");
                actions.openModal('auth'); // Return to profile
            } catch (error) {
                console.error("Password Change Error:", error);
                let msg = "Failed to update password.";
                if (error.code === 'auth/wrong-password') msg = "Current password is incorrect.";
                if (error.code === 'auth/weak-password') msg = "Password is too weak.";
                if (error.code === 'auth/requires-recent-login') msg = "Key expired. Please relogin.";
                actions.showToast(msg, "error");

                // Reset Button
                btn.innerText = originalText;
                btn.disabled = false;
                btn.classList.remove('opacity-50');
            }
        };

actions.applyTheme = function (theme) {
            // const root = document.documentElement;
            // Define Theme Palettes
            const themes = {
                emerald: {
                    '--primary': '#10b981', '--primary-dark': '#059669', '--primary-light': '#ecfdf5', '--primary-rgb': '16, 185, 129',
                    '--bg-main': '#f8fafc', '--bg-card': '#ffffff', '--bg-sub': '#f1f5f9', '--bg-input': '#f8fafc',
                    '--text-main': '#0f172a', '--text-muted': '#64748b', '--btn-solid': '#0f172a', '--btn-text': '#ffffff', '--border-color': '#e2e8f0'
                },
                blue: {
                    '--primary': '#3b82f6', '--primary-dark': '#1d4ed8', '--primary-light': '#eff6ff', '--primary-rgb': '59, 130, 246',
                    '--bg-main': '#f0f9ff', '--bg-card': '#ffffff', '--bg-sub': '#e0f2fe', '--bg-input': '#f0f9ff',
                    '--text-main': '#0f172a', '--text-muted': '#64748b', '--btn-solid': '#1e40af', '--btn-text': '#ffffff', '--border-color': '#bfdbfe'
                },
                violet: {
                    '--primary': '#8b5cf6', '--primary-dark': '#6d28d9', '--primary-light': '#f5f3ff', '--primary-rgb': '139, 92, 246',
                    '--bg-main': '#faf5ff', '--bg-card': '#ffffff', '--bg-sub': '#f3e8ff', '--bg-input': '#faf5ff',
                    '--text-main': '#2e1065', '--text-muted': '#a78bfa', '--btn-solid': '#5b21b6', '--btn-text': '#ffffff', '--border-color': '#e9d5ff'
                },
                rose: {
                    '--primary': '#e11d48', '--primary-dark': '#be123c', '--primary-light': '#fff1f2', '--primary-rgb': '225, 29, 72',
                    '--bg-main': '#fff1f2', '--bg-card': '#ffffff', '--bg-sub': '#ffe4e6', '--bg-input': '#fff1f2',
                    '--text-main': '#881337', '--text-muted': '#be123c', '--btn-solid': '#e11d48', '--btn-text': '#ffffff', '--border-color': '#fecdd3'
                }
            };
            const t = themes[theme] || themes.emerald;
            // disabled

            // PERSISTENCE: Save to LocalStorage for Login Screen access
            try { localStorage.setItem('fs_theme', theme); } catch(e) { console.warn('LocalStorage unavailable', e); }
        };

actions.showConfirm = function (title, msg, onYes, yesLabel = 'Yes, Delete', onCancel = null) {
            const m = document.getElementById('confirm-modal');
            if (m.dataset.busy === 'true') return;
            document.getElementById('confirm-title').innerText = title;
            FinzUI.setHTML(document.getElementById('confirm-msg'), msg);

            const yesBtn = document.getElementById('confirm-yes-btn');
            const cancelBtn = document.getElementById('confirm-cancel-btn');

            // 1. Setup YES Button
            const newYes = yesBtn.cloneNode(true);
            newYes.innerText = yesLabel;
            newYes.disabled = false;
            newYes.removeAttribute('aria-busy');
            if (yesLabel !== 'Yes, Delete') {
                newYes.className = "p-3 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/30";
            } else {
                newYes.className = "p-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/30";
            }
            yesBtn.parentNode.replaceChild(newYes, yesBtn);
            newYes.onclick = async () => {
                if (newYes.disabled) return;
                m.dataset.busy = 'true';
                newYes.disabled = true;
                newCancel.disabled = true;
                newYes.setAttribute('aria-busy', 'true');
                newYes.innerText = /delete/i.test(yesLabel) ? 'Deleting…' : 'Processing…';
                newYes.classList.add('opacity-60', 'cursor-wait');
                try { await onYes(); m.classList.replace('flex', 'hidden'); }
                catch (error) { actions.showToast(error.message, 'error'); }
                finally {
                    delete m.dataset.busy;
                    newYes.disabled = false;
                    newCancel.disabled = false;
                    newYes.removeAttribute('aria-busy');
                    newYes.innerText = yesLabel;
                    newYes.classList.remove('opacity-60', 'cursor-wait');
                }
            };

            // 2. Setup CANCEL Button (New Logic to fix infinite loop)
            const newCancel = cancelBtn.cloneNode(true);
            newCancel.disabled = false;
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn); // Clear old listeners

            newCancel.onclick = () => {
                if (m.dataset.busy === 'true') return;
                m.classList.replace('flex', 'hidden');
                if (onCancel) onCancel(); // Run callback if provided (e.g. reset loading state)
            };

            m.classList.replace('hidden', 'flex');
        };

actions.showPrompt = function (title, msg, onConfirm, type = 'text', allowEmpty = false) {
            const m = document.getElementById('prompt-modal');
            if (m.dataset.busy === 'true') return;
            document.getElementById('prompt-title').innerText = title;
            document.getElementById('prompt-msg').innerText = msg;

            const inp = document.getElementById('prompt-input');
            inp.value = '';
            inp.type = type;

            const yesBtn = document.getElementById('prompt-yes-btn');
            const newBtn = yesBtn.cloneNode(true);
            yesBtn.parentNode.replaceChild(newBtn, yesBtn);

            newBtn.disabled = false;
            newBtn.onclick = async () => {
                if (newBtn.disabled) return;
                const value = inp.value.trim();
                if (!value && !allowEmpty) { inp.focus(); return; }
                const label = newBtn.innerText;
                const cancel = m.querySelector('#prompt-cancel-btn');
                m.dataset.busy = 'true'; newBtn.disabled = true; inp.disabled = true;
                if (cancel) cancel.disabled = true;
                newBtn.innerText = 'Saving…'; newBtn.setAttribute('aria-busy', 'true');
                try {
                    const result = await onConfirm(value);
                    if (result !== false) m.classList.replace('flex', 'hidden');
                } catch (error) { actions.showToast(error.message || 'Unable to save. Please retry.', 'error'); }
                finally {
                    delete m.dataset.busy; newBtn.disabled = false; inp.disabled = false;
                    if (cancel) cancel.disabled = false;
                    newBtn.innerText = label; newBtn.removeAttribute('aria-busy');
                }
            };
            m.classList.replace('hidden', 'flex');
            inp.focus();
        };

actions.showToast = function (msg, type = 'info') {
            const c = document.getElementById('toast-container');
            const el = document.createElement('div');

            let icon = 'info', color = 'bg-slate-800', text = 'text-white';
            if (type === 'success') { icon = 'check-circle'; color = 'bg-emerald-500'; }
            if (type === 'error') { icon = 'alert-circle'; color = 'bg-red-500'; }
            if (type === 'warn') { icon = 'alert-triangle'; color = 'bg-amber-500'; }

            el.className = `flex items-center gap-3 p-4 rounded-xl shadow-xl transform transition-all duration-300 translate-y-10 opacity-0 ${color} ${text} min-w-[200px]`;
            FinzUI.setHTML(el, FinzUI.html`<i data-lucide="${icon}" class="w-5 h-5"></i><span class="font-bold text-xs">${msg}</span>`);

            c.appendChild(el);
            lucide.createIcons();

            // Animate In
            requestAnimationFrame(() => el.classList.remove('translate-y-10', 'opacity-0'));

            // Remove after 3s
            setTimeout(() => {
                el.classList.add('translate-y-10', 'opacity-0');
                setTimeout(() => el.remove(), 300);
            }, 3000);
        };

actions.fetchExchangeRate = async function fetchExchangeRate() {
            try {
                const res = await fetch('https://api.exchangerate-api.com/v4/latest/AED');
                const d = await res.json();
                if (d.rates && d.rates.INR) {
                    state.data.settings.rate = d.rates.INR;
                    document.getElementById('exchange-rate-badge')?.classList.add('rate-live');
                }
            } catch (e) { console.warn("Live rate unavailable."); }
            // Always refresh asset values on generic refresh
            actions.recalcDynamicAssets();
            actions.renderApp();
        };

actions.renderApp = function renderApp() {
            const dashboard = document.getElementById('app-content'); if (!dashboard || dashboard.style.display === 'none') return;

            // Helper for Number Formatting (Tabular)
            actions.fmtMoney = (val, currency) => {
                const parts = val.toFixed(2).split('.');
                const intPart = new Intl.NumberFormat('en-US').format(parseInt(parts[0]));
                return FinzUI.html`<span class="money-font tracking-tight">${currency === 'AED' ? 'AED' : '₹'} ${intPart}</span><span class="text-[0.6em] opacity-50 font-bold ml-0.5">.${parts[1]}</span>`;
            };

            actions.renderAssetCard = (a, isChild = false) => {
                let subtext = a.type;
                let icon = 'layers'; // Default
                let iconColor = 'bg-slate-900 border border-slate-700/30 text-rose-400'; // Sleek dark default

                if (a.type === 'Commodity' || (a.subtype && ['Gold', 'Silver', 'Platinum', 'Palladium', 'Oil', 'Diamond'].includes(a.subtype))) {
                    icon = 'coins';
                    iconColor = 'bg-amber-500/15 border border-amber-500/30 text-amber-400';
                    const metalName = a.subtype || 'Commodity';
                    subtext = `${metalName}${a.weight ? ' • ' + a.weight + 'g' : ' • Asset'}`;
                }
                else if (a.type === 'Mutual Fund') {
                    const meta = state.data.portfolio?.[a.schemeCode];
                    subtext = meta ? `NAV: ₹${meta.nav} (${meta.date})` : (a.category ? `Mutual Fund • ${a.category}` : 'Mutual Fund');
                    icon = 'pie-chart';
                    iconColor = 'bg-blue-500/15 border border-blue-500/30 text-blue-400';
                }
                else if (a.type === 'Bank Account') {
                    icon = 'landmark';
                    iconColor = 'bg-emerald-900/30 border border-emerald-700/30 text-emerald-400';
                }
                else if (a.type === 'Cash') {
                    icon = 'wallet';
                    iconColor = 'bg-emerald-900/30 border border-emerald-700/30 text-emerald-400';
                }
                else if (a.type === 'Savings') {
                    icon = 'piggy-bank';
                    iconColor = 'bg-teal-500/15 border border-teal-500/30 text-teal-400';
                }
                else if (a.type === 'Investment') {
                    icon = 'trending-up';
                    iconColor = 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-400';
                    subtext = a.subtype || a.category || 'Investment';
                }
                else if (a.type === 'Real Estate') {
                    icon = 'building';
                    iconColor = 'bg-indigo-900/30 border border-indigo-700/30 text-indigo-400';
                    subtext = a.details?.location || a.category || 'Property';
                }
                else if (a.type === 'Vehicle') {
                    icon = 'car';
                    iconColor = 'bg-rose-900/30 border border-rose-700/30 text-rose-400';
                    subtext = `${a.details?.make || ''} ${a.details?.model || ''}`.trim() || 'Vehicle';
                }
                else if (a.type === 'Crypto') {
                    icon = 'zap';
                    iconColor = 'bg-purple-900/30 border border-purple-700/30 text-purple-400';
                    subtext = `${a.details?.sym || 'CRYPTO'} (${a.details?.net || 'Chain'})`;
                }
                else if (a.type === 'Collectible') {
                    icon = 'watch';
                    iconColor = 'bg-pink-900/30 border border-pink-700/30 text-pink-400';
                    subtext = a.details?.brand || 'Collectible';
                }
                else if (a.type === 'Bond') {
                    icon = 'file-text';
                    iconColor = 'bg-cyan-900/30 border border-cyan-700/30 text-cyan-400';
                }
                if (a.type === 'Emergency Fund') {
                    icon = 'shield';
                    iconColor = 'bg-emerald-900/30 border border-emerald-500/40 text-emerald-400';
                    // EMF click goes to the special EMF dashboard, not ledger
                    const emfTarget = a.target || state.data.settings?.emfTarget || 0;
                    const emfProgress = emfTarget > 0 ? Math.min(100, (a.balance / emfTarget) * 100) : 0;
                    const emfCurrency = a.currency || 'AED';
                    return FinzUI.html`<div class="bg-gradient-to-br from-emerald-500/10 via-slate-800 to-slate-900 p-5 rounded-[2rem] border-2 border-emerald-500/30 shadow-xl cursor-pointer hover:border-emerald-400/60 transition-all fade-in" data-finz-click="${FinzUI.handler(function(event) { return actions.openEmergencyFundDashboard(((a.id))) })}">
                        <div class="flex justify-between items-start mb-4">
                            <div class="flex items-center gap-3">
                                <div class="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shadow-inner">
                                    <i data-lucide="shield" class="w-6 h-6"></i>
                                </div>
                                <div class="text-left">
                                    <p class="font-black text-emerald-300 text-sm tracking-wide">${a.name}</p>
                                    <p class="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Emergency Fund</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="font-black text-white text-lg num-font">${state.data.settings.isPrivate ? '••••' : actions.fmtMoney(a.balance, emfCurrency)}</p>
                                ${emfTarget > 0 ? FinzUI.html`<p class="text-[9px] font-bold text-emerald-400">${emfProgress.toFixed(0)}% of target</p>` : FinzUI.html`<p class="text-[9px] font-bold text-slate-400">Tap to set target</p>`}
                            </div>
                        </div>
                        ${emfTarget > 0 ? FinzUI.html`
                        <div class="w-full bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700/50">
                            <div class="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700 rounded-full" style="width: ${emfProgress}%"></div>
                        </div>
                        <div class="flex justify-between text-[9px] font-bold text-slate-400 mt-2">
                            <span>Saved: ${actions.fmtMoney(a.balance, emfCurrency)}</span>
                            <span>Target: ${actions.fmtMoney(emfTarget, emfCurrency)}</span>
                        </div>` : ''}
                    </div>`;
                }

                return FinzUI.html`<div class="bg-slate-800/50 backdrop-blur-md p-4 rounded-[1.5rem] flex justify-between items-center border border-slate-700/50 shadow-sm cursor-pointer hover:bg-slate-800 transition-all text-center group ${isChild ? 'border-0 border-b last:border-0 border-slate-700/50 rounded-none' : ''}" data-finz-click="${FinzUI.handler(function(event) { return actions.viewAccountLedger(((a.id))) })}">
                    <div class="flex items-center space-x-4 text-left">
                        <div class="w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner ${iconColor}">
                            <i data-lucide="${icon}" class="w-6 h-6"></i>
                        </div>
                        <div>
                            <p class="font-bold text-slate-100 text-sm text-left flex items-center tracking-wide">${a.name}</p>
                            <p class="text-[9px] text-slate-400 uppercase font-black text-left tracking-widest">${subtext}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="font-black text-slate-100 text-base num-font">${state.data.settings.isPrivate ? '****' : actions.fmtMoney(a.balance, a.currency)}</p>
                    </div>
                </div>`;
            };

            // FINANCIAL GRADE: Ledger-Based Truth
            // Derived Balances are calculated live from Transaction History before rendering
            actions.recalculateBalances();

            const { accounts, transactions, debts, settings } = state.data;
            const r = settings.rate, priv = settings.isPrivate;
            const ut = (id, val) => { const el = document.getElementById(id); if (el) FinzUI.setHTML(el, val); };

            if (document.getElementById('rate-display')) ut('rate-display', r.toFixed(2));

            let uae = 0, ind = 0, inv = 0;
            accounts.forEach(a => { if (a.currency === 'AED') uae += a.balance; else ind += a.balance; if (!['Bank Account', 'Cash', 'Savings'].includes(a.type)) inv += (a.currency === 'AED' ? a.balance * r : a.balance); });
            const pay = debts.filter(d => !d.settled && d.type === 'payable').reduce((s, d) => s + (Number(d.amount) * (d.currency === 'AED' ? r : 1)), 0), rec = debts.filter(d => !d.settled && d.type === 'receivable').reduce((s, d) => s + (Number(d.amount) * (d.currency === 'AED' ? r : 1)), 0);

            const net = (uae * r) + ind + rec - pay;
            const rawNetAED = net / r;            
            const privText = FinzUI.html`<span class="tracking-widest opacity-50">••••••••</span>`;

            ut('total-primary', priv ? privText : actions.fmtMoney(rawNetAED, 'AED'));
            ut('total-secondary', priv ? privText : `≈ ` + actions.fmtMoney(net, 'INR'));

            // GUILT-FREE SPEND LOGIC
            const liquidAssetsAED = accounts
                .filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type))
                .reduce((s, a) => s + (a.currency === 'AED' ? a.balance : a.balance / r), 0);
                
            let totalBudgetsAED = 0;
            if (state.data.envelopeLedger && state.data.envelopeLedger.length > 0) {
                const stats = (typeof actions.getEnvelopeStats === 'function') ? actions.getEnvelopeStats() : null;
                if (stats) totalBudgetsAED = Math.max(0, stats.totalFunded - stats.totalDefunded);
            }
            if (totalBudgetsAED === 0) {
                if (state.data.budgetTemplate && Object.keys(state.data.budgetTemplate).length > 0) {
                    totalBudgetsAED = Object.values(state.data.budgetTemplate).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                } else if (state.data.budgets && Object.keys(state.data.budgets).length > 0) {
                    totalBudgetsAED = Object.values(state.data.budgets).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                }
            }
            
            // Guilt-Free = Liquid Cash - Monthly Envelope Budgets
            const guiltFree = liquidAssetsAED - totalBudgetsAED;
            const gfValue = Math.max(0, guiltFree);
            ut('guilt-free-val', priv ? privText : actions.fmtMoney(gfValue, 'AED'));
            ut('no-spend-val', actions.getNoSpendStreak() + ' Days');

            // Update Credit Score Radar
            try {
                if (typeof actions.getPersonalCreditScore === 'function') {
                    const cs = actions.getPersonalCreditScore();
                    ut('credit-score-val', `${cs.score} • ${cs.tier}`);
                    ut('credit-score-sub', cs.statusSummary);
                }
            } catch (e) {
                console.error("Credit score update err", e);
            }

            // Update Milestone Radar
            try {
                if (typeof actions.getNetWorthMilestoneStats === 'function') {
                    const mStats = actions.getNetWorthMilestoneStats();
                    ut('milestone-target-val', mStats.currentMilestone.label);
                    ut('milestone-pct-val', `${mStats.totalProgress.toFixed(1)}% • ~₹ ${(Math.round(mStats.shortfallInr)/1000).toFixed(1)}k to go`);
                }
            } catch (e) {
                console.error("Milestone update err", e);
            }

            // Snapshot Net Worth
            if (!state.data.historicalSnapshots) {
                state.data.historicalSnapshots = [];
                // Generate some mock history for demonstration (past 3 months growing slowly)
                for (let i = 3; i > 0; i--) {
                    const d = new Date();
                    d.setMonth(d.getMonth() - i);
                    state.data.historicalSnapshots.push({
                        month: d.toISOString().slice(0, 7),
                        netWorthAED: rawNetAED * (1 - (0.05 * i)) // 5% growth per month mock
                    });
                }
            }
            const currentMonthStr = new Date().toISOString().slice(0, 7); // YYYY-MM
            const lastSnap = state.data.historicalSnapshots[state.data.historicalSnapshots.length - 1];
            if (!lastSnap || lastSnap.month !== currentMonthStr) {
                state.data.historicalSnapshots.push({
                    month: currentMonthStr,
                    netWorthAED: rawNetAED
                });
            } else {
                lastSnap.netWorthAED = rawNetAED;
            }

            // Calculate Safe To Spend (Liquid Cash - Goals Saved)
            let liquidCashAED = 0;
            accounts.forEach(a => {
                if (['Bank Account', 'Cash', 'Savings'].includes(a.type)) {
                    liquidCashAED += (a.currency === 'AED' ? a.balance : a.balance / r);
                }
            });
            let totalGoalsAED = 0;
            (state.data.goals || []).forEach(g => {
                totalGoalsAED += (g.currency === 'AED' ? Number(g.saved) : Number(g.saved) / r);
            });
            const safeToSpendAED = liquidCashAED - totalGoalsAED;
            ut('safe-to-spend-budget', priv ? privText : actions.fmtMoney(safeToSpendAED, 'AED'));

            // Render Goals to Dashboard
            const gl = document.getElementById('goals-list');
            const gSec = document.getElementById('goals-section');
            if (gl && gSec) {
                if (state.data.goals && state.data.goals.length > 0) {
                    gSec.classList.remove('hidden');
                    FinzUI.setHTML(gl, state.data.goals.map(g => {
                        const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
                        return FinzUI.html`
                        <div class="text-slate-900 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm text-left relative overflow-hidden group cursor-pointer" data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('goals') })}">
                            <div class="text-slate-900 absolute inset-0 bg-slate-50 translate-y-[100%] group-hover:translate-y-[0%] transition-transform duration-500 ease-in-out"></div>
                            <div class="relative z-10">
                                <div class="flex justify-between items-start mb-4">
                                    <div class="flex items-center space-x-3">
                                        <div class="w-10 h-10 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center">
                                            <i data-lucide="${g.icon || 'target'}" class="w-5 h-5"></i>
                                        </div>
                                        <div>
                                            <h4 class="font-bold text-sm text-slate-800">${g.name}</h4>
                                            <p class="text-[9px] font-black uppercase text-slate-400">Target: ${actions.fmtMoney(g.target, g.currency)}</p>
                                        </div>
                                    </div>
                                    <span class="text-xs font-black text-indigo-500">${pct}%</span>
                                </div>
                                
                                <div class="w-full bg-slate-100 rounded-full h-2.5 mb-2 overflow-hidden flex">
                                    <div class="bg-indigo-500 h-2.5 rounded-full" style="width: ${pct}%"></div>
                                </div>
                                <div class="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                    <span>Saved: ${actions.fmtMoney(g.saved, g.currency)}</span>
                                    <span>Left: ${actions.fmtMoney(g.target - g.saved, g.currency)}</span>
                                </div>
                            </div>
                        </div>`;
                    }).join(''));
                } else {
                    gSec.classList.add('hidden');
                }
            }

            ut('uae-val', priv ? privText : actions.fmtMoney(uae, 'AED'));
            ut('india-val', priv ? privText : actions.fmtMoney(ind, 'INR'));
            ut('rec-val', (priv ? privText : actions.fmtMoney(rec, 'INR')));
            ut('pay-val', (priv ? privText : '-' + actions.fmtMoney(pay, 'INR')));
            ut('inv-val', priv ? privText : actions.fmtMoney(inv, 'INR'));

            // Safe User Label Update
            const uLabel = document.getElementById('user-label');
            if (state.user && uLabel) uLabel.innerText = state.user.email.split('@')[0];

            actions.renderAssetsList('uae', accounts.filter(a => a.currency === 'AED'));
            actions.renderAssetsList('india', accounts.filter(a => a.currency === 'INR'));
            actions.renderNotifications();
            actions.renderInstallments();
            actions.renderSmartInsights();
            // Render Wealth Landscape (Simulated/Calculated History)
            setTimeout(actions.renderWealthLandscape, 100);
            lucide.createIcons();
        };

actions.renderWealthLandscape = function () {
            const ctx = document.getElementById('wealth-chart');
            if (!ctx) return;

            // 1. Calculate History (Reverse Engineering from Current Net Worth)
            // Current Net Worth (INR)
            const r = state.data.settings.rate;
            let currentNW = 0;
            state.data.accounts.forEach(a => {
                const bal = a.currency === 'AED' ? a.balance * r : a.balance;
                currentNW += bal;
            });
            // Adjust for liabilities
            state.data.debts.forEach(d => {
                if (!d.settled) {
                    const val = Number(d.amount) * (d.currency === 'AED' ? r : 1);
                    if (d.type === 'payable') currentNW -= val;
                    else currentNW += val;
                }
            });

            // Reconstruct last 30 days
            const history = [];
            const today = new Date();
            let tempNW = currentNW;

            // Group transactions by day
            const dailyTx = {};
            state.data.transactions.forEach(t => {
                const date = t.date.split('T')[0];
                const amt = parseFloat(t.amount);
                // We need the value in INR Approx for the trend
                // Note: This is an approximation since we don't track historical rates
                let val = amt;
                // Try to infer currency from account or transaction (simplified)
                // If it was an Expense, NW goes DOWN, so to go BACK in time, we ADD it.
                // If Income, NW goes UP, so going back, we SUBTRACT.
                // Logic: Past NW = Current NW - Income + Expense
                if (t.type === 'income') dailyTx[date] = (dailyTx[date] || 0) + val;
                else if (t.type === 'expense') dailyTx[date] = (dailyTx[date] || 0) - val;
                // Transfers don't change Net Worth (usually), ignoring gain/loss for simplicity
            });

            for (let i = 0; i < 30; i++) {
                const d = new Date();
                d.setDate(today.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                history.push(tempNW);

                // Reverse adjustment for next iteration (going back in time)
                const change = dailyTx[dateStr] || 0;
                tempNW = tempNW - change; // if change was +100 (income), prev day was 100 less.
            }
            history.reverse(); // Now chronologically sorted

            if (actions.wealthChartInstance) actions.wealthChartInstance.destroy();
            actions.wealthChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: Array(30).fill(''),
                    datasets: [{
                        data: history,
                        borderColor: '#10b981', // Emerald 500
                        backgroundColor: (context) => {
                            const ctx = context.chart.ctx;
                            const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.5)');
                            gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
                            return gradient;
                        },
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { enabled: false } },
                    scales: {
                        x: { display: false },
                        y: { display: false, min: Math.min(...history) * 0.95 }
                    },
                    animation: { duration: 2000, easing: 'easeOutQuart' }
                }
            });
        };

actions.renderAnalytics = function () {
            const freedom = FinzCore.financialFreedom(state.data);
            const yearsFreedom = freedom.years === null ? '—' : freedom.years.toFixed(1);

            // HTML Structure
            const modal = document.getElementById('modal-content');
            FinzUI.setHTML(modal, FinzUI.html`
                <div class="space-y-8">
                    <!-- Freedom Gauge -->
                    <div class="bg-slate-900 text-white p-8 rounded-[3rem] text-center shadow-xl">
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Financial Freedom</p>
                        <p class="text-5xl font-black text-emerald-400">${yearsFreedom} <span class="text-lg text-slate-500">Years</span></p>
                        <p class="text-[10px] font-bold text-slate-500 mt-2">Based on ${freedom.months} completed months • converted to AED</p>
                    </div>

                    <!-- Asset Allocation Chart -->
                    <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm text-center">
                        <h4 class="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest">Interactive Wealth Composition</h4>
                        
                        <p class="text-[9px] font-black uppercase text-slate-400 tracking-widest mt-4">Gross Assets</p>
                        <p id="chart-center-val-modal" class="text-2xl font-black text-slate-800 text-center leading-tight mx-auto mb-4"></p>
                        
                        <div class="relative h-16 w-full mb-8">
                            <canvas id="allocation-chart-modal"></canvas>
                        </div>

                        <!-- Liability Bar -->
                        <div class="mt-8 mb-4">
                            <div class="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                <span>Debt-to-Asset Ratio</span>
                                <span id="debt-ratio-val-modal">0%</span>
                            </div>
                            <div class="w-full h-3 bg-emerald-100 rounded-full overflow-hidden flex">
                                <div id="liability-bar-modal" class="h-full bg-red-500 transition-all duration-1000" style="width: 0%"></div>
                            </div>
                            <div class="flex justify-between text-[10px] font-bold mt-2">
                                <span class="text-emerald-600" id="gross-assets-label-modal">Assets: </span>
                                <span class="text-red-500" id="liabilities-label-modal">Liabilities: </span>
                            </div>
                        </div>
                        
                        <!-- Drill-Down Container -->
                        <div id="category-details-container-modal" class="mt-6 text-left hidden fade-in"></div>
                    </div>

                    <!-- Historical Net Worth Trend -->
                    <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm text-center">
                        <h4 class="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Net Worth Trend</h4>
                        <div class="relative h-48 w-full">
                            <canvas id="networth-trend-chart"></canvas>
                        </div>
                    </div>

                    <!-- Expense Trend -->
                    <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm text-center">
                        <h4 class="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Expense Trend (6 Mo)</h4>
                        <div class="relative h-48 w-full">
                            <canvas id="expense-trend-chart"></canvas>
                        </div>
                    </div>
                </div>`);

            // Render Charts safely after DOM updates
            setTimeout(() => {
                actions.renderAllocationChart(true);
                actions.renderNetWorthTrend();
                actions.renderExpenseTrend();
            }, 200);
        };

actions.renderExpenseTrend = function () {
    const canvas = document.getElementById('expense-trend-chart');
    if (!canvas) return;
    if (actions.expenseTrendChart) actions.expenseTrendChart.destroy();
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
    const totals = months.map(month => state.data.transactions.filter(t => {
        const date = new Date(t.date);
        return t.type === 'expense' && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
    }).reduce((sum, t) => sum + actions.convert(t.amount, t.currency), 0));
    actions.expenseTrendChart = new Chart(canvas, { type: 'bar', data: {
        labels: months.map(m => m.toLocaleString('default', { month: 'short' })),
        datasets: [{ label: 'Expenses (AED)', data: totals, backgroundColor: '#f43f5e' }]
    }, options: { responsive: true, maintainAspectRatio: false } });
};

actions.renderNetWorthTrend = function () {
            const ctx = document.getElementById('networth-trend-chart');
            if (!ctx || !state.data.historicalSnapshots || state.data.historicalSnapshots.length === 0) return;

            if (actions.netWorthChartInstance) actions.netWorthChartInstance.destroy();

            const labels = state.data.historicalSnapshots.map(s => {
                const [y, m] = s.month.split('-');
                return new Date(y, m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
            });
            const data = state.data.historicalSnapshots.map(s => s.netWorthAED);

            actions.netWorthChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Net Worth (AED)',
                        data: data,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#10b981',
                        pointBorderColor: '#fff',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: '#10b981',
                        pointRadius: 4,
                        pointHoverRadius: 6
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
                                    return ' AED ' + Number(context.raw).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                }
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { family: "'Plus Jakarta Sans'", size: 10, weight: 'bold' } } },
                        y: { display: false, min: Math.min(...data) * 0.95 }
                    }
                }
            });
        };

actions.renderNotifications = function renderNotifications() {
            const list = document.getElementById('upcoming-dues-list'), panel = document.getElementById('notification-panel');
            if (!list) return;

            const today = new Date();
            const limit = new Date();
            limit.setDate(today.getDate() + 2);

            // FIXED: Use Local Time for Date String to avoid UTC shifts
            const toStr = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            };
            const todayStr = toStr(today);
            const limitStr = toStr(limit);

            // Mix of standard debts and BNPL installments
            const items = [];

            state.data.debts.forEach(d => {
                if (d.settled) return;
                // FIXED: Filter out receivables (Money In) as per user request
                if (d.type === 'receivable') return;

                // 1. Installment Handling (BNPL, Loans, etc.)
                // REMOVED: Installments now live strictly in "Installment Due" section (User Request)
                if (d.schedule && d.schedule.length > 0) {
                    // Skip installments for Action Required
                }
                // 2. Standard handling
                else if (d.repaymentDate) {
                    if (d.repaymentDate <= limitStr) {
                        items.push({
                            id: d.id,
                            type: d.type,
                            party: d.party,
                            date: d.repaymentDate,
                            amount: d.amount,
                            currency: d.currency,
                            isBnpl: false
                        });
                    }
                }
            });

            const sorted = items.sort((a, b) => new Date(a.date) - new Date(b.date));

            if (sorted.length === 0) { panel.classList.add('hidden'); return; }
            panel.classList.remove('hidden');

            FinzUI.setHTML(list, sorted.map(d => {
                const settleAction = d.isBnpl ? (() => actions.settleInstallment(d.id, d.instIndex)) : (() => actions.openSettleFlow(d.id));
                return FinzUI.html`
                <div class="text-slate-900 bg-white p-4 rounded-2xl border-l-4 ${d.type === 'receivable' ? 'border-emerald-500' : 'border-amber-500'} shadow-sm flex flex-col justify-between text-center">
                    <div class="flex justify-between items-start mb-3 text-center">
                        <div class="text-left text-center">
                            <p class="text-[8px] font-black uppercase text-slate-400 mb-0.5">${d.type === 'receivable' ? 'Money In' : 'Money Out'}</p>
                            <p class="font-bold text-slate-800 text-sm text-center">${d.party}</p>
                            <p class="text-[9px] font-bold text-slate-400 uppercase text-center text-center">Due: ${d.date}</p>
                        </div>
                        <p class="font-black text-slate-900">${d.amount} ${d.currency}</p>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-center text-center">
                        <button data-finz-click="${FinzUI.handler(function(event) { return (settleAction).call(this, event); })}" class="bg-emerald-500 text-white py-1.5 rounded-lg text-[9px] font-bold uppercase shadow-sm text-center text-center">Settle</button>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.openRescheduleFlow(((d.id))) })}" class="text-slate-900 bg-slate-50 text-slate-600 py-1.5 rounded-lg text-[9px] font-bold uppercase text-center text-center">Later</button>
                    </div>
                </div>`;
            }).join(''));
        };

actions.parsedRows = [];

actions.switchProfileTab = function (tab) {
            const secBtn = document.getElementById('tab-btn-security');
            const repBtn = document.getElementById('tab-btn-reports');
            const secPane = document.getElementById('tab-pane-security');
            const repPane = document.getElementById('tab-pane-reports');
            
            if (!secBtn || !repBtn || !secPane || !repPane) return;
            
            if (tab === 'security') {
                secBtn.className = "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-white shadow-sm text-slate-900 transition-all";
                repBtn.className = "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all";
                secPane.classList.remove('hidden');
                repPane.classList.add('hidden');
            } else {
                repBtn.className = "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-white shadow-sm text-slate-900 transition-all";
                secBtn.className = "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all";
                repPane.classList.remove('hidden');
                secPane.classList.add('hidden');
                actions.renderReportsTab();
            }
        };

actions.openModal = function(type, param) {
if (type === 'budget') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'Monthly Budgeting';
            actions.renderBudgetUIOverride();
            return;
        }
if (type === 'salary') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'Process Salary Day';
            const c = document.getElementById('modal-content');
            FinzUI.setHTML(c, FinzUI.html`
                <div class="max-w-md mx-auto bg-slate-800 p-8 md:p-10 rounded-[2.5rem] border border-slate-700 shadow-2xl text-center fade-in">
                    <div class="w-20 h-20 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <i data-lucide="banknote" class="w-10 h-10"></i>
                    </div>
                    <h3 class="text-2xl font-black text-white mb-2">Salary Credited</h3>
                    <p class="text-xs font-bold text-slate-400 mb-8">Record your incoming salary to start funding your budget envelopes.</p>
                    
                    <div class="mb-6 text-left">
                        <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-2 block">Total Received Amount</label>
                        <input type="number" id="sal-amount" placeholder="0.00" class="w-full p-5 border-2 border-slate-700 bg-slate-900 text-white rounded-2xl font-black text-3xl text-center focus:border-emerald-500 outline-none text-emerald-400 num-font">
                    </div>
                    
                    <div class="mb-8 text-left">
                        <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-2 block">Credited To Account</label>
                        <select id="sal-acc" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold text-center outline-none">
                            ${state.data.accounts.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}
                        </select>
                    </div>
                    
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.processSalary() })}" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2">Record & Start Budgeting <i data-lucide="arrow-right" class="w-4 h-4"></i></button>
                </div>
            `);
            lucide.createIcons();
            return;
        }
if (type === 'guilt_free') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'Guilt-Free Spend Details';
            actions.renderGuiltFreeModal();
            return;
        }
if (type === 'streak_details') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'No-Spend Streak Breakdown';
            actions.renderStreakDetailsModal();
            return;
        }
if (type === 'credit_score') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'Credit Score & Financial Health';
            actions.renderCreditScoreModal();
            return;
        }

            const b = document.getElementById('modal-backdrop'), t = document.getElementById('modal-title'), c = document.getElementById('modal-content');
            b.classList.replace('hidden', 'flex');
            switch (type) {
                // FIXED: Sign Out button now uses window.handleSignOut()
                case 'auth': t.innerText = 'System Profile'; FinzUI.setHTML(c, FinzUI.html`
                <div class="w-full space-y-6 fade-in text-center">
                    <!-- Modern Glassmorphic Tab Selector -->
                    <div class="flex justify-center mb-8">
                        <div class="bg-slate-100 p-1 rounded-2xl inline-flex shadow-sm items-center">
                            <button id="tab-btn-security" data-finz-click="${FinzUI.handler(function(event) { return actions.switchProfileTab('security') })}" class="text-slate-900 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-white shadow-sm text-slate-900 transition-all">Security</button>
                            <button id="tab-btn-reports" data-finz-click="${FinzUI.handler(function(event) { return actions.switchProfileTab('reports') })}" class="px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all">Data Vault & Reports</button>
                        </div>
                    </div>

                    <!-- TAB 1: Security -->
                    <div id="tab-pane-security" class="space-y-8 text-center max-w-md mx-auto">
                        <div class="fs-logo-modern w-24 h-24 mb-6 relative group mx-auto">
                            <div class="absolute inset-0 bg-emerald-500/20 rounded-xl blur-xl group-hover:bg-emerald-500/30 transition-all duration-500"></div>
                            <div class="relative h-full w-full bg-slate-900 border border-emerald-500/30 rounded-xl flex items-center justify-center overflow-hidden shadow-2xl">
                                <div class="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-transparent to-transparent"></div>
                                <div class="absolute inset-0 w-full h-[200%] bg-gradient-to-b from-transparent via-white/5 to-transparent -translate-y-[150%] animate-[modernScan_4s_infinite_ease-in-out]"></div>
                                <div class="relative z-10 text-center">
                                    <span class="block text-4xl font-black text-white tracking-tighter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">FS</span>
                                    <span class="block text-[8px] font-bold text-emerald-400 tracking-[0.3em] uppercase mt-1">Finance</span>
                                </div>
                            </div>
                        </div>
                        <p class="font-black text-xl text-slate-800 text-center">${state.user.email}</p>
                        
                        <div class="grid grid-cols-2 gap-4 max-w-sm mx-auto">
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('remittance') })}" class="text-slate-900 p-4 bg-slate-50 rounded-2xl text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 font-bold text-xs uppercase transition-all">
                                <i data-lucide="arrow-left-right" class="w-6 h-6 mx-auto mb-2"></i> Remittance
                            </button>
                             <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('zakat') })}" class="text-slate-900 p-4 bg-slate-50 rounded-2xl text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 font-bold text-xs uppercase transition-all">
                                <i data-lucide="heart-handshake" class="w-6 h-6 mx-auto mb-2"></i> Zakat Calc
                            </button>
                        </div>
                        <div class="max-w-sm mx-auto mt-4">
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('change-password') })}" class="text-slate-900 w-full p-4 bg-slate-50 rounded-2xl text-slate-600 hover:bg-amber-50 hover:text-amber-600 font-bold text-xs uppercase transition-all">
                                <i data-lucide="shield-check" class="w-6 h-6 mx-auto mb-2"></i> Change Password
                            </button>
                        </div>

                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.handleSignOut() })}" class="w-full max-w-sm mx-auto bg-slate-900 text-white p-5 rounded-3xl font-black uppercase text-sm text-center">Sign Out</button>
                    </div>

                    <!-- TAB 2: Data Vault & Reports -->
                    <div id="tab-pane-reports" class="hidden text-left max-w-4xl mx-auto space-y-8 fade-in">
                        <!-- Module A: Annual Report (Injected via JS) -->
                        <div id="annual-report-container" class="bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden border border-slate-800 text-center">
                            <!-- Injected content -->
                        </div>

                        <!-- Module B: Custom Deep-Dive Filters -->
                        <div class="text-slate-900 bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm text-center">
                            <h3 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center justify-center"><i data-lucide="filter" class="w-4 h-4 mr-2"></i> Custom Intelligence Query</h3>
                            
                            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 text-left">
                                <div>
                                    <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">From</label>
                                    <input type="date" id="query-date-from" class="text-slate-900 w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-emerald-500">
                                </div>
                                <div>
                                    <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">To</label>
                                    <input type="date" id="query-date-to" class="text-slate-900 w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-emerald-500">
                                </div>
                                <div>
                                    <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Type</label>
                                    <select id="query-type" class="text-slate-900 w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-emerald-500">
                                        <option value="all">All Flows</option>
                                        <option value="income">Income Only</option>
                                        <option value="expense">Expense Only</option>
                                        <option value="transfer">Transfers</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="text-[9px] font-bold text-slate-400 uppercase ml-1">Category</label>
                                    <select id="query-category" class="text-slate-900 w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-emerald-500">
                                        <option value="all">Any Category</option>
                                        <optgroup label="Expenses">
                                            ${state.data.expenseCategories.map(c => FinzUI.literal("<option value=\"") + c + '">' + c + FinzUI.literal("</option>")).join('')}
                                        </optgroup>
                                        <optgroup label="Income">
                                            ${state.data.incomeCategories.map(c => FinzUI.literal("<option value=\"") + c + '">' + c + FinzUI.literal("</option>")).join('')}
                                        </optgroup>
                                    </select>
                                </div>
                            </div>

                            <div class="flex flex-wrap justify-center gap-2 mb-6 cursor-pointer">
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.setQueryDates(30) })}" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600">Last 30 Days</button>
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.setQueryDates(90) })}" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600">Last Quarter</button>
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.setQueryDates(365) })}" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600">Past Year</button>
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.setQueryDates('ytd') })}" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600">YTD</button>
                                <button data-finz-click="${FinzUI.handler(function(event) { document.getElementById('query-date-from').value=''; return document.getElementById('query-date-to').value=''; })}" class="text-slate-900 px-3 py-1 bg-slate-50 hover:bg-slate-100 rounded-lg text-[10px] font-bold text-slate-400 border border-slate-200">Clear</button>
                            </div>

                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.executeCustomQuery() })}" class="w-full bg-slate-900 text-emerald-400 hover:bg-slate-800 p-4 rounded-2xl font-black uppercase text-xs transition-all shadow-lg flex items-center justify-center">
                                <i data-lucide="zap" class="w-4 h-4 mr-2"></i> Generate Query
                            </button>

                            <!-- Query Results -->
                            <div id="query-results" class="hidden mt-8 text-left">
                                <div class="flex justify-between items-end border-b border-slate-200 pb-4 mb-4">
                                    <div>
                                        <p class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Query Aggregate</p>
                                        <p id="query-total-sum" class="text-2xl font-black text-slate-900 mt-1 num-font w-full max-w-[200px] break-all">0.00</p>
                                    </div>
                                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.exportCustomQueryPDF() })}" class="bg-emerald-50 text-emerald-600 px-4 py-2 flex items-center rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all border border-emerald-100 shrink-0 self-center">
                                        <i data-lucide="download" class="w-3 h-3 mr-2"></i> PDF
                                    </button>
                                </div>
                                <div class="overflow-x-auto no-scrollbar max-h-[300px] custom-scrollbar border border-slate-100 rounded-xl relative">
                                    <table id="query-results-table" class="w-full text-left font-sans text-sm whitespace-nowrap">
                                        <thead class="text-slate-900 bg-slate-50 text-[10px] text-slate-500 font-bold uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th class="p-3">Date</th>
                                                <th class="p-3">Details</th>
                                                <th class="p-3">Type</th>
                                                <th class="p-3 text-right">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody id="query-results-body" class="divide-y divide-slate-100 font-medium text-slate-700">
                                            <!-- Results go here -->
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`);
                setTimeout(() => {
                    lucide.createIcons();
                }, 50);
                break;
                case 'change-password':
                    t.innerText = 'Security Settings';
                    FinzUI.setHTML(c, FinzUI.html`
                        <div class="text-slate-900 max-w-sm mx-auto bg-slate-50 p-8 rounded-[2.5rem] border text-center">
                            <i data-lucide="lock" class="w-12 h-12 text-amber-500 mx-auto mb-4"></i>
                            <div class="space-y-4 text-left">
                                <div>
                                    <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Current Password</label>
                                    <input type="password" id="cp-old" placeholder="Verify Identity" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-white outline-none focus:ring-2 focus:ring-amber-500 text-center">
                                </div>
                                <div>
                                    <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">New Password</label>
                                    <input type="password" id="cp-new" placeholder="Min 6 chars" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-white outline-none focus:ring-2 focus:ring-amber-500 text-center">
                                </div>
                                <div>
                                    <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Confirm New</label>
                                    <input type="password" id="cp-cnf" placeholder="Repeat New" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-white outline-none focus:ring-2 focus:ring-amber-500 text-center">
                                </div>
                            </div>
                            <button id="btn-change-password" data-finz-click="${FinzUI.handler(function(event) { return actions.handleChangePassword() })}" class="w-full bg-amber-500 text-white p-4 rounded-2xl font-black uppercase text-xs shadow-lg hover:bg-amber-600 transition-all mt-6">Update Credentials</button>
                        </div>
                    `); break;
                case 'accounts':
                    t.innerText = 'Asset Registration';
                    FinzUI.setHTML(c, FinzUI.html`
                        <div class="max-w-md mx-auto bg-slate-800/95 backdrop-blur-xl p-8 rounded-[2.5rem] border border-slate-700/80 text-center shadow-2xl">
                            
                            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">— REGISTER ASSET OR ACCOUNT —</p>

                            <input type="text" id="an" placeholder="Asset Name (e.g. 24K Gold Bar, ADCB Bank, HDFC)" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold mb-4 outline-none focus:border-emerald-500 placeholder-slate-500">
                            
                            <div class="grid grid-cols-2 gap-4 mb-4">
                                <select id="ac" data-finz-change="${FinzUI.handler(function(event) { return actions.calcCommodityBalance() })}" class="p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold text-center outline-none">
                                    <option value="AED">AED</option>
                                    <option value="INR">INR</option>
                                </select>
                                <select id="at" data-finz-change="${FinzUI.handler(function(event) { return actions.toggleAssetFields() })}" class="p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold text-center outline-none">
                                    ${state.data.assetTypes.map(ty => FinzUI.html`<option value="${ty}">${ty}</option>`).join('')}
                                </select>
                            </div>

                            <div id="inv-type-container" class="hidden mb-4 text-left">
                                <p class="text-[9px] font-bold text-slate-400 mb-1 uppercase tracking-widest pl-1">Investment Category</p>
                                <select id="inv-type" data-finz-change="${FinzUI.handler(function(event) { return actions.toggleAssetFields() })}" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold text-center outline-none">
                                    <option value="General">General / Stock</option>
                                    <option value="Commodity">Commodity (Gold, Silver...)</option>
                                    <option value="Mutual Fund">Mutual Fund</option>
                                    <option value="Crypto">Crypto</option>
                                    <option value="Bond">Bond / Deposit</option>
                                </select>
                            </div>

                            <!-- Dynamic Inputs -->
                            <div id="dynamic-inputs" class="space-y-4 mb-6 text-left">
                                
                                <!-- Emergency Fund Target -->
                                <div id="inp-emf" class="hidden">
                                    <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1 block mb-1">Target Amount (Optional)</label>
                                    <input type="number" id="emf-target" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-emerald-500 font-mono" placeholder="Target">
                                </div>

                                <!-- Commodity Inputs -->
                                <div id="inp-commodity" class="hidden space-y-4">
                                    <div>
                                        <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1 block mb-1">Metal / Commodity Type</label>
                                        <select id="commodity-type" data-finz-change="${FinzUI.handler(function(event) { return actions.calcCommodityBalance() })}" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none">
                                            <option value="Gold">Gold</option>
                                            <option value="Silver">Silver</option>
                                            <option value="Platinum">Platinum</option>
                                            <option value="Palladium">Palladium</option>
                                            <option value="Oil">Oil</option>
                                            <option value="Diamond">Diamond</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1 block mb-1">Weight in Grams (Optional)</label>
                                        <input type="number" step="any" id="aw" data-finz-input="${FinzUI.handler(function(event) { return actions.calcCommodityBalance() })}" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-amber-500 font-mono placeholder-slate-500" placeholder="e.g. 10">
                                        <p id="commodity-rate-hint" class="text-[10px] text-amber-400 font-bold mt-1 pl-1"></p>
                                    </div>
                                </div>

                                <!-- Mutual Fund -->
                                <div id="inp-fund" class="hidden space-y-4">
                                    <div>
                                        <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1 block mb-1">Fund Category / Name</label>
                                        <input type="text" id="mf-cat" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-blue-500 placeholder-slate-500" placeholder="Category (e.g. Small Cap, Index Fund)">
                                    </div>
                                </div>

                                <!-- Real Estate -->
                                <div id="inp-re" class="hidden space-y-4">
                                    <input type="text" id="re-loc" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Location (e.g. Dubai Marina)">
                                    <div class="grid grid-cols-2 gap-4">
                                        <select id="re-type" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none">
                                            <option value="Residential">Residential</option>
                                            <option value="Commercial">Commercial</option>
                                            <option value="Land">Land</option>
                                        </select>
                                        <input type="text" id="re-area" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none placeholder-slate-500" placeholder="Area (sqft)">
                                    </div>
                                </div>

                                <!-- Crypto -->
                                <div id="inp-crypto" class="hidden grid grid-cols-2 gap-4">
                                    <input type="text" id="cry-sym" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none uppercase placeholder-slate-500" placeholder="Symbol (BTC)">
                                    <input type="text" id="cry-net" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none placeholder-slate-500" placeholder="Network (ERC20)">
                                </div>

                                <!-- Bond/Deposit -->
                                <div id="inp-bond" class="hidden grid grid-cols-2 gap-4">
                                    <input type="date" id="bond-date" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none text-xs" title="Maturity Date">
                                    <input type="number" id="bond-rate" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none placeholder-slate-500" placeholder="Rate %">
                                </div>

                                <!-- Universal: Current Balance / Value -->
                                <div id="inp-balance">
                                    <label id="lbl-balance" class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1 block mb-1">Current Balance / Value</label>
                                    <input type="number" step="any" id="ab" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-emerald-500 font-mono placeholder-slate-500" placeholder="0.00">
                                </div>
                                <div id="inp-balance-note" class="text-[10px] text-slate-400 font-bold text-center mt-1">Enter current available balance in account</div>
                            </div>
                            <button id="btn-save-acc" data-finz-click="${FinzUI.handler(function(event) { return actions.saveAccount() })}" class="w-full bg-emerald-500 text-white p-5 rounded-3xl font-black uppercase text-sm shadow-xl hover:bg-emerald-600 transition-all">Save Account</button>
                        </div>`);
                    setTimeout(() => {
                        actions.toggleAssetFields();
                    }, 20);
                    break;


                case 'transaction': t.innerText = 'Data Movement'; FinzUI.setHTML(c, FinzUI.html`
                    <div class="text-slate-100 max-w-2xl mx-auto bg-slate-800 p-8 md:p-10 rounded-[2.5rem] border border-slate-700 shadow-2xl text-center">
                        <div id="tx-warning" class="hidden mb-4 p-3 bg-amber-500/10 text-amber-300 rounded-xl text-xs font-bold border border-amber-500/30"></div>
                        <div class="grid grid-cols-2 gap-4 mb-6 text-center">
                            <button id="be" data-finz-click="${FinzUI.handler(function(event) { return actions.setT('expense') })}" class="p-4 rounded-2xl border-2 border-rose-500 bg-rose-600 text-white font-black text-xs uppercase shadow-lg shadow-rose-600/30 transition-all">Expense</button>
                            <button id="bi" data-finz-click="${FinzUI.handler(function(event) { return actions.setT('income') })}" class="p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-slate-400 font-black text-xs uppercase hover:text-slate-200 transition-all">Income</button>
                        </div>
                        <input type="hidden" id="tt" value="expense">
                        <div class="mb-4 text-left">
                            <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-1 block">Account</label>
                            <select id="ta" data-finz-change="${FinzUI.handler(function(event) { return actions.onTxAccountChange() })}" class="w-full p-4 border border-slate-700 rounded-xl font-bold bg-slate-900 text-white text-center outline-none">${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}</select>
                        </div>
                        <div class="grid grid-cols-2 gap-4 mb-4 text-left">
                            <div>
                                <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-1 block">Category</label>
                                <select id="tc" data-finz-change="${FinzUI.handler(function(event) { return actions.checkBudgetWarning() })}" class="w-full p-4 border border-slate-700 rounded-xl font-bold text-sm text-center bg-slate-900 text-white outline-none">${actions.renderCategoryOptions()}</select>
                            </div>
                            <div>
                                <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-1 block">Amount</label>
                                <input type="number" id="tam" placeholder="0.00" data-finz-input="${FinzUI.handler(function(event) { return actions.checkBudgetWarning() })}" class="w-full p-4 border border-slate-700 rounded-xl font-black text-center bg-slate-900 text-white focus:border-rose-500 outline-none num-font">
                            </div>
                        </div>
                        <div class="mb-4 text-left">
                            <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-1 block">Note (Optional)</label>
                            <input type="text" id="tn" placeholder="e.g. Grocery, Lunch, Rent" class="w-full p-4 border border-slate-700 rounded-xl bg-slate-900 text-white outline-none focus:border-rose-500">
                        </div>
                        <div id="tx-exclude-budget-container" class="mb-6 flex items-center justify-between p-3.5 bg-slate-900/80 border border-slate-700/80 rounded-xl text-left">
                            <div class="pr-3">
                                <label for="tx-exclude-budget" class="text-xs font-bold text-slate-200 block cursor-pointer">Exclude from Monthly Budget</label>
                                <p class="text-[10px] text-slate-400 mt-0.5">Paid from savings / capital — won't deduct from monthly salary envelopes</p>
                            </div>
                            <input type="checkbox" id="tx-exclude-budget" data-finz-change="${FinzUI.handler(function(event) { return actions.checkBudgetWarning() })}" class="w-5 h-5 rounded accent-rose-500 cursor-pointer">
                        </div>
                        <p id="tx-validation" role="alert" class="hidden mb-4 text-sm font-bold text-rose-300"></p>
                        <button id="btn-save-tx" data-finz-click="${FinzUI.handler(function(event) { return actions.saveTransaction() })}" class="w-full bg-rose-600 hover:bg-rose-700 text-white p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-rose-600/30 transition-all text-center">Authorize entry</button>
                    </div>`);
                    setTimeout(() => {
                        if (typeof actions.onTxAccountChange === 'function') actions.onTxAccountChange();
                    }, 20);
                    break;
                case 'transfer': t.innerText = 'Transfer & Remittance'; FinzUI.setHTML(c, FinzUI.html`
                    <div class="text-slate-100 max-w-2xl mx-auto bg-slate-800/95 border border-slate-700/80 p-6 md:p-8 rounded-[2.5rem] shadow-2xl text-left space-y-6">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="text-[10px] font-black uppercase text-slate-400 block mb-1.5 pl-1">From (Source)</label>
                                <select id="ts" data-finz-change="${FinzUI.handler(function(event) { return actions.updateTransferUI() })}" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-rose-500 text-sm">
                                    ${state.data.accounts.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency} ${actions.toCurrency(a.balance).toLocaleString()})</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="text-[10px] font-black uppercase text-slate-400 block mb-1.5 pl-1">To (Destination)</label>
                                <select id="ttg" data-finz-change="${FinzUI.handler(function(event) { return actions.updateTransferUI() })}" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-emerald-500 text-sm">
                                    ${state.data.accounts.map((a, idx) => FinzUI.html`<option value="${a.id}" ${idx === 1 ? 'selected' : ''}>${a.name} (${a.currency} ${actions.toCurrency(a.balance).toLocaleString()})</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <!-- Sending Amount -->
                        <div>
                            <label id="lbl-send-amount" class="text-[10px] font-black uppercase text-slate-400 block mb-1.5 pl-1">Sending Amount</label>
                            <div class="relative">
                                <input type="number" step="any" id="tamt" data-finz-input="${FinzUI.handler(function(event) { return actions.calcTransferEstimate('send') })}" class="w-full p-5 border border-slate-700 bg-slate-900 text-white rounded-2xl font-black text-2xl md:text-3xl text-center outline-none focus:border-emerald-500 font-mono placeholder-slate-600" placeholder="0.00">
                                <span id="badge-send-cur" class="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-xs font-black">AED</span>
                            </div>
                        </div>

                        <!-- Cross-Currency Remittance Box (AED -> INR or INR -> AED) -->
                        <div id="cross-currency-box" class="p-5 bg-gradient-to-br from-indigo-950/40 via-slate-900/80 to-slate-900/90 border border-indigo-500/30 rounded-2xl space-y-4">
                            <div class="flex items-center justify-between border-b border-indigo-500/20 pb-2.5">
                                <div class="flex items-center gap-2 text-indigo-400 font-black text-xs uppercase tracking-wider">
                                    <i data-lucide="arrow-left-right" class="w-4 h-4"></i> Cross-Currency Conversion
                                </div>
                                <span id="rate-source-tag" class="text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-800 px-2.5 py-0.5 rounded-full border border-slate-700">Custom Rate Enabled</span>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="text-[9px] font-black uppercase text-slate-400 block mb-1 pl-1">Exchange Rate (1 AED = ? INR)</label>
                                    <input type="number" step="0.0001" id="tx-rate" data-finz-input="${FinzUI.handler(function(event) { return actions.calcTransferEstimate('rate') })}" class="w-full p-3.5 border border-slate-700 bg-slate-900 text-amber-300 font-mono font-bold rounded-xl outline-none focus:border-amber-400 text-sm" placeholder="e.g. 22.85">
                                </div>
                                <div>
                                    <label id="lbl-received-amount" class="text-[9px] font-black uppercase text-slate-400 block mb-1 pl-1">Received INR Amount (Credited)</label>
                                    <input type="number" step="any" id="tx-received" data-finz-input="${FinzUI.handler(function(event) { return actions.calcTransferEstimate('receive') })}" class="w-full p-3.5 border border-slate-700 bg-slate-900 text-emerald-400 font-mono font-bold rounded-xl outline-none focus:border-emerald-400 text-sm" placeholder="0.00">
                                </div>
                            </div>

                            <!-- Optional Transfer Fee -->
                            <div>
                                <div class="flex justify-between items-center mb-1 pl-1">
                                    <label id="lbl-transfer-fee" class="text-[9px] font-black uppercase text-slate-400">Transfer / Exchange Fee (Optional)</label>
                                    <span class="text-[8px] font-bold text-slate-500">Debited as bank fee</span>
                                </div>
                                <input type="number" step="any" id="tx-fee" data-finz-input="${FinzUI.handler(function(event) { return actions.calcTransferEstimate('fee') })}" class="w-full p-3 border border-slate-700 bg-slate-900 text-slate-300 font-mono font-bold rounded-xl outline-none focus:border-rose-500 text-sm" placeholder="0.00">
                            </div>

                            <!-- Live Conversion Summary -->
                            <div id="remit-summary-pill" class="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-center text-xs font-bold text-indigo-300">
                                Enter sending amount to calculate
                            </div>
                        </div>

                        <!-- Description & Category -->
                        <div class="space-y-4">
                            <div>
                                <label class="text-[10px] font-black uppercase text-slate-400 block mb-1.5 pl-1">Transfer Note / Description</label>
                                <input type="text" id="trn" placeholder="e.g. Monthly Home Remittance, Botim Transfer, Savings" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-emerald-500 text-sm placeholder-slate-600">
                            </div>
                            <div>
                                <label class="text-[10px] font-black uppercase text-slate-400 block mb-1.5 pl-1">Budget Category (Optional)</label>
                                <select id="tcat" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold outline-none focus:border-emerald-500 text-sm">
                                    ${actions.renderCategoryOptions(true)}
                                </select>
                                <p class="text-[9px] text-slate-500 font-bold mt-1 pl-1">If you select an Expense/Investment category, this transfer will count against your Monthly Envelope Budget.</p>
                            </div>
                        </div>

                        <div id="transfer-error-msg" class="hidden p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold rounded-xl text-center"></div>

                        <button id="btn-do-transfer" data-finz-click="${FinzUI.handler(function(event) { return actions.doTransfer() })}" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white p-5 rounded-2xl font-black uppercase text-sm shadow-xl shadow-emerald-500/20 transition-all text-center">
                            Authorize Transfer
                        </button>
                    </div>`);
                    setTimeout(() => {
                        actions.updateTransferUI();
                        lucide.createIcons();
                    }, 20);
                    break;
                case 'debt': t.innerText = 'Liability Management'; FinzUI.setHTML(c, actions.renderDebtUI()); break;
                case 'settings': t.innerText = 'Configuration Hub'; FinzUI.setHTML(c, actions.renderSettingsUI()); break;
                case 'reports': t.innerText = 'Summaries'; FinzUI.setHTML(c, actions.renderDistributionInsights()); break;
                case 'analytics': t.innerText = 'Financial Health Board'; actions.renderDashboard(); break;
                case 'budget': t.innerText = 'Monthly Budgeting'; FinzUI.setHTML(c, actions.renderBudgetUI()); setTimeout(actions.recalculateBalances, 50); break;

                case 'goals': t.innerText = 'My Goals (Sinking Funds)'; FinzUI.setHTML(c, actions.renderGoalsUI()); break;
                case 'tags': t.innerText = 'Projects & Tag Analytics'; FinzUI.setHTML(c, actions.renderTagsUI()); break;
                case 'calculator': t.innerText = 'Compound Projector'; FinzUI.setHTML(c, actions.renderCalculator()); break;
                case 'subscriptions': t.innerText = 'Recurring Auto-Pay'; FinzUI.setHTML(c, actions.renderSubscriptionsUI()); break;
                case 'import': t.innerText = 'Import Statement'; FinzUI.setHTML(c, actions.renderImportUI()); break;
                case 'salary': t.innerText = 'Process Salary Day'; FinzUI.setHTML(c, FinzUI.html`
                    <div class="text-slate-900 max-w-md mx-auto bg-white p-10 rounded-[3rem] border shadow-xl text-center">
                        <h3 class="text-xl font-black text-slate-900 mb-4">Salary Allocation</h3>
                        <div class="mb-4">
                            <label class="text-[10px] font-black uppercase text-slate-400 block mb-1 text-left ml-2">Total Salary Amount</label>
                            <input type="number" id="sal-amount" placeholder="0.00" class="w-full p-4 border rounded-xl font-black text-center focus:border-emerald-500" data-finz-input="${FinzUI.handler(function(event) { return actions.calcSalAlloc() })}">
                        </div>
                        <div class="grid grid-cols-3 gap-2 mb-4">
                            <div>
                                <label class="text-[9px] font-bold uppercase text-slate-400 block mb-1">Savings (%)</label>
                                <input type="number" id="sal-sav-pct" value="20" class="w-full p-2 border rounded-lg text-center" data-finz-input="${FinzUI.handler(function(event) { return actions.calcSalAlloc() })}">
                                <p id="sal-sav-val" class="text-xs font-bold text-emerald-600 mt-1">0.00</p>
                            </div>
                            <div>
                                <label class="text-[9px] font-bold uppercase text-slate-400 block mb-1">Invest (%)</label>
                                <input type="number" id="sal-inv-pct" value="30" class="w-full p-2 border rounded-lg text-center" data-finz-input="${FinzUI.handler(function(event) { return actions.calcSalAlloc() })}">
                                <p id="sal-inv-val" class="text-xs font-bold text-indigo-600 mt-1">0.00</p>
                            </div>
                            <div>
                                <label class="text-[9px] font-bold uppercase text-slate-400 block mb-1">Expense (%)</label>
                                <input type="number" id="sal-exp-pct" value="50" class="w-full p-2 border rounded-lg text-center" data-finz-input="${FinzUI.handler(function(event) { return actions.calcSalAlloc() })}">
                                <p id="sal-exp-val" class="text-xs font-bold text-rose-600 mt-1">0.00</p>
                            </div>
                        </div>
                        <div class="mb-4">
                             <label class="text-[10px] font-black uppercase text-slate-400 block mb-1 text-left ml-2">Receiving Account</label>
                             <select id="sal-acc" class="w-full p-4 border rounded-xl font-bold text-center">${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}</select>
                        </div>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.processSalary() })}" class="w-full bg-emerald-500 text-white p-4 rounded-2xl font-black uppercase shadow-lg mb-2">Execute Allocations</button>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.printSalary() })}" class="w-full bg-slate-100 text-slate-600 p-4 rounded-2xl font-bold uppercase mt-2"><i data-lucide="printer" class="inline w-4 h-4 mr-1"></i> Print Summary</button>
                    </div>`); 
                    setTimeout(() => lucide.createIcons(), 50);
                    break;
                // NEW FEATURES
                case 'remittance': t.innerText = 'Arbitrage Tracker'; FinzUI.setHTML(c, actions.renderRemittance()); setTimeout(actions.renderRemitChart, 300); break;
                case 'zakat': t.innerText = 'Zakat Calculator'; FinzUI.setHTML(c, actions.renderZakatCalculator()); break;
                case 'zakat_payment': t.innerText = 'Record Zakat Payment'; FinzUI.setHTML(c, actions.renderZakatPaymentModal()); break;


                case 'sweep':
                    t.innerText = 'Budget Sweep';
                    const sw = actions.pendingSweep || { cat: '?', amt: 0 };
                    FinzUI.setHTML(c, FinzUI.html`
                        <div class="text-slate-900 max-w-md mx-auto bg-white p-8 rounded-[3rem] border shadow-xl text-center space-y-6">
                            <div class="bg-emerald-50 p-6 rounded-[2rem] mb-4">
                                <p class="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1">Surplus To Sweep</p>
                                <h3 class="text-4xl font-black text-emerald-600 num-font">${state.data.settings.currency || 'AED'} ${Math.round(sw.amt).toLocaleString()}</h3>
                                <p class="text-xs font-bold text-emerald-700/60 mt-2">From '${sw.cat}' Budget</p>
                            </div>

                            <div class="grid grid-cols-1 gap-4 text-left">
                                <div>
                                    <label class="text-[9px] font-black uppercase text-slate-400 ml-3 mb-1 block">From Account (Source)</label>
                                    <select id="sw-src" class="text-slate-900 w-full p-4 border rounded-xl font-bold text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500">
                                        <option value="">Select Source...</option>
                                        ${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(a => FinzUI.html`<option value="${a.id}">${a.name} (Avl: ${a.balance})</option>`).join('')}
                                    </select>
                                </div>
                                <div class="flex justify-center text-slate-300"><i data-lucide="arrow-down" class="w-6 h-6"></i></div>
                                <div>
                                    <label class="text-[9px] font-black uppercase text-slate-400 ml-3 mb-1 block">To Savings Pot (Goal)</label>
                                    <select id="sw-goal" class="text-slate-900 w-full p-4 border rounded-xl font-bold text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500">
                                        <option value="">Select Target...</option>
                                        ${state.data.goals.map(g => FinzUI.html`<option value="${g.id}">${g.name} (Saved: ${g.saved})</option>`).join('')}
                                    </select>
                                </div>
                            </div>
                            
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.finalizeSweep() })}" class="w-full bg-slate-900 text-white p-5 rounded-2xl font-black uppercase shadow-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 mt-4">
                                <i data-lucide="sparkles" class="w-5 h-5"></i> Confirm Sweep
                            </button>
                        </div>
                    `);
                    break;
            }
            lucide.createIcons();
        };

actions.renderSubscriptionsUI = function () {
            return FinzUI.html`<div class= "max-w-xl mx-auto space-y-6">
            <div class="text-slate-900 bg-slate-50 p-6 rounded-[2.5rem] border shadow-sm">
                <h4 class="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest text-center">New Auto-Pay</h4>
                <div class="space-y-4">
                    <input type="text" id="sub-name" placeholder="Name (e.g. Netflix)" class="w-full p-3 border rounded-xl font-bold text-sm outline-none focus:border-emerald-500">
                        <div class="grid grid-cols-2 gap-4">
                            <input type="number" id="sub-amt" placeholder="Amount" class="p-3 border rounded-xl font-bold text-sm outline-none focus:border-emerald-500">
                                <input type="number" id="sub-day" placeholder="Day (1-31)" min="1" max="31" class="p-3 border rounded-xl font-bold text-sm outline-none focus:border-emerald-500">
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <select id="sub-type" class="text-slate-900 p-3 border rounded-xl font-bold text-sm bg-white">
                                        <option value="expense">Expense (-)</option>
                                        <option value="income">Income (+)</option>
                                    </select>
                                    <select id="sub-acc" class="text-slate-900 p-3 border rounded-xl font-bold text-sm bg-white">
                                        <option value="">Link Account...</option>
                                        ${state.data.accounts.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}
                                    </select>
                                </div>
                                
                                <!-- NEW FIELDS: Billing Cycle & Free Trial -->
                                <div class="grid grid-cols-2 gap-4">
                                     <select id="sub-cycle" class="text-slate-900 p-3 border rounded-xl font-bold text-sm bg-white">
                                        <option value="Monthly">Monthly</option>
                                        <option value="Yearly">Yearly</option>
                                    </select>
                                    <div class="relative">
                                        <label class="text-slate-900 absolute -top-2 left-2 px-1 bg-white text-[9px] font-bold text-slate-400">Free Trial Ends (Opt)</label>
                                        <input type="date" id="sub-trial" class="w-full p-3 border rounded-xl font-bold text-sm outline-none focus:border-emerald-500 text-slate-600">
                                    </div>
                                </div>
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.addSubscription() })}" class="w-full bg-slate-900 text-white p-3 rounded-xl font-black uppercase shadow-lg text-xs">Create Schedule</button>
                        </div>
                </div>

                <div class="space-y-4">
                    <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-2">Active Schedules</h4>
                    ${(state.data.subscriptions || []).map(s => {
                const acc = state.data.accounts.find(a => a.id === s.accountId);
                return FinzUI.html`<div class="text-slate-900 bg-white p-5 rounded-[2rem] border shadow-sm flex justify-between items-center group">
                            <div class="text-left">
                                <p class="font-black text-slate-800">${s.name}</p>
                                <p class="text-[9px] font-bold text-slate-400 uppercase">
                                    ${s.billingCycle || 'Monthly'} • Next: ${new Date(s.nextDate).toLocaleDateString()}
                                    ${s.freeTrialEndDate && new Date(s.freeTrialEndDate) > new Date() ?
                        FinzUI.html`<span class="ml-1 px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded text-[8px] font-black">TRIAL</span>` : ''}
                                </p>
                                ${acc ? FinzUI.html`<p class="text-[8px] font-bold text-emerald-600 uppercase mt-0.5"><i data-lucide="link" class="w-3 h-3 inline"></i> ${acc.name}</p>` : ''}
                            </div>
                            <div class="text-right">
                                <p class="font-black text-lg ${s.type === 'income' ? 'text-emerald-500' : 'text-slate-800'}">${s.type === 'income' ? '+' : '-'} ${s.amount}</p>
                                <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteSubscription(((s.id))) })}" class="text-[9px] text-red-300 font-bold uppercase hover:text-red-500">Stop</button>
                            </div>
                        </div>`;
            }).join('') || FinzUI.literal("<p class=\"text-center text-slate-300 py-4 font-bold text-xs uppercase\">No active subscriptions</p>")}
                </div>
            </div>`;
        };

actions.addSubscription = async function () {
            const name = document.getElementById('sub-name').value;
            const amount = parseFloat(document.getElementById('sub-amt').value);
            const day = parseInt(document.getElementById('sub-day').value);
            const type = document.getElementById('sub-type').value;
            const accId = document.getElementById('sub-acc').value;
            // Capture target if transfer
            const targetAccId = document.getElementById('sub-target-acc') ? document.getElementById('sub-target-acc').value : null;

            const cycle = document.getElementById('sub-cycle').value || 'Monthly';
            const trial = document.getElementById('sub-trial').value || null;

            if (!name.trim() || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(day) || day < 1 || day > 31 || !accId) {
                actions.showToast("Please fill all required fields.", "error");
                return;
            }

            if (type === 'transfer' && !targetAccId) {
                actions.showToast("Please select a Destination Account.", "error");
                return;
            }

            if (!state.data.subscriptions) state.data.subscriptions = [];

            const now = new Date();
            const d = new Date(now.getFullYear(), now.getMonth(), Math.min(day, new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()));
            let nextDate = d;
            if (now.getDate() > day) nextDate = FinzCore.nextDue(d, cycle, day);
            if (trial) {
                const trialDate = new Date(trial + 'T00:00:00');
                if (!Number.isFinite(trialDate.getTime())) { actions.showToast('Invalid trial date.', 'error'); return; }
                if (trialDate > nextDate) nextDate = trialDate;
            }

            state.data.subscriptions.push({
                id: actions.genId(),
                name, amount, type,
                day,
                billingCycle: cycle,
                freeTrialEndDate: trial,
                nextDate: nextDate.toISOString(),
                accountId: accId,
                targetAccountId: targetAccId || null,
                category: type === 'transfer' ? 'Transfer' : 'Recurring'
            });
            await updateDb();
            actions.showToast("Subscription Added!", "success");
            actions.openModal('subscriptions');
        };

actions.deleteSubscription = async function (id) {
            actions.showConfirm("Stop this subscription?", "Future auto-transactions will be cancelled.", async () => {
                state.data.subscriptions = state.data.subscriptions.filter(s => s.id !== id);
                await updateDb(); actions.openModal('subscriptions');
                actions.showToast("Subscription cancelled.", "success");
            });
        };

actions.renderTagsUI = function () {
            // Aggregate Tags
            let tagMap = {}; // { "#tag": { count, totalExpense, totalIncome } }
            state.data.transactions.forEach(t => {
                if (t.tags && t.tags.length > 0) {
                    t.tags.forEach(tag => {
                        let tName = tag.toLowerCase();
                        if (!tagMap[tName]) tagMap[tName] = { count: 0, totalExpense: 0, totalIncome: 0, txs: [] };
                        tagMap[tName].count++;
                        tagMap[tName].txs.push(t);
                        
                        // Approximate all values to global currency using rate
                        let amt = Number(t.amount);
                        const acc = state.data.accounts.find(a => a.id === t.accountId);
                        if (acc && acc.currency !== state.data.settings.currency) {
                            if (state.data.settings.currency === 'AED' && acc.currency === 'INR') amt = amt / state.data.settings.rate;
                            if (state.data.settings.currency === 'INR' && acc.currency === 'AED') amt = amt * state.data.settings.rate;
                        }

                        if (t.type === 'expense' || t.type === 'transfer_out') tagMap[tName].totalExpense += amt;
                        if (t.type === 'income' || t.type === 'transfer_in') tagMap[tName].totalIncome += amt;
                    });
                }
            });

            const tagsArray = Object.keys(tagMap).map(k => ({ name: k, ...tagMap[k] })).sort((a,b) => b.totalExpense - a.totalExpense);

            return FinzUI.html`
            <div class="max-w-4xl mx-auto space-y-6">
                <div class="flex flex-wrap gap-2 mb-6 justify-center">
                    ${tagsArray.map(t => FinzUI.html`
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.viewTagDetails(((t.name))) })}" class="text-slate-900 px-4 py-2 bg-slate-50 hover:bg-pink-50 hover:text-pink-600 rounded-xl border border-slate-200 text-xs font-black text-slate-600 transition-colors">
                            ${t.name} <span class="ml-1 opacity-50 font-normal">(${t.count})</span>
                        </button>
                    `).join('') || FinzUI.literal("<p class=\"text-xs font-bold text-slate-400\">No #tags found in any transactions yet.</p>")}
                </div>
                
                <div id="tag-detail-view" class="text-slate-900 bg-slate-50 rounded-[2.5rem] border border-slate-100 p-8 hidden text-center">
                    <!-- Tag specific UI injected here by viewTagDetails -->
                </div>
            </div>
            `;
        };

actions.viewTagDetails = function(tagName) {
            const v = document.getElementById('tag-detail-view');
            v.classList.remove('hidden');
            
            // Re-aggregate
            let txs = [];
            let exp = 0;
            let inc = 0;
            
            state.data.transactions.forEach(t => {
                if (t.tags && t.tags.map(x=>x.toLowerCase()).includes(tagName.toLowerCase())) {
                    txs.push(t);
                    let amt = Number(t.amount);
                    const acc = state.data.accounts.find(a => a.id === t.accountId);
                    if (acc && acc.currency !== state.data.settings.currency) {
                        if (state.data.settings.currency === 'AED' && acc.currency === 'INR') amt = amt / state.data.settings.rate;
                        if (state.data.settings.currency === 'INR' && acc.currency === 'AED') amt = amt * state.data.settings.rate;
                    }
                    if (t.type === 'expense' || t.type === 'transfer_out') exp += amt;
                    if (t.type === 'income' || t.type === 'transfer_in') inc += amt;
                }
            });

            txs.sort((a, b) => new Date(b.date) - new Date(a.date));

            FinzUI.setHTML(v, FinzUI.html`
                <div class="flex items-center justify-center space-x-3 mb-6">
                    <div class="w-12 h-12 bg-pink-100 text-pink-500 rounded-full flex items-center justify-center"><i data-lucide="hash" class="w-6 h-6"></i></div>
                    <h3 class="text-2xl font-black text-slate-900">${tagName}</h3>
                </div>
                <div class="grid grid-cols-2 gap-4 mb-8">
                    <div class="text-slate-900 bg-white p-4 rounded-3xl shadow-sm">
                        <p class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Spent</p>
                        <p class="text-xl font-black text-red-500 num-font">${state.data.settings.currency} ${exp.toFixed(2)}</p>
                    </div>
                    <div class="text-slate-900 bg-white p-4 rounded-3xl shadow-sm">
                        <p class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Earned</p>
                        <p class="text-xl font-black text-emerald-500 num-font">${state.data.settings.currency} ${inc.toFixed(2)}</p>
                    </div>
                </div>
                
                <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4 text-left ml-2">Recent Transactions</h4>
                <div class="space-y-2 max-h-[300px] overflow-y-auto no-scrollbar custom-scrollbar text-left pr-2">
                    ${txs.slice(0, 50).map(t => {
                        const isInc = t.type === 'income' || t.type === 'transfer_in';
                        return FinzUI.html`
                        <div class="text-slate-900 bg-white p-4 rounded-2xl flex justify-between items-center shadow-sm">
                            <div>
                                <p class="text-xs font-bold text-slate-800">${t.category || t.type}</p>
                                <p class="text-[9px] font-medium text-slate-400">${t.note}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-sm font-black ${isInc ? 'text-emerald-500' : 'text-slate-900'}">${isInc ? '+' : '-'} ${t.amount}</p>
                                <p class="text-[8px] font-black uppercase text-slate-400">${new Date(t.date).toLocaleDateString()}</p>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            `);
            lucide.createIcons();
        };

actions.calcSIP = function () {
            const P = parseFloat(document.getElementById('sip-amt').value);
            const r = parseFloat(document.getElementById('sip-rate').value) / 100 / 12;
            const n = parseFloat(document.getElementById('sip-years').value) * 12;

            const FV = P * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
            document.getElementById('sip-result').innerText = '₹' + Math.round(FV).toLocaleString();
        };

actions.runRealityCheck = function () {
            const r = state.data.settings.rate;

            // 1. Assets
            let assets = 0;
            state.data.accounts.forEach(a => assets += (a.currency === 'AED' ? Number(a.balance) : Number(a.balance) / r));

            // 2. Debts
            let debts = 0;
            state.data.debts.filter(d => !d.settled && d.type === 'payable').forEach(d => debts += (d.currency === 'AED' ? Number(d.amount) : Number(d.amount) / r));

            // Net Free = Assets - Debts
            const netFree = assets - debts;

            // Render Results
            const b = document.getElementById('modal-backdrop');
            const t = document.getElementById('modal-title');
            const c = document.getElementById('modal-content');

            t.innerText = "Financial Reality Check";
            FinzUI.setHTML(c, FinzUI.html`
            <div class="max-w-md mx-auto space-y-8 text-center py-6">
                <!--NET WORTH CARD-->
                <div class="bg-indigo-900 text-white p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
                    <div class="relative z-10">
                        <p class="text-[10px] text-indigo-300 font-black uppercase tracking-widest mb-2">Net Wealth</p>
                        <h2 class="text-5xl font-black text-white num-font mb-2">AED ${Math.round(netFree).toLocaleString()}</h2>
                        <p class="text-[10px] font-bold text-indigo-400">Total Assets - Total Liabilities</p>
                    </div>
                    <div class="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white to-transparent opacity-10"></div>
                </div>

                <!--BREAKDOWN -->
                <div class="grid grid-cols-2 gap-4">
                    <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm">
                        <p class="text-[9px] text-slate-400 font-black uppercase mb-2">Total Assets</p>
                        <p class="text-xl font-black text-emerald-600">AED ${Math.round(assets).toLocaleString()}</p>
                    </div>
                    <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm">
                        <p class="text-[9px] text-slate-400 font-black uppercase mb-2">Total Debt</p>
                        <p class="text-xl font-black text-red-500">-${Math.round(debts).toLocaleString()}</p>
                    </div>
                </div>



                <button data-finz-click="${FinzUI.handler(function(event) { actions.renderSettingsUI(); return actions.openModal('settings'); })}" class="text-slate-400 font-bold text-xs hover:text-slate-800 transition-colors uppercase">
                    Back to Settings
                </button>
            </div> `);

            b.classList.replace('hidden', 'flex');
            lucide.createIcons();
        };

actions.renderSettingsUI = function () {

            const s = state.data.settings;
            // Defaults
            const startDay = s.budgetStartDay || 1;
            const expRet = s.forecastReturn || 8;
            const infRate = s.inflationRate || 5;
            const alertLim = s.budgetAlertLimit || 80;
            const minRunway = s.minRunwayMonths || 6;

            return FinzUI.html`
            <div class="max-w-3xl mx-auto space-y-8 py-4 text-left">
                <!--Header -->
                <div class="text-center mb-8">
                    <h2 class="text-3xl font-black text-slate-900">App Settings</h2>
                    <p class="text-sm text-slate-500 font-medium mt-2">Customize your experience</p>
                </div>



                <!--1.5 REALITY CHECK-->
                <div class="bg-indigo-900 text-white p-6 rounded-[2.5rem] shadow-xl relative overflow-hidden text-center flex flex-col justify-center">
                    <div class="relative z-10">
                        <h4 class="text-[10px] font-black uppercase text-indigo-300 tracking-widest mb-4">Financial Reality Check</h4>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.runRealityCheck() })}" class="bg-indigo-500 hover:bg-indigo-400 text-white py-3 px-6 rounded-2xl font-black uppercase shadow-lg transition-all flex items-center justify-center gap-3 mx-auto text-xs">
                            <i data-lucide="eye" class="w-4 h-4"></i> Reveal Net Free Wealth
                        </button>
                    </div>
                </div>

                
                

                <!--2. BUDGET CYCLE & THRESHOLDS-->
                <div class="text-slate-900 bg-white p-8 rounded-[3rem] border shadow-sm">
                    <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 border-b pb-2">Budget & Safety Protocol</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <p class="text-[9px] font-bold text-emerald-600 uppercase mb-2">Payday Alignment</p>
                            <label class="text-slate-900 flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                                <span class="text-xs font-bold text-slate-700">Budget Start Day</span>
                                <input type="number" id="sets-day" min="1" max="28" value="${startDay}" class="text-slate-900 w-16 p-1 bg-white border rounded-lg text-center font-black text-sm outline-none focus:border-emerald-500">
                            </label>
                            <p class="text-[9px] text-slate-400 mt-2 leading-relaxed">Resets your "Days Left" and Budget Progress bars on this day of the month.</p>
                        </div>
                        <div>
                            <p class="text-[9px] font-bold text-amber-600 uppercase mb-2">Safety Thresholds</p>
                            <div class="space-y-3">
                                <label class="flex justify-between items-center">
                                    <span class="text-xs font-bold text-slate-600">Budget Alert (%)</span>
                                    <input type="number" id="sets-alert" value="${alertLim}" class="text-slate-900 w-16 p-2 bg-slate-50 border rounded-xl text-center font-bold text-xs">
                                </label>
                                <label class="flex justify-between items-center">
                                    <span class="text-xs font-bold text-slate-600">Min Runway (Mo)</span>
                                    <input type="number" id="sets-runway" value="${minRunway}" class="text-slate-900 w-16 p-2 bg-slate-50 border rounded-xl text-center font-bold text-xs">
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!--3. CURRENCY-->
                <div class="grid grid-cols-1 gap-6"> 
                    <div class="bg-slate-800/50 p-6 rounded-[2.5rem] border border-slate-700/50 flex flex-col justify-center text-center shadow-lg">
                        <p class="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-4">Base Conversion Rate</p>
                        <div class="flex items-center justify-center space-x-3 text-2xl font-black text-white">
                            <span class="text-base text-slate-400">1 AED =</span>
                            <input type="number" id="sr" step="0.01" value="${state.data.settings.rate}" class="w-32 p-3 bg-slate-900/80 border border-slate-700 rounded-xl text-center outline-none focus:border-rose-500 focus:ring-1 ring-rose-500/50 text-white num-font [&::-webkit-inner-spin-button]:appearance-none appearance-none">
                            <span class="text-base text-slate-400">INR</span>
                        </div>
                    </div>
                </div>
                
                <p class="text-sm text-slate-400">WhatsApp reminders open a draft. Review it and press Send in WhatsApp. No messaging API is used.</p>
                <!--3.6 MESSAGE TEMPLATES -->
                <div class="bg-slate-800/50 p-6 rounded-[3rem] border border-slate-700/50 shadow-lg flex flex-col justify-center text-center">
                    <div class="flex items-center justify-center gap-2 mb-6">
                        <i data-lucide="file-text" class="w-4 h-4 text-rose-400"></i>
                        <p class="text-[10px] font-black text-rose-400 uppercase tracking-widest">Message Templates</p>
                    </div>
                    
                    <p class="text-[9px] font-bold text-slate-400 uppercase text-left ml-1 mb-2 mt-2">Reminder Message Template</p>
                    <textarea id="sets-tpl-reminder" rows="2" class="w-full p-4 bg-slate-900/80 border border-slate-700 rounded-xl font-bold text-xs text-white outline-none focus:border-rose-500 mb-6 placeholder-slate-600" placeholder="e.g. Hi {name}, just a quick reminder about the {amount} for {note}.">${state.data.settings.tplReminder || 'Hi {name}, just a quick reminder about the {amount}. Let me know if you need any info!'}</textarea>

                    <p class="text-[9px] font-bold text-slate-400 uppercase text-left ml-1 mb-2">Payment Sent Template</p>
                    <textarea id="sets-tpl-payment" rows="2" class="w-full p-4 bg-slate-900/80 border border-slate-700 rounded-xl font-bold text-xs text-white outline-none focus:border-rose-500 mb-4 placeholder-slate-600" placeholder="e.g. Hi {name}, I have sent {amount} for {note}. Thanks!">${state.data.settings.tplPayment || 'Hi {name}, I have transferred {amount} to you. Thanks!'}</textarea>
                    
                    <p class="text-[8px] text-slate-500 font-bold leading-relaxed">Variables available: {name}, {amount}, {currency}, {note}</p>
                </div>



                                <!--5. 3-PILLAR & INCOME CATEGORY MANAGEMENT-->
                <div class="bg-slate-800/50 p-6 md:p-8 rounded-[3rem] border border-slate-700/50 shadow-lg text-left">
                    <div class="flex justify-between items-center mb-6">
                        <div>
                            <h4 class="text-xs font-black text-emerald-400 uppercase tracking-widest">3-Pillar Categories & Future Funds</h4>
                            <p class="text-[10px] font-bold text-slate-400 mt-0.5">Manage Living Expenses, Savings/Sinking Funds (Wedding, Car, etc.), Investments, and Income</p>
                        </div>
                    </div>

                    <!-- Add New Category -->
                    <div class="bg-slate-900/80 p-4 rounded-2xl border border-slate-700 mb-6 flex flex-col md:flex-row gap-2.5">
                        <input type="text" id="settings-new-cat" class="flex-1 bg-slate-900 border border-slate-700 text-white p-3 rounded-xl font-bold text-xs outline-none focus:border-emerald-500 placeholder-slate-500" placeholder="New Category (e.g. Wedding Fund, Car Fund, Sarwa)...">
                        <select id="settings-new-type" class="bg-slate-900 border border-slate-700 text-white p-3 rounded-xl text-xs font-bold outline-none">
                            <option value="expenseCategories">🛒 Living Expense</option>
                            <option value="savingsCategories">🛡️ Savings & Sinking Fund</option>
                            <option value="investmentCategories">📈 Investment</option>
                            <option value="incomeCategories">💵 Income Source</option>
                        </select>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.addWizardCategory() })}" class="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-3 rounded-xl font-black text-xs uppercase flex items-center justify-center gap-1 shrink-0 shadow-lg shadow-emerald-500/20">
                            <i data-lucide="plus" class="w-4 h-4"></i> Add
                        </button>
                    </div>

                    <!-- Category Lists Grid -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <!-- Pillar 1: Living Expenses -->
                        <div class="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/40">
                            <div class="flex justify-between items-center mb-3">
                                <p class="text-[10px] font-black uppercase text-rose-400 tracking-wider flex items-center gap-1">
                                    <i data-lucide="shopping-bag" class="w-3.5 h-3.5"></i> Living (${(state.data.expenseCategories || []).length})
                                </p>
                            </div>
                            <div class="space-y-2 max-h-56 overflow-y-auto no-scrollbar pr-1">
                                ${(state.data.expenseCategories || []).map(c => FinzUI.html`
                                    <div class="flex justify-between items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/50 text-xs text-white">
                                        <span class="font-bold truncate mr-1">${c}</span>
                                        <div class="flex items-center gap-1 shrink-0">
                                            <select data-finz-change="${FinzUI.handler(function(event) { return actions.setCategoryPillar(((c)), 'expense', this.value) })}" class="bg-slate-800 border border-slate-700 text-[9px] text-slate-300 rounded p-1 font-bold outline-none">
                                                <option value="expense" selected>Living</option>
                                                <option value="savings">Savings</option>
                                                <option value="investment">Invest</option>
                                            </select>
                                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteCategory(((c))) })}" title="Delete" class="text-slate-500 hover:text-rose-400 p-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                                        </div>
                                    </div>
                                `).join('') || FinzUI.literal("<p class=\"text-[10px] text-slate-500 py-2\">No categories</p>")}
                            </div>
                        </div>

                        <!-- Pillar 2: Savings & Sinking Funds -->
                        <div class="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/40">
                            <div class="flex justify-between items-center mb-3">
                                <p class="text-[10px] font-black uppercase text-emerald-400 tracking-wider flex items-center gap-1">
                                    <i data-lucide="shield" class="w-3.5 h-3.5"></i> Savings & Goals (${(state.data.savingsCategories || []).length})
                                </p>
                            </div>
                            <div class="space-y-2 max-h-56 overflow-y-auto no-scrollbar pr-1">
                                ${(state.data.savingsCategories || []).map(c => FinzUI.html`
                                    <div class="flex justify-between items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/50 text-xs text-white">
                                        <span class="font-bold truncate mr-1">${c}</span>
                                        <div class="flex items-center gap-1 shrink-0">
                                            <select data-finz-change="${FinzUI.handler(function(event) { return actions.setCategoryPillar(((c)), 'savings', this.value) })}" class="bg-slate-800 border border-slate-700 text-[9px] text-slate-300 rounded p-1 font-bold outline-none">
                                                <option value="expense">Living</option>
                                                <option value="savings" selected>Savings</option>
                                                <option value="investment">Invest</option>
                                            </select>
                                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteCategory(((c))) })}" title="Delete" class="text-slate-500 hover:text-rose-400 p-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                                        </div>
                                    </div>
                                `).join('') || FinzUI.literal("<p class=\"text-[10px] text-slate-500 py-2\">No savings funds</p>")}
                            </div>
                        </div>

                        <!-- Pillar 3: Investments -->
                        <div class="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/40">
                            <div class="flex justify-between items-center mb-3">
                                <p class="text-[10px] font-black uppercase text-indigo-400 tracking-wider flex items-center gap-1">
                                    <i data-lucide="trending-up" class="w-3.5 h-3.5"></i> Investments (${(state.data.investmentCategories || []).length})
                                </p>
                            </div>
                            <div class="space-y-2 max-h-56 overflow-y-auto no-scrollbar pr-1">
                                ${(state.data.investmentCategories || []).map(c => FinzUI.html`
                                    <div class="flex justify-between items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/50 text-xs text-white">
                                        <span class="font-bold truncate mr-1">${c}</span>
                                        <div class="flex items-center gap-1 shrink-0">
                                            <select data-finz-change="${FinzUI.handler(function(event) { return actions.setCategoryPillar(((c)), 'investment', this.value) })}" class="bg-slate-800 border border-slate-700 text-[9px] text-slate-300 rounded p-1 font-bold outline-none">
                                                <option value="expense">Living</option>
                                                <option value="savings">Savings</option>
                                                <option value="investment" selected>Invest</option>
                                            </select>
                                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteCategory(((c))) })}" title="Delete" class="text-slate-500 hover:text-rose-400 p-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                                        </div>
                                    </div>
                                `).join('') || FinzUI.literal("<p class=\"text-[10px] text-slate-500 py-2\">No investments</p>")}
                            </div>
                        </div>
                    </div>

                    <!-- Income Sources Row -->
                    <div class="mt-4 pt-4 border-t border-slate-700/50">
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2">💵 Income Sources (${(state.data.incomeCategories || []).length})</p>
                        <div class="flex flex-wrap gap-2">
                            ${(state.data.incomeCategories || []).map(c => FinzUI.html`
                                <div class="inline-flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-700/50 text-xs text-white">
                                    <span class="font-bold">${c}</span>
                                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.deleteCategory(((c))) })}" class="text-slate-500 hover:text-rose-400"><i data-lucide="trash-2" class="w-3 h-3"></i></button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <!--6. MERGE TOOL(New)-->
                <div class="bg-slate-800/50 p-8 rounded-[3rem] border border-slate-700/50 text-center shadow-lg mt-8">
                    <h4 class="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-6">Merge Categories</h4>
                    <div class="flex flex-col md:flex-row items-center justify-center gap-4 mb-4">
                        <select id="merge-src" class="p-3 border border-slate-700 bg-slate-900/80 rounded-xl font-bold text-xs w-full md:w-48 text-white outline-none focus:border-rose-500">
                            <option value="">Source Category...</option>
                            ${[...state.data.incomeCategories, ...state.data.expenseCategories].map(c => FinzUI.html`<option value="${c}">${c}</option>`).join('')}
                        </select>
                        <i data-lucide="arrow-right" class="w-4 h-4 text-slate-500 hidden md:block"></i>
                        <select id="merge-target" class="p-3 border border-slate-700 bg-slate-900/80 rounded-xl font-bold text-xs w-full md:w-48 text-white outline-none focus:border-rose-500">
                            <option value="">Target Category...</option>
                            ${[...state.data.incomeCategories, ...state.data.expenseCategories].map(c => FinzUI.html`<option value="${c}">${c}</option>`).join('')}
                        </select>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.mergeCategories() })}" class="bg-rose-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-[0_0_10px_rgba(244,63,94,0.3)] hover:scale-105 transition-transform">Merge</button>
                    </div>
                    <p class="text-[9px] text-slate-400 font-bold">Warning: This moves all transactions from Source to Target and deletes Source.</p>
                </div>

                <!--7. DATA ACTIONS-->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                    <div class="bg-slate-800/50 p-6 rounded-[2.5rem] text-center border border-slate-700/50 shadow-lg">
                        <p class="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-4">Data Management</p>
                        <div class="flex justify-center gap-4">
                            <button data-finz-click="${FinzUI.handler(function(event) { return actions.exportBackup() })}" class="flex items-center gap-2 bg-slate-900/80 border border-slate-700 text-slate-300 px-5 py-3 rounded-xl font-bold text-[10px] uppercase hover:text-rose-400 hover:border-rose-500/50 transition-all">
                                <i data-lucide="download" class="w-4 h-4"></i> Backup
                            </button>
                            <label class="flex items-center gap-2 bg-rose-600 text-white px-5 py-3 rounded-xl font-bold text-[10px] uppercase shadow-[0_0_10px_rgba(244,63,94,0.3)] hover:scale-105 cursor-pointer transition-all">
                                <i data-lucide="upload" class="w-4 h-4"></i> Restore
                                <input type="file" class="hidden" data-finz-change="${FinzUI.handler(function(event) { return actions.importBackup(this) })}">
                            </label>
                        </div>
                    </div>
                     <div class="bg-rose-950/30 p-6 rounded-[2.5rem] border border-rose-900/50 text-center flex flex-col justify-center shadow-lg">
                        <p class="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-3">Zone of Danger</p>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.resetBudgetSystem() })}" class="bg-amber-600 text-white px-6 py-3 rounded-xl font-black uppercase text-xs shadow-lg hover:bg-amber-500 active:scale-95 transition-all text-center mx-auto mb-3 w-full border border-amber-500/50">
                            Reset Budget Allocations
                        </button>
                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.resetData() })}" class="bg-red-600 text-white px-6 py-3 rounded-xl font-black uppercase text-xs shadow-[0_0_15px_rgba(220,38,38,0.4)] hover:bg-red-500 active:scale-95 transition-all text-center mx-auto w-full border border-red-500/50">
                            Reset Entire System
                        </button>
                    </div>
                </div>

                <!--MAIN SAVE ACTION-->
            <div class="pt-6 mt-4 pb-2">
                <button data-finz-click="${FinzUI.handler(function(event) { return actions.saveSettings() })}" class="w-full bg-slate-900 text-white p-5 rounded-[2rem] font-black shadow-2xl hover:shadow-emerald-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-3">
                    <i data-lucide="check-circle" class="w-5 h-5"></i> Save Changes
                </button>
            </div>
            </div> `;
        };

actions.previewTheme = function (t) {
            state.data.settings.theme = t;
            actions.applyTheme(t);
            // Optimization: Don't re-render entire UI, just apply CSS vars.
            // Rings update automatically via CSS state but we might need to manually toggle classes if performance is key.
            // For now, removing renderSettingsUI() prevents the big lag.
        }

actions.saveSettings = async function () {
            const r = parseFloat(document.getElementById('sr').value);
            if (isNaN(r)) return;
            state.data.settings.rate = r;

            // New Advanced Settings
            state.data.settings.budgetStartDay = parseInt(document.getElementById('sets-day').value) || 1;
            const retEl = document.getElementById('sets-ret');
            if (retEl) state.data.settings.forecastReturn = parseFloat(retEl.value) || 8;
            const infEl = document.getElementById('sets-inf');
            if (infEl) state.data.settings.inflationRate = parseFloat(infEl.value) || 5;
            state.data.settings.budgetAlertLimit = parseFloat(document.getElementById('sets-alert').value) || 80;
            state.data.settings.minRunwayMonths = parseFloat(document.getElementById('sets-runway').value) || 6;

            // Messaging Infrastructure
            
            // Templates
            const tplRem = document.getElementById('sets-tpl-reminder');
            if (tplRem) state.data.settings.tplReminder = tplRem.value;
            const tplPay = document.getElementById('sets-tpl-payment');
            if (tplPay) state.data.settings.tplPayment = tplPay.value;

            // Theme is already set in state via previewTheme, just persisting now.



            await updateDb();
            actions.showToast("✅ Settings Updated Successfully", "success");
            actions.renderApp();
        };

actions.mergeCategories = async function () {
            const src = document.getElementById('merge-src').value;
            const tgt = document.getElementById('merge-target').value;
            if (!src || !tgt) { actions.showToast("Please select both a source and target category.", "error"); return; }
            if (src === tgt) { actions.showToast("Source and Target cannot be the same.", "error"); return; }

            actions.showConfirm(
                "⚠? MERGE CATEGORIES?",
                `This will move ALL transactions from '${src}' to '${tgt}'.\n\n'${src}' will be permanently deleted.`,
                async () => {
                    // 1. Update Transactions
                    let count = 0;
                    state.data.transactions.forEach(t => {
                        if (t.category === src) {
                            t.category = tgt;
                            count++;
                        }
                    });

                    // 2. Merge Budgets
                    if (state.data.budgets && state.data.budgets[src]) {
                        const srcB = state.data.budgets[src] || 0;
                        state.data.budgets[tgt] = (state.data.budgets[tgt] || 0) + srcB;
                        delete state.data.budgets[src];
                    }

                    // 3. Delete Category from List
                    state.data.expenseCategories = state.data.expenseCategories.filter(c => c !== src);
                    state.data.incomeCategories = state.data.incomeCategories.filter(c => c !== src); // Check both just in case

                    await updateDb();
                    actions.showToast(`✅ Merged ${count} transactions from '${src}' to '${tgt}'.`, "success");
                    actions.renderSettingsUI(); // Refresh UI
                    actions.renderApp();
                }
            );
        };

actions.resetData = async function () {
            actions.showConfirm(
                "⚠? DANGER ZONE ⚠?",
                "This will permanently delete ALL accounts, transactions, and settings.\n\nAre you sure you want to reset everything?",
                async () => {
                    try {
                        // Reset to defaults
                        state.data = {
                            accounts: [],
                            transactions: [],
                            debts: [],
                            budgets: {},
                            settings: { rate: 22.75 },
                            incomeCategories: ['Salary', 'Bonus', 'Investment Return', 'Other'],
                            expenseCategories: ['Rent', 'Food', 'Utilities', 'Investment', 'Family', 'Other'],
                            assetTypes: ['Bank Account', 'Cash', 'Savings', 'Emergency Fund', 'Investment']
                        };

                        await updateDb();
                        actions.showToast("System Reset Complete", "success");
                        setTimeout(() => window.location.reload(), 1000); // Force reload to ensure clean state
                    } catch (error) {
                        console.error("Reset failed:", error);
                        actions.showToast("Reset failed: " + error.message, "error");
                    }
                }
            );
        };

actions.renderFinancialHealth = function () {
            const r = state.data.settings?.rate || 22.75;
            
            // 1. Calc Monthly Fixed Debt Obligations
            let monthlyDebt = 0;
            let activePayableCount = 0;

            // BNPLs (Monthly payments)
            (state.data.debts || []).filter(d => (d.isBnpl || d.subtype === 'bnpl') && !d.settled).forEach(d => {
                const next = (d.schedule || []).find(s => !s.paid);
                if (next) {
                    monthlyDebt += (parseFloat(next.amount) * (d.currency === 'AED' ? 1 : (1 / r)));
                    activePayableCount++;
                } else if (d.currentAmount || d.amount) {
                    monthlyDebt += (parseFloat(d.currentAmount || d.amount) * (d.currency === 'AED' ? 1 : (1 / r)));
                    activePayableCount++;
                }
            });

            // Personal Borrowings (Payables)
            (state.data.debts || []).filter(d => !d.isBnpl && d.subtype !== 'bnpl' && d.type === 'payable' && !d.settled).forEach(d => {
                const amt = parseFloat(d.amount) || 0;
                monthlyDebt += (amt * (d.currency === 'AED' ? 1 : (1 / r)));
                activePayableCount++;
            });

            // 2. Calc Income (Salary Setting, Recent Income, or Fallback)
            let income = parseFloat(state.data.settings?.expectedSalary) || 0;
            if (income === 0) {
                const now = new Date();
                const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                const recentInc = (state.data.transactions || []).filter(t => t.type === 'income' && new Date(t.date) >= d30).reduce((s, t) => s + (parseFloat(t.amount) * (t.currency === 'AED' ? 1 : 1 / r)), 0);
                income = recentInc > 0 ? recentInc : 15000;
            }

            const dti = income > 0 ? (monthlyDebt / income) * 100 : 0;

            let zone = 'Healthy (Debt Free)';
            let color = 'emerald';
            if (monthlyDebt > 0) {
                if (dti <= 20) { zone = 'Low Debt Load'; color = 'emerald'; }
                else if (dti <= 35) { zone = 'Moderate Burden'; color = 'amber'; }
                else { zone = 'High Debt Alert'; color = 'rose'; }
            }

            const isDebtFree = monthlyDebt <= 0.01;

            return FinzUI.html`
                <div class="mb-6 bg-slate-900 rounded-[2.5rem] p-6 text-white relative overflow-hidden text-center shadow-lg border border-slate-800">
                    <div class="relative z-10 flex justify-between items-center">
                        <div class="text-left">
                            <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Debt-to-Income Health</p>
                            <h2 class="text-2xl font-black ${color === 'emerald' ? 'text-emerald-400' : (color === 'amber' ? 'text-amber-400' : 'text-rose-400')} num-font">
                                ${dti.toFixed(1)}% <span class="text-xs text-white opacity-70 font-sans font-bold">(${isDebtFree ? 'Debt Free' : zone})</span>
                            </h2>
                            <p class="text-[9px] text-slate-400 font-bold mt-1">
                                ${isDebtFree ? 'Monthly Obligations: AED 0 • No active liabilities' : `Monthly Obligations: AED ${Math.round(monthlyDebt).toLocaleString()} (${activePayableCount} active)`}
                            </p>
                        </div>
                        
                        <!-- Gauge Visual -->
                        <div class="w-16 h-16 relative shrink-0">
                            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#1e293b" stroke-width="4" />
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${isDebtFree ? '#10b981' : (color === 'emerald' ? '#10b981' : (color === 'amber' ? '#f59e0b' : '#f43f5e'))}" stroke-width="4" stroke-dasharray="${isDebtFree ? 100 : Math.min(100, Math.round(dti))}, 100" stroke-linecap="round" />
                            </svg>
                            <div class="absolute inset-0 flex items-center justify-center">
                                <i data-lucide="${color === 'rose' ? 'alert-triangle' : 'shield-check'}" class="w-6 h-6 ${color === 'rose' ? 'text-rose-400' : 'text-emerald-400'}"></i>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        };

actions.renderPaymentTimeline = function (bnplOnly = false) {
            const upcoming = state.data.debts
                .filter(d => !d.settled && (d.type === 'payable' || d.isBnpl))
                .filter(d => !bnplOnly || d.isBnpl)
                .flatMap(d => {
                    if (d.isBnpl) {
                        return d.schedule.filter(s => !s.paid).map(s => ({
                            date: s.date || s.dueDate, // FIX: Support both schemas
                            name: d.party,
                            amount: s.amount,
                            currency: d.currency,
                            type: 'bnpl'
                        }));
                    } else {
                        return [{ date: d.repaymentDate, name: d.party, amount: d.amount, currency: d.currency, type: 'personal' }];
                    }
                })
                .filter(x => x.date && new Date(x.date) >= new Date().setHours(0, 0, 0, 0))
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .slice(0, 15); // Show more items

            if (upcoming.length === 0) return '';

            return FinzUI.html`
                <div class="mb-8">
                    <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3 ml-2">Payment Timeline</h4>
                    <div class="flex gap-3 overflow-x-auto no-scrollbar pb-4 snap-x hide-scrollbar">
                        ${upcoming.map(u => {
                const d = new Date(u.date);
                const day = d.getDate();
                const month = d.toLocaleString('default', { month: 'short' });
                return FinzUI.html`
                                <div class="text-slate-900 min-w-[100px] bg-white p-3 rounded-2xl border border-slate-100 shadow-sm snap-start flex-shrink-0 text-center relative overflow-hidden">
                                     <div class="absolute top-0 left-0 w-full h-1 ${u.type === 'bnpl' ? 'bg-indigo-500' : 'bg-rose-500'}"></div>
                                     <p class="text-[10px] font-bold text-slate-400 uppercase mb-1">${month}</p>
                                     <h3 class="text-xl font-black text-slate-800 leading-none mb-1">${day}</h3>
                                     <p class="text-[9px] font-black text-slate-600 truncate w-full">${u.name}</p>
                                     <p class="text-[9px] font-bold text-slate-400 mt-1">${u.amount}</p>
                                </div>
                            `;
            }).join('')}
                    </div>
                </div>
            `;
        };

actions.togglePersonDetails = function (unsafeName) {
            // Encode/Decode to handle spaces/special chars in IDs safely
            // Simpler: use a comprehensive replace for valid ID
            const safeId = unsafeName.replace(/[^a-zA-Z0-9]/g, '_');
            const el = document.getElementById(`p-det-${safeId}`);
            if (el) {
                el.classList.toggle('hidden');
                // Rotate chevron if exists
                const chev = document.getElementById(`chev-${safeId}`);
                if (chev) chev.classList.toggle('rotate-180');
            }
        };

actions.renderActionRequired = function () {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // User Filter: "Show only amount which is due for TODAY"
            const todayStr = today.toDateString();

            const dueItems = [];

            // 1. BNPL Installments
            state.data.debts.filter(d => d.isBnpl && !d.settled).forEach(d => {
                const pending = d.schedule.find(s => !s.paid);
                if (pending) {
                    // Check date or dueDate
                    const dStr = pending.date ? new Date(pending.date).toDateString() : (pending.dueDate ? new Date(pending.dueDate).toDateString() : '');
                    if (dStr === todayStr) {
                        dueItems.push({
                            type: 'BNPL',
                            name: d.party,
                            amount: pending.amount,
                            currency: d.currency,
                            date: 'TODAY',
                            id: d.id,
                            idx: d.schedule.indexOf(pending),
                            isBnpl: true
                        });
                    }
                }
            });

            // 2. Personal Debts (Modified for 1-Day Advance Notice)
            state.data.debts.filter(d => !d.isBnpl && d.type === 'payable' && !d.settled).forEach(d => {
                const dDate = new Date(d.repaymentDate);
                const dStr = dDate.toDateString();

                // Calculate Tomorrow
                const uniqueTomorrow = new Date();
                uniqueTomorrow.setDate(uniqueTomorrow.getDate() + 1);
                const tomorrowStr = uniqueTomorrow.toDateString();

                if (dStr === tomorrowStr || dStr === todayStr) {
                    const label = dStr === todayStr ? 'TODAY' : 'TOMORROW';
                    dueItems.push({ type: 'Debt', name: d.party, amount: d.amount, currency: d.currency, date: label, id: d.id, isBnpl: false });
                }
            });

            if (dueItems.length === 0) return '';

            return FinzUI.html`<div class="bg-rose-50 p-6 rounded-[2.5rem] border border-rose-100 mb-8 shadow-sm text-left">
                <div class="flex items-center gap-2 mb-4">
                    <i data-lucide="siren" class="w-5 h-5 text-rose-500 animate-pulse"></i>
                    <h4 class="text-[10px] font-black uppercase text-rose-400 tracking-widest">Action Required</h4>
                </div>
                <div class="space-y-3">
                    ${dueItems.map(a => FinzUI.html`
                        <div class="text-slate-900 bg-white p-4 rounded-2xl border border-rose-100 flex justify-between items-center shadow-sm">
                            <div>
                                <p class="text-[9px] font-bold text-rose-400 uppercase mb-0.5">${a.type} • Due ${a.date}</p>
                                <p class="font-black text-slate-800 text-sm">${a.name}</p>
                                <p class="text-xs font-bold text-slate-500">${a.amount} ${a.currency}</p>
                            </div>
                            <div>
                                ${a.isBnpl ?
                    FinzUI.html`<button data-finz-click="${FinzUI.handler(function(event) { return actions.settleInstallment(((a.id)), (a.idx)) })}" class="px-3 py-1.5 bg-rose-500 text-white rounded-lg font-black text-[10px] uppercase shadow-md active:scale-95">Settle</button>` :
                    FinzUI.html`<button data-finz-click="${FinzUI.handler(function(event) { return actions.openSettleFlow(((a.id))) })}" class="px-3 py-1.5 bg-rose-500 text-white rounded-lg font-black text-[10px] uppercase shadow-md active:scale-95">Pay</button>`}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        };

actions.generatePDF = function () {
            const { jsPDF } = libraries.jspdf;
            const doc = new jsPDF();
            const r = state.data.settings.rate;

            // -- HEADER --
            doc.setFontSize(22);
            doc.setFont("helvetica", "bold");
            doc.text("Financial Statement", 105, 20, null, null, "center");

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(100);
            doc.text(`Generated on ${new Date().toLocaleDateString()} | FINSHAANIREE Wealth Hub`, 105, 26, null, null, "center");

            // -- SUMMARY --
            let totalAssets = 0, totalLiabilities = 0;
            state.data.accounts.forEach(a => totalAssets += (a.currency === 'AED' ? a.balance * r : a.balance));
            state.data.debts.forEach(d => {
                if (!d.settled) {
                    const val = Number(d.amount) * (d.currency === 'AED' ? r : 1);
                    if (d.type === 'payable') totalLiabilities += val;
                    else totalAssets += val;
                }
            });
            const netWorth = totalAssets - totalLiabilities;

            doc.setFillColor(248, 250, 252); // slate-50
            doc.roundedRect(14, 35, 182, 30, 3, 3, 'F');

            doc.setTextColor(0);
            doc.setFontSize(10);
            doc.text("Total Net Worth", 105, 45, null, null, "center");
            doc.setFontSize(24);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(16, 185, 129); // emerald-500
            doc.text(`INR ${Math.round(netWorth).toLocaleString()} `, 105, 58, null, null, "center");

            // -- ASSETS TABLE --
            doc.setTextColor(0);
            doc.setFontSize(14);
            doc.text("Asset Holdings", 14, 80);

            const assetRows = state.data.accounts.map(a => [
                a.name,
                a.type,
                `${a.currency} ${a.balance.toLocaleString()} `,
                `INR ${Math.round(a.currency === 'AED' ? a.balance * r : a.balance).toLocaleString()} `
            ]);

            doc.autoTable({
                startY: 85,
                head: [['Asset Name', 'Type', 'Native Balance', 'INR Value']],
                body: assetRows,
                theme: 'grid',
                headStyles: { fillColor: [15, 23, 42] }, // slate-900
                styles: { fontSize: 9 }
            });

            // -- RECENT TRANSACTIONS --
            const finalY = doc.lastAutoTable.finalY + 15;
            doc.setFontSize(14);
            doc.text("Recent Ledger Activity (Last 20)", 14, finalY);

            const txRows = state.data.transactions
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, 20)
                .map(t => [
                    new Date(t.date).toLocaleDateString(),
                    t.category || t.type,
                    t.note || '-',
                    `${t.type.includes('income') || t.type === 'transfer_in' ? '+' : '-'} ${parseFloat(t.amount).toLocaleString()} `
                ]);

            doc.autoTable({
                startY: finalY + 5,
                head: [['Date', 'Category', 'Note', 'Amount']],
                body: txRows,
                theme: 'striped',
                headStyles: { fillColor: [100, 116, 139] },
                styles: { fontSize: 8 }
            });

            doc.save(`FI_SHAANIRE_Statement_${new Date().toISOString().split('T')[0]}.pdf`);
        };

actions.toggleFixedCat = async function (cat) {
            if (!state.data.fixedCategories) state.data.fixedCategories = [];
            if (state.data.fixedCategories.includes(cat)) {
                state.data.fixedCategories = state.data.fixedCategories.filter(c => c !== cat);
            } else {
                state.data.fixedCategories.push(cat);
            }
            await updateDb();
            actions.openModal('settings');
        };

actions.handleLogin = function () {
            const e = document.getElementById('login-email').value, p = document.getElementById('login-pass').value;
            signInWithEmailAndPassword(auth, e, p).catch(() => {
                const msg = document.getElementById('auth-error-msg');
                if (msg) { msg.innerText = "Invalid credentials."; msg.classList.remove('hidden'); }
            });
        };

actions.handleRegister = function () {
            const e = document.getElementById('login-email').value, p = document.getElementById('login-pass').value;
            createUserWithEmailAndPassword(auth, e, p).catch(() => alert("Registry failed."));
        };

actions.toggleVisibility = function () { state.data.settings.isPrivate = !state.data.settings.isPrivate; updateDb().then(renderApp); };

actions.svS = async function () {
            // Save Currency Rate
            const r = parseFloat(document.getElementById('sr').value);
            if (!isNaN(r)) state.data.settings.rate = r;

            // Save Commodity Rates
            if (!state.data.commodityRates) state.data.commodityRates = {};
            if (!state.data.commodityRatesAED) state.data.commodityRatesAED = {};
            ['Gold', 'Silver'].forEach(metal => {
                const elInr = document.getElementById('rate-' + metal);
                if (elInr) state.data.commodityRates[metal] = parseFloat(elInr.value) || 0;

                const elAed = document.getElementById('rate-aed-' + metal);
                if (elAed) state.data.commodityRatesAED[metal] = parseFloat(elAed.value) || 0;
            });

            await updateDb();
            actions.renderApp(); // Re-render to update asset values
            closeModal();
        };

actions.toggleTradeFields = function () {
            actions.updateTransferUI();
        };

actions.calcRemit = function (v) {
            actions.calcTransferEstimate('send');
        };

actions.onTxAccountChange = function () {
            const aId = document.getElementById('ta')?.value;
            const account = state.data.accounts.find(a => a.id === aId);
            const excludeEl = document.getElementById('tx-exclude-budget');
            if (account && excludeEl) {
                if (['Savings', 'Emergency Fund'].includes(account.type)) {
                    excludeEl.checked = true;
                } else {
                    excludeEl.checked = false;
                }
            }
            if (typeof actions.checkBudgetWarning === 'function') actions.checkBudgetWarning();
        };

actions.setT = function (t) {
            document.getElementById('tt').value = t;
            const list = t === 'income' ? state.data.incomeCategories : state.data.expenseCategories;
            const select = document.getElementById('tc');
            if (select) FinzUI.setHTML(select, list.map(c => FinzUI.html`<option value="${c}">${c}</option>`).join(''));
            const be = document.getElementById('be');
            const bi = document.getElementById('bi');
            const excludeContainer = document.getElementById('tx-exclude-budget-container');
            if (be && bi) {
                if (t === 'expense') {
                    be.className = "p-4 rounded-2xl border-2 border-rose-500 bg-rose-600 text-white font-black text-xs uppercase shadow-lg shadow-rose-600/30 transition-all";
                    bi.className = "p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-slate-400 font-black text-xs uppercase hover:text-slate-200 transition-all";
                    if (excludeContainer) excludeContainer.classList.remove('hidden');
                } else {
                    bi.className = "p-4 rounded-2xl border-2 border-emerald-500 bg-emerald-600 text-white font-black text-xs uppercase shadow-lg shadow-emerald-600/30 transition-all";
                    be.className = "p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-slate-400 font-black text-xs uppercase hover:text-slate-200 transition-all";
                    if (excludeContainer) excludeContainer.classList.add('hidden');
                }
            }
            if (typeof actions.checkBudgetWarning === 'function') actions.checkBudgetWarning();
        };

actions.generateSmartInsights = function () {
            const insights = [];
            const r = state.data.settings.rate;
            const now = new Date();
            const dayOfMonth = now.getDate();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const monthProgress = dayOfMonth / daysInMonth;

            // 1. BUDGET PACING ALERTS
            state.data.expenseCategories.forEach(cat => {
                const budget = state.data.budgets[cat] || 0;
                if (budget > 0) {
                    // Calc spent this month
                    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
                    const spent = state.data.transactions
                        .filter(t => t.type === 'expense' && t.category === cat && !t.excludeFromBudget && new Date(t.date) >= mStart)
                        .reduce((s, t) => {
                            const cur = t.currency || (state.data.accounts.find(a => a.id === t.accountId)?.currency) || 'AED';
                            return s + (Number(t.amount) * (cur === 'AED' ? 1 : (1 / r))); // Budget is usually tracked in primary currency (AED assumed base here for budget input, or matched. Let's assume budgets are set in AED as per UI labels)
                            // Logic correction: Budgets input label says "Limits (AED)". So we convert everything to AED.
                        }, 0);

                    const spentPct = spent / budget;
                    // Trigger: Spent % is 15% higher than Month %
                    if (spentPct > (monthProgress + 0.15) && spentPct < 1.0) {
                        insights.push({
                            type: 'warning',
                            icon: 'alert-triangle',
                            text: FinzUI.html`Slow down on <b> ${cat}</b> !You've used ${Math.round(spentPct * 100)}% of budget, but month is only ${Math.round(monthProgress * 100)}% done.`
                        });
                    } else if (spentPct >= 1.0) {
                        insights.push({
                            type: 'danger',
                            icon: 'x-octagon',
                            text: FinzUI.html`<b>${cat}</b> budget exceeded by ${Math.round((spentPct - 1) * 100)}%. Stop spending here!`
                        });
                    }
                }
            });

            // 2. ASSET PERFORMANCE (Simple Check)
            // Check if Investments/Gold have grown (Mock check as we don't have historical valuation snapshots yet)
            // We can check if today's commodity rate is high vs average? Or just a random encouragement if wealth is high?
            // Let's use a simple "Wealth Milestone" check
            const totalWealthAED = state.data.accounts.reduce((s, a) => s + (a.currency === 'AED' ? a.balance : a.balance / r), 0);
            if (totalWealthAED > 100000) {
                insights.push({
                    type: 'success',
                    icon: 'trending-up',
                    text: `Your net worth is looking strong! Keep investing to hit your next milestone.`
                });
            }

            return insights;
        };

actions.renderSmartInsights = function () {
            const list = document.getElementById('insights-list');
            if (!list) return;
            const msgs = actions.generateSmartInsights();

            if (msgs.length === 0) {
                document.getElementById('smart-insights-panel').classList.add('hidden');
                return;
            }

            document.getElementById('smart-insights-panel').classList.remove('hidden');
            FinzUI.setHTML(list, msgs.map(m => {
                const colors = m.type === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                    (m.type === 'danger' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100');
                const iconColor = m.type === 'warning' ? 'text-amber-500' : (m.type === 'danger' ? 'text-red-500' : 'text-emerald-500');
                return FinzUI.html`
                <div class="p-4 rounded-2xl border ${colors} flex items-start gap-3 shadow-sm text-left">
                    <div class="mt-0.5"><i data-lucide="${m.icon}" class="w-5 h-5 ${iconColor}"></i></div>
                    <p class="text-xs font-medium leading-relaxed">${m.text}</p>
                </div>`;
            }).join(''));
            lucide.createIcons();

            // Auto-hide after 1 minute (60000ms)
            setTimeout(() => {
                document.getElementById('smart-insights-panel').classList.add('hidden');
            }, 60000);
        };

actions.calcSalAlloc = function () {
            const amt = parseFloat(document.getElementById('sal-amount').value) || 0;
            const savPct = parseFloat(document.getElementById('sal-sav-pct').value) || 0;
            const invPct = parseFloat(document.getElementById('sal-inv-pct').value) || 0;
            const expPct = parseFloat(document.getElementById('sal-exp-pct').value) || 0;

            document.getElementById('sal-sav-val').innerText = (amt * (savPct/100)).toFixed(2);
            document.getElementById('sal-inv-val').innerText = (amt * (invPct/100)).toFixed(2);
            document.getElementById('sal-exp-val').innerText = (amt * (expPct/100)).toFixed(2);
        };

actions.fireConfetti = function() {
    const duration = 3000;
    const end = Date.now() + duration;
    
    (function frame() {
        const confetti = document.createElement('div');
        confetti.classList.add('fixed', 'w-3', 'h-3', 'rounded-full', 'z-[200]', 'pointer-events-none');
        
        // Random colors
        const colors = ['bg-rose-500', 'bg-emerald-500', 'bg-amber-400', 'bg-indigo-500'];
        confetti.classList.add(colors[Math.floor(Math.random() * colors.length)]);
        
        // Random position at top
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.top = '-10px';
        
        // Random animation
        confetti.style.transition = 'all 2s ease-out';
        confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
        
        document.body.appendChild(confetti);
        
        setTimeout(() => {
            confetti.style.top = '100vh';
            confetti.style.transform = `rotate(${Math.random() * 720}deg)`;
        }, 50);
        
        setTimeout(() => {
            confetti.remove();
        }, 2000);
        
        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());
};

actions.openPinPasswordFallback = function () {
    if (confirm("Unlock with account password? This will return to the sign-in screen.")) {
        sessionStorage.removeItem('fs_is_locked');
        actions.handleSignOut();
    }
};

actions.categoryManagerBackAction = function(event) { actions.renderBudgetUIOverride() };
}
