import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        const firebaseConfig = { apiKey: "AIzaSyCbYXBMRtIDhB49nQexCTHQY2YPeInHLJ8", authDomain: "my-finance-454c2.firebaseapp.com", projectId: "my-finance-454c2", storageBucket: "my-finance-454c2.firebasestorage.app", messagingSenderId: "18874709232", appId: "1:18874709232:web:b9b007e07042fb0cf87e35" };
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const appId = 'finshaanire-v2';

        let state = {
            user: null,
            data: {
                accounts: [],
                transactions: [],
                debts: [],
                budgets: {},
                categoryLinks: {},
                goals: [], // { id, name, target, saved, currency, icon }
                portfolio: {}, // { schemeCode: { nav, date, name } }
                commodityRates: { Gold: 7200, Silver: 90 }, // INR per gram default
                commodityRatesAED: { Gold: 315, Silver: 3.5 }, // AED per gram default
                allocationTargets: { 'Real Estate': 0, 'Gold': 20, 'Equity': 50, 'Cash': 30 },
                settings: { rate: 22.75, isPrivate: false, theme: 'emerald' },
                savingsCategories: ['Wedding Fund', 'Car Fund', 'Emergency Fund Top-Up', 'Annual Vacation'],
                investmentCategories: ['Mutual Funds', 'Sarwa', 'Crypto & Stocks'],
                incomeCategories: ['Salary', 'Bonus', 'Investment Return', 'Other'],
                expenseCategories: ['Rent', 'Food', 'Utilities', 'Investment', 'Family', 'Other'],
                assetTypes: ['Bank Account', 'Cash', 'Savings', 'Emergency Fund', 'Investment'] // Simplified
            }
        };
        window.state = state; // Expose globally for header scripts

        // Helper: Convert any transaction amount to Base Currency (AED)
        window.getTransactionBaseAmount = function (t) {
            if (!t) return 0;
            const amt = parseFloat(t.amount) || 0;
            if (amt === 0) return 0;
            const baseCur = (typeof state !== 'undefined' && state.data?.settings?.currency) ? state.data.settings.currency : 'AED';
            const acc = (typeof state !== 'undefined' && state.data?.accounts) ? state.data.accounts.find(a => a.id === t.accountId) : null;
            const cur = t.currency || (acc ? acc.currency : baseCur);
            if (cur === baseCur) return amt;
            const rate = parseFloat(t.exchangeRate) || parseFloat(state.data?.settings?.rate) || 22.75;
            if (baseCur === 'AED' && cur === 'INR') {
                return rate > 0 ? (amt / rate) : amt;
            } else if (baseCur === 'INR' && cur === 'AED') {
                return amt * rate;
            }
            return amt;
        };

        // --- GLOBAL FUNCTION ASSIGNMENTS ---
        window.closeModal = () => {
            const c = document.getElementById('modal-content');
            c.classList.remove('max-w-[95vw]');
            c.classList.add('max-w-4xl');
            document.getElementById('modal-backdrop').classList.replace('flex', 'hidden');
        };
        window.closeReminder = () => document.getElementById('reminder-overlay').classList.add('hidden');
        window.updateDb = async () => {
            if (!state.user) return;
            // Sanitize data to remove undefined values (Firebase doesn't accept them)
            const sanitizeData = (obj) => {
                if (obj === null || obj === undefined) return null;
                if (Array.isArray(obj)) return obj.map(sanitizeData).filter(item => item !== null && item !== undefined);
                if (typeof obj === 'object') {
                    const cleaned = {};
                    for (const key in obj) {
                        const value = sanitizeData(obj[key]);
                        if (value !== undefined && value !== null) cleaned[key] = value;
                    }
                    return cleaned;
                }
                return obj;
            };
            const cleanedData = sanitizeData(state.data);
            await setDoc(doc(db, 'artifacts', appId, 'users', state.user.uid, 'finance', 'main'), cleanedData);
        };

        // Math Helper: Money Class for Financial Grade Integer Math
        class Money {
            constructor(cents) {
                this.cents = Math.round(cents);
            }
            static fromAmount(amount) {
                return new Money(Math.round(amount * 100));
            }
            static fromCents(cents) {
                return new Money(cents);
            }
            add(m) { return new Money(this.cents + m.cents); }
            subtract(m) { return new Money(this.cents - m.cents); }
            multiply(factor) { return new Money(Math.round(this.cents * factor)); }
            divide(divisor) { return new Money(Math.round(this.cents / divisor)); }
            get amount() { return this.cents / 100; }
            format(currency = 'AED') {
                return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(this.amount);
            }
        }
        window.Money = Money;

        // LEGACY COMPATIBILITY: Wrapper to keep existing code working until fully refactored
        // Ensures strict 2 decimal places to avoid floating point errors
        window.toCurrency = (num) => parseFloat(Number(num).toFixed(2));

        // LEDGER-BASED TRUTH: Recalculate all account balances from transaction history
        window.recalculateBalances = function () {
            // 1. Snapshot defined Initial Balances (if we had them, defaulting to 0 for now)
            // Strategy: We assume existing accounts starts at 0 and history is complete.
            // If history is partial, we might need a distinct "Opening Balance" transaction.
            const balances = {};
            state.data.accounts.forEach(a => balances[a.id] = 0);

            // 2. Replay History
            state.data.transactions.forEach(t => {
                const amt = Math.round(parseFloat(t.amount) * 100); // work in cents

                if (t.type === 'income') {
                    if (balances[t.accountId] !== undefined) balances[t.accountId] += amt;
                } else if (t.type === 'expense') {
                    if (balances[t.accountId] !== undefined) balances[t.accountId] -= amt;
                } else if (t.type === 'transfer_out') {
                    if (balances[t.accountId] !== undefined) balances[t.accountId] -= amt;
                } else if (t.type === 'transfer_in') {
                    if (balances[t.accountId] !== undefined) balances[t.accountId] += amt;
                }
            });

            // 3. Update State (In-Memory Only - Do not persist derived balance if possible, or persist for cache)
            // For this 'Financial Grade' refactor, we WILL persist it for performance, but ONLY satisfy it via this function.
            state.data.accounts.forEach(a => {
                // For Cash accounts, balance is strictly the ledger sum.
                if (['Bank Account', 'Cash', 'Savings'].includes(a.type)) {
                    a.balance = balances[a.id] / 100;
                } else {
                    // For Investments/Commodities, the balance must include the manual 'Initial Investment' (originalCost)
                    // plus any net transfers from the ledger, matching the Ledger UI logic.
                    a.balance = (a.originalCost || 0) + (balances[a.id] / 100);
                }
            });

            // 4. Fix BNPL Drift
            if (state.data.debts) {
                state.data.debts.forEach(d => {
                    if (d.isBnpl || d.subtype === 'bnpl') {
                        let rem = 0;
                        (d.schedule || []).forEach(s => { if (!s.paid) rem += parseFloat(s.amount); });
                        d.currentAmount = rem;
                        d.amount = Number(rem).toFixed(2);
                        if (rem < 0.1) d.settled = true;
                    }
                });
            }
        };

        // ID Helper: Generates robust unique IDs
        window.genId = () => Date.now().toString() + '_' + Math.floor(Math.random() * 1000);

        // Helper: Toggle Button State to prevent double-clicks
        window.setBtnLoading = (btnId, isLoading) => {
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

        // SIGN OUT FIX: Added a global handler for sign out
        window.handleSignOut = async function () {
            try {
                await signOut(auth);
                location.reload();
            } catch (err) {
                console.error("Sign out error", err);
            }
        };

        window.handleChangePassword = async function () {
            const oldP = document.getElementById('cp-old').value;
            const newP = document.getElementById('cp-new').value;
            const cnfP = document.getElementById('cp-cnf').value;

            if (!oldP || !newP || !cnfP) {
                window.showToast("Please fill all fields.", "error"); return;
            }
            if (newP !== cnfP) {
                window.showToast("New passwords do not match.", "error"); return;
            }
            if (newP.length < 6) {
                window.showToast("Password must be at least 6 chars.", "error"); return;
            }

            // Lock UI
            const btn = document.querySelector('button[onclick="window.handleChangePassword()"]');
            const originalText = btn.innerText;
            btn.innerText = "Verifying...";
            btn.disabled = true;
            btn.classList.add('opacity-50');

            try {
                const cred = EmailAuthProvider.credential(state.user.email, oldP);
                await reauthenticateWithCredential(state.user, cred);

                btn.innerText = "Updating...";
                await updatePassword(state.user, newP);

                window.closeModal();
                window.showToast("Password Change Successful!", "success");
                window.openModal('auth'); // Return to profile
            } catch (error) {
                console.error("Password Change Error:", error);
                let msg = "Failed to update password.";
                if (error.code === 'auth/wrong-password') msg = "Current password is incorrect.";
                if (error.code === 'auth/weak-password') msg = "Password is too weak.";
                if (error.code === 'auth/requires-recent-login') msg = "Key expired. Please relogin.";
                window.showToast(msg, "error");

                // Reset Button
                btn.innerText = originalText;
                btn.disabled = false;
                btn.classList.remove('opacity-50');
            }
        };

        // --- THEME ENGINE ---
        window.applyTheme = function (theme) {
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

        // BOOT: Load saved theme immediately (for Login Screen)
        (function () {
            try {
                const saved = localStorage.getItem('fs_theme');
                if (saved) window.applyTheme(saved);
            } catch(e) { console.warn('LocalStorage unavailable', e); }
        })();

        // --- CORE APPLICATION FUNCTIONS ---

        async function checkDueDebts() {
            const today = new Date().toISOString().split('T')[0];
            let dueItem = null;
            let dueType = 'standard'; // or 'bnpl'
            let dueIdx = -1;
            let dataChanged = false;

            // Priority: Check Defaults first, then BNPL logic overrides or adds? 
            // Let's just find the *first* due item.
            for (const d of state.data.debts) {
                if (d.settled) continue;

                // --- AUTOMATION: Moved to checkSelfReminders ---

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
                    let settleFn = () => window.openSettleFlow(dueItem.id);

                    if (dueType === 'bnpl') {
                        const inst = dueItem.schedule[dueIdx];
                        amount = inst.amount;
                        party = `${dueItem.party} (Inst #${inst.index + 1})`;
                        settleFn = () => window.settleInstallment(dueItem.id, dueIdx);
                    }

                    // SNOOZE CHECK: Check if snoozed in last 5 hours
                    let snoozed = null;
                    try { snoozed = localStorage.getItem('reminder_snooze'); } catch(e) {}
                    // 5 hours = 5 * 60 * 60 * 1000 = 18000000 ms
                    if (snoozed && (Date.now() - parseInt(snoozed)) < 18000000) return;

                    details.innerHTML = `<p class="text-xl font-bold">${amount} ${dueItem.currency}</p><p class="text-sm font-medium text-slate-500">Party: ${party}</p>`;
                    document.getElementById('remit-settle-btn').onclick = settleFn;

                    // ACTION 1: Schedule Later (Reschedule)
                    document.getElementById('remit-resched-btn').onclick = () => window.openRescheduleFlow(dueItem.id);

                    // ACTION 2: Ignore (Snooze for 5h)
                    document.getElementById('remit-ignore-btn').onclick = () => {
                        try { localStorage.setItem('reminder_snooze', Date.now().toString()); } catch(e) {}
                        overlay.classList.add('hidden');
                        window.showToast("Reminders snoozed for 5 hours", "info");
                    };

                    overlay.classList.replace('hidden', 'flex'); lucide.createIcons();
                }
            }
        }
        // --- CUSTOM MODAL HANDLERS ---
        window.showConfirm = function (title, msg, onYes, yesLabel = 'Yes, Delete', onCancel = null) {
            const m = document.getElementById('confirm-modal');
            document.getElementById('confirm-title').innerText = title;
            document.getElementById('confirm-msg').innerHTML = msg;

            const yesBtn = document.getElementById('confirm-yes-btn');
            const cancelBtn = document.getElementById('confirm-cancel-btn');

            // 1. Setup YES Button
            const newYes = yesBtn.cloneNode(true);
            newYes.innerText = yesLabel;
            if (yesLabel !== 'Yes, Delete') {
                newYes.className = "p-3 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/30";
            } else {
                newYes.className = "p-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/30";
            }
            yesBtn.parentNode.replaceChild(newYes, yesBtn);
            newYes.onclick = () => { onYes(); m.classList.replace('flex', 'hidden'); };

            // 2. Setup CANCEL Button (New Logic to fix infinite loop)
            const newCancel = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn); // Clear old listeners

            newCancel.onclick = () => {
                m.classList.replace('flex', 'hidden');
                if (onCancel) onCancel(); // Run callback if provided (e.g. reset loading state)
            };

            m.classList.replace('hidden', 'flex');
        };

        window.showPrompt = function (title, msg, onConfirm, type = 'text', allowEmpty = false) {
            const m = document.getElementById('prompt-modal');
            document.getElementById('prompt-title').innerText = title;
            document.getElementById('prompt-msg').innerText = msg;

            const inp = document.getElementById('prompt-input');
            inp.value = '';
            inp.type = type;

            const yesBtn = document.getElementById('prompt-yes-btn');
            const newBtn = yesBtn.cloneNode(true);
            yesBtn.parentNode.replaceChild(newBtn, yesBtn);

            newBtn.onclick = () => {
                if (inp.value.trim() || allowEmpty) {
                    m.classList.replace('flex', 'hidden'); // Hide first!
                    // Small delay to ensure clean state transition if needed, though usually synchronous is fine if hidden first
                    // But to be safe lets allow DOM to update
                    setTimeout(() => onConfirm(inp.value.trim()), 50);
                }
            };
            m.classList.replace('hidden', 'flex');
            inp.focus();
        };

        window.showToast = function (msg, type = 'info') {
            const c = document.getElementById('toast-container');
            const el = document.createElement('div');

            let icon = 'info', color = 'bg-slate-800', text = 'text-white';
            if (type === 'success') { icon = 'check-circle'; color = 'bg-emerald-500'; }
            if (type === 'error') { icon = 'alert-circle'; color = 'bg-red-500'; }
            if (type === 'warn') { icon = 'alert-triangle'; color = 'bg-amber-500'; }

            el.className = `flex items-center gap-3 p-4 rounded-xl shadow-xl transform transition-all duration-300 translate-y-10 opacity-0 ${color} ${text} min-w-[200px]`;
            el.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i><span class="font-bold text-xs">${msg}</span>`;

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

        window.checkDueDebts = checkDueDebts;

        async function fetchExchangeRate() {
            try {
                const res = await fetch('https://api.exchangerate-api.com/v4/latest/AED');
                const d = await res.json();
                if (d.rates && d.rates.INR) {
                    state.data.settings.rate = d.rates.INR;
                    document.getElementById('exchange-rate-badge')?.classList.add('rate-live');
                }
            } catch (e) { console.warn("Live rate unavailable."); }
            // Always refresh asset values on generic refresh
            window.recalcDynamicAssets();
            window.renderApp();
        }
        window.fetchExchangeRate = fetchExchangeRate;

        async function fetchMetalsRate() { return; }
        window.fetchMetalsRate = fetchMetalsRate;

        window.recalcDynamicAssets = function () { return; };

        window.refreshFund = async function (accId) { return; };

        function renderApp() {
            const dashboard = document.getElementById('app-content'); if (!dashboard || dashboard.style.display === 'none') return;

            // Helper for Number Formatting (Tabular)
            window.fmtMoney = (val, currency) => {
                const parts = val.toFixed(2).split('.');
                const intPart = new Intl.NumberFormat('en-US').format(parseInt(parts[0]));
                return `<span class="money-font tracking-tight">${currency === 'AED' ? 'AED' : '₹'} ${intPart}</span><span class="text-[0.6em] opacity-50 font-bold ml-0.5">.${parts[1]}</span>`;
            };

            window.renderAssetCard = (a, isChild = false) => {
                let subtext = a.type;
                let icon = 'layers'; // Default
                let iconColor = 'bg-slate-900 border border-slate-700/30 text-rose-400'; // Sleek dark default

                if (a.type === 'Mutual Fund') {
                    const meta = state.data.portfolio?.[a.schemeCode];
                    subtext = meta ? `NAV: ?${meta.nav} (${meta.date})` : 'Mutual Fund';
                    icon = 'pie-chart';
                }

                if (a.type === 'Bank Account') {
                    icon = 'landmark';
                    iconColor = 'bg-emerald-900/30 border border-emerald-700/30 text-emerald-400';
                }
                if (a.type === 'Cash') {
                    icon = 'wallet';
                    iconColor = 'bg-emerald-900/30 border border-emerald-700/30 text-emerald-400';
                }
                if (a.type === 'Real Estate') {
                    icon = 'building';
                    iconColor = 'bg-indigo-900/30 border border-indigo-700/30 text-indigo-400';
                    subtext = a.details?.location || a.category || 'Property';
                }
                if (a.type === 'Vehicle') {
                    icon = 'car';
                    iconColor = 'bg-rose-900/30 border border-rose-700/30 text-rose-400';
                    subtext = `${a.details?.make || ''} ${a.details?.model || ''}`.trim() || 'Vehicle';
                }
                if (a.type === 'Crypto') {
                    icon = 'zap';
                    iconColor = 'bg-purple-900/30 border border-purple-700/30 text-purple-400';
                    subtext = `${a.details?.sym || 'CRYPTO'} (${a.details?.net || 'Chain'})`;
                }
                if (a.type === 'Collectible') {
                    icon = 'watch';
                    iconColor = 'bg-pink-900/30 border border-pink-700/30 text-pink-400';
                    subtext = a.details?.brand || 'Collectible';
                }
                if (a.type === 'Bond') {
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
                    return `<div class="bg-gradient-to-br from-emerald-500/10 via-slate-800 to-slate-900 p-5 rounded-[2rem] border-2 border-emerald-500/30 shadow-xl cursor-pointer hover:border-emerald-400/60 transition-all fade-in" onclick="window.openEmergencyFundDashboard('${a.id}')">
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
                                <p class="font-black text-white text-lg num-font">${state.data.settings.isPrivate ? '••••' : window.fmtMoney(a.balance, emfCurrency)}</p>
                                ${emfTarget > 0 ? `<p class="text-[9px] font-bold text-emerald-400">${emfProgress.toFixed(0)}% of target</p>` : `<p class="text-[9px] font-bold text-slate-400">Tap to set target</p>`}
                            </div>
                        </div>
                        ${emfTarget > 0 ? `
                        <div class="w-full bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700/50">
                            <div class="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700 rounded-full" style="width: ${emfProgress}%"></div>
                        </div>
                        <div class="flex justify-between text-[9px] font-bold text-slate-400 mt-2">
                            <span>Saved: ${window.fmtMoney(a.balance, emfCurrency)}</span>
                            <span>Target: ${window.fmtMoney(emfTarget, emfCurrency)}</span>
                        </div>` : ''}
                    </div>`;
                }

                return `<div class="bg-slate-800/50 backdrop-blur-md p-4 rounded-[1.5rem] flex justify-between items-center border border-slate-700/50 shadow-sm cursor-pointer hover:bg-slate-800 transition-all text-center group ${isChild ? 'border-0 border-b last:border-0 border-slate-700/50 rounded-none' : ''}" onclick="window.viewAccountLedger('${a.id}')">
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
                        <p class="font-black text-slate-100 text-base num-font">${state.data.settings.isPrivate ? '****' : window.fmtMoney(a.balance, a.currency)}</p>
                    </div>
                </div>`;
            };

            // FINANCIAL GRADE: Ledger-Based Truth
            // Derived Balances are calculated live from Transaction History before rendering
            window.recalculateBalances();

            const { accounts, transactions, debts, settings } = state.data;
            const r = settings.rate, priv = settings.isPrivate;
            const ut = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

            if (document.getElementById('rate-display')) ut('rate-display', r.toFixed(2));

            let uae = 0, ind = 0, inv = 0;
            accounts.forEach(a => { if (a.currency === 'AED') uae += a.balance; else ind += a.balance; if (!['Bank Account', 'Cash', 'Savings'].includes(a.type)) inv += (a.currency === 'AED' ? a.balance * r : a.balance); });
            const pay = debts.filter(d => !d.settled && d.type === 'payable').reduce((s, d) => s + (Number(d.amount) * (d.currency === 'AED' ? r : 1)), 0), rec = debts.filter(d => !d.settled && d.type === 'receivable').reduce((s, d) => s + (Number(d.amount) * (d.currency === 'AED' ? r : 1)), 0);

            const net = (uae * r) + ind + rec - pay;
            const rawNetAED = net / r;            
            const privText = `<span class="tracking-widest opacity-50">••••••••</span>`;

            ut('total-primary', priv ? privText : window.fmtMoney(rawNetAED, 'AED'));
            ut('total-secondary', priv ? privText : `≈ ` + window.fmtMoney(net, 'INR'));

            // GUILT-FREE SPEND LOGIC
            const liquidAssetsAED = accounts
                .filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type))
                .reduce((s, a) => s + (a.currency === 'AED' ? a.balance : a.balance / r), 0);
                
            const totalBudgetsAED = state.data.envelopeLedger ? (() => {
                const stats = window.getEnvelopeStats();
                return stats.totalFunded - stats.totalDefunded;
            })() : 0;
            
            // Guilt-Free = Liquid Cash - Monthly Envelope Budgets
            const guiltFree = liquidAssetsAED - totalBudgetsAED;
            const gfValue = Math.max(0, guiltFree);
            ut('guilt-free-val', priv ? privText : window.fmtMoney(gfValue, 'AED'));
            ut('no-spend-val', window.getNoSpendStreak() + ' Days');

            // Update Milestone Radar
            try {
                if (typeof window.getNetWorthMilestoneStats === 'function') {
                    const mStats = window.getNetWorthMilestoneStats();
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
            ut('safe-to-spend-budget', priv ? privText : window.fmtMoney(safeToSpendAED, 'AED'));

            // Render Goals to Dashboard
            const gl = document.getElementById('goals-list');
            const gSec = document.getElementById('goals-section');
            if (gl && gSec) {
                if (state.data.goals && state.data.goals.length > 0) {
                    gSec.classList.remove('hidden');
                    gl.innerHTML = state.data.goals.map(g => {
                        const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
                        return `
                        <div class="text-slate-900 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm text-left relative overflow-hidden group cursor-pointer" onclick="window.openModal('goals')">
                            <div class="text-slate-900 absolute inset-0 bg-slate-50 translate-y-[100%] group-hover:translate-y-[0%] transition-transform duration-500 ease-in-out"></div>
                            <div class="relative z-10">
                                <div class="flex justify-between items-start mb-4">
                                    <div class="flex items-center space-x-3">
                                        <div class="w-10 h-10 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center">
                                            <i data-lucide="${g.icon || 'target'}" class="w-5 h-5"></i>
                                        </div>
                                        <div>
                                            <h4 class="font-bold text-sm text-slate-800">${g.name}</h4>
                                            <p class="text-[9px] font-black uppercase text-slate-400">Target: ${window.fmtMoney(g.target, g.currency)}</p>
                                        </div>
                                    </div>
                                    <span class="text-xs font-black text-indigo-500">${pct}%</span>
                                </div>
                                
                                <div class="w-full bg-slate-100 rounded-full h-2.5 mb-2 overflow-hidden flex">
                                    <div class="bg-indigo-500 h-2.5 rounded-full" style="width: ${pct}%"></div>
                                </div>
                                <div class="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                    <span>Saved: ${window.fmtMoney(g.saved, g.currency)}</span>
                                    <span>Left: ${window.fmtMoney(g.target - g.saved, g.currency)}</span>
                                </div>
                            </div>
                        </div>`;
                    }).join('');
                } else {
                    gSec.classList.add('hidden');
                }
            }

            ut('uae-val', priv ? privText : window.fmtMoney(uae, 'AED'));
            ut('india-val', priv ? privText : window.fmtMoney(ind, 'INR'));
            ut('rec-val', (priv ? privText : window.fmtMoney(rec, 'INR')));
            ut('pay-val', (priv ? privText : '-' + window.fmtMoney(pay, 'INR')));
            ut('inv-val', priv ? privText : window.fmtMoney(inv, 'INR'));

            // Safe User Label Update
            const uLabel = document.getElementById('user-label');
            if (state.user && uLabel) uLabel.innerText = state.user.email.split('@')[0];

            window.renderAssetsList('uae', accounts.filter(a => a.currency === 'AED'));
            window.renderAssetsList('india', accounts.filter(a => a.currency === 'INR'));
            window.renderNotifications();
            window.renderInstallments();
            window.renderSmartInsights();
            // Render Wealth Landscape (Simulated/Calculated History)
            setTimeout(window.renderWealthLandscape, 100);
            lucide.createIcons();
        }
        window.renderApp = renderApp;

        window.renderWealthLandscape = function () {
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

            if (window.wealthChartInstance) window.wealthChartInstance.destroy();
            window.wealthChartInstance = new Chart(ctx, {
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

        window.calculateWealthAllocation = function () {
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
                const val = window.toChartCur(Number(a.balance), a.currency || 'AED', r);
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
                const val = window.toChartCur(Number(d.amount), d.currency || 'AED', r);
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

        window.renderAnalytics = function () {
            // Calculate Financial Freedom
            const monthExp = state.data.transactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + parseFloat(t.amount), 0) / 6;

            const currentNW = state.data.accounts.reduce((sum, a) => {
                const val = a.currency === 'AED' ? a.balance * state.data.settings.rate : a.balance;
                return sum + val;
            }, 0);

            const yearsFreedom = monthExp > 0 ? (currentNW / (monthExp * 12)).toFixed(1) : '∞';

            // HTML Structure
            const modal = document.getElementById('modal-content');
            modal.innerHTML = `
                <div class="space-y-8">
                    <!-- Freedom Gauge -->
                    <div class="bg-slate-900 text-white p-8 rounded-[3rem] text-center shadow-xl">
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Financial Freedom</p>
                        <p class="text-5xl font-black text-emerald-400">${yearsFreedom} <span class="text-lg text-slate-500">Years</span></p>
                        <p class="text-[10px] font-bold text-slate-500 mt-2">Based on current lifestyle</p>
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
                </div>`;

            // Render Charts safely after DOM updates
            setTimeout(() => {
                window.renderAllocationChart(true);
                window.renderNetWorthTrend();
                window.renderExpenseTrend();
            }, 200);
        };

        window.renderNetWorthTrend = function () {
            const ctx = document.getElementById('networth-trend-chart');
            if (!ctx || !state.data.historicalSnapshots || state.data.historicalSnapshots.length === 0) return;

            if (window.netWorthChartInstance) window.netWorthChartInstance.destroy();

            const labels = state.data.historicalSnapshots.map(s => {
                const [y, m] = s.month.split('-');
                return new Date(y, m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
            });
            const data = state.data.historicalSnapshots.map(s => s.netWorthAED);

            window.netWorthChartInstance = new Chart(ctx, {
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

        window.renderAllocationChart = function (isModal = false) {
            const suffix = isModal ? '-modal' : '';
            const ctx = document.getElementById('allocation-chart' + suffix);
            if (!ctx) return;

            if (!ctx.offsetParent) {
                setTimeout(() => window.renderAllocationChart(isModal), 100);
                return;
            }

            const dataGroups = window.calculateWealthAllocation();

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

            const cur = window.chartCurrency || 'AED';
            document.getElementById('chart-center-val' + suffix).innerHTML = window.fmtMoney(totalGrossAssets, cur);
            document.getElementById('debt-ratio-val' + suffix).innerText = debtRatio.toFixed(1) + '%';
            document.getElementById('liability-bar' + suffix).style.width = Math.min(debtRatio, 100) + '%';
            document.getElementById('gross-assets-label' + suffix).innerHTML = 'Assets: ' + window.fmtMoney(totalGrossAssets, cur);
            document.getElementById('liabilities-label' + suffix).innerHTML = 'Liabilities: ' + window.fmtMoney(liabilitiesTotal, cur);

            if (isModal) {
                if (window.allocationChartInstanceModal) window.allocationChartInstanceModal.destroy();
            } else {
                if (window.allocationChartInstance) window.allocationChartInstance.destroy();
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
                            window.showCategoryDetails(label, dataGroups[label], suffix);
                        }
                    }
                }
            });

            if (isModal) window.allocationChartInstanceModal = chartInstance;
            else window.allocationChartInstance = chartInstance;
        };

        window.showCategoryDetails = function (categoryName, categoryData, suffix = '') {
            const container = document.getElementById('category-details-container' + suffix);
            if (!container) return;
            const cur = window.chartCurrency || 'AED';

            let html = `
                <div class="text-slate-900 bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                    <div class="absolute left-0 top-0 bottom-0 w-1 bg-slate-300"></div>
                    <div class="flex justify-between items-end border-b border-slate-200 pb-2 mb-2">
                        <h5 class="font-black text-slate-800 text-sm">${categoryName} Total</h5>
                        <span class="font-black text-slate-900 num-font">${window.fmtMoney(categoryData.total, cur)}</span>
                    </div>
                    <div class="space-y-1.5 mt-3 max-h-48 overflow-y-auto no-scrollbar pr-2">
            `;

            if (categoryData.items.length === 0) {
                html += `<div class="text-center text-[10px] text-slate-400 font-bold py-2">No active items</div>`;
            } else {
                categoryData.items.forEach(item => {
                    const originalBalanceFmt = state.data.settings.isPrivate ? '••••' : Number(item.originalBalance).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' ' + item.currency;
                    html += `
                        <div class="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center py-1">
                            <span class="text-xs font-bold text-slate-600 flex items-center pr-2">
                                <i data-lucide="corner-down-right" class="w-3 h-3 text-slate-300 mr-2"></i>
                                ${item.name}
                            </span>
                            <span class="text-xs font-black text-slate-800 num-font mt-1 sm:mt-0 ml-5 sm:ml-0 whitespace-nowrap">
                                ${originalBalanceFmt}
                                <span class="text-[9px] text-slate-400 font-bold ml-1 hidden sm:inline-block">(${window.fmtMoney(item.value, cur)})</span>
                            </span>
                        </div>
                    `;
                });
            }

            html += `</div></div>`;
            container.innerHTML = html;
            container.classList.remove('hidden');
            lucide.createIcons();

            const colorMap = {
                'Liquid Assets': 'bg-emerald-500',
                'Market Investments': 'bg-blue-500',
                'Commodities': 'bg-amber-500',
                'Physical/Fixed Assets': 'bg-violet-500',
                'Receivables': 'bg-teal-500'
            };
            const div = container.querySelector('.absolute.w-1');
            if (div) {
                div.className = `absolute left-0 top-0 bottom-0 w-1 ${colorMap[categoryName] || 'bg-slate-300'}`;
            }
        };

        function renderNotifications() {
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

            list.innerHTML = sorted.map(d => {
                const settleAction = d.isBnpl ? `window.settleInstallment('${d.id}', ${d.instIndex})` : `window.openSettleFlow('${d.id}')`;
                return `
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
                        <button onclick="${settleAction}" class="bg-emerald-500 text-white py-1.5 rounded-lg text-[9px] font-bold uppercase shadow-sm text-center text-center">Settle</button>
                        <button onclick="window.openRescheduleFlow('${d.id}')" class="text-slate-900 bg-slate-50 text-slate-600 py-1.5 rounded-lg text-[9px] font-bold uppercase text-center text-center">Later</button>
                    </div>
                </div>`;
            }).join('');
        }
        window.renderNotifications = renderNotifications;

        window.renderInstallments = function () {
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

            list.innerHTML = sorted.map(d => `
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
                        <button onclick="window.settleInstallment('${d.id}', ${d.instIndex})" class="bg-indigo-500 text-white py-1.5 rounded-lg text-[9px] font-bold uppercase shadow-sm text-center text-center">Pay Now</button>
                        <button onclick="window.openRescheduleFlow('${d.id}')" class="text-slate-900 bg-slate-50 text-slate-600 py-1.5 rounded-lg text-[9px] font-bold uppercase text-center text-center">Later</button>
                    </div>
                </div>`).join('');
        };

        window.toggleGroup = function (id) {
            // Deprecated
        };

        window.openGroupDetails = function (type, subtype, currency) {
            const items = state.data.accounts.filter(a => {
                if (a.currency !== currency) return false;
                if (type === 'Commodity') return a.type === 'Commodity' && (a.subtype || 'Commodity') === subtype;
                if (type === 'Mutual Fund') return a.type === 'Mutual Fund' && (a.category || 'Mutual Funds') === subtype;
                return false;
            });

            if (items.length === 0) return;

            const t = document.getElementById('modal-title');
            const c = document.getElementById('modal-content');
            const b = document.getElementById('modal-backdrop');

            // 1. Calculate Stats
            const totalVal = items.reduce((s, a) => s + a.balance, 0);
            let statHtml = '';

            if (type === 'Commodity') {
                const totalWeight = items.reduce((s, a) => s + (a.weight || 0), 0);
                statHtml = `<div class="bg-amber-50 p-6 rounded-3xl border border-amber-100 text-center">
                    <p class="text-[10px] font-black uppercase text-amber-500 tracking-widest mb-1">Total Weight</p>
                    <p class="text-3xl font-black text-slate-800">${totalWeight.toFixed(2)}g</p>
                </div>`;
            } else if (type === 'Mutual Fund') {
                statHtml = `<div class="bg-blue-50 p-6 rounded-3xl border border-blue-100 text-center">
                    <p class="text-[10px] font-black uppercase text-blue-500 tracking-widest mb-1">Portfolios</p>
                    <p class="text-3xl font-black text-slate-800">${items.length} <span class="text-xs text-slate-400">Funds</span></p>
                </div>`;
            }

            t.innerText = `${subtype} (${currency})`;
            c.innerHTML = `
                <div class="space-y-6">
                    <!-- Dashboard Header -->
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 text-center">
                            <p class="text-[10px] font-black uppercase text-emerald-600 tracking-widest mb-1">Total Value</p>
                            <p class="text-3xl font-black text-emerald-600">${window.fmtMoney(totalVal, currency)}</p>
                        </div>
                        ${statHtml}
                    </div>

                    <!-- Distribution Chart -->
                    <div class="text-slate-900 bg-white p-6 rounded-[2.5rem] border shadow-sm text-center">
                        <h4 class="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Distribution</h4>
                        <div class="relative h-48 w-full">
                            <canvas id="group-chart"></canvas>
                        </div>
                    </div>

                    <!-- Item List -->
                    <div class="grid gap-2">
                        <h4 class="text-[10px] font-black uppercase text-slate-400 mt-4 mb-2 tracking-widest text-left px-2">Holdings List</h4>
                        ${items.map(a => window.renderAssetCard(a)).join('')}
                    </div>
                </div>
            `;
            b.classList.replace('hidden', 'flex');
            lucide.createIcons();

            // Render Chart
            setTimeout(() => {
                const ctx = document.getElementById('group-chart');
                if (ctx) {
                    const labels = items.map(a => a.name);
                    const data = items.map(a => a.balance);
                    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#6366f1', '#8b5cf6', '#14b8a6'];

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
                                hoverOffset: 10
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } }, // Clean look
                            cutout: '60%'
                        }
                    });
                }
            }, 100);
        };

        function renderAssetsList(reg, items) {
            const container = document.getElementById(`${reg}-list`); if (!container) return;
            if (items.length === 0) { container.innerHTML = `<div class="p-8 border border-dashed border-slate-700 rounded-[2rem] text-center text-slate-500 uppercase text-[10px] font-black">No accounts</div>`; return; }

            // Filter out commodities and render as sleek banking cards
            const singleHTML = items
                .filter(a => a.type !== 'Commodity')
                .map(a => window.renderAssetCard(a))
                .join('');

            container.innerHTML = `<div class="space-y-3">${singleHTML}</div>`;
        }
        window.renderAssetsList = renderAssetsList;

        function renderLedger(items) {
            const body = document.getElementById('master-ledger-body'); if (!body) return;
            const sorted = [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
            body.innerHTML = sorted.map(t => {
                let accName = 'N/A';
                if (t.accountId === 'virtual_writeoff') {
                    accName = 'Write-off Record';
                } else {
                    accName = state.data.accounts.find(a => a.id === t.accountId)?.name || 'N/A';
                }
                const isTransfer = t.type.includes('transfer');
                const isIncome = t.type === 'income' || t.type === 'transfer_in';
                const colorClass = isTransfer ? 'text-slate-500' : (isIncome ? 'text-emerald-500' : 'text-red-400');
                const sign = isIncome ? '+' : '-';
                const displayType = isTransfer ? (t.type === 'transfer_in' ? 'Inflow' : 'Outflow') : (t.type === 'income' ? 'Income' : 'Expense');

                return `<tr class="text-slate-900 hover:bg-slate-50 text-center group">
                    <td class="px-6 py-4 text-left">
                        <p class="text-xs font-bold text-slate-800">${new Date(t.date).toLocaleDateString()}</p>
                        <p class="text-[9px] font-black text-slate-400 uppercase">${new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </td>
                    <td class="px-6 py-4 text-left">
                        <p class="text-xs font-bold text-slate-800">${t.category || displayType}</p>
                        <p class="text-[10px] text-slate-400 font-medium truncate max-w-[120px]">${t.note || '-'}</p>
                        ${t.tags && t.tags.length > 0 ? `<div class="flex space-x-1 mt-1">${t.tags.map(tg => `<span class="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[8px] font-bold rounded-md">${tg}</span>`).join('')}</div>` : ''}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <span class="text-[9px] font-black uppercase px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">${accName}</span>
                    </td>
                    <td class="px-6 py-4 text-right font-black ${colorClass} num-font">
                        ${sign}${state.data.settings.isPrivate ? '••••' : Number(t.amount).toFixed(2)}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <div class="flex items-center justify-center space-x-2">
                            <button onclick="window.cloneTransaction('${t.id}')" class="p-1.5 bg-slate-100 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50" title="Clone Entry">
                                <i data-lucide="copy" class="w-3 h-3"></i>
                            </button>
                            <button onclick="window.editTransaction('${t.id}')" class="p-1.5 bg-slate-100 rounded-lg text-slate-600 hover:text-emerald-600 hover:bg-emerald-50" title="Edit Entry">
                                <i data-lucide="pencil" class="w-3 h-3"></i>
                            </button>
                            <button onclick="event.stopPropagation(); window.deleteTransaction('${t.id}')" class="p-1.5 bg-slate-100 rounded-lg text-slate-600 hover:text-red-600 hover:bg-red-50" title="Delete Entry">
                                <i data-lucide="trash-2" class="w-3 h-3"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }
        window.renderLedger = renderLedger;

        window.filterLedger = function () {
            const q = document.getElementById('ledger-search').value.toLowerCase();
            const filter = window.activeLedgerFilter || 'all';
            const all = state.data.transactions;

            const filtered = all.filter(t => {
                // 1. Check Search Query
                const matchesSearch = !q || (
                    (t.note && t.note.toLowerCase().includes(q)) ||
                    (t.category && t.category.toLowerCase().includes(q)) ||
                    (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q))) ||
                    (t.amount.toString().includes(q))
                );

                // 2. Check Filter Chip
                let matchesFilter = true;
                if (filter === 'income') {
                    // Exclude non-income inflows
                    const isExcluded = ['Settlement', 'Loan', 'Debt', 'Opening Balance', 'Initial', 'Credit'].some(k =>
                        (t.category && t.category.includes(k)) || (t.note && t.note.includes(k))
                    );
                    matchesFilter = (t.type === 'income' || t.type === 'transfer_in') && !isExcluded;
                }
                else if (filter === 'expense') matchesFilter = (t.type === 'expense' || t.type === 'transfer_out');
                else if (filter === 'transfer') matchesFilter = t.type.includes('transfer');
                else if (filter === 'high') matchesFilter = parseFloat(t.amount) > 5000;

                // 3. Check Date Range Filter
                const dFrom = document.getElementById('ledger-date-from')?.value;
                const dTo = document.getElementById('ledger-date-to')?.value;

                let matchesDate = true;
                if (dFrom) matchesDate = matchesDate && (new Date(t.date) >= new Date(dFrom));
                if (dTo) {
                    // Adjust to end of day for intuitive filtering
                    const endDate = new Date(dTo);
                    endDate.setHours(23, 59, 59, 999);
                    matchesDate = matchesDate && (new Date(t.date) <= endDate);
                }

                return matchesSearch && matchesFilter && matchesDate;
            });
            window.renderLedger(filtered);
        };

        window.renderImportUI = function () {
            return `<div class="text-slate-900 max-w-2xl mx-auto bg-white p-10 rounded-[3rem] border shadow-xl text-center">
                <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Bulk Import (CSV)</h4>
                
                <div class="mb-6 text-left">
                    <p class="text-[10px] text-slate-500 font-bold mb-2">Instructions:</p>
                    <ul class="text-[10px] text-slate-400 list-disc list-inside mb-4">
                        <li>Paste your statement below.</li>
                        <li>Format: <strong>Date, Description, Amount</strong> (e.g. 2024-02-01, Netflix, -50)</li>
                        <li>Positive for Income, Negative for Expense</li>
                    </ul>
                    <textarea id="csv-input" class="text-slate-900 w-full h-40 p-4 border rounded-2xl bg-slate-50 text-xs font-mono outline-none focus:border-emerald-500" placeholder="2024-02-01, Salary, 5000\n2024-02-02, Grocery, -200"></textarea>
                </div>
                
                <select id="csv-acc" class="text-slate-900 w-full p-4 border rounded-xl font-bold text-sm mb-4 bg-white">
                    ${state.data.accounts.map(a => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}
                </select>

                <div id="csv-preview" class="hidden mb-6 max-h-40 overflow-auto border rounded-xl"></div>

                <div class="grid grid-cols-2 gap-4">
                    <button onclick="window.parseCSV()" class="bg-slate-100 text-slate-600 p-4 rounded-xl font-black uppercase text-[10px]">Parse Data</button>
                    <button onclick="window.bulkImport()" id="btn-import" class="bg-slate-900 text-white p-4 rounded-xl font-black uppercase text-[10px] opacity-50 cursor-not-allowed">Run Import</button>
                </div>
            </div>`;
        };

        window.parsedRows = [];

        window.parseCSV = function () {
            const raw = document.getElementById('csv-input').value;
            const rows = raw.split(/\r?\n/).filter(r => r.trim() !== '');
            window.parsedRows = [];

            rows.forEach(r => {
                const parts = r.split(',').map(p => p.trim());
                if (parts.length >= 3) {
                    // Try to simplistic parse
                    const date = parts[0];
                    const desc = parts[1];
                    const amt = parseFloat(parts[2]);

                    if (!isNaN(amt)) {
                        window.parsedRows.push({ date, desc, amt });
                    }
                }
            });

            if (window.parsedRows.length > 0) {
                const prev = document.getElementById('csv-preview');
                prev.innerHTML = `<table class="w-full text-center text-[9px]"><thead class="bg-slate-100 font-bold"><tr><th class="p-2">Date</th><th class="p-2">Desc</th><th class="p-2">Amt</th></tr></thead>
                <tbody>${window.parsedRows.map(r => `<tr><td class="p-2 border-b">${r.date}</td><td class="p-2 border-b">${r.desc}</td><td class="p-2 border-b font-bold ${r.amt > 0 ? 'text-emerald-500' : 'text-red-500'}">${r.amt}</td></tr>`).join('')}</tbody></table>`;
                prev.classList.remove('hidden');
                document.getElementById('btn-import').classList.remove('opacity-50', 'cursor-not-allowed');
                alert(`✅ Parsed ${window.parsedRows.length} rows! Review and click Import.`);
            } else {
                alert("Could not parse rows. Ensure format: YYYY-MM-DD, Description, Amount (Use minus for expense)");
            }
        };

        window.bulkImport = async function () {
            if (window.parsedRows.length === 0) return;
            const aid = document.getElementById('csv-acc').value;
            if (!aid) return;

            if (!confirm(`Import ${window.parsedRows.length} transactions to selected account?`)) return;

            window.setBtnLoading('btn-import', true);
            const accIdx = state.data.accounts.findIndex(a => a.id === aid);
            let balChange = 0;

            window.parsedRows.forEach(r => {
                const type = r.amt >= 0 ? 'income' : 'expense';
                balChange += r.amt;

                state.data.transactions.push({
                    id: window.genId(),
                    accountId: aid,
                    amount: Math.abs(r.amt), // Store absolute
                    type: type,
                    category: 'Imported',
                    note: r.desc,
                    date: new Date(r.date).toISOString() || new Date().toISOString()
                });
            });

            // Update Balance
            state.data.accounts[accIdx].balance += balChange; // Simple add, floating point risk acceptable for V1 MVP

            await updateDb();
            window.closeModal();
            window.renderApp();
            alert("Success! Transactions Imported.");
        };

        // --- NEW FUNCTIONS (Moved to bottom) ---
        window.switchProfileTab = function (tab) {
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
                window.renderReportsTab();
            }
        };

        window.renderReportsTab = function () {
            const container = document.getElementById('annual-report-container');
            if (!container) return;
            
            const txCount = state.data.transactions ? state.data.transactions.length : 0;
            let firstDateStr = 'Recent';
            if (txCount > 0) {
                const sorted = [...state.data.transactions].sort((a,b) => new Date(a.date) - new Date(b.date));
                firstDateStr = new Date(sorted[0].date).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
            }
            const todayStr = new Date().toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});

            container.innerHTML = `
                <div class="absolute -top-10 -right-10 w-40 h-40 bg-rose-500/10 rounded-full blur-3xl"></div>
                <div class="absolute -bottom-10 -left-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl"></div>
                <div class="relative z-10 flex flex-col items-center justify-center space-y-4 py-4 text-center">
                    <div class="w-16 h-16 bg-gradient-to-br from-rose-500 to-rose-700 rounded-3xl flex items-center justify-center mb-1 shadow-lg shadow-rose-600/30 transform transition-transform hover:scale-105 cursor-pointer" onclick="window.generateAnnualReport()">
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
                       <button onclick="window.generateAnnualReport()" class="w-full bg-rose-600 hover:bg-rose-500 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest transition-all shadow-xl shadow-rose-600/30 flex items-center justify-center gap-2">
                            <i data-lucide="download" class="w-4 h-4"></i> Download PDF Statement
                       </button>
                    </div>
                </div>
            `;
            lucide.createIcons();
        };

        window.setQueryDates = function (mode) {
            const to = new Date();
            let from = new Date();
            
            if (mode === 30) {
                from.setDate(to.getDate() - 30);
            } else if (mode === 90) {
                from.setDate(to.getDate() - 90);
            } else if (mode === 365) {
                from.setDate(to.getDate() - 365);
            } else if (mode === 'ytd') {
                from = new Date(to.getFullYear(), 0, 1);
            }
            
            const toStr = to.toISOString().split('T')[0];
            const fromStr = from.toISOString().split('T')[0];
            
            document.getElementById('query-date-from').value = fromStr;
            document.getElementById('query-date-to').value = toStr;
        };

        window.currentQueryResult = []; // Global to hold current selection for PDF export

        window.executeCustomQuery = function () {
            const dFrom = document.getElementById('query-date-from').value;
            const dTo = document.getElementById('query-date-to').value;
            const type = document.getElementById('query-type').value;
            const category = document.getElementById('query-category').value;
            
            let filtered = state.data.transactions.filter(t => {
                let mType = true;
                if (type === 'income') mType = ['income', 'transfer_in'].includes(t.type);
                if (type === 'expense') mType = ['expense', 'transfer_out'].includes(t.type);
                if (type === 'transfer') mType = t.type.includes('transfer');
                
                let mCat = true;
                if (category !== 'all') {
                    mCat = (t.category === category);
                }
                
                let mDate = true;
                if (dFrom) mDate = mDate && (new Date(t.date) >= new Date(dFrom));
                if (dTo) {
                    const endDate = new Date(dTo);
                    endDate.setHours(23, 59, 59, 999);
                    mDate = mDate && (new Date(t.date) <= endDate);
                }
                
                return mType && mCat && mDate;
            });
            
            // Sort Descending by Date
            filtered.sort((a,b) => new Date(b.date) - new Date(a.date));
            window.currentQueryResult = filtered;
            
            // Calculate Sum
            let sumAED = 0;
            let sumINR = 0;
            const rate = (typeof state !== 'undefined' && state && state.data && state.data.settings && state.data.settings.rate) ? state.data.settings.rate : 22.75;

            filtered.forEach(t => {
                const acc = state.data.accounts.find(a => a.id === t.accountId);
                const currency = acc ? acc.currency : 'AED';
                t._currency = currency;
                
                const amt = parseFloat(t.amount);
                if (currency === 'AED') {
                    sumAED += amt;
                    sumINR += (amt * rate);
                } else if (currency === 'INR') {
                    sumINR += amt;
                    sumAED += (amt / rate);
                } else {
                    // Fallback treats unknown as AED base
                    sumAED += amt;
                    sumINR += (amt * rate);
                }
            });
            
            const resultsDiv = document.getElementById('query-results');
            const tbody = document.getElementById('query-results-body');
            const sumEl = document.getElementById('query-total-sum');
            
            sumEl.innerHTML = `
                <div class="flex flex-col items-end justify-center">
                    <div>${window.fmtMoney(sumAED, 'AED')}</div>
                    <div class="scale-75 origin-right opacity-80 -mt-1">${window.fmtMoney(sumINR, 'INR')}</div>
                </div>
            `;
            
            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-xs font-bold text-slate-400">No transactions match your query.</td></tr>';
            } else {
                tbody.innerHTML = filtered.map(t => {
                    const isIncome = ['income', 'transfer_in'].includes(t.type);
                    const color = isIncome ? 'text-emerald-500' : 'text-slate-800';
                    const sign = isIncome ? '+' : (t.type.includes('transfer_out') ? '-' : (t.type === 'expense' ? '-' : ''));
                    const pDate = new Date(t.date).toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' });
                    
                    return `
                    <tr class="text-slate-900 hover:bg-slate-50 transition-colors">
                        <td class="p-3 text-xs border-r border-slate-100">${pDate}</td>
                        <td class="p-3 text-xs">
                            <p class="font-bold text-slate-800 truncate max-w-[150px]">${t.note || t.category}</p>
                            <p class="text-[9px] uppercase tracking-widest text-slate-400">${t.category}</p>
                        </td>
                        <td class="p-3 text-[10px] font-black uppercase text-slate-500 border-x border-slate-100">${t.type.replace('_', ' ')}</td>
                        <td class="p-3 text-right font-black num-font ${color}">${sign}${t._currency || 'AED'} ${parseFloat(t.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    </tr>`;
                }).join('');
            }
            
            resultsDiv.classList.remove('hidden');
        };

        window.exportCustomQueryPDF = function () {
            if (!window.currentQueryResult || window.currentQueryResult.length === 0) {
                 window.showToast("Generate a query with data first.", "warn");
                 return;
            }
            try {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                
                doc.setFillColor(15, 23, 42); // bg-slate-900
                doc.rect(0, 0, 210, 30, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(16);
                doc.setFont("helvetica", "bold");
                doc.text("FINSHAANIREE Vault", 14, 20);
                
                doc.setTextColor(16, 185, 129); // emerald-500
                doc.setFontSize(10);
                doc.text("CUSTOM INTELLIGENCE QUERY", 140, 20);
                
                // Details
                doc.setTextColor(50, 50, 50);
                doc.setFontSize(10);
                
                const dFrom = document.getElementById('query-date-from').value || 'Beginning';
                const dTo = document.getElementById('query-date-to').value || 'Today';
                const totalText = document.getElementById('query-total-sum').innerText;
                
                doc.text(`Date Range: ${dFrom} to ${dTo}`, 14, 45);
                doc.text(`Records: ${window.currentQueryResult.length}`, 14, 52);
                doc.setFont("helvetica", "bold");
                doc.text(`Aggregate Sum: ${totalText}`, 140, 52);
                
                const tableBody = window.currentQueryResult.map(t => [
                    new Date(t.date).toLocaleDateString(),
                    t.category,
                    t.note || '-',
                    t.type,
                    `${t._currency || 'AED'} ${parseFloat(t.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}`
                ]);
                
                doc.autoTable({
                    startY: 60,
                    head: [['Date', 'Category', 'Description', 'Type', 'Amount']],
                    body: tableBody,
                    theme: 'striped',
                    headStyles: { fillColor: [15, 23, 42] },
                    styles: { fontSize: 8, cellPadding: 2 },
                    columnStyles: { 4: { halign: 'right', fontStyle: 'bold' } }
                });
                
                doc.save(`FI_SHAANIRE_Query_${new Date().toISOString().split('T')[0]}.pdf`);
                window.showToast("Query Exported to PDF", "success");
            } catch (err) {
                console.error("PDF Export Error", err);
                window.showToast("Error generating PDF. Check console.", "error");
            }
        };

        window.generateAnnualReport = function () {
            try {
                const { jsPDF } = window.jspdf;
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
                    
                    const amtBas = window.toChartCur(parseFloat(t.amount), currency);

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
                doc.text(`Gross Inflows: ${(window.chartCurrency || 'AED')} ${sumInc.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 14, 55);
                doc.text(`Gross Outflows: ${(window.chartCurrency || 'AED')} ${sumExp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 14, 62);
                const netCashflow = sumInc - sumExp;
                doc.setTextColor(netCashflow >= 0 ? 16 : 225, netCashflow >= 0 ? 185 : 29, netCashflow >= 0 ? 129 : 72);
                doc.setFont("helvetica", "bold");
                doc.text(`Net Inflow / Savings: ${(window.chartCurrency || 'AED')} ${netCashflow.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 14, 69);
                
                doc.setTextColor(50, 50, 50);
                doc.setFont("helvetica", "bold");
                doc.text("Category Breakdown (Expenses & Outflows)", 14, 90);
                
                let sortCats = Object.entries(cats).sort((a,b) => b[1] - a[1]);
                let y = 100;
                doc.setFont("helvetica", "normal");
                for (let i = 0; i < Math.min(sortCats.length, 10); i++) {
                    let pct = sumExp > 0 ? ((sortCats[i][1] / sumExp) * 100).toFixed(1) : 0;
                    doc.text(`• ${sortCats[i][0]}: ${(window.chartCurrency || 'AED')} ${sortCats[i][1].toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${pct}%)`, 14, y);
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
                window.showToast("Financial Statement PDF Downloaded!", "success");
            } catch (err) {
                console.error("PDF Generate Error", err);
                window.showToast("Failed to generate PDF: " + err.message, "error");
            }
        };

        // --- NEW FUNCTIONS (Moved to bottom) ---

        // --- MODAL VIEWS ---

        window.openModal = function (type) {
            const b = document.getElementById('modal-backdrop'), t = document.getElementById('modal-title'), c = document.getElementById('modal-content');
            b.classList.replace('hidden', 'flex');
            switch (type) {
                // FIXED: Sign Out button now uses window.handleSignOut()
                case 'auth': t.innerText = 'System Profile'; c.innerHTML = `
                <div class="w-full space-y-6 fade-in text-center">
                    <!-- Modern Glassmorphic Tab Selector -->
                    <div class="flex justify-center mb-8">
                        <div class="bg-slate-100 p-1 rounded-2xl inline-flex shadow-sm items-center">
                            <button id="tab-btn-security" onclick="window.switchProfileTab('security')" class="text-slate-900 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-white shadow-sm text-slate-900 transition-all">Security</button>
                            <button id="tab-btn-reports" onclick="window.switchProfileTab('reports')" class="px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all">Data Vault & Reports</button>
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
                            <button onclick="window.openModal('remittance')" class="text-slate-900 p-4 bg-slate-50 rounded-2xl text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 font-bold text-xs uppercase transition-all">
                                <i data-lucide="arrow-left-right" class="w-6 h-6 mx-auto mb-2"></i> Remittance
                            </button>
                             <button onclick="window.openModal('zakat')" class="text-slate-900 p-4 bg-slate-50 rounded-2xl text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 font-bold text-xs uppercase transition-all">
                                <i data-lucide="heart-handshake" class="w-6 h-6 mx-auto mb-2"></i> Zakat Calc
                            </button>
                        </div>
                        <div class="max-w-sm mx-auto mt-4">
                            <button onclick="window.openModal('change-password')" class="text-slate-900 w-full p-4 bg-slate-50 rounded-2xl text-slate-600 hover:bg-amber-50 hover:text-amber-600 font-bold text-xs uppercase transition-all">
                                <i data-lucide="shield-check" class="w-6 h-6 mx-auto mb-2"></i> Change Password
                            </button>
                        </div>

                        <button onclick="window.handleSignOut()" class="w-full max-w-sm mx-auto bg-slate-900 text-white p-5 rounded-3xl font-black uppercase text-sm text-center">Sign Out</button>
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
                                            ${state.data.expenseCategories.map(c => '<option value="' + c + '">' + c + '</option>').join('')}
                                        </optgroup>
                                        <optgroup label="Income">
                                            ${state.data.incomeCategories.map(c => '<option value="' + c + '">' + c + '</option>').join('')}
                                        </optgroup>
                                    </select>
                                </div>
                            </div>

                            <div class="flex flex-wrap justify-center gap-2 mb-6 cursor-pointer">
                                <button onclick="window.setQueryDates(30)" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600">Last 30 Days</button>
                                <button onclick="window.setQueryDates(90)" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600">Last Quarter</button>
                                <button onclick="window.setQueryDates(365)" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600">Past Year</button>
                                <button onclick="window.setQueryDates('ytd')" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600">YTD</button>
                                <button onclick="document.getElementById('query-date-from').value=''; document.getElementById('query-date-to').value='';" class="text-slate-900 px-3 py-1 bg-slate-50 hover:bg-slate-100 rounded-lg text-[10px] font-bold text-slate-400 border border-slate-200">Clear</button>
                            </div>

                            <button onclick="window.executeCustomQuery()" class="w-full bg-slate-900 text-emerald-400 hover:bg-slate-800 p-4 rounded-2xl font-black uppercase text-xs transition-all shadow-lg flex items-center justify-center">
                                <i data-lucide="zap" class="w-4 h-4 mr-2"></i> Generate Query
                            </button>

                            <!-- Query Results -->
                            <div id="query-results" class="hidden mt-8 text-left">
                                <div class="flex justify-between items-end border-b border-slate-200 pb-4 mb-4">
                                    <div>
                                        <p class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Query Aggregate</p>
                                        <p id="query-total-sum" class="text-2xl font-black text-slate-900 mt-1 num-font w-full max-w-[200px] break-all">0.00</p>
                                    </div>
                                    <button onclick="window.exportCustomQueryPDF()" class="bg-emerald-50 text-emerald-600 px-4 py-2 flex items-center rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all border border-emerald-100 shrink-0 self-center">
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
                </div>`;
                setTimeout(() => {
                    lucide.createIcons();
                }, 50);
                break;
                case 'change-password':
                    t.innerText = 'Security Settings';
                    c.innerHTML = `
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
                            <button onclick="window.handleChangePassword()" class="w-full bg-amber-500 text-white p-4 rounded-2xl font-black uppercase text-xs shadow-lg hover:bg-amber-600 transition-all mt-6">Update Credentials</button>
                        </div>
                    `; break;
                case 'accounts':
                    t.innerText = 'Asset Registration';
                    c.innerHTML = `
                        <div class="max-w-md mx-auto bg-slate-800/95 backdrop-blur-xl p-8 rounded-[2.5rem] border border-slate-700/80 text-center shadow-2xl">
                        

                            
                            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">— OR ADD ANY ASSET —</p>

                            <input type="text" id="an" placeholder="Identifier (e.g. HDFC Gold Fund)" class="w-full p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold mb-4 outline-none focus:border-rose-500 placeholder-slate-500">
                            
                            <div class="grid grid-cols-2 gap-4 mb-4">
                                <select id="ac" class="p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold text-center">
                                    <option value="AED">AED</option>
                                    <option value="INR">INR</option>
                                </select>
                                <select id="at" onchange="window.toggleAssetFields()" class="p-4 border border-slate-700 bg-slate-900 text-white rounded-2xl font-bold text-center">
                                    ${state.data.assetTypes.map(ty => `<option value="${ty}">${ty}</option>`).join('')}
                                </select>
                            </div>

                            <div id="inv-type-container" class="hidden mb-4">
                                <p class="text-[9px] font-bold text-slate-400 mb-1 uppercase">Investment Type</p>
                                <select id="inv-type" onchange="window.toggleAssetFields()" class="text-slate-900 w-full p-4 border rounded-xl font-bold text-center bg-slate-50 text-slate-700">
                                    <option value="General">General / Stock</option>
                                    <option value="Commodity">Commodity (Gold, Silver...)</option>
                                    <option value="Mutual Fund">Mutual Fund</option>
                                    <option value="Crypto">Crypto</option>
                                    <option value="Bond">Bond / Deposit</option>
                                </select>
                            </div>

                            <!-- Dynamic Inputs -->
                            <div id="dynamic-inputs" class="space-y-4 mb-6">
                                
                                <!-- Emergency Fund Target -->
                                <div id="inp-emf" class="hidden">
                                    <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Target Amount (Optional)</label>
                                    <input type="number" id="emf-target" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-mono" placeholder="Target">
                                </div>

                                <!-- Default: Balance -->
                                <div id="inp-balance">
                                    <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Current Balance</label>
                                    <input type="number" id="ab" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-mono" placeholder="0.00">
                                </div>
                                <div id="inp-balance-note" class="hidden text-[10px] text-slate-400 font-bold text-center mt-1">Enter current available cash in bank/wallet</div>

                                <!-- Commodity -->
                                <div id="inp-commodity" class="hidden space-y-4">
                                    <div>
                                        <label class="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Metal Type</label>
                                        <select id="commodity-type" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 text-xs">
                                            <option value="Gold">Gold</option>
                                            <option value="Silver">Silver</option>
                                            <option value="Oil">Oil</option>
                                            <option value="Diamond">Diamond</option>
                                        </select>
                                    </div>
                                </div>

                                <!-- Mutual Fund -->
                                <div id="inp-fund" class="hidden space-y-4">
                                    <input type="text" id="mf-cat" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 text-xs" placeholder="Category (e.g. Small Cap)">
                                </div>

                                <!-- Real Estate -->
                                <div id="inp-re" class="hidden space-y-4">
                                    <input type="text" id="re-loc" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 text-xs" placeholder="Location (e.g. Dubai Marina)">
                                    <div class="grid grid-cols-2 gap-4">
                                        <select id="re-type" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 text-xs">
                                            <option value="Residential">Residential</option>
                                            <option value="Commercial">Commercial</option>
                                            <option value="Land">Land</option>
                                        </select>
                                        <input type="text" id="re-area" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 outline-none text-slate-900 text-xs" placeholder="Area (sqft)">
                                    </div>
                                </div>

                                <!-- Crypto -->
                                <div id="inp-crypto" class="hidden grid grid-cols-2 gap-4">
                                    <input type="text" id="cry-sym" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 text-xs uppercase" placeholder="Symbol (BTC)">
                                    <input type="text" id="cry-net" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 text-xs" placeholder="Network (ERC20)">
                                </div>

                                <!-- Bond/Deposit -->
                                <div id="inp-bond" class="hidden grid grid-cols-2 gap-4">
                                    <input type="date" id="bond-date" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 text-xs" title="Maturity Date">
                                    <input type="number" id="bond-rate" class="text-slate-900 w-full p-4 border rounded-xl font-bold bg-slate-50 text-xs" placeholder="Rate %">
                                </div>
                            </div>
                            <button id="btn-save-acc" onclick="window.saveAccount()" class="w-full bg-emerald-500 text-white p-5 rounded-3xl font-black uppercase text-sm shadow-xl hover:bg-emerald-600 transition-all">Save Account</button>
                        </div>`; break;


                case 'transaction': t.innerText = 'Data Movement'; c.innerHTML = `
                    <div class="text-slate-100 max-w-2xl mx-auto bg-slate-800 p-8 md:p-10 rounded-[2.5rem] border border-slate-700 shadow-2xl text-center">
                        <div id="tx-warning" class="hidden mb-4 p-3 bg-amber-500/10 text-amber-300 rounded-xl text-xs font-bold border border-amber-500/30"></div>
                        <div class="grid grid-cols-2 gap-4 mb-6 text-center">
                            <button id="be" onclick="window.setT('expense')" class="p-4 rounded-2xl border-2 border-rose-500 bg-rose-600 text-white font-black text-xs uppercase shadow-lg shadow-rose-600/30 transition-all">Expense</button>
                            <button id="bi" onclick="window.setT('income')" class="p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-slate-400 font-black text-xs uppercase hover:text-slate-200 transition-all">Income</button>
                        </div>
                        <input type="hidden" id="tt" value="expense">
                        <div class="mb-4 text-left">
                            <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-1 block">Account</label>
                            <select id="ta" class="w-full p-4 border border-slate-700 rounded-xl font-bold bg-slate-900 text-white text-center outline-none">${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(a => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}</select>
                        </div>
                        <div class="grid grid-cols-2 gap-4 mb-4 text-left">
                            <div>
                                <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-1 block">Category</label>
                                <select id="tc" onchange="window.checkBudgetWarning()" class="w-full p-4 border border-slate-700 rounded-xl font-bold text-sm text-center bg-slate-900 text-white outline-none">${window.renderCategoryOptions()}</select>
                            </div>
                            <div>
                                <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-1 block">Amount</label>
                                <input type="number" id="tam" placeholder="0.00" oninput="window.checkBudgetWarning()" class="w-full p-4 border border-slate-700 rounded-xl font-black text-center bg-slate-900 text-white focus:border-rose-500 outline-none num-font">
                            </div>
                        </div>
                        <div class="mb-6 text-left">
                            <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2 mb-1 block">Note (Optional)</label>
                            <input type="text" id="tn" placeholder="e.g. Grocery, Lunch, Rent" class="w-full p-4 border border-slate-700 rounded-xl bg-slate-900 text-white outline-none focus:border-rose-500">
                        </div>
                        <button id="btn-save-tx" onclick="window.saveTransaction()" class="w-full bg-rose-600 hover:bg-rose-700 text-white p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-rose-600/30 transition-all text-center">Authorize entry</button>
                    </div>`; break;
                case 'transfer': t.innerText = 'Transfer & Invest'; c.innerHTML = `
                    <div class="text-slate-100 max-w-3xl mx-auto bg-slate-800 border border-slate-700 p-10 rounded-[3rem] border shadow-2xl text-center">
                        <div class="grid grid-cols-2 gap-4 mb-6 text-center">
                            <div>
                                <label class="text-[9px] font-black uppercase text-slate-400 block mb-1 text-left ml-2 text-center">From (Source)</label>
                                <select id="ts" onchange="window.toggleTradeFields()" class="w-full p-4 border rounded-xl font-bold text-center text-center">
                                    ${state.data.accounts.map(a => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="text-[9px] font-black uppercase text-slate-400 block mb-1 text-left ml-2 text-center">To (Dest)</label>
                                <select id="ttg" onchange="window.toggleTradeFields()" class="w-full p-4 border rounded-xl font-bold text-center text-center">
                                    ${state.data.accounts.map(a => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <!-- ASSET TRADE UI REMOVED FOR COST-BASIS ONLY MODE -->

                        <input type="number" id="tamt" oninput="window.calcRemit(this.value)" class="w-full p-6 border-2 rounded-2xl font-black text-3xl text-center mb-4 text-center outline-none focus:border-emerald-500" placeholder="Sending Amount">
                        <div id="remit-preview" class="text-xs font-black text-emerald-600 mb-6 h-4 text-center"></div>
                        <input type="text" id="trn" placeholder="Transfer Node / Description" class="w-full p-4 border rounded-xl mb-4 text-center outline-none focus:border-emerald-500">
                        <div class="mb-6 relative">
                            <label class="text-[9px] font-black uppercase text-slate-400 block mb-1 text-center">Budget Category (Optional)</label>
                            <select id="tcat" class="w-full p-4 border rounded-xl font-bold text-center text-center outline-none focus:border-emerald-500 bg-emerald-50/50">
                                ${window.renderCategoryOptions(true)}
                            </select>
                            <p class="text-[9px] text-slate-400 font-bold mt-2 text-center leading-tight px-4">If you select an Investment category, this transfer will count against your Monthly Budget.</p>
                        </div>
                        <div id="transfer-error-msg" class="hidden text-red-500 text-xs font-bold mt-2 mb-2"></div>
                        <button id="btn-do-transfer" onclick="window.doTransfer()" class="w-full bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase shadow-xl text-center">Authorize Transfer</button>
                        <p class="mt-4 text-[10px] text-slate-400 font-bold">Use this to move funds to Investment Accounts or Remit.</p>
                    </div>`; break;
                case 'debt': t.innerText = 'Liability Management'; c.innerHTML = window.renderDebtUI(); break;
                case 'settings': t.innerText = 'Configuration Hub'; c.innerHTML = window.renderSettingsUI(); break;
                case 'reports': t.innerText = 'Summaries'; c.innerHTML = window.renderDistributionInsights(); break;
                case 'analytics': t.innerText = 'Financial Health Board'; window.renderDashboard(); break;
                case 'budget': t.innerText = 'Monthly Budgeting'; c.innerHTML = window.renderBudgetUI(); setTimeout(window.recalculateBalances, 50); break;

                case 'goals': t.innerText = 'My Goals (Sinking Funds)'; c.innerHTML = window.renderGoalsUI(); break;
                case 'tags': t.innerText = 'Projects & Tag Analytics'; c.innerHTML = window.renderTagsUI(); break;
                case 'calculator': t.innerText = 'Compound Projector'; c.innerHTML = window.renderCalculator(); break;
                case 'subscriptions': t.innerText = 'Recurring Auto-Pay'; c.innerHTML = window.renderSubscriptionsUI(); break;
                case 'import': t.innerText = 'Import Statement'; c.innerHTML = window.renderImportUI(); break;
                case 'salary': t.innerText = 'Process Salary Day'; c.innerHTML = `
                    <div class="text-slate-900 max-w-md mx-auto bg-white p-10 rounded-[3rem] border shadow-xl text-center">
                        <h3 class="text-xl font-black text-slate-900 mb-4">Salary Allocation</h3>
                        <div class="mb-4">
                            <label class="text-[10px] font-black uppercase text-slate-400 block mb-1 text-left ml-2">Total Salary Amount</label>
                            <input type="number" id="sal-amount" placeholder="0.00" class="w-full p-4 border rounded-xl font-black text-center focus:border-emerald-500" oninput="window.calcSalAlloc()">
                        </div>
                        <div class="grid grid-cols-3 gap-2 mb-4">
                            <div>
                                <label class="text-[9px] font-bold uppercase text-slate-400 block mb-1">Savings (%)</label>
                                <input type="number" id="sal-sav-pct" value="20" class="w-full p-2 border rounded-lg text-center" oninput="window.calcSalAlloc()">
                                <p id="sal-sav-val" class="text-xs font-bold text-emerald-600 mt-1">0.00</p>
                            </div>
                            <div>
                                <label class="text-[9px] font-bold uppercase text-slate-400 block mb-1">Invest (%)</label>
                                <input type="number" id="sal-inv-pct" value="30" class="w-full p-2 border rounded-lg text-center" oninput="window.calcSalAlloc()">
                                <p id="sal-inv-val" class="text-xs font-bold text-indigo-600 mt-1">0.00</p>
                            </div>
                            <div>
                                <label class="text-[9px] font-bold uppercase text-slate-400 block mb-1">Expense (%)</label>
                                <input type="number" id="sal-exp-pct" value="50" class="w-full p-2 border rounded-lg text-center" oninput="window.calcSalAlloc()">
                                <p id="sal-exp-val" class="text-xs font-bold text-rose-600 mt-1">0.00</p>
                            </div>
                        </div>
                        <div class="mb-4">
                             <label class="text-[10px] font-black uppercase text-slate-400 block mb-1 text-left ml-2">Receiving Account</label>
                             <select id="sal-acc" class="w-full p-4 border rounded-xl font-bold text-center">${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(a => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}</select>
                        </div>
                        <button onclick="window.processSalary()" class="w-full bg-emerald-500 text-white p-4 rounded-2xl font-black uppercase shadow-lg mb-2">Execute Allocations</button>
                        <button onclick="window.printSalary()" class="w-full bg-slate-100 text-slate-600 p-4 rounded-2xl font-bold uppercase mt-2"><i data-lucide="printer" class="inline w-4 h-4 mr-1"></i> Print Summary</button>
                    </div>`; 
                    setTimeout(() => lucide.createIcons(), 50);
                    break;
                // NEW FEATURES
                case 'remittance': t.innerText = 'Arbitrage Tracker'; c.innerHTML = window.renderRemittance(); setTimeout(window.renderRemitChart, 300); break;
                case 'zakat': t.innerText = 'Zakat Calculator'; c.innerHTML = window.renderZakatCalculator(); break;
                case 'zakat_payment': t.innerText = 'Record Zakat Payment'; c.innerHTML = window.renderZakatPaymentModal(); break;


                case 'sweep':
                    t.innerText = 'Budget Sweep';
                    const sw = window.pendingSweep || { cat: '?', amt: 0 };
                    c.innerHTML = `
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
                                        ${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(a => `<option value="${a.id}">${a.name} (Avl: ${a.balance})</option>`).join('')}
                                    </select>
                                </div>
                                <div class="flex justify-center text-slate-300"><i data-lucide="arrow-down" class="w-6 h-6"></i></div>
                                <div>
                                    <label class="text-[9px] font-black uppercase text-slate-400 ml-3 mb-1 block">To Savings Pot (Goal)</label>
                                    <select id="sw-goal" class="text-slate-900 w-full p-4 border rounded-xl font-bold text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500">
                                        <option value="">Select Target...</option>
                                        ${state.data.goals.map(g => `<option value="${g.id}">${g.name} (Saved: ${g.saved})</option>`).join('')}
                                    </select>
                                </div>
                            </div>
                            
                            <button onclick="window.finalizeSweep()" class="w-full bg-slate-900 text-white p-5 rounded-2xl font-black uppercase shadow-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 mt-4">
                                <i data-lucide="sparkles" class="w-5 h-5"></i> Confirm Sweep
                            </button>
                        </div>
                    `;
                    break;
            }
            lucide.createIcons();
        };

        // renderGoalsUI function removed

        window.renderZakatCalculator = function () {
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
            window.currentZakatDue = zakatDue;

            return `<div class="max-w-xl mx-auto space-y-8 text-center">
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

                <button onclick="window.initZakatPaymentFlow()" class="w-full bg-emerald-500 text-white p-5 rounded-3xl font-black uppercase shadow-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2">
                    <i data-lucide="check-circle" class="w-5 h-5"></i> Record Zakat Payment
                </button>
            </div>`;
        };

        window.renderZakatPaymentModal = function () {
            const zakatAmount = window.currentZakatDue ? Math.round(window.currentZakatDue) : 0;
            const validAccounts = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type));
            
            let accountOptions = validAccounts.map(a => `<option value="${a.id}">${a.name} (${a.currency} ${a.balance.toLocaleString()})</option>`).join('');

            return `<div class="text-slate-900 max-w-md mx-auto bg-white p-8 rounded-[2.5rem] text-left space-y-6">
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

                <button id="btn-process-zakat" onclick="window.processZakatPayment()" class="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg flex items-center justify-center space-x-2">
                    <span id="btn-process-zakat-text">Confirm Payment</span>
                </button>
            </div>`;
        };

        window.processZakatPayment = async function () {
            const amt = parseFloat(document.getElementById('zakat-pay-amount').value);
            const accId = document.getElementById('zakat-pay-account').value;

            if (!amt || amt <= 0 || !accId) {
                window.showToast("Please enter a valid amount and select an account.", "error");
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
                window.showToast("Insufficient funds in selected account.", "error");
                return;
            }

            window.setBtnLoading('btn-process-zakat', true);

            // Deduct from account
            acc.balance -= finalDeduction;

            // Create Transaction
            const newTx = {
                id: window.genId(),
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
            
            await window.updateDb();
            window.showToast("Zakat payment recorded successfully! May Allah accept it.", "success");
            window.closeModal();
            window.renderDashboard(true);
        };

        window.initZakatPaymentFlow = function () {
            const currentRate = (state.data.commodityRates && state.data.commodityRates.Silver) ? state.data.commodityRates.Silver : 90;
            window.showPrompt('Confirm Silver Rate', `Enter current silver market rate (INR/gram). Current stored rate is ₹${currentRate}.`, async (val) => {
                const rate = parseFloat(val);
                if (isNaN(rate) || rate <= 0) {
                    window.showToast("Invalid rate entered.", "error");
                    return;
                }
                
                if (!state.data.commodityRates) state.data.commodityRates = {};
                state.data.commodityRates.Silver = rate;
                
                // Recalculate implicitly by running render function (updates global window.currentZakatDue)
                window.renderZakatCalculator();
                
                // Persist new rate
                await window.updateDb();
                
                // Open payment modal
                window.openModal('zakat_payment');
            }, 'number');
        };

        // createGoal, contribGoal, deleteGoal removed


        window.sweepBudget = function (cat, amt) {
            window.showToast("Savings Pots feature removed.", "warning");
        };

        window.finalizeSweep = async function () {
            const sw = window.pendingSweep;
            if (!sw) return;

            const srcId = document.getElementById('sw-src').value;
            const goalId = document.getElementById('sw-goal').value;

            if (!srcId || !goalId) {
                window.showToast("Please select both source and target.", "warning");
                return;
            }

            const acc = state.data.accounts.find(a => a.id === srcId);
            const goal = state.data.goals.find(g => g.id === goalId);

            if (!acc || !goal) return;
            if (acc.balance < sw.amt) {
                window.showToast("Insufficient funds in selected account!", "error");
                return;
            }

            // Execute
            const accIdx = state.data.accounts.findIndex(a => a.id === acc.id);
            const gIdx = state.data.goals.findIndex(g => g.id === goal.id);

            state.data.accounts[accIdx].balance = window.toCurrency(state.data.accounts[accIdx].balance - sw.amt);
            state.data.goals[gIdx].saved += sw.amt;

            // Log Transaction (Mark as Sweep)
            state.data.transactions.push({
                id: window.genId(),
                accountId: acc.id,
                amount: window.toCurrency(sw.amt),
                type: 'transfer_out',
                category: 'Sweep',
                note: `Budget Sweep: ${sw.cat} -> ${goal.name} `,
                date: new Date().toISOString()
            });

            await updateDb();
            window.closeModal();
            window.renderApp();
            window.showToast(`✨ Swept ${sw.amt} into ${goal.name} !`, "success");
            window.pendingSweep = null; // Clear
        };

        window.setBudget = function (cat) {
            window.showPrompt(`Budget for ${cat}`, "Set Monthly Limit (AED):", async (valStr) => {
                const val = parseFloat(valStr);
                if (!isNaN(val)) {
                    if (!state.data.budgets) state.data.budgets = {};
                    state.data.budgets[cat] = val;
                    await updateDb(); window.openModal('budget');
                    window.showToast("Budget Updated", "success");
                }
            }, "number");
        };

        window.checkBudgetRollover = async function () {
            const now = new Date();
            const last = state.data.lastRolloverDate ? new Date(state.data.lastRolloverDate) : null;

            // If new month detected
            if (last && (now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear())) {
                window.showToast("📅 New Month! Processing Rollovers...", "info");
                if (!state.data.budgetRollovers) state.data.budgetRollovers = {};

                // Calculate rollovers from PREVIOUS month
                const cats = state.data.expenseCategories;
                for (let c of cats) {
                    const budget = (state.data.budgets && state.data.budgets[c]) || 0;
                    if (budget > 0) {
                        // Calc spend of LAST month
                        const spend = state.data.transactions.filter(t =>
                            t.type === 'expense' && t.category === c &&
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

        // --- SUBSCRIPTION MANAGER ---
        window.renderSubscriptionsUI = function () {
            return `<div class= "max-w-xl mx-auto space-y-6">
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
                                        ${state.data.accounts.map(a => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}
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
                                <button onclick="window.addSubscription()" class="w-full bg-slate-900 text-white p-3 rounded-xl font-black uppercase shadow-lg text-xs">Create Schedule</button>
                        </div>
                </div>

                <div class="space-y-4">
                    <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-2">Active Schedules</h4>
                    ${(state.data.subscriptions || []).map(s => {
                const acc = state.data.accounts.find(a => a.id === s.accountId);
                return `<div class="text-slate-900 bg-white p-5 rounded-[2rem] border shadow-sm flex justify-between items-center group">
                            <div class="text-left">
                                <p class="font-black text-slate-800">${s.name}</p>
                                <p class="text-[9px] font-bold text-slate-400 uppercase">
                                    ${s.billingCycle || 'Monthly'} • Next: ${new Date(s.nextDate).toLocaleDateString()}
                                    ${s.freeTrialEndDate && new Date(s.freeTrialEndDate) > new Date() ?
                        `<span class="ml-1 px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded text-[8px] font-black">TRIAL</span>` : ''}
                                </p>
                                ${acc ? `<p class="text-[8px] font-bold text-emerald-600 uppercase mt-0.5"><i data-lucide="link" class="w-3 h-3 inline"></i> ${acc.name}</p>` : ''}
                            </div>
                            <div class="text-right">
                                <p class="font-black text-lg ${s.type === 'income' ? 'text-emerald-500' : 'text-slate-800'}">${s.type === 'income' ? '+' : '-'} ${s.amount}</p>
                                <button onclick="window.deleteSubscription('${s.id}')" class="text-[9px] text-red-300 font-bold uppercase hover:text-red-500">Stop</button>
                            </div>
                        </div>`;
            }).join('') || '<p class="text-center text-slate-300 py-4 font-bold text-xs uppercase">No active subscriptions</p>'}
                </div>
            </div>`;
        };

        window.addSubscription = async function () {
            const name = document.getElementById('sub-name').value;
            const amount = parseFloat(document.getElementById('sub-amt').value);
            const day = parseInt(document.getElementById('sub-day').value);
            const type = document.getElementById('sub-type').value;
            const accId = document.getElementById('sub-acc').value;
            // Capture target if transfer
            const targetAccId = document.getElementById('sub-target-acc') ? document.getElementById('sub-target-acc').value : null;

            const cycle = document.getElementById('sub-cycle').value || 'Monthly';
            const trial = document.getElementById('sub-trial').value || null;

            if (!name || isNaN(amount) || isNaN(day) || !accId) {
                window.showToast("Please fill all required fields.", "error");
                return;
            }

            if (type === 'transfer' && !targetAccId) {
                window.showToast("Please select a Destination Account.", "error");
                return;
            }

            if (!state.data.subscriptions) state.data.subscriptions = [];

            // Calc next date: If today > day, then next month. Else this month.
            // Support Yearly cycle? For now, logic defaults to Monthly for 'nextDate' calc initially.
            // We can refine nextDate logic later if needed.
            const d = new Date();
            if (d.getDate() > day) d.setMonth(d.getMonth() + 1);
            d.setDate(day);

            state.data.subscriptions.push({
                id: window.genId(),
                name, amount, type,
                day,
                billingCycle: cycle,
                freeTrialEndDate: trial,
                nextDate: d.toISOString(),
                accountId: accId,
                targetAccountId: targetAccId || null,
                category: type === 'transfer' ? 'Transfer' : 'Recurring'
            });
            await updateDb();
            window.showToast("Subscription Added!", "success");
            window.openModal('subscriptions');
        };

        window.deleteSubscription = async function (id) {
            window.showConfirm("Stop this subscription?", "Future auto-transactions will be cancelled.", async () => {
                state.data.subscriptions = state.data.subscriptions.filter(s => s.id !== id);
                await updateDb(); window.openModal('subscriptions');
                window.showToast("Subscription cancelled.", "success");
            });
        };

        window.checkSubscriptions = async function () {
            if (!state.data.subscriptions) return;
            let executedLogs = [];
            const today = new Date();

            for (let sub of state.data.subscriptions) {
                const due = new Date(sub.nextDate);
                if (today >= due) {
                    if (sub.type === 'transfer') {
                        // --- TRANSFER LOGIC ---
                        const srcIdx = state.data.accounts.findIndex(a => a.id === sub.accountId);
                        const tgtIdx = state.data.accounts.findIndex(a => a.id === sub.targetAccountId);

                        if (srcIdx > -1 && tgtIdx > -1) {
                            const amt = parseFloat(sub.amount);
                            const srcAcc = state.data.accounts[srcIdx];
                            const tgtAcc = state.data.accounts[tgtIdx];

                            // 1. Transactions (No manual balance math, recalculateBalances does it)
                            const dateIso = new Date().toISOString();
                            state.data.transactions.push({
                                id: window.genId(), accountId: sub.accountId, amount: window.toCurrency(amt), type: 'transfer_out', category: 'Auto-Transfer', note: `To ${tgtAcc.name}: ${sub.name}`, date: dateIso
                            });
                            
                            let finalAmt = amt;
                            if (srcAcc.currency !== tgtAcc.currency) {
                                const rate = state.data.settings.rate;
                                if (srcAcc.currency === 'AED' && tgtAcc.currency === 'INR') finalAmt = amt * rate;
                                else if (srcAcc.currency === 'INR' && tgtAcc.currency === 'AED') finalAmt = amt / rate;
                            }
                            state.data.transactions.push({
                                id: window.genId(), accountId: sub.targetAccountId, amount: window.toCurrency(finalAmt), type: 'transfer_in', category: 'Auto-Transfer', note: `From ${srcAcc.name}: ${sub.name}`, date: dateIso
                            });

                            executedLogs.push(`Moved ${srcAcc.currency} ${amt} for ${sub.name}`);
                        }

                    } else {
                        // --- INCOME/EXPENSE LOGIC ---
                        const accIdx = state.data.accounts.findIndex(a => a.id === sub.accountId);
                        if (accIdx > -1) {
                            const amt = parseFloat(sub.amount);
                            const acc = state.data.accounts[accIdx];
                            
                            state.data.transactions.push({
                                id: window.genId(),
                                accountId: sub.accountId,
                                amount: window.toCurrency(amt),
                                type: sub.type,
                                category: sub.category,
                                note: `Auto-Pay: ${sub.name}`,
                                date: new Date().toISOString()
                            });
                            executedLogs.push(`${sub.type === 'income' ? 'Deposited' : 'Deducted'} ${acc.currency} ${amt} for ${sub.name}`);
                        }
                    }

                    // Advance Date by handling frequency (Monthly by default, can be extended later)
                    const next = new Date(due);
                    next.setMonth(next.getMonth() + 1);
                    sub.nextDate = next.toISOString();
                    
                    // Note: even if account not found, we advance the date so it doesn't loop infinitely
                }
            }
            if (executedLogs.length > 0) {
                await updateDb();
                window.recalculateBalances(); // Essential for Poka-Yoke ledger integrity
                window.renderApp();
                
                // Show Execution Report
                const b = document.getElementById('modal-backdrop');
                const t = document.getElementById('modal-title');
                const c = document.getElementById('modal-content');
                t.innerText = "Auto-Pilot Report";
                c.innerHTML = `
                <div class="text-slate-900 max-w-md mx-auto bg-white p-8 rounded-[3rem] text-center space-y-6">
                    <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                        <i data-lucide="bot" class="w-8 h-8"></i>
                    </div>
                    <p class="text-sm font-bold text-slate-500">I processed the following recurring transactions in the background while you were away:</p>
                    <ul class="text-slate-900 text-left space-y-3 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                        ${executedLogs.map(l => `<li class="flex items-center text-xs font-black text-slate-700"><i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-500 mr-2"></i> ${l}</li>`).join('')}
                    </ul>
                    <button onclick="window.closeModal()" class="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg hover:bg-emerald-500 transition-colors">Acknowledge</button>
                </div>`;
                b.classList.replace('hidden', 'flex');
                lucide.createIcons();
            }
        };

        window.renderGoalsUI = function () {
            if (!state.data.goals) state.data.goals = [];
            return `
            <div class="max-w-2xl mx-auto space-y-6 text-left">
                <div class="grid gap-4 max-h-[50vh] overflow-y-auto no-scrollbar custom-scrollbar pr-2">
                    ${state.data.goals.map(g => `
                    <div class="text-slate-900 bg-white border border-slate-200 rounded-3xl p-5 flex flex-col md:flex-row justify-between items-center shadow-sm">
                        <div class="flex items-center space-x-4 mb-4 md:mb-0">
                            <div class="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center">
                                <i data-lucide="${g.icon || 'target'}" class="w-6 h-6"></i>
                            </div>
                            <div>
                                <h4 class="font-bold text-sm text-slate-900">${g.name}</h4>
                                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Target: ${window.fmtMoney(g.target, g.currency)} | Saved: ${window.fmtMoney(g.saved, g.currency)}</p>
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            <button onclick="window.addGoalFunds('${g.id}')" class="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-bold uppercase hover:bg-emerald-100">+ Add Funds</button>
                            <button onclick="window.deleteGoal('${g.id}')" class="px-3 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-bold hover:bg-red-100"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                        </div>
                    </div>`).join('') || '<p class="text-center text-slate-400 py-8 font-bold text-xs uppercase tracking-widest">No Active Goals</p>'}
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
                    <button onclick="window.saveGoal()" class="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg hover:bg-indigo-500 transition-colors">Create Goal Envelope</button>
                </div>
                <button onclick="window.closeModal()" class="w-full text-slate-400 py-3 text-[10px] font-black uppercase tracking-widest hover:text-slate-600 transition-colors">Close Menu</button>
            </div>`;
        };

        window.saveGoal = async function () {
            const name = document.getElementById('g-name').value;
            const target = document.getElementById('g-target').value;
            const currency = document.getElementById('g-currency').value;
            const icon = document.getElementById('g-icon').value;

            if (!name || !target) return window.showToast("Fill required fields", "error");

            if (!state.data.goals) state.data.goals = [];
            state.data.goals.push({
                id: window.genId(),
                name, target: parseFloat(target), saved: 0, currency, icon
            });

            await updateDb();
            window.openModal('goals');
            window.recalculateBalances();
            window.renderApp();
            window.showToast("Goal Created", "success");
        };

        window.deleteGoal = async function (id) {
            if (confirm("Remove this goal? The funds will simply return to your 'Safe to Spend' limit.")) {
                state.data.goals = state.data.goals.filter(g => g.id !== id);
                await updateDb();
                window.openModal('goals');
                window.recalculateBalances();
                window.renderApp();
            }
        };

        window.addGoalFunds = function (id) {
            const g = state.data.goals.find(x => x.id === id);
            if (!g) return;
            window.showPrompt("Add Funds to " + g.name, "Enter the amount of " + g.currency + " to lock into this goal envelope:", async (amtStr) => {
                const amt = parseFloat(amtStr);
                if (isNaN(amt) || amt <= 0) return;
                g.saved += amt;
                if (g.saved > g.target) g.saved = g.target; // Cap it
                await updateDb();
                window.openModal('goals');
                window.recalculateBalances();
                window.renderApp();
            }, 'number');
        };

        window.renderTagsUI = function () {
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

            return `
            <div class="max-w-4xl mx-auto space-y-6">
                <div class="flex flex-wrap gap-2 mb-6 justify-center">
                    ${tagsArray.map(t => `
                        <button onclick="window.viewTagDetails('${t.name}')" class="text-slate-900 px-4 py-2 bg-slate-50 hover:bg-pink-50 hover:text-pink-600 rounded-xl border border-slate-200 text-xs font-black text-slate-600 transition-colors">
                            ${t.name} <span class="ml-1 opacity-50 font-normal">(${t.count})</span>
                        </button>
                    `).join('') || '<p class="text-xs font-bold text-slate-400">No #tags found in any transactions yet.</p>'}
                </div>
                
                <div id="tag-detail-view" class="text-slate-900 bg-slate-50 rounded-[2.5rem] border border-slate-100 p-8 hidden text-center">
                    <!-- Tag specific UI injected here by viewTagDetails -->
                </div>
            </div>
            `;
        };

        window.viewTagDetails = function(tagName) {
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

            v.innerHTML = `
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
                        return `
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
            `;
            lucide.createIcons();
        };

        window.renderCalculator = function () {
            // Simple SIP Projector
            return `<div class="text-slate-900 max-w-md mx-auto bg-white p-8 rounded-[3rem] border shadow-xl text-center space-y-6">
                <h3 class="font-black text-xl">SIP Projector</h3>
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="text-[9px] font-bold uppercase text-slate-400">Monthly Inv</label><input type="number" id="sip-amt" value="5000" class="w-full p-3 border rounded-xl font-bold text-center"></div>
                    <div><label class="text-[9px] font-bold uppercase text-slate-400">Return %</label><input type="number" id="sip-rate" value="12" class="w-full p-3 border rounded-xl font-bold text-center"></div>
                </div>
                <div><label class="text-[9px] font-bold uppercase text-slate-400">Time Period (Years)</label><input type="range" id="sip-years" min="1" max="30" value="10" class="w-full accent-emerald-500" oninput="document.getElementById('yr-val').innerText = this.value + ' Years'; window.calcSIP()"> <p id="yr-val" class="font-black text-emerald-600">10 Years</p></div>
                <div class="text-slate-900 bg-slate-50 p-6 rounded-3xl"><p class="text-xs text-slate-400 font-bold uppercase">Estimated Value</p><p id="sip-result" class="text-4xl font-black text-emerald-600 mt-2">₹0</p></div>
                <button onclick="window.calcSIP()" class="w-full bg-slate-900 text-white py-3 rounded-xl font-bold uppercase text-xs">Calculate</button>
            </div> `;
        };

        window.calcSIP = function () {
            const P = parseFloat(document.getElementById('sip-amt').value);
            const r = parseFloat(document.getElementById('sip-rate').value) / 100 / 12;
            const n = parseFloat(document.getElementById('sip-years').value) * 12;

            const FV = P * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
            document.getElementById('sip-result').innerText = '₹' + Math.round(FV).toLocaleString();
        };

        window.renderDashboard = function (instant = false) {
            const c = document.getElementById('modal-content');

            // --- DATA PREP ---
            const r = state.data.settings.rate;
            const d = new Date(); d.setMonth(d.getMonth() - 1); // Last 30 Days snapshot for velocity/rhythm
            const txs = state.data.transactions;

            // 1. CALC FINANCIAL HEALTH SCORE VARIABLES
            // A. Savings Rate (Last 30 Days)
            const last30Inc = txs.filter(t => t.type === 'income' && new Date(t.date) >= d).reduce((s, t) => s + window.toChartCur(Number(t.amount), t.currency || 'AED', r), 0);
            const last30Exp = txs.filter(t => t.type === 'expense' && new Date(t.date) >= d).reduce((s, t) => s + window.toChartCur(Number(t.amount), t.currency || 'AED', r), 0);
            const savingsRate = last30Inc > 0 ? Math.max(0, ((last30Inc - last30Exp) / last30Inc) * 100) : 0;

            // B. Runway (Months)
            const liquid = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).reduce((s, a) => s + window.toChartCur(a.balance, a.currency || 'AED', r), 0);
            const avgExp = last30Exp > 0 ? last30Exp : 1; // Avoid div by 0
            const runway = liquid / avgExp;

            // C. Debt Load (Debt / Assets)
            const totalAssets = state.data.accounts.reduce((s, a) => s + window.toChartCur(a.balance, a.currency || 'AED', r), 0);
            const totalDebt = state.data.debts.filter(d => !d.settled).reduce((s, d) => s + window.toChartCur(d.amount, d.currency || 'AED', r), 0);
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
                dayCounts[day] += window.toChartCur(Number(t.amount), t.currency || 'AED', r);
            });

            // 3. EXPENSE RADAR (Categories)
            const catMap = {};
            txs.filter(t => t.type === 'expense').forEach(t => {
                catMap[t.category] = (catMap[t.category] || 0) + window.toChartCur(Number(t.amount), t.currency || 'AED', r);
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
                const val = window.toChartCur(a.balance, a.currency || 'AED', r);
                if (val > 0) assetMap[k] = (assetMap[k] || 0) + val;
            });

            // --- OLD ANALYTICS LOGIC MERGE ---
            // 1. Net Worth (Liquid + Invested - Debts)
            let totalNW = 0;
            state.data.accounts.forEach(a => totalNW += window.toChartCur(a.balance, a.currency || 'AED', r));
            state.data.debts.forEach(d => {
                if (!d.settled) {
                    const val = window.toChartCur(Number(d.amount), d.currency || 'AED', r);
                    totalNW += (d.type === 'receivable' ? val : -val);
                }
            });

            // 2. Annual Expenses (Extrapolated from last 6 months)
            const d6m = new Date(); d6m.setMonth(d6m.getMonth() - 6);
            const recentExp = state.data.transactions.filter(t => t.type === 'expense' && new Date(t.date) >= d6m).reduce((s, t) => {
                const acc = state.data.accounts.find(a => a.id === t.accountId);
                const cur = t.currency || acc?.currency || 'AED';
                return s + window.toChartCur(Number(t.amount), cur, r);
            }, 0);

            const avgMonthlyExpOLD = recentExp / 6;
            const annualExp = avgMonthlyExpOLD * 12;

            // Output Metrics
            const freedomYears = annualExp > 0 ? (totalNW / annualExp).toFixed(1) : '∞';
            const freedomDate = annualExp > 0 ? new Date(new Date().setFullYear(new Date().getFullYear() + parseFloat(freedomYears))) : 'Forever';
            const dateStr = freedomDate === 'Forever' ? 'Infinity' : freedomDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            // HTML MERGE
            const currSym = window.chartCurrency === 'AED' ? 'AED' : '₹';
            c.innerHTML = `
            <div class="space-y-8 py-4">
                
                <!-- CURRENCY TOGGLE -->
                <div class="flex justify-center mb-6">
                    <div class="bg-slate-200 p-1 rounded-xl flex items-center gap-1">
                        <button onclick="window.setChartCurrency('AED')" class="text-slate-900 px-6 py-2 text-[10px] uppercase font-black tracking-widest rounded-lg transition-all ${window.chartCurrency === 'AED' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">AED</button>
                        <button onclick="window.setChartCurrency('INR')" class="text-slate-900 px-6 py-2 text-[10px] uppercase font-black tracking-widest rounded-lg transition-all ${window.chartCurrency === 'INR' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">INR</button>
                    </div>
                </div>

                <!-- 1. HEALTH SCORE (REMOVED) -->

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


            </div>`;

            // --- HELPER: FORMAT MONEY PLAIN TEXT ---
            if (!window.fmtMoneyText) {
                window.fmtMoneyText = (val, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(val);
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
                window.renderCharts();
                window.renderAllocationChart();
            } else {
                setTimeout(() => {
                    window.renderCharts();
                    window.renderAllocationChart();
                }, 500); // Trigger Old Charts logic with animation delay
            }
        };

        window.runRealityCheck = function () {
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
            c.innerHTML = `
            <div class="max-w-md mx-auto space-y-8 text-center py-6">
                <!--NET WORTH CARD-->
                <div class="bg-indigo-900 text-white p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
                    <div class="relative z-10">
                        <p class="text-[10px] text-indigo-300 font-black uppercase tracking-widest mb-2">Net Wealth</p>
                        <h2 class="text-5xl font-black text-white num-font mb-2">AED ${Math.round(netFree).toLocaleString()}</h2>
                        <p class="text-[10px] font-bold text-indigo-400">Total Assets - Total Liabilities</p>
                    </div>
                    <div class="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
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



                <button onclick="window.renderSettingsUI(); window.openModal('settings');" class="text-slate-400 font-bold text-xs hover:text-slate-800 transition-colors uppercase">
                    Back to Settings
                </button>
            </div> `;

            b.classList.replace('hidden', 'flex');
            lucide.createIcons();
        };

        window.renderSettingsUI = function () {

            const s = state.data.settings;
            // Defaults
            const startDay = s.budgetStartDay || 1;
            const expRet = s.forecastReturn || 8;
            const infRate = s.inflationRate || 5;
            const alertLim = s.budgetAlertLimit || 80;
            const minRunway = s.minRunwayMonths || 6;

            return `
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
                        <button onclick="window.runRealityCheck()" class="bg-indigo-500 hover:bg-indigo-400 text-white py-3 px-6 rounded-2xl font-black uppercase shadow-lg transition-all flex items-center justify-center gap-3 mx-auto text-xs">
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
                
                <!--3.5 MESSAGING INFRASTRUCTURE (Universal)-->
                <div class="bg-slate-800/50 p-6 rounded-[3rem] border border-slate-700/50 flex flex-col justify-center text-center shadow-lg">
                    <div class="flex items-center justify-center gap-2 mb-6">
                        <i data-lucide="message-square" class="w-4 h-4 text-rose-400"></i>
                        <p class="text-[10px] font-black text-rose-400 uppercase tracking-widest">Messaging Infrastructure</p>
                    </div>
                    
                    <!-- Mode Toggle -->
                    <div class="flex items-center justify-between p-4 bg-slate-900/80 rounded-2xl border border-slate-700 mb-6">
                        <span class="text-xs font-bold text-slate-300">Auto-Messaging (API)</span>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="sets-auto-msg" class="sr-only peer" ${state.data.settings.isAutoMessagingEnabled ? 'checked' : ''}>
                            <div class="text-slate-900 w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-rose-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
                        </label>
                    </div>

                    <p class="text-[9px] font-bold text-slate-400 uppercase text-left ml-1 mb-2">Universal API Token</p>
                    <input type="password" id="sets-whapi" value="${state.data.settings.messagingToken || state.data.settings.whapiToken || ''}" placeholder="Paste API Token Here" class="w-full p-4 bg-slate-900/80 border border-slate-700 rounded-xl text-center font-bold text-xs text-white outline-none focus:border-rose-500 focus:ring-1 ring-rose-500/50 mb-6 placeholder-slate-600">
                    
                    <p class="text-[9px] font-bold text-slate-400 uppercase text-left ml-1 mb-2">My Phone (Self Reminders)</p>
                    <input type="tel" id="sets-myphone" value="${state.data.settings.myPhone || ''}" placeholder="97150..." class="w-full p-4 bg-slate-900/80 border border-slate-700 rounded-xl text-center font-bold text-xs text-white outline-none focus:border-rose-500 focus:ring-1 ring-rose-500/50 placeholder-slate-600">
                    
                    <p class="text-[8px] text-slate-500 mt-4 font-bold leading-relaxed">Toggle OFF for Manual drafting via WhatApp. Toggle ON for background API automation.</p>
                </div>

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
                        <button onclick="window.addWizardCategory()" class="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-3 rounded-xl font-black text-xs uppercase flex items-center justify-center gap-1 shrink-0 shadow-lg shadow-emerald-500/20">
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
                                ${(state.data.expenseCategories || []).map(c => `
                                    <div class="flex justify-between items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/50 text-xs text-white">
                                        <span class="font-bold truncate mr-1">${c}</span>
                                        <div class="flex items-center gap-1 shrink-0">
                                            <select onchange="window.setCategoryPillar('${c}', 'expense', this.value)" class="bg-slate-800 border border-slate-700 text-[9px] text-slate-300 rounded p-1 font-bold outline-none">
                                                <option value="expense" selected>Living</option>
                                                <option value="savings">Savings</option>
                                                <option value="investment">Invest</option>
                                            </select>
                                            <button onclick="window.deleteCategory('${c}')" title="Delete" class="text-slate-500 hover:text-rose-400 p-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                                        </div>
                                    </div>
                                `).join('') || '<p class="text-[10px] text-slate-500 py-2">No categories</p>'}
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
                                ${(state.data.savingsCategories || []).map(c => `
                                    <div class="flex justify-between items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/50 text-xs text-white">
                                        <span class="font-bold truncate mr-1">${c}</span>
                                        <div class="flex items-center gap-1 shrink-0">
                                            <select onchange="window.setCategoryPillar('${c}', 'savings', this.value)" class="bg-slate-800 border border-slate-700 text-[9px] text-slate-300 rounded p-1 font-bold outline-none">
                                                <option value="expense">Living</option>
                                                <option value="savings" selected>Savings</option>
                                                <option value="investment">Invest</option>
                                            </select>
                                            <button onclick="window.deleteCategory('${c}')" title="Delete" class="text-slate-500 hover:text-rose-400 p-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                                        </div>
                                    </div>
                                `).join('') || '<p class="text-[10px] text-slate-500 py-2">No savings funds</p>'}
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
                                ${(state.data.investmentCategories || []).map(c => `
                                    <div class="flex justify-between items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/50 text-xs text-white">
                                        <span class="font-bold truncate mr-1">${c}</span>
                                        <div class="flex items-center gap-1 shrink-0">
                                            <select onchange="window.setCategoryPillar('${c}', 'investment', this.value)" class="bg-slate-800 border border-slate-700 text-[9px] text-slate-300 rounded p-1 font-bold outline-none">
                                                <option value="expense">Living</option>
                                                <option value="savings">Savings</option>
                                                <option value="investment" selected>Invest</option>
                                            </select>
                                            <button onclick="window.deleteCategory('${c}')" title="Delete" class="text-slate-500 hover:text-rose-400 p-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                                        </div>
                                    </div>
                                `).join('') || '<p class="text-[10px] text-slate-500 py-2">No investments</p>'}
                            </div>
                        </div>
                    </div>

                    <!-- Income Sources Row -->
                    <div class="mt-4 pt-4 border-t border-slate-700/50">
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2">💵 Income Sources (${(state.data.incomeCategories || []).length})</p>
                        <div class="flex flex-wrap gap-2">
                            ${(state.data.incomeCategories || []).map(c => `
                                <div class="inline-flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-700/50 text-xs text-white">
                                    <span class="font-bold">${c}</span>
                                    <button onclick="window.deleteCategory('${c}')" class="text-slate-500 hover:text-rose-400"><i data-lucide="trash-2" class="w-3 h-3"></i></button>
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
                            ${[...state.data.incomeCategories, ...state.data.expenseCategories].map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                        <i data-lucide="arrow-right" class="w-4 h-4 text-slate-500 hidden md:block"></i>
                        <select id="merge-target" class="p-3 border border-slate-700 bg-slate-900/80 rounded-xl font-bold text-xs w-full md:w-48 text-white outline-none focus:border-rose-500">
                            <option value="">Target Category...</option>
                            ${[...state.data.incomeCategories, ...state.data.expenseCategories].map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                        <button onclick="window.mergeCategories()" class="bg-rose-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-[0_0_10px_rgba(244,63,94,0.3)] hover:scale-105 transition-transform">Merge</button>
                    </div>
                    <p class="text-[9px] text-slate-400 font-bold">Warning: This moves all transactions from Source to Target and deletes Source.</p>
                </div>

                <!--7. DATA ACTIONS-->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                    <div class="bg-slate-800/50 p-6 rounded-[2.5rem] text-center border border-slate-700/50 shadow-lg">
                        <p class="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-4">Data Management</p>
                        <div class="flex justify-center gap-4">
                            <button onclick="window.exportBackup()" class="flex items-center gap-2 bg-slate-900/80 border border-slate-700 text-slate-300 px-5 py-3 rounded-xl font-bold text-[10px] uppercase hover:text-rose-400 hover:border-rose-500/50 transition-all">
                                <i data-lucide="download" class="w-4 h-4"></i> Backup
                            </button>
                            <label class="flex items-center gap-2 bg-rose-600 text-white px-5 py-3 rounded-xl font-bold text-[10px] uppercase shadow-[0_0_10px_rgba(244,63,94,0.3)] hover:scale-105 cursor-pointer transition-all">
                                <i data-lucide="upload" class="w-4 h-4"></i> Restore
                                <input type="file" class="hidden" onchange="window.importBackup(this)">
                            </label>
                        </div>
                    </div>
                     <div class="bg-rose-950/30 p-6 rounded-[2.5rem] border border-rose-900/50 text-center flex flex-col justify-center shadow-lg">
                        <p class="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-3">Zone of Danger</p>
                        <button onclick="window.resetBudgetSystem()" class="bg-amber-600 text-white px-6 py-3 rounded-xl font-black uppercase text-xs shadow-lg hover:bg-amber-500 active:scale-95 transition-all text-center mx-auto mb-3 w-full border border-amber-500/50">
                            Reset Budget Allocations
                        </button>
                        <button onclick="window.resetData()" class="bg-red-600 text-white px-6 py-3 rounded-xl font-black uppercase text-xs shadow-[0_0_15px_rgba(220,38,38,0.4)] hover:bg-red-500 active:scale-95 transition-all text-center mx-auto w-full border border-red-500/50">
                            Reset Entire System
                        </button>
                    </div>
                </div>

                <!--MAIN SAVE ACTION-->
            <div class="pt-6 mt-4 pb-2">
                <button onclick="window.saveSettings()" class="w-full bg-slate-900 text-white p-5 rounded-[2rem] font-black shadow-2xl hover:shadow-emerald-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-3">
                    <i data-lucide="check-circle" class="w-5 h-5"></i> Save Changes
                </button>
            </div>
            </div> `;
        };

        window.previewTheme = function (t) {
            state.data.settings.theme = t;
            window.applyTheme(t);
            // Optimization: Don't re-render entire UI, just apply CSS vars.
            // Rings update automatically via CSS state but we might need to manually toggle classes if performance is key.
            // For now, removing renderSettingsUI() prevents the big lag.
        }

        window.saveSettings = async function () {
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
            state.data.settings.isAutoMessagingEnabled = document.getElementById('sets-auto-msg').checked;
            state.data.settings.messagingToken = document.getElementById('sets-whapi').value.trim();
            state.data.settings.myPhone = document.getElementById('sets-myphone').value.trim();
            
            // Templates
            const tplRem = document.getElementById('sets-tpl-reminder');
            if (tplRem) state.data.settings.tplReminder = tplRem.value;
            const tplPay = document.getElementById('sets-tpl-payment');
            if (tplPay) state.data.settings.tplPayment = tplPay.value;

            // Theme is already set in state via previewTheme, just persisting now.



            await updateDb();
            window.showToast("✅ Settings Updated Successfully", "success");
            window.renderApp();
        };

        window.mergeCategories = async function () {
            const src = document.getElementById('merge-src').value;
            const tgt = document.getElementById('merge-target').value;
            if (!src || !tgt) { window.showToast("Please select both a source and target category.", "error"); return; }
            if (src === tgt) { window.showToast("Source and Target cannot be the same.", "error"); return; }

            window.showConfirm(
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
                    window.showToast(`✅ Merged ${count} transactions from '${src}' to '${tgt}'.`, "success");
                    window.renderSettingsUI(); // Refresh UI
                    window.renderApp();
                }
            );
        };

        window.resetBudgetSystem = async function () {
            window.showConfirm(
                "Reset Budget System",
                "This will permanently clear your current envelope balances, allocations, and past budget reports.\n\nAre you sure you want to reset?",
                async () => {
                    try {
                        state.data.envelopeLedger = [];
                        state.data.budgets = {};
                        state.data.budgetReports = [];
                        state.data.settings.expectedSalary = 0;
                        delete state.data.settings.lastSalaryDate;
                        await window.updateDb();
                        window.showToast("Budget Reset Complete", "success");
                        window.renderApp();
                    } catch (error) {
                        window.showToast("Reset failed: " + error.message, "error");
                    }
                }
            );
        };

        window.resetData = async function () {
            window.showConfirm(
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
                        window.showToast("System Reset Complete", "success");
                        setTimeout(() => window.location.reload(), 1000); // Force reload to ensure clean state
                    } catch (error) {
                        console.error("Reset failed:", error);
                        window.showToast("Reset failed: " + error.message, "error");
                    }
                }
            );
        };

        window.calcInstallment = function () {
            const amt = parseFloat(document.getElementById('da').value) || 0;
            const split = parseInt(document.getElementById('db-split').value) || 1;
            const el = document.getElementById('bnpl-preview');
            if (el) el.innerText = `Monthly: ${(amt / split).toFixed(2)}`;
        };

        window.toggleDebtFields = function () {
            const t = document.getElementById('dt').value;
            const isBnpl = t === 'bnpl';
            document.getElementById('bnpl-fields').classList.toggle('hidden', !isBnpl);
            if (isBnpl) window.calcInstallment();
        };

        // Helper to Calc DTI & Health
        window.renderFinancialHealth = function () {
            const r = state.data.settings.rate;
            // 1. Calc Monthly Fixed Debt Obligations
            let monthlyDebt = 0;
            // BNPLs (Monthly payments)
            state.data.debts.filter(d => d.isBnpl && !d.settled).forEach(d => {
                // Amortize remaining? Or just take next installment?
                // Let's take the first unpaid installment amount as "this month's load"
                const next = d.schedule.find(s => !s.paid);
                if (next) monthlyDebt += (parseFloat(next.amount) * (d.currency === 'AED' ? 1 : (1 / r)));
            });
            // Personal Debts due this month
            const now = new Date();
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            state.data.debts.filter(d => !d.isBnpl && d.type === 'payable' && !d.settled && new Date(d.repaymentDate) <= endOfMonth).forEach(d => {
                monthlyDebt += (parseFloat(d.amount) * (d.currency === 'AED' ? 1 : (1 / r)));
            });

            // 2. Calc Income (Avg 3 mo)
            // Reuse BNPL Analyzer logic or simple fallback
            const income = 15000; // Placeholder until we have robust income tracking. 
            // Or use Settings if available?
            // Let's rely on a hard-coded fallback or minimal settings for now to show UI.
            // Ideally we prompt user for "Monthly Income".

            const dti = income > 0 ? (monthlyDebt / income) * 100 : 0;

            let zone = 'Healthy';
            let color = 'emerald';
            if (dti > 30) { zone = 'Caution'; color = 'amber'; }
            if (dti > 50) { zone = 'Danger'; color = 'red'; }

            return `
                <div class="mb-6 bg-slate-900 rounded-[2.5rem] p-6 text-white relative overflow-hidden text-center shadow-lg">
                    <div class="relative z-10 flex justify-between items-center">
                        <div class="text-left">
                            <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Debt-to-Income Health</p>
                            <h2 class="text-2xl font-black text-${color}-400">${dti.toFixed(1)}% <span class="text-xs text-white opacity-60 font-sans font-bold">(${zone})</span></h2>
                            <p class="text-[9px] text-slate-500 font-bold mt-1">Monthly Obligations: AED ${Math.round(monthlyDebt).toLocaleString()}</p>
                        </div>
                        
                        <!-- Gauge Visual -->
                        <div class="w-16 h-16 relative">
                            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#334155" stroke-width="4" />
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${color === 'emerald' ? '#34d399' : (color === 'amber' ? '#fbbf24' : '#f87171')}" stroke-width="4" stroke-dasharray="${dti}, 100" />
                            </svg>
                            <div class="absolute inset-0 flex items-center justify-center">
                                <i data-lucide="${color === 'emerald' ? 'shield-check' : 'alert-triangle'}" class="w-6 h-6 text-${color}-400"></i>
                            </div>
                        </div>
                    </div>
                </div>
             `;
        };

        // Helper for Timeline
        window.renderPaymentTimeline = function (bnplOnly = false) {
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

            return `
                <div class="mb-8">
                    <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3 ml-2">Payment Timeline</h4>
                    <div class="flex gap-3 overflow-x-auto no-scrollbar pb-4 snap-x hide-scrollbar">
                        ${upcoming.map(u => {
                const d = new Date(u.date);
                const day = d.getDate();
                const month = d.toLocaleString('default', { month: 'short' });
                return `
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

        // Window Exposure for toggles
        window.toggleBnplDetails = function (id) {
            document.getElementById(`bnpl-det-${id}`)?.classList.toggle('hidden');
        };

        window.togglePersonDetails = function (unsafeName) {
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

        window.settleInstallment = function (dId, idx) {
            const d = state.data.debts.find(x => x.id === dId);
            if (!d || !d.schedule[idx] || d.schedule[idx].status === 'paid') return;

            window.showConfirm("Pay Installment?", `Settle AED ${d.schedule[idx].amount} now? (Deducts from Main Bank)`, async () => {
                const acc = state.data.accounts.find(a => a.type === 'Bank Account') || state.data.accounts[0];
                if (acc) {
                    acc.balance -= parseFloat(d.schedule[idx].amount);
                    state.data.transactions.push({
                        id: window.genId(), accountId: acc.id, amount: d.schedule[idx].amount,
                        type: 'expense', category: 'BNPL Repayment',
                        note: `Paid ${d.party} (${idx + 1}/${d.installments})`,
                        debtId: dId, // Link to Debt
                        date: new Date().toISOString()
                    });
                }
                d.schedule[idx].status = 'paid';
                d.schedule[idx].paidDate = new Date().toISOString();
                d.paidMonths = (d.paidMonths || 0) + 1;

                if (d.paidMonths >= d.installments) d.settled = true;

                await updateDb();
                window.renderDebtUI();
                window.renderApp();
            }, "Confirm Payment");
        };




        window.calcTrustScore = function (name) {
            let score = 100;
            // Heuristics can continue here
            return Math.max(0, Math.min(100, score));
        };

        // WHATSAPP INTEGRATION
        // UNIVERSAL MESSAGING HANDLER
        window.sendWhapiReminder = async function (name, debtDetails, isRaw = false, netValue = 1) {
            const isAuto = state.data.settings.isAutoMessagingEnabled;
            const token = state.data.settings.messagingToken || state.data.settings.whapiToken;
            
            let msgBody = '';
            if (isRaw) {
                msgBody = debtDetails;
            } else {
                if (netValue < 0) {
                    let tpl = state.data.settings.tplPayment || 'Hi {name}, just a quick update regarding the {amount} I owe you. I will settle this soon. Thanks!';
                    msgBody = tpl.replace('{name}', name).replace('{amount}', debtDetails).replace('{note}', 'debt').replace('{currency}', '');
                } else {
                    let tpl = state.data.settings.tplReminder || 'Hi {name}, just a quick reminder regarding the {amount}. Let me know when you can settle this. Thanks!';
                    msgBody = tpl.replace('{name}', name).replace('{amount}', debtDetails).replace('{note}', 'debt').replace('{currency}', '');
                }
            }

            // Get Contact & Phone
            const contact = (state.data.contacts && state.data.contacts.find(c => c.name === name));
            if (!contact || !contact.phone) {
                window.showPrompt(`Phone for ${name}`, "Enter Mobile Number (e.g. 97150...):", (val) => {
                    if (val) {
                        if (!state.data.contacts) state.data.contacts = [];
                        let c = state.data.contacts.find(x => x.name === name);
                        if (!c) { c = { name: name, relation: 'Friend', phone: val }; state.data.contacts.push(c); }
                        else { c.phone = val; }
                        updateDb();
                        window.sendWhapiReminder(name, debtDetails, isRaw); // Retry
                    }
                }, 'tel');
                return;
            }

            const cleanPhone = contact.phone.replace(/[^0-9]/g, '');

            if (isAuto && token) {
                // AUTO MODE: Send via API
                window.showToast("🚀 Sending via API...", "info");
                try {
                    const res = await fetch('https://gate.whapi.cloud/messages/text', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ to: cleanPhone, body: msgBody })
                    });
                    if (res.ok) window.showToast("Message Sent! ✅", "success");
                    else window.showToast("API Error. Check Settings.", "error");
                } catch (error) {
                    window.showToast("Network Error.", "error");
                }
            } else {
                // MANUAL MODE: Open WhatsApp Draft
                window.showToast("📲 Opening WhatsApp Draft...", "info");
                const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msgBody)}`;
                window.open(url, '_blank');
            }
        };

        // DAILY AUTOMATION LOGIC (Self + Peer)
        window.checkSelfReminders = async function () {
            // 1. Check prerequisites
            if (!state.data.settings.isAutoMessagingEnabled) return;
            const token = state.data.settings.messagingToken || state.data.settings.whapiToken;
            if (!token) return;

            // 2. Check frequency (Once per day)
            const todayStr = new Date().toISOString().split('T')[0];
            if (state.data.settings.lastAutoReminderDate === todayStr) return;

            window.showToast("🔔 Checking daily automations...", "info");
            let sentCountSelf = 0;
            let sentCountPeer = 0;

            try {
                // --- A. SELF REMINDERS (Due Today) ---
                const myPhone = state.data.settings.myPhone;
                if (myPhone) {
                    let dueItems = [];

                    // 1. BNPL Installments (Due Today)
                    state.data.debts.filter(d => d.isBnpl && !d.settled).forEach(d => {
                        const installment = d.schedule.find(s => !s.paid && (s.date === todayStr || s.dueDate === todayStr));
                        if (installment) dueItems.push({ type: 'BNPL', name: d.party, amount: installment.amount, currency: d.currency });
                    });

                    // 2. Personal Payables (Due Today)
                    state.data.debts.filter(d => !d.isBnpl && d.type === 'payable' && !d.settled).forEach(d => {
                        if (d.repaymentDate === todayStr) dueItems.push({ type: 'Debt', name: d.party, amount: d.amount, currency: d.currency });
                    });

                    if (dueItems.length > 0) {
                        const summary = dueItems.map(i => `• ${i.type} to ${i.name}: ${i.amount} ${i.currency}`).join('\\n');
                        const msgBody = `📅 *Payment Reminder: Due Today* (${todayStr})\\n\\n${summary}\\n\\nCheck FINSHAANIREE for details.`;
                        const cleanPhone = myPhone.replace(/[^0-9]/g, '');

                        try {
                            await fetch('https://gate.whapi.cloud/messages/text', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ to: cleanPhone, body: msgBody })
                            });
                            sentCountSelf++;
                        } catch (e) {
                            console.error("Self Reminder Fetch Error", e);
                        }
                    }
                }

                // --- B. PEER REMINDERS (Due Today) ---
                // Receivables owed TO user
                const peerDebts = state.data.debts.filter(d => !d.isBnpl && d.type === 'receivable' && !d.settled && d.repaymentDate === todayStr);

                for (const d of peerDebts) {
                    const contact = state.data.contacts.find(c => c.name === d.party);
                    if (contact && contact.phone) {
                        const cleanPhone = contact.phone.replace(/[^0-9]/g, '');
                        // Check if reminder already sent today (per item check)
                        if (d.lastAutoRemindDate === todayStr) continue;

                        const msgBody = `Hi ${d.party}, friendly reminder that ${d.amount} ${d.currency} is due today (${todayStr}). Please let me know the status. Thanks!`;

                        try {
                            const res = await fetch('https://gate.whapi.cloud/messages/text', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ to: cleanPhone, body: msgBody })
                            });

                            if (res.ok) {
                                sentCountPeer++;
                                // Update item state to prevent duplicate if job re-runs
                                d.lastAutoRemindDate = todayStr;
                            }
                        } catch (e) {
                            console.error("Peer Reminder Fetch Error", e);
                        }
                    }
                }

                // --- C. SUBSCRIPTION TRIALS (Ending Soon) ---
                if (state.data.subscriptions) {
                    const trials = state.data.subscriptions.filter(s => s.freeTrialEndDate);
                    if (state.data.settings.myPhone && trials.length > 0) {
                        const endingSoon = trials.filter(s => {
                            const end = new Date(s.freeTrialEndDate);
                            const now = new Date();
                            const diff = (end - now) / (1000 * 60 * 60 * 24);
                            return diff >= 0 && diff <= 3;
                        });

                        if (endingSoon.length > 0) {
                            const summary = endingSoon.map(s => `• ${s.name} (Ends: ${s.freeTrialEndDate})`).join('\\n');
                            const msgBody = `⚠? *Free Trial Alert*\\n\\nThe following trials are ending soon:\\n${summary}\\n\\nCancel now if unwanted!`;
                            const cleanPhone = state.data.settings.myPhone.replace(/[^0-9]/g, '');

                            try {
                                await fetch('https://gate.whapi.cloud/messages/text', {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ to: cleanPhone, body: msgBody })
                                });
                                sentCountSelf++;
                            } catch (e) {
                                console.error("Trial Reminder Fetch Error", e);
                            }
                        }
                    }
                }

                // 5. Update Global State
                state.data.settings.lastAutoReminderDate = todayStr;
                await updateDb();

                if (sentCountSelf > 0 || sentCountPeer > 0) {
                    window.showToast(`🔔 Sent ${sentCountSelf} self & ${sentCountPeer} peer reminders!`, "success");
                } else {
                    console.log("No reminders needed today.");
                }

            } catch (e) {
                console.error("Automation Critical Error", e);
            }
        };


        window.openWhatsApp = function (name, amount, currency) {
            // Deprecated manual fallback if needed, or alias to new one? 
            // Keeping for legacy or manual override if we want double buttons.
            // For now, the UI will call sendWhapiReminder
            const contact = (state.data.contacts && state.data.contacts.find(c => c.name === name));
            let phone = contact ? contact.phone : null;

            const send = (p) => {
                // Update phone if not saved
                if (contact && !contact.phone) {
                    contact.phone = p;
                    updateDb();
                }
                const msg = `Hi ${name}, just a quick reminder regarding the ${amount} ${currency}. Let me know when you can settle this. Thanks!`;
                window.open(`https://wa.me/${p.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
            };

            if (phone) {
                send(phone);
            } else {
                window.showPrompt("Enter Mobile Number", "e.g. 971501234567", (val) => {
                    if (val) send(val);
                }, 'tel');
            }
        };

        // FRIEND LEDGER
        window.openFriendLedger = function (name) {
            const history = state.data.debts.filter(d => d.party === name).sort((a, b) => new Date(b.date) - new Date(a.date));
            const contact = (state.data.contacts && state.data.contacts.find(c => c.name === name)) || { relation: 'Friend', creditScore: 100 };

            const t = document.getElementById('modal-title');
            const c = document.getElementById('modal-content');
            const b = document.getElementById('modal-backdrop');

            t.innerText = `${name}'s Ledger`;
            c.innerHTML = `
                <div class="space-y-6">
                     <div class="text-slate-900 flex justify-between items-center bg-slate-50 p-6 rounded-3xl border border-slate-100">
                         <div>
                             <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Relationship</p>
                             <p class="text-xl font-black text-slate-800">${contact.relation || 'Contact'}</p>
                         </div>
                         <div class="text-right">
                             <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Lifetime Score</p>
                             <p class="text-xl font-black text-indigo-500">${window.calcTrustScore(name)}%</p>
                         </div>
                     </div>
                     
                     <div class="space-y-3">
                         ${history.length > 0 ? history.map(d => `
                             <div class="text-slate-900 bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center ${d.settled ? 'opacity-60' : ''}">
                                 <div class="text-left">
                                     <p class="font-bold text-sm text-slate-800 flex items-center gap-2">
                                        ${d.type === 'receivable' ? 'Lent' : 'Borrowed'}
                                        ${d.settled ? '<span class="text-[8px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-black uppercase">Settled</span>' : ''}
                                     </p>
                                     <p class="text-[10px] text-slate-400 font-bold uppercase">${d.repaymentDate || d.date ? (d.date || '').split('T')[0] : 'No Date'}</p>
                                 </div>
                                 <div class="text-right">
                                     <p class="font-black text-slate-900">${d.amount} ${d.currency}</p>
                                 </div>
                             </div>
                         `).join('') : '<p class="text-center text-slate-300 font-bold py-10">No records found.</p>'}
                     </div>
                </div>
            `;
            b.classList.replace('hidden', 'flex');
            lucide.createIcons();
        };

        // new Action Required Logic
        window.renderActionRequired = function () {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // User Filter: "Show only amount which is due for TODAY"
            const todayStr = today.toDateString();

            const actions = [];

            // 1. BNPL Installments
            state.data.debts.filter(d => d.isBnpl && !d.settled).forEach(d => {
                const pending = d.schedule.find(s => !s.paid);
                if (pending) {
                    // Check date or dueDate
                    const dStr = pending.date ? new Date(pending.date).toDateString() : (pending.dueDate ? new Date(pending.dueDate).toDateString() : '');
                    if (dStr === todayStr) {
                        actions.push({
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
                    actions.push({ type: 'Debt', name: d.party, amount: d.amount, currency: d.currency, date: label, id: d.id, isBnpl: false });
                }
            });

            if (actions.length === 0) return '';

            return `<div class="bg-rose-50 p-6 rounded-[2.5rem] border border-rose-100 mb-8 shadow-sm text-left">
                <div class="flex items-center gap-2 mb-4">
                    <i data-lucide="siren" class="w-5 h-5 text-rose-500 animate-pulse"></i>
                    <h4 class="text-[10px] font-black uppercase text-rose-400 tracking-widest">Action Required</h4>
                </div>
                <div class="space-y-3">
                    ${actions.map(a => `
                        <div class="text-slate-900 bg-white p-4 rounded-2xl border border-rose-100 flex justify-between items-center shadow-sm">
                            <div>
                                <p class="text-[9px] font-bold text-rose-400 uppercase mb-0.5">${a.type} • Due ${a.date}</p>
                                <p class="font-black text-slate-800 text-sm">${a.name}</p>
                                <p class="text-xs font-bold text-slate-500">${a.amount} ${a.currency}</p>
                            </div>
                            <div>
                                ${a.isBnpl ?
                    `<button onclick="window.settleInstallment('${a.id}', ${a.idx})" class="px-3 py-1.5 bg-rose-500 text-white rounded-lg font-black text-[10px] uppercase shadow-md active:scale-95">Settle</button>` :
                    `<button onclick="window.openSettleFlow('${a.id}')" class="px-3 py-1.5 bg-rose-500 text-white rounded-lg font-black text-[10px] uppercase shadow-md active:scale-95">Pay</button>`
                }
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        };

        // --- BNPL HELPER: Pay Split ---
        window.payBnplSplit = async function (id, idx) {
            const d = state.data.debts.find(x => x.id === id);
            if (!d || !d.schedule[idx] || d.schedule[idx].paid) return;

            const inst = d.schedule[idx];
            const amt = parseFloat(inst.amount);

            // 1. Prepare Account Options
            const accounts = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Wallet'].includes(a.type));
            if (accounts.length === 0) {
                window.showToast("No payment accounts found!", "error");
                return;
            }

            let msg = `Pay AED ${amt} for ${d.party} (Month ${idx + 1}/${d.installments})?\n\nSelect Payment Method:\n`;
            accounts.forEach((a, i) => {
                msg += `${i + 1}. ${a.name} (${a.currency} ${window.toCurrency(a.balance)})\n`;
            });
            msg += `\nEnter number (1-${accounts.length}):`;

            // 2. Prompt for Selection
            window.showPrompt("Confirm Payment", msg, async (val) => {
                const choice = parseInt(val) - 1;
                const acc = accounts[choice];

                if (!acc) {
                    window.showToast("Invalid selection. Payment cancelled.", "error");
                    return;
                }

                // Balance Check
                const payAmt = (acc.currency === 'AED' ? amt : amt / state.data.settings.rate);
                if (acc.balance < payAmt) {
                    window.showToast("Insufficient Funds in " + acc.name, "error");
                    return;
                }

                // 3. Process Payment
                inst.paid = true;
                d.currentAmount -= amt;
                if (d.currentAmount < 0.1) { d.currentAmount = 0; d.settled = true; }

                // 4. Update Balance & Log
                acc.balance -= (acc.currency === 'AED' ? amt : amt / state.data.settings.rate); // Simple conversion if needed

                window.saveTransaction({
                    id: window.genId(), accountId: acc.id,
                    type: 'expense', amount: amt, category: 'BNPL Payment',
                    note: `Paid ${d.party} - Installment ${idx + 1}/${d.installments}`,
                    date: new Date().toISOString()
                });

                await window.updateDb();
                window.renderApp();

                // Instant UI Update for Modal
                const modalContent = document.getElementById('modal-content');
                if (modalContent && !document.getElementById('modal-backdrop').classList.contains('hidden')) {
                    modalContent.innerHTML = window.renderDebtUI();
                    lucide.createIcons();
                }

                window.showToast(`Paid via ${acc.name}!`, "success");
            }, "1"); // Default to 1
        };

        window.renderDebtUI = function () {
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

                return `<div class="bg-slate-900/40 rounded-[1.5rem] border border-slate-700/50 shadow-sm relative overflow-hidden group transition-all hover:border-slate-500/50 cursor-pointer flex flex-col h-full hover:-translate-y-1" onclick="window.navDebt('bnpl_ledger', '${d.id}')">
                    
                    <div class="p-5 flex flex-col relative z-10 flex-grow text-left">
                        ${isDueSoon ? `<div class="absolute top-4 right-4 w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]"></div>` : ''}
                        
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
                if (!people[p]) people[p] = { name: p, totals: {}, items: [], trust: window.calcTrustScore(p), virtualNet: 0 };

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
                return `
                    <div class="mt-3 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                        <p class="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-2">Payment History</p>
                        <div class="space-y-2">
                            ${txs.map(t => `
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

                return `<div class="bg-slate-900/40 rounded-[1.5rem] border border-slate-700/50 shadow-sm relative overflow-hidden group transition-all hover:border-slate-500/50 cursor-pointer flex flex-col h-full hover:-translate-y-1" onclick="window.navDebt('person_ledger', '${p.name}')">
                    
                    <div class="p-5 flex flex-col relative z-10 flex-grow text-left">
                        ${dueSoon ? `<div class="absolute top-4 right-4 w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]"></div>` : ''}
                        
                        <!-- Top Left Icon -->
                        <div class="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
                            <i data-lucide="user" class="w-5 h-5"></i>
                        </div>
                        
                        <!-- Name & Subtitle -->
                        <h3 class="font-black text-slate-100 text-lg leading-none mb-1 truncate">${p.name}</h3>
                        <span class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-6 block">Personal Contact</span>
                        
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
            window.copyLedgerStatement = function (pName) {
                const pItems = state.data.debts.filter(d => d.party === pName);
                if (pItems.length === 0) return window.showToast("No records found", "error");

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
                    window.showToast("Statement Copied to Clipboard!", "success");
                }).catch(() => {
                    window.showToast("Failed to copy", "error");
                });
            };

            // --- WRITE OFF LOGIC ---
            window.writeOffDebt = function (id) {
                const d = state.data.debts.find(x => x.id === id);
                if (!d) return;

                window.showConfirm(
                    "Write Off Debt?",
                    `Mark ${d.amount} ${d.currency} as settled WITHOUT any payment? (Use for bad debts or corrections)`,
                    async () => {
                        d.settled = true;
                        d.notes = (d.notes || '') + " [Written Off]";
                        // No transaction created.
                        await updateDb();
                        window.renderDebtUI();
                        window.showToast("Debt Written Off (Archived)", "success");
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
                const html = window.renderDebtUI();
                const c = document.getElementById('modal-content');
                if (c) { c.innerHTML = html; lucide.createIcons(); }
            };
            const goView = (v, payload = null) => {
                state.ui.debtView = v;
                state.ui.debtPayload = payload;
                const html = window.renderDebtUI();
                const c = document.getElementById('modal-content');
                if (c) { c.innerHTML = html; lucide.createIcons(); }
            };
            window.navDebt = goView; // Exposure for onclick
            window.navDebtHome = goHome;

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

                return `<div class="max-w-6xl mx-auto space-y-6 text-left fade-in pb-12">
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
                                        <input type="number" id="da" placeholder="0.00" oninput="window.calcInstallment()" class="w-full bg-transparent text-white font-black text-3xl outline-none placeholder-slate-600 num-font">
                                    </div>
                                </div>

                                <!-- Pill Toggles -->
                                <div class="flex bg-slate-900/90 p-1 rounded-xl border border-slate-700/60">
                                    <button type="button" onclick="document.getElementById('dt').value='payable'; window.toggleDebtFields(); this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-slate-700','text-white')); this.classList.add('bg-slate-700','text-white')" class="flex-1 py-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-700 text-white transition-all">I Owe</button>
                                    <button type="button" onclick="document.getElementById('dt').value='receivable'; window.toggleDebtFields(); this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-slate-700','text-white')); this.classList.add('bg-slate-700','text-white')" class="flex-1 py-2 rounded-lg text-xs font-bold text-slate-400 transition-all hover:text-slate-300">Owed To Me</button>
                                    <button type="button" onclick="document.getElementById('dt').value='bnpl'; window.toggleDebtFields(); this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-slate-700','text-white')); this.classList.add('bg-slate-700','text-white')" class="flex-1 py-2 rounded-lg text-xs font-bold text-slate-400 transition-all hover:text-slate-300">BNPL</button>
                                </div>
                                <input type="hidden" id="dt" value="payable">

                                <!-- Contact Selector -->
                                <div id="debt-party-container">
                                    <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1.5 block">Contact / Counterparty</label>
                                    <div class="flex items-center gap-2">
                                        <select id="dw" class="w-full bg-slate-900/90 border border-slate-700 p-3.5 rounded-xl text-white font-bold text-xs outline-none">
                                            <option value="" class="bg-slate-800 text-slate-400">-- Select Person --</option>
                                            ${(state.data.contacts || []).map(c => `<option value="${c.name}" class="bg-slate-800">${c.name}</option>`).join('')}
                                        </select>
                                        <button onclick="window.openContactModal()" class="bg-rose-500/20 text-rose-400 p-3.5 rounded-xl border border-rose-500/30 hover:bg-rose-500/30 transition-colors shrink-0" title="Add New Contact">
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
                                            ${state.data.accounts.map(a => `<option value="${a.id}" class="bg-slate-800">${a.name}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div>
                                        <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1.5 block">Due Date</label>
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
                                            <input type="number" id="db-split" value="4" oninput="window.calcInstallment()" class="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white font-black text-center text-sm">
                                        </div>
                                        <div class="text-right">
                                            <label class="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-1 block">Monthly EMI</label>
                                            <p id="bnpl-preview" class="text-rose-400 font-black text-base num-font">...</p>
                                        </div>
                                    </div>
                                </div>

                                <button id="btn-commit-debt" onclick="window.commitDebt()" class="w-full bg-rose-500 hover:bg-rose-600 text-white p-4 rounded-2xl font-black uppercase text-xs tracking-wider shadow-lg shadow-rose-500/30 transition-all mt-2">Commit Record</button>
                            </div>
                        </div>

                        <!-- RIGHT 7 COLS: DTI GAUGE & NAVIGATION FOLDERS -->
                        <div class="lg:col-span-7 space-y-6">
                            <!-- DTI Financial Health Gauge -->
                            ${window.renderFinancialHealth()}

                            <!-- 3 Quick Navigation Folders (Grid) -->
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <!-- 1. Personal Liabilities Folder -->
                                <div onclick="window.navDebt('personal')" class="bg-gradient-to-br from-indigo-900/60 to-slate-900 p-5 rounded-[2rem] border border-indigo-500/30 shadow-lg relative overflow-hidden cursor-pointer hover:border-indigo-400 transition-all group flex flex-col justify-between h-40">
                                    <div class="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-2">
                                        <i data-lucide="users" class="w-5 h-5"></i>
                                    </div>
                                    <div>
                                        <h3 class="text-base font-black text-white leading-tight">Personal<br>Liabilities</h3>
                                        <p class="text-indigo-300 text-[10px] font-bold mt-1">${sortedPeople.length} Contacts</p>
                                    </div>
                                </div>

                                <!-- 2. Active BNPL Installments -->
                                <div onclick="window.navDebt('bnpl')" class="bg-gradient-to-br from-rose-900/60 to-slate-900 p-5 rounded-[2rem] border border-rose-500/30 shadow-lg relative overflow-hidden cursor-pointer hover:border-rose-400 transition-all group flex flex-col justify-between h-40">
                                    <div class="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-2">
                                        <i data-lucide="shopping-bag" class="w-5 h-5"></i>
                                    </div>
                                    <div>
                                        <h3 class="text-base font-black text-white leading-tight">Active<br>Installments</h3>
                                        <p class="text-rose-300 text-[10px] font-bold mt-1">${bnpl.length} Items</p>
                                    </div>
                                </div>

                                <!-- 3. Settled Archive -->
                                <div onclick="window.navDebt('archive')" class="bg-gradient-to-br from-slate-800 to-slate-900 p-5 rounded-[2rem] border border-slate-700 shadow-lg relative overflow-hidden cursor-pointer hover:border-slate-500 transition-all group flex flex-col justify-between h-40">
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
                            ${window.renderPaymentTimeline()}
                        </div>
                    </div>
                </div>`;
            }

            // --- FOLDER: PERSONAL (Merged Payables/Receivables) ---
            if (state.ui.debtView === 'personal') {
                return `<div class="w-full max-w-6xl mx-auto space-y-6 min-h-[50vh]">
                    <div class="flex items-center gap-4 mb-4 px-2">
                        <button onclick="window.navDebt('home')" class="p-3 bg-slate-800 rounded-xl shadow-sm border border-slate-700/50 hover:bg-slate-700 transition-colors"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                        <h3 class="text-xl md:text-3xl font-black text-slate-100 flex-grow">Personal Liability</h3>
                        <button onclick="window.bulkRemindOverdue()" class="p-3 bg-rose-500/10 text-rose-400 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-rose-500/20 transition-colors shadow-sm whitespace-nowrap flex items-center gap-2 border border-rose-500/20">
                            <i data-lucide="bell-ring" class="w-4 h-4"></i> Bulk Remind
                        </button>
                    </div>

                    <!-- SEARCH / FILTER BAR (Optional Future?) -->

                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start px-2">
                        ${sortedPeople.length > 0 ? sortedPeople.map(renderPerson).join('') :
                        '<div class="text-center py-20 opacity-50 col-span-2 md:col-span-3 lg:col-span-4"><i data-lucide="users" class="w-16 h-16 mx-auto mb-4 text-slate-500"></i><p class="font-bold text-slate-400">No active personal debts.</p></div>'}
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
                
                return `<div class="max-w-4xl mx-auto space-y-6 min-h-[50vh] fade-in pb-20 text-left">
                    <!-- HEADER -->
                    <div class="flex items-center gap-4 mb-2">
                        <button onclick="window.navDebt('personal')" class="p-3 bg-slate-800 rounded-xl shadow-sm border border-slate-700/50 hover:bg-slate-700 transition-colors"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                        <h3 class="text-xl md:text-2xl font-black text-slate-100 flex-grow">Contact Profile</h3>
                    </div>
                    
                    <!-- PROFILE HERO CARD -->
                    <div class="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-[2.5rem] border border-slate-700/60 p-8 text-center relative overflow-hidden shadow-2xl">
                        <div class="w-20 h-20 mx-auto rounded-3xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4 shadow-inner">
                            <i data-lucide="user" class="w-10 h-10"></i>
                        </div>
                        <h2 class="text-3xl font-black text-slate-100 mb-1 tracking-tight">${pName}</h2>
                        <div class="inline-flex items-center gap-1 bg-slate-800/80 px-3 py-1 rounded-full border border-slate-700/50 mb-6">
                            <i data-lucide="shield" class="w-3 h-3 text-indigo-400"></i>
                            <span class="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Trust Score: ${window.calcTrustScore(pName)}</span>
                        </div>
                        
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Overall Net Balance</p>
                        <p class="text-4xl font-black ${netColor} num-font tracking-tighter">${Math.abs(virtualNet).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-lg text-slate-400">AED</span></p>
                        <p class="text-xs font-bold text-slate-400 mt-1 uppercase">${isNetOwe ? '🔴 You Owe Them' : (isSettled ? '✅ Fully Settled' : '🟢 They Owe You')}</p>
                        
                        <div class="flex flex-wrap gap-3 mt-8 justify-center">
                            <button onclick="window.shareWhatsAppReminder('${pName}')" class="flex items-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-xl transition-all font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20">
                                <i data-lucide="message-circle" class="w-4 h-4"></i> WhatsApp Reminder
                            </button>
                            <button onclick="window.copyLedgerStatement('${pName}')" class="flex items-center gap-2 px-4 py-3 bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-xl transition-colors font-bold text-xs uppercase tracking-wider border border-slate-700 shadow-sm">
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
                            return `
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
                                    
                                    ${progress > 0 ? `
                                        <div class="w-full bg-slate-900 rounded-full h-2 mb-4 overflow-hidden border border-slate-800">
                                            <div class="bg-emerald-400 h-full rounded-full" style="width: ${progress}%"></div>
                                        </div>
                                    ` : ''}
                                    
                                    <div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-700/50">
                                        <button onclick="window.openPartialSettleModal('${d.id}')" class="py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold uppercase tracking-wider rounded-xl transition-all border border-slate-600">
                                            Partial Pay
                                        </button>
                                        ${d.type === 'payable' ?
                                        `<button onclick="window.openSettleFlow('${d.id}')" class="py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md transition-all">Settle Full</button>` :
                                        `<button onclick="window.openSettleFlow('${d.id}')" class="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md transition-all">Received Full</button>`}
                                        <button onclick="window.writeOffDebt('${d.id}')" class="py-2.5 bg-slate-800 text-xs text-slate-400 hover:text-rose-400 font-bold uppercase tracking-wider rounded-xl hover:bg-rose-500/10 transition-colors border border-slate-700">Write Off</button>
                                    </div>
                                    ${renderHistory(d.id)}
                                </div>
                            `;
                        }).join('') : '<p class="text-center text-slate-500 font-bold text-xs py-8 bg-slate-900/40 rounded-2xl">No active records for this contact.</p>'}
                    </div>
                    
                    <!-- ARCHIVED / SETTLED -->
                    <div class="space-y-3 mt-8 opacity-75">
                        <h4 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 px-2">
                            <i data-lucide="archive" class="w-4 h-4"></i> Settled History
                        </h4>
                        ${settledItems.length > 0 ? settledItems.map(d => `
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
                        `).join('') : '<p class="text-center text-slate-600 font-bold text-xs py-4">No past history.</p>'}
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

                return `<div class="w-full max-w-6xl mx-auto space-y-6 min-h-[50vh]">
                <div class="flex items-center gap-4 mb-4 px-2">
                    <button onclick="window.navDebt('home')" class="p-3 bg-slate-800 rounded-xl shadow-sm border border-slate-700/50 hover:bg-slate-700 transition-colors"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                    <h3 class="text-xl md:text-3xl font-black text-slate-100">Active Installments</h3>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 px-2">
                     ${bnpl.length > 0 ? bnpl.map(renderBnplItem).join('') : '<div class="p-10 text-center border-2 border-dashed border-slate-700/50 rounded-3xl col-span-full"><p class="text-slate-500 font-bold uppercase text-xs mb-2">No active installments</p><p class="text-[10px] text-slate-600">Purchases will appear here</p></div>'}
                </div>
                </div>`;
            }

            // --- FOLDER: BNPL LEDGER ---
            if (state.ui.debtView === 'bnpl_ledger') {
                const d = state.data.debts.find(x => x.id === state.ui.debtPayload);
                if (!d) return window.navDebt('bnpl');
                
                const nextDue = d.schedule.find(s => !s.paid);
                const nextDate = nextDue ? (nextDue.date || nextDue.dueDate) : 'Settled';
                let progress = 0;
                if (d.originalAmount && d.originalAmount > 0) {
                    progress = ((d.originalAmount - d.currentAmount) / d.originalAmount) * 100;
                }

                return `<div class="max-w-2xl mx-auto space-y-6 min-h-[50vh] fade-in pb-20">
                    <!-- HEADER -->
                    <div class="flex items-center gap-4 mb-2">
                        <button onclick="window.navDebt('bnpl')" class="p-3 bg-slate-800 rounded-xl shadow-sm border border-slate-700/50 hover:bg-slate-700 transition-colors"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
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
                        ${d.schedule.map((s, idx) => `
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
                                    `<button onclick="window.openBnplSettleModal('${d.id}', ${idx})" class="w-10 h-10 flex items-center justify-center bg-rose-600 text-white rounded-xl hover:bg-rose-500 transition-colors shadow-[0_0_10px_rgba(244,63,94,0.3)] active:scale-95">
                                        <i data-lucide="banknote" class="w-5 h-5"></i>
                                    </button>`
                                    :
                                    `<div class="w-10 h-10 flex items-center justify-center text-emerald-500"><i data-lucide="check-circle-2" class="w-6 h-6"></i></div>`
                                    }
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            }

            // --- FOLDER: ARCHIVE ---
            if (state.ui.debtView === 'archive') {
                const settled = state.data.debts.filter(d => d.settled);
                return `<div class="max-w-xl mx-auto space-y-6 min-h-[50vh]">
                <div class="flex items-center gap-4 mb-6">
                    <button onclick="window.navDebtHome()" class="bg-slate-800 p-3 rounded-xl hover:bg-slate-700 border border-slate-700/50"><i data-lucide="arrow-left" class="w-5 h-5 text-slate-300"></i></button>
                    <h2 class="text-2xl font-black text-slate-100">Archive / Settled</h2>
                </div>
                     ${settled.length > 0 ? settled.map(d => {
                    // Simple Render for Archive
                    return `<div class="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 mb-2 opacity-75 grayscale hover:grayscale-0 transition-all">
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
                        `<div class="text-center py-20 opacity-50"><i data-lucide="archive" class="w-16 h-16 mx-auto mb-4 text-slate-300"></i><p class="font-bold">No archival records.</p></div>`
                    }
                </div>`;
            }
        };

        window.renderDistributionInsights = function () {
            const spend = state.data.transactions.filter(t => t.type === 'expense'), total = spend.reduce((s, t) => { const acc = state.data.accounts.find(a => a.id === t.accountId); const cur = t.currency || acc?.currency || 'AED'; return s + (Number(t.amount) * (cur === 'AED' ? state.data.settings.rate : 1)); }, 0);
            return `<div class="text-slate-900 max-w-xl mx-auto p-10 bg-white rounded-[3rem] border text-center shadow-sm text-center text-center text-center text-center text-center"><h4 class="text-[10px] font-black uppercase text-slate-400 mb-10 tracking-widest text-center text-center text-center">Weight distribution</h4>
                <div class="text-right mb-6 flex justify-end gap-2">
                    <button onclick="window.csvExport()" class="bg-slate-100 text-slate-600 py-2 px-4 rounded-xl font-bold text-[10px] uppercase hover:bg-slate-200">CSV</button>
                    <button onclick="window.generatePDF()" class="bg-slate-900 text-white py-2 px-4 rounded-xl font-bold text-[10px] uppercase shadow-lg hover:bg-emerald-500 transition-colors">Download Official PDF</button>
                </div>
                <div class="space-y-4">
                    ${[...new Set(spend.map(t => t.category))].map(cat => { const val = spend.filter(t => t.category === cat).reduce((s, t) => { const acc = state.data.accounts.find(a => a.id === t.accountId); const cur = t.currency || acc?.currency || 'AED'; return s + (Number(t.amount) * (cur === 'AED' ? state.data.settings.rate : 1)); }, 0), p = total > 0 ? (val / total * 100) : 0; return `<div class="flex justify-between items-center space-y-3"><span class="font-black text-xs uppercase w-24 text-left">${cat}</span><div class="text-slate-900 flex-1 mx-4 h-2 bg-slate-50 rounded-full overflow-hidden"><div class="h-full bg-slate-900" style="width: ${p}%"></div></div><span class="font-bold text-xs text-slate-400 w-12 text-right num-font">${Math.round(p)}%</span></div>`; }).join('') || '<p class="text-xs italic text-slate-300">No records</p>'}
                </div>
            </div>`;
        }

        window.generatePDF = function () {
            const { jsPDF } = window.jspdf;
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
                    `${t.type.includes('income') || t.type === 'transfer_in' ? '+' : '-'} ${parseFloat(t.amount).toLocaleString()
                    } `
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

        window.csvExport = function () {
            if (!state.data.transactions || state.data.transactions.length === 0) {
                window.showToast("No transactions to export", "error");
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
            
            window.showToast("CSV Exported Successfully", "success");
        };

        // --- REMITTANCE ARBITRAGE TRACKER ---
        window.renderRemittance = function () {
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

            return `<div class="max-w-xl mx-auto space-y-8">
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
                    ${remittance.length > 0 ? remittance.map(r => `
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
                     `).join('') : '<p class="text-center text-slate-300 text-xs font-bold uppercase py-10">No AED -> INR transfers detected</p>'}
                </div>
            </div>`;
        };

        window.renderRemitChart = function () {
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

        // --- BNPL ANALYZER (Tabby/Tamara) ---
        window.renderBNPLAnalyzer = function () {
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

            return `<div class="bg-indigo-50 p-6 rounded-[2.5rem] border border-indigo-100 relative overflow-hidden text-center mb-8">
                <div class="flex justify-between items-center mb-4 relative z-10 px-2">
                    <h4 class="text-[10px] font-black uppercase text-indigo-400 tracking-widest flex items-center gap-2">
                        <i data-lucide="shopping-bag" class="w-4 h-4"></i> BNPL Power
                    </h4>
                    <div class="flex items-center gap-2 bg-indigo-100 px-2 py-1 rounded-lg">
                        <span class="text-[9px] font-bold text-indigo-400 uppercase">Split:</span>
                        <input type="number" id="bnpl-split" value="4" min="1" max="60" oninput="window.calcBNPLSafe(${availableCapacity})" class="bg-transparent text-indigo-600 w-8 font-black text-[9px] text-center border-none outline-none num-font">
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
                            <input type="number" id="bnpl-price" oninput="window.calcBNPLSafe(${availableCapacity})" placeholder="Total Price (AED)" class="w-full p-3 border rounded-xl font-bold text-center outline-none focus:border-indigo-500 num-font">
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

        window.calcBNPLSafe = function (limit) {
            const val = parseFloat(document.getElementById('bnpl-price').value);
            const split = parseInt(document.getElementById('bnpl-split').value) || 4;
            const res = document.getElementById('bnpl-result');

            if (isNaN(val) || val <= 0) {
                res.innerHTML = "Enter Amount";
                res.className = "w-full p-3 bg-slate-50 rounded-xl font-bold text-xs text-center text-slate-400";
                return;
            }

            const installment = val / split;
            const isSafe = installment <= limit;

            if (isSafe) {
                res.innerHTML = `<span class="text-emerald-500 block">✅ AED ${Math.round(installment)} /mo</span> <span class="text-[8px] uppercase">Safe over ${split} mo</span>`;
                res.className = "w-full p-2 bg-emerald-50 border border-emerald-100 rounded-xl font-bold text-xs text-center";
            } else {
                res.innerHTML = `<span class="text-red-500 block">? AED ${Math.round(installment)} /mo</span> <span class="text-[8px] uppercase">Too Risky</span>`;
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

        window.addCategory = async function (type) {
            const inpId = type === 'income' ? 'new-inc-cat' : 'new-exp-cat';
            const listKey = type === 'income' ? 'incomeCategories' : 'expenseCategories';
            const val = document.getElementById(inpId)?.value?.trim();
            if (!val || state.data[listKey].includes(val)) return;
            state.data[listKey].push(val); await updateDb(); window.openModal('settings');
        };

        window.toggleFixedCat = async function (cat) {
            if (!state.data.fixedCategories) state.data.fixedCategories = [];
            if (state.data.fixedCategories.includes(cat)) {
                state.data.fixedCategories = state.data.fixedCategories.filter(c => c !== cat);
            } else {
                state.data.fixedCategories.push(cat);
            }
            await updateDb();
            window.openModal('settings');
        };

        window.delCategory = async function (type, name) {
            const listKey = type === 'income' ? 'incomeCategories' : 'expenseCategories';
            state.data[listKey] = state.data[listKey].filter(c => c !== name);
            await updateDb(); window.openModal('settings');
        };

        // --- CONTACTS MANAGER ---
        window.checkContactSelect = function () {
            const val = document.getElementById('dw').value;
            if (val === 'new') window.openContactModal();
        };

        window.openContactModal = function () {
            window.showPrompt("Add New Contact", "Enter full name (e.g. Ali Baba)", (name) => {
                if (!name) { document.getElementById('dw').value = ''; return; }

                window.showPrompt("Mobile Number", "e.g. 971501234567 (Optional) - Leave blank if unknown", (phone) => {
                    window.showPrompt("Relationship", "Friend, Family, or Business?", async (rel) => {
                        const newC = { id: window.genId(), name: name, phone: phone || null, relation: rel || 'Friend', creditScore: 100 };
                        if (!state.data.contacts) state.data.contacts = [];

                        // Check for duplicates
                        if (state.data.contacts.find(c => c.name === name)) {
                            window.showToast("Contact already exists", "warn");
                            return;
                        }

                        state.data.contacts.push(newC);
                        await window.updateDb();
                        window.showToast("Contact Added", "success");

                        // 1. Re-render Main App (Background)
                        if (typeof renderApp === 'function') renderApp(); else window.location.reload();

                        // 2. Re-render Modal if open (Foreground)
                        // This fixes the dropdown not updating issue
                        const modalContent = document.getElementById('modal-content');
                        if (modalContent && !document.getElementById('modal-backdrop').classList.contains('hidden')) {
                            // Assuming we are in Debt UI if the dropdown was visible
                            // We re-render the current debt view to refresh the select options
                            if (window.renderDebtUI) {
                                modalContent.innerHTML = window.renderDebtUI();
                                lucide.createIcons();
                            }
                        }

                        // Set value after re-render
                        setTimeout(() => {
                            const el = document.getElementById('dw');
                            if (el) el.value = name;
                        }, 300);
                    }, 'text', true); // Allow empty relationship (defaults to Friend)
                }, 'tel', true); // Allow empty phone
            });
        };

        window.handleLogin = function () {
            const e = document.getElementById('login-email').value, p = document.getElementById('login-pass').value;
            signInWithEmailAndPassword(auth, e, p).catch(() => {
                const msg = document.getElementById('auth-error-msg');
                if (msg) { msg.innerText = "Invalid credentials."; msg.classList.remove('hidden'); }
            });
        };

        window.handleRegister = function () {
            const e = document.getElementById('login-email').value, p = document.getElementById('login-pass').value;
            createUserWithEmailAndPassword(auth, e, p).catch(() => alert("Registry failed."));
        };

        window.openBudgetSettings = function () {
            document.getElementById('modal-content').innerHTML = `<div class="text-slate-900 max-w-md mx-auto bg-slate-50 p-10 rounded-[3rem] border space-y-6 text-center">
                <p class="text-[10px] font-black uppercase text-slate-400">Monthly Budget Targets (AED)</p>
                <div class="space-y-4">
                    ${state.data.expenseCategories.map(cat => `
                        <div class="flex items-center space-x-4">
                            <span class="w-1/3 text-xs font-black text-left text-slate-500 uppercase">${cat}</span>
                            <input type="number" id="budget-${cat}" value="${state.data.budgets[cat] || 0}" class="text-slate-900 w-2/3 p-4 border rounded-xl font-black text-center outline-none focus:border-emerald-500 bg-white shadow-sm transition-all">
                        </div>
                    `).join('')}
                </div>
                <button onclick="window.saveBudgets()" class="w-full bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-200">Update Targets</button>
            </div>`;
        };

        window.saveBudgets = async function () { state.data.expenseCategories.forEach(cat => { state.data.budgets[cat] = parseFloat(document.getElementById(`budget-${cat}`).value) || 0; }); await updateDb(); window.openModal('budget'); };
        window.toggleVisibility = function () { state.data.settings.isPrivate = !state.data.settings.isPrivate; updateDb().then(renderApp); };
        window.svS = async function () {
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
            window.renderApp(); // Re-render to update asset values
            closeModal();
        };
        window.exportBackup = function () { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state.data)], { type: 'application/json' })); a.download = `Wealth_Back_${new Date().toISOString().split('T')[0]}.json`; a.click(); };
        window.importBackup = function (i) { const reader = new FileReader(); reader.onload = async (e) => { try { const imp = JSON.parse(e.target.result); if (imp.accounts) { state.data = imp; await updateDb(); window.showToast("Restored.", "success"); window.closeModal(); } } catch (err) { window.showToast("Error importing backup.", "error"); } }; if (i.files[0]) reader.readAsText(i.files[0]); };
        window.copyReminder = function (party, amount, currency, date, note) { const msg = `Hi ${party}, a friendly reminder regarding the repayment of ${amount} ${currency} scheduled for ${date || 'today'} ${note ? `(Purpose: ${note})` : ''}. Please settle it when you have a moment.Thanks!`; const el = document.createElement('textarea'); el.value = msg; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); window.showToast("Draft Copied!", "success"); };
        window.delAccount = async function (id) {
            window.showConfirm("Permanently wipe?", "This will delete the account and cannot be undone.", async () => {
                state.data.accounts = state.data.accounts.filter(x => x.id !== id);
                await updateDb();
                window.closeModal();
            });
        };

        window.toggleDebtFields = function () {
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

        window.commitDebt = function () {
            const type = document.getElementById('dt').value;
            let who = document.getElementById('dw').value;
            const cur = document.getElementById('dc').value;
            const amt = parseFloat(document.getElementById('da').value);
            const date = document.getElementById('drd').value;
            const note = document.getElementById('dn').value;
            const accId = document.getElementById('ds').value;

            // BNPL Override: Auto-assign "who" if empty
            if (type === 'bnpl') {
                const prod = document.getElementById('bnpl-product').value;
                who = prod || "BNPL Purchase"; // Use product name or default
            } else {
                // Personal Debt requires a person
                if (!who) return window.showToast('Please select a person', 'error');
            }

            // BNPL FLAG: If BNPL selected in dropdown, force 'bnpl' type logic if user missed it?
            // User selects "BNPL" in 'dt' (Debt Type). 'dt' value is 'bnpl'.
            // So type IS 'bnpl'. Consistency check handled.

            if (isNaN(amt)) return window.showToast('Please enter amount', 'error');

            if (amt <= 0) return window.showToast('Amount must be positive', 'error');

            window.setBtnLoading('btn-commit-debt', true);

            // Stash
            window.dataToCommit = { type, who, cur, amt, date, note, accId };

            // LENDING SAFE CHECK
            if (type === 'receivable') {
                const limit = state.data.settings.lendingLimit || 50000; // Default warning threshold
                if (amt > limit) {
                    return window.showConfirm(
                        "High Value Lending",
                        `You are about to lend ${amt} ${cur}. Ensure you have proper documentation.Proceed ? `,
                        () => window.finalizeCommitDebt(),
                        "Proceed", // Context aware label
                        () => window.setBtnLoading('btn-commit-debt', false) // FIX: Reset loading on cancel
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
                    window.showConfirm(
                        `⚠? High Risk Warning`,
                        `Lending leaves only ~${runwayAfterLoan.toFixed(1)} months of runway.Proceed ? `,
                        () => window.finalizeCommitDebt(),
                        "Proceed",
                        () => window.setBtnLoading('btn-commit-debt', false) // Reset loading on cancel
                    );
                    return;
                }
            }

            window.finalizeCommitDebt();
        };

        window.finalizeCommitDebt = async function () {
            const { type, who, cur, amt, date, note, accId } = window.dataToCommit;
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
                        window.showToast(`Insufficient Funds in ${acc.name} (Need ${cost.toFixed(2)} ${acc.currency})`, "error");
                        window.setBtnLoading('btn-commit-debt', false);
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
                    id: window.genId(),
                    type: 'payable',
                    subtype: 'bnpl',
                    party: who,
                    amount: amt,
                    currentAmount: amt,
                    originalAmount: amt,
                    currency: cur,
                    installments: split,
                    schedule: schedule,
                    repaymentDate: schedule[0].date, // Fixed: use .date not .dueDate
                    notes: 'BNPL Split',
                    settled: false,
                    isBnpl: true
                });
            } else {
                state.data.debts.push({
                    id: window.genId(),
                    type: type,
                    party: who,
                    amount: amt,
                    originalAmount: amt,
                    currency: cur,
                    repaymentDate: date,
                    notes: note || '',
                    settled: false
                });

                // AUTOMATED LENDING MESSAGE
                if (type === 'receivable' && state.data.settings.whapiToken) {
                    const contact = state.data.contacts.find(c => c.name === who);
                    if (contact && contact.phone) {
                        const noteText = note ? `(Purpose: ${note})` : '';
                        const msg = `Hey ${who}, just confirming I transferred ${amt} ${cur} to you. Scheduled back by: ${date ? new Date(date).toLocaleDateString() : 'open'} ${noteText}. Thanks!`;
                        window.sendWhapiReminder(who, msg, true); // Fire and forget
                    }
                }
            }

            // Linked Account Adjustment
            if (accId) {
                const acc = state.data.accounts.find(a => a.id === accId);
                if (acc) {
                    if (type === 'payable' && !type.isBnpl) {
                        window.saveTransaction({
                            id: window.genId(), accountId: acc.id,
                            type: 'income', amount: amt, category: 'Loan',
                            note: `Borrowed from ${who}`, date: new Date().toISOString()
                        });
                    } else if (type === 'receivable') {
                        window.saveTransaction({
                            id: window.genId(), accountId: acc.id,
                            type: 'expense', amount: amt, category: 'Loan Given',
                            note: `Lent to ${who}`, date: new Date().toISOString()
                        });
                    }
                }
            }

            await window.updateDb();
            window.renderApp();
            
            // Render a beautiful, centered success message
            const modalContent = document.getElementById('modal-content');
            if (modalContent) {
                modalContent.innerHTML = `
                    <div class="flex flex-col items-center justify-center space-y-6 py-20 fade-in text-center">
                        <div class="w-24 h-24 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(16,185,129,0.3)] transform scale-in">
                            <i data-lucide="check-circle-2" class="w-12 h-12"></i>
                        </div>
                        <div>
                            <h3 class="text-3xl font-black text-slate-100 tracking-tight">Debt Recorded</h3>
                            <p class="text-slate-400 font-bold mt-2">The liability has been securely logged.</p>
                        </div>
                        <div class="flex gap-4 pt-4">
                            <button onclick="window.navDebtHome()" class="px-8 py-4 bg-slate-800 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-700 transition-colors border border-slate-700/50 shadow-lg">Done</button>
                            <button onclick="window.navDebt('home')" class="px-8 py-4 bg-rose-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-rose-500 transition-colors shadow-[0_0_15px_rgba(225,29,72,0.3)]">Add Another</button>
                        </div>
                    </div>
                `;
                if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
            }

            window.setBtnLoading('btn-commit-debt', false);
        };

        // --- ASSET SELL/BUY FLOW HELPERS ---
        window.toggleTradeFields = function () {
            // REMOVED: Asset quantities/NAV inputs are no longer required in Cost-Basis mode.
        };

        window.calcSellTotal = function () {
            // REMOVED
        };

        window.calcRemit = function (v) {
            const sId = document.getElementById('ts').value, tId = document.getElementById('ttg').value;
            const sAcc = state.data.accounts.find(a => a.id === sId), tAcc = state.data.accounts.find(a => a.id === tId);
            const rate = state.data.settings.rate;
            let est = 0;
            if (sAcc && tAcc) {
                if (sAcc.currency === tAcc.currency) est = parseFloat(v);
                else if (sAcc.currency === 'AED' && tAcc.currency === 'INR') est = parseFloat(v) * rate;
                else if (sAcc.currency === 'INR' && tAcc.currency === 'AED') est = parseFloat(v) / rate;
                else est = parseFloat(v);
            }
            const el = document.getElementById('remit-preview');
            if (el) el.innerText = `Estimate: ${est.toFixed(2)} ${tAcc ? tAcc.currency : ''} `;
        };

        window.setT = function (t) {
            document.getElementById('tt').value = t;
            const list = t === 'income' ? state.data.incomeCategories : state.data.expenseCategories;
            const select = document.getElementById('tc');
            if (select) select.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
            const be = document.getElementById('be');
            const bi = document.getElementById('bi');
            if (be && bi) {
                if (t === 'expense') {
                    be.className = "p-4 rounded-2xl border-2 border-rose-500 bg-rose-600 text-white font-black text-xs uppercase shadow-lg shadow-rose-600/30 transition-all";
                    bi.className = "p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-slate-400 font-black text-xs uppercase hover:text-slate-200 transition-all";
                } else {
                    bi.className = "p-4 rounded-2xl border-2 border-emerald-500 bg-emerald-600 text-white font-black text-xs uppercase shadow-lg shadow-emerald-600/30 transition-all";
                    be.className = "p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-slate-400 font-black text-xs uppercase hover:text-slate-200 transition-all";
                }
            }
        };

        window.toggleAssetFields = function () {
            const type = document.getElementById('at').value;
            const invType = document.getElementById('inv-type').value;

            // Toggle Secondary Dropdown logic
            const isInv = type === 'Investment';
            document.getElementById('inv-type-container').classList.toggle('hidden', !isInv);

            // Hide All First
            ['inp-balance', 'inp-balance-note', 'inp-commodity', 'inp-fund', 'inp-re', 'inp-crypto', 'inp-bond', 'inp-emf'].forEach(id => {
                document.getElementById(id)?.classList.add('hidden');
            });

            // Logic Tree
            if (type === 'Real Estate') {
                document.getElementById('inp-balance').classList.remove('hidden');
                document.getElementById('inp-re').classList.remove('hidden');
            }
            else if (isInv) {
                // Investment Sub-logic
                if (invType === 'Commodity') document.getElementById('inp-commodity').classList.remove('hidden');
                else if (invType === 'Mutual Fund') document.getElementById('inp-fund').classList.remove('hidden');
                else if (invType === 'Crypto') {
                    document.getElementById('inp-balance').classList.remove('hidden');
                    document.getElementById('inp-crypto').classList.remove('hidden');
                }
                else if (invType === 'Bond') {
                    document.getElementById('inp-balance').classList.remove('hidden');
                    document.getElementById('inp-bond').classList.remove('hidden');
                }
                else document.getElementById('inp-balance').classList.remove('hidden'); // General Stock
            }
            else if (type === 'Emergency Fund') {
                document.getElementById('inp-balance').classList.remove('hidden');
                document.getElementById('inp-emf').classList.remove('hidden');
            }
            else if (type === 'Bank Account') {
                document.getElementById('inp-balance').classList.remove('hidden');
                document.getElementById('inp-balance-note').classList.remove('hidden');
            }
            else {
                // Cash, Savings, etc.
                document.getElementById('inp-balance').classList.remove('hidden');
            }
        };

        window.saveAccount = async function () {
            const n = document.getElementById('an')?.value;
            const c = document.getElementById('ac')?.value || 'AED';
            let t = document.getElementById('at')?.value;
            // Resolve Nested Type
            if (t === 'Investment') {
                t = document.getElementById('inv-type').value;
                if (t === 'General') t = 'Investment'; // Fallback to generic
            }

            const bal = parseFloat(document.getElementById('ab').value) || 0;
            const w = parseFloat(document.getElementById('aw')?.value) || 0;
            const u = parseFloat(document.getElementById('au')?.value) || 0;
            const code = document.getElementById('asc')?.value;
            const emfTarget = document.getElementById('emf-target') ? parseFloat(document.getElementById('emf-target').value) : null;

            // Capture Extra Fields
            const subtype = t === 'Commodity' ? document.getElementById('commodity-type')?.value :
                (t === 'Asset' ? 'General' : null);

            const category = document.getElementById('mf-cat')?.value || document.getElementById('re-type')?.value || 'General';
            const location = document.getElementById('re-loc')?.value;
            const area = document.getElementById('re-area')?.value;
            const vehicle = { make: document.getElementById('veh-make')?.value, model: document.getElementById('veh-model')?.value, year: document.getElementById('veh-year')?.value };
            const crypto = { sym: document.getElementById('cry-sym')?.value, net: document.getElementById('cry-net')?.value };
            const collectible = { brand: document.getElementById('col-brand')?.value, cond: document.getElementById('col-cond')?.value };

            if (!n) return;
            window.setBtnLoading('btn-save-acc', true);

            const newAcc = {
                id: window.genId(), name: n, currency: c, type: t,
                balance: bal, weight: w, units: u, schemeCode: code,
                subtype: subtype, category: category,
                details: { location, area, ...vehicle, ...crypto, ...collectible }
            };
            if (t === 'Emergency Fund' && !isNaN(emfTarget) && emfTarget !== null) {
                newAcc.target = emfTarget;
                if (!state.data.settings) state.data.settings = {};
                state.data.settings.emfTarget = emfTarget;
            }

            if (t === 'Commodity') {
                newAcc.subtype = document.getElementById('asub')?.value || document.getElementById('commodity-type')?.value || 'Gold';
            } else if (t === 'Mutual Fund') {
                newAcc.category = document.getElementById('acat')?.value || 'Equity';
            }

            if (bal !== 0) {
                newAcc.balance = 0; // Starts at 0, transaction will fill it
                state.data.transactions.push({
                    id: window.genId(),
                    accountId: newAcc.id,
                    amount: window.toCurrency(bal),
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

            // Mutual Fund fetch removed per cash-only logic

            await updateDb();
            window.setBtnLoading('btn-save-acc', false);
            closeModal();
        };

        window.saveTransaction = async function (txData) {
            let transaction = txData;

            // GLOBAL BALANCE SAFEGUARD (Programmatic calls)
            if (transaction) {
                if (transaction.type === 'expense' || transaction.type === 'transfer_out') {
                    const acc = state.data.accounts.find(a => a.id === transaction.accountId);
                    if (acc) {
                        // Parse amount safely (could be formatted string or number)
                        const reqAmt = parseFloat(transaction.amount);
                        if (acc.balance < reqAmt) {
                            window.showToast(`Insufficient Funds! (${acc.currency} ${acc.balance} < ${reqAmt})`, "error");
                            // Throwing error to stop execution chains in callers
                            throw new Error("Insufficient Funds");
                        }
                    }
                }
            }

            // 1. UI Mode: Scrape from DOM if no data provided
            if (!transaction) {
                const aId = document.getElementById('ta')?.value;
                const amtEl = document.getElementById('tam');
                const amt = parseFloat(amtEl?.value);
                const type = document.getElementById('tt')?.value;
                const cat = document.getElementById('tc')?.value;
                const note = document.getElementById('tn')?.value;

                if (!aId || isNaN(amt)) return;

                // Security: Prevent negative amounts
                if (amt < 0) {
                    window.showToast("Amount cannot be negative", "error");
                    // QoL: Ensure button is reset
                    const btn = document.getElementById('btn-save-tx');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = btn.innerHTML.includes('Update') ? 'Update Entry' : 'Save Transaction';
                        btn.classList.remove('opacity-50', 'cursor-not-allowed');
                    }
                    return;
                }

                window.setBtnLoading('btn-save-tx', true);

                const idx = state.data.accounts.findIndex(a => a.id === aId);
                const currentBal = state.data.accounts[idx].balance;

                // Insufficient Funds Check
                if (type === 'expense' && currentBal < amt) {
                    window.showToast("Insufficient Funds!", "error");
                    window.setBtnLoading('btn-save-tx', false);
                    return;
                }

                // Snapshot current exchange rate
                const rateSnapshot = state.data.settings.rate;

                transaction = {
                    id: window.genId(),
                    accountId: aId,
                    amount: window.toCurrency(amt),
                    type,
                    category: cat,
                    note,
                    date: new Date().toISOString(),
                    exchangeRate: rateSnapshot
                };
            }

            // 2. Commit to State
            state.data.transactions.push(transaction);

            // 3. Persist & Clean Up
            window.recalculateBalances(); // Derive new balances
            await updateDb();

            // Only handle UI cleanup if called from UI
            if (!txData) {
                window.setBtnLoading('btn-save-tx', false);
                closeModal();
                window.renderApp();
                // success toast handled by caller if programmatic, else here
                window.showToast("Transaction Saved", "success");
            }
        };

        window.doTransfer = async function () {
            const sId = document.getElementById('ts').value, tId = document.getElementById('ttg').value, val = parseFloat(document.getElementById('tamt').value), n = document.getElementById('trn').value;
            const tCat = (document.getElementById('tcat') ? document.getElementById('tcat').value : '') || 'Transfer';
            if (!sId || !tId || isNaN(val)) return;

            // Security: Prevent negative amounts
            if (val <= 0) {
                window.showToast("Transfer amount must be positive", "error");
                return;
            }

            if (sId === tId) {
                window.showToast("Cannot transfer to the same account", "error");
                return;
            }

            window.setBtnLoading('btn-do-transfer', true);

            const rate = state.data.settings.rate;
            const sIdx = state.data.accounts.findIndex(x => x.id === sId), tIdx = state.data.accounts.findIndex(x => x.id === tId);
            const sAcc = state.data.accounts[sIdx], tAcc = state.data.accounts[tIdx];

            if (sAcc.balance < val) {
                const errDiv = document.getElementById('transfer-error-msg');
                if (errDiv) {
                    errDiv.innerText = "Insufficient Funds in Source Account";
                    errDiv.classList.remove('hidden');
                } else {
                    window.showToast("Insufficient Funds in Source Account", "error");
                }
                window.setBtnLoading('btn-do-transfer', false);
                return;
            } else {
                const errDiv = document.getElementById('transfer-error-msg');
                if (errDiv) errDiv.classList.add('hidden');
            }

            let finalAmt = val;
            let noteSuffix = "";

            if (sAcc.currency !== tAcc.currency) {
                if (sAcc.currency === 'AED' && tAcc.currency === 'INR') finalAmt = val * rate;
                else if (sAcc.currency === 'INR' && tAcc.currency === 'AED') finalAmt = val / rate;
            }

            // --- INVESTMENT LOGIC REMOVED (Cost-Basis Only) ---

            // LEDGER-BASED REFACTOR: Do not manually update balances

            // 3. Transactions
            const dateIso = new Date().toISOString();
            const rateSnapshot = state.data.settings.rate;

            state.data.transactions.push({
                id: window.genId(), accountId: sId, amount: window.toCurrency(val), type: 'transfer_out', category: tCat, note: `To ${tAcc.name}: ${n}${noteSuffix} `, date: dateIso, exchangeRate: rateSnapshot, currency: sAcc.currency
            });
            state.data.transactions.push({
                id: window.genId(), accountId: tId, amount: window.toCurrency(finalAmt), type: 'transfer_in', category: tCat, note: `From ${sAcc.name}: ${n}${noteSuffix} `, date: dateIso, exchangeRate: rateSnapshot, currency: tAcc.currency
            });

            window.recalculateBalances();
            await updateDb();
            window.setBtnLoading('btn-do-transfer', false);
            closeModal();
            window.renderApp();
            window.showToast("Transfer Successful", "success");
        };

        window.openSettleFlow = function (id) {
            const d = state.data.debts.find(x => x.id === id), c = document.getElementById('modal-content');
            document.getElementById('modal-title').innerText = "Process Settlement";
            c.innerHTML = `<div class="text-slate-900 max-w-md mx-auto bg-slate-50 p-10 rounded-[3rem] border space-y-6 text-center shadow-xl">
                <p class="text-[10px] font-black uppercase">Entity: ${d.party}</p>
                <p class="text-3xl font-black">${d.amount} <span class="text-xs opacity-30">${d.currency}</span></p>
                <div class="text-left text-center"><label class="text-[10px] font-black uppercase block mb-1">Enter Volume (${d.currency})</label><input type="number" id="samt" step="0.01" value="${d.amount}" class="w-full p-4 border rounded-xl font-black text-xl text-center outline-none"></div>
                <div class="text-left text-center"><label class="text-[10px] font-black uppercase block mb-1">Select account</label><select id="sacc" class="text-slate-900 w-full p-4 border rounded-xl bg-white font-bold text-center">${state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type)).map(acc => `<option value="${acc.id}">${acc.name} (${acc.currency})</option>`).join('')}</select></div>
                <button id="btn-finalize-settle" onclick="window.finalizeSettle('${id}')" class="w-full bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase shadow-lg text-center text-center">Authorize Movement</button>
            </div> `;
            window.closeReminder(); document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
        };

        window.finalizeSettle = async function (id) {
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
                window.showToast(`Insufficient Funds in ${acc.name}`, "error");
                return;
            }

            window.setBtnLoading('btn-finalize-settle', true);

            // --- WHAPI AUTOMATION START ---
            try {
                const contact = state.data.contacts.find(c => c.name === d.party);
                if (contact && contact.phone && state.data.settings.whapiToken) {
                    const remaining = d.amount - enteredAmt;
                    const isFullSettle = (remaining <= 0.1);
                    const borrowedDate = new Date(d.repaymentDate || d.id.split('_')[0] || Date.now()).toLocaleDateString();
                    const noteText = d.notes ? `(Purpose: ${d.notes})` : '';

                    let msg = '';
                    if (d.type === 'receivable') {
                        // I received money (User was lender)
                        msg = `Hi ${d.party}, received ${enteredAmt} ${d.currency}. Thanks for settling that! ${noteText} ${isFullSettle ? '' : ` (Remaining: ${remaining.toFixed(2)} ${d.currency})`}`;
                    } else {
                        // I paid money (User was borrower)
                        msg = `Hi ${d.party}, I've sent ${enteredAmt} ${d.currency} to clear the pending balance. Please confirm when you get it. ${noteText} ${isFullSettle ? '' : ` (Remaining: ${remaining.toFixed(2)} ${d.currency})`}`;
                    }
                    // Fire and forget (don't await to block UI)
                    window.sendWhapiReminder(contact.name, msg, true); // isRaw = true
                    window.showToast("🔔 Settlement automated message sent!", "success");
                }
            } catch (e) {
                console.error("Whapi Auto-Settle Error", e);
            }
            // --- WHAPI AUTOMATION END ---


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
                id: window.genId(),
                accountId: aId,
                amount: window.toCurrency(finalTxAmt),
                type: d.type === 'receivable' ? 'income' : 'expense',
                category: 'Settlement',
                note: `${d.party} (${enteredAmt} ${d.currency}) ${fxNote.join(' ')}`,
                debtId: id, // Link to Debt
                date: new Date().toISOString()
            });

            // Math Safety & Auto-Settle
            const newAmount = d.amount - enteredAmt;
            if (newAmount <= 0.1) { // Threshold for float dust
                state.data.debts[dIdx].amount = 0;
                state.data.debts[dIdx].settled = true;
            } else {
                state.data.debts[dIdx].amount = window.toCurrency(newAmount);
            }

            window.recalculateBalances();
            await updateDb();
            window.setBtnLoading('btn-finalize-settle', false);
            renderApp();
            document.getElementById('modal-content').innerHTML = `<div class="flex flex-col items-center justify-center space-y-4 py-20 fade-in text-center text-center"><div class="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-center"><i data-lucide="check-circle-2" class="w-10 h-10"></i></div><h3 class="text-2xl font-black">Success!</h3><button onclick="window.closeModal()" class="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold uppercase text-[10px] text-center">Done</button></div> `;
            lucide.createIcons();
        };

        window.openRescheduleFlow = function (id) {
            const d = state.data.debts.find(x => x.id === id), b = document.getElementById('modal-backdrop'), t = document.getElementById('modal-title'), c = document.getElementById('modal-content');
            t.innerText = "Schedule Later";
            c.innerHTML = `<div class="text-slate-900 max-w-md mx-auto bg-white p-10 rounded-[3rem] border shadow-xl space-y-6 text-center text-center"><p class="text-[10px] font-black uppercase text-slate-400">Extension for ${d.party}</p><div class="text-left text-center"><label class="text-[10px] font-black uppercase block mb-2 text-center text-center">New Date</label><input type="date" id="new-date" class="w-full p-4 border rounded-xl font-bold text-center outline-none"></div><button id="btn-resched" onclick="window.finalizeReschedule('${id}')" class="w-full bg-slate-900 text-white p-5 rounded-3xl font-black uppercase shadow-lg text-center text-center">Commit</button></div> `;
            b.classList.replace('hidden', 'flex'); window.closeReminder(); lucide.createIcons();
        };

        window.finalizeReschedule = async function (id) {
            const dt = document.getElementById('new-date').value; if (!dt) return;
            window.setBtnLoading('btn-resched', true);
            state.data.debts[state.data.debts.findIndex(i => i.id === id)].repaymentDate = dt;
            await updateDb(); renderApp();
            document.getElementById('modal-content').innerHTML = `<div class="flex flex-col items-center justify-center space-y-6 py-20 fade-in text-center text-center text-center"><div class="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto text-center"><i data-lucide="calendar-check" class="w-12 h-12"></i></div><h3 class="text-2xl font-black text-center text-center">Updated</h3><button onclick="window.closeModal()" class="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold uppercase text-[10px] text-center">Done</button></div> `;
            lucide.createIcons();
        };

        window.openMasterLedger = function () {
            const b = document.getElementById('modal-backdrop');
            const t = document.getElementById('modal-title');
            const c = document.getElementById('modal-content');
            
            // Expand modal to stretch horizontally
            c.classList.remove('max-w-4xl');
            c.classList.add('max-w-[95vw]');

            t.innerText = "Transaction Ledger";
            c.innerHTML = `
            <div class="w-full h-full flex flex-col space-y-4">
                <!--Search & Export Header-->
                <div class="flex flex-col md:flex-row justify-between items-center gap-4 py-2 border-b border-slate-700/50 flex-shrink-0">
                    <div class="relative w-full md:w-auto flex-grow max-w-xl">
                        <i data-lucide="search" class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"></i>
                        <input type="text" id="ledger-search" oninput="window.filterLedger()" 
                            placeholder="Search #tags, notes, amounts..." 
                            class="pl-12 pr-4 py-4 bg-slate-900/50 border border-slate-700/50 text-white rounded-2xl text-sm font-black outline-none w-full transition-all focus:ring-1 focus:ring-rose-500/50 placeholder:text-slate-500">
                    </div>
                    
                    <div class="flex items-center space-x-2">
                         <div class="flex items-center space-x-2 mr-4 hidden md:flex">
                             <input type="date" id="ledger-date-from" onchange="window.filterLedger()" class="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-bold text-slate-300 uppercase outline-none focus:border-rose-500 transition-all cursor-pointer hover:bg-slate-700 text-center w-28" placeholder="From">
                             <span class="text-slate-500 font-bold">-</span>
                             <input type="date" id="ledger-date-to" onchange="window.filterLedger()" class="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-bold text-slate-300 uppercase outline-none focus:border-rose-500 transition-all cursor-pointer hover:bg-slate-700 text-center w-28" placeholder="To">
                         </div>

                        <button onclick="window.openModal('reports')" class="flex items-center space-x-2 bg-slate-800 border border-slate-700 text-slate-300 px-6 py-3 rounded-2xl font-bold text-[10px] uppercase hover:bg-rose-600 hover:text-white transition-all">
                            <i data-lucide="download" class="w-4 h-4"></i> <span>Export</span>
                        </button>
                    </div>
                </div>

                <!-- Table Container (Full Statement View) -->
                <div class="flex-grow overflow-y-auto no-scrollbar -mx-6 px-6 relative">
                    <div class="w-full pb-10 flex flex-col space-y-4">
                        
                        <!--Filter Chips directly above list-->
                        <div class="flex flex-col md:flex-row justify-between items-end gap-4 w-full">
                            <div class="flex flex-wrap items-center gap-2">
                                <button id="filter-btn-all" onclick="window.setLedgerFilter('all')" class="px-4 py-2 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase shadow-[0_0_15px_rgba(225,29,72,0.3)] transform scale-105 transition-all border border-rose-500">All</button>
                                <button id="filter-btn-income" onclick="window.setLedgerFilter('income')" class="px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all">Income</button>
                                <button id="filter-btn-expense" onclick="window.setLedgerFilter('expense')" class="px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all">Expense</button>
                                <button id="filter-btn-transfer" onclick="window.setLedgerFilter('transfer')" class="px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all">Transfers</button>
                                <button id="filter-btn-high" onclick="window.setLedgerFilter('high')" class="px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all">High Value (>5k)</button>
                            </div>
                            <!-- Mobile date picker and search fallbacks -->
                            <div class="flex items-center space-x-2 md:hidden">
                                <input type="text" id="ledger-search-mobile" onkeyup="document.getElementById('ledger-search').value = this.value; window.filterLedger()" placeholder="Search..." class="w-24 px-2 py-1 bg-slate-800 border border-slate-700 text-white rounded-lg text-[9px] font-bold outline-none">
                                <input type="date" id="ledger-date-from-mobile" onchange="document.getElementById('ledger-date-from').value = this.value; window.filterLedger()" class="px-2 py-1 bg-slate-800 border border-slate-700 text-white rounded-lg text-[9px] font-bold uppercase outline-none focus:border-rose-500 w-24">
                                <span class="text-slate-500">-</span>
                                <input type="date" id="ledger-date-to-mobile" onchange="document.getElementById('ledger-date-to').value = this.value; window.filterLedger()" class="px-2 py-1 bg-slate-800 border border-slate-700 text-white rounded-lg text-[9px] font-bold uppercase outline-none focus:border-rose-500 w-24">
                            </div>
                        </div>

                        <div id="master-ledger-body"></div>
                    </div>
                </div>
            </div>`;

            // Render Filters
            window.setLedgerFilter = function (filterType) {
                window.activeLedgerFilter = filterType;

                // Visual Update
                ['all', 'income', 'expense', 'transfer', 'high'].forEach(f => {
                    const btn = document.getElementById('filter-btn-' + f);
                    if (btn) {
                        if (f === filterType) {
                            btn.className = "px-4 py-2 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase shadow-[0_0_15px_rgba(225,29,72,0.3)] transform scale-105 transition-all border border-rose-500";
                        } else {
                            btn.className = "px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all";
                        }
                    }
                });

                window.filterLedger();
            };

            // Init Filter State
            window.activeLedgerFilter = 'all';

            b.classList.replace('hidden', 'flex');
            if (typeof window.renderLedger === 'function') {
                window.renderLedger(state.data.transactions);
            }
            lucide.createIcons();
        };

        window.viewAccountLedger = function (id) {
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
            // Transfer In = Deposit, Transfer Out = Withdrawal
            const deps = ts.filter(t => t.type === 'transfer_in').reduce((s, t) => s + parseFloat(t.amount), 0);
            const withs = ts.filter(t => t.type === 'transfer_out').reduce((s, t) => s + parseFloat(t.amount), 0);

            // For commodities OR Mutual Funds OR any investment, use originalCost if available + net transfers
            let investedNative;

            // Base calculation from ledger (Deposits - Withdrawals)
            const netTransfers = deps - withs;

            // If historical cost is set, add it. This is the "Base".
            if (a.originalCost !== undefined) {
                investedNative = a.originalCost + netTransfers;
            } else {
                investedNative = Math.max(0, netTransfers);
            }

            const investedINR = a.currency === 'AED' ? investedNative * r : investedNative;

            // 3. Profit / Loss & Projections (REMOVED: Cost-Basis Only)

            // --- RENDER UI ---
            c.innerHTML = `
                <div class="space-y-8 max-w-2xl mx-auto">
                    
                    <!--HERO CARD-->
                    <div class="bg-slate-900 text-white p-8 rounded-[3rem] text-center shadow-xl relative overflow-hidden">
                        <div class="relative z-10">
                            <p class="text-[10px] text-emerald-400 font-black uppercase mb-1 tracking-widest">${isInv ? 'Total Invested Amount' : 'Current Balance'}</p>
                            <div class="flex items-baseline justify-center space-x-2">
                                <span class="text-4xl font-black">${a.currency} ${curNative.toLocaleString()}</span>
                            </div>
                            ${a.currency === 'AED' ? `<p class="text-xs text-slate-500 font-bold mt-1">≈ ₹${Math.round(curINR).toLocaleString()}</p>` : ''}
                        </div>
                    </div>

                    <!--ACTIONS -->
                    ${isInv ? `
                      <div class="grid grid-cols-3 gap-2 mb-4">
                           <button onclick="window.quickInvest('${id}')" class="w-full py-4 bg-emerald-500 text-white rounded-2xl font-black uppercase text-[9px] tracking-widest hover:bg-emerald-600 transition-all shadow-md">+ Invest More</button>
                           <button onclick="window.quickLiquidate('${id}')" class="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black uppercase text-[9px] tracking-widest hover:bg-slate-200 transition-all">- Liquidate</button>
                           <button onclick="window.openModal('subscriptions')" class="w-full py-4 bg-indigo-500 text-white rounded-2xl font-black uppercase text-[9px] tracking-widest hover:bg-indigo-600 transition-all shadow-md"><i data-lucide="refresh-cw" class="w-3 h-3 inline mr-1"></i> Auto-SIP</button>
                      </div>` : ''}
                      <div class="flex justify-center space-x-4">
                         ${isInv ? `<button onclick="window.editOriginalCost('${id}')" class="px-6 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs uppercase hover:bg-slate-200 transition-all">Set Initial Investment</button>` : ''}
                         <button onclick="window.delAccount('${id}')" class="px-6 py-3 bg-red-50 text-red-500 rounded-xl font-bold text-xs uppercase hover:bg-red-100 transition-all">Delete Asset</button>
                    </div>

                    <!--LEDGER -->
                    <div class="space-y-4 text-left mt-8">
                        <h4 class="text-xs font-black uppercase text-slate-400 tracking-widest px-2">Recent History</h4>
                        ${ts.map(t => {
                            const isPositive = t.type === 'income' || t.type === 'transfer_in';
                            const color = isPositive ? 'text-emerald-400' : 'text-rose-400';
                            const sign = isPositive ? '+' : '-';
                            return `<div class="p-5 bg-slate-900/50 border border-slate-700/50 rounded-[2rem] flex justify-between items-center hover:bg-slate-800/80 transition-colors">
                                        <div class="truncate pr-4">
                                            <p class="font-black text-sm text-slate-100 truncate">${t.category || 'Transfer'}</p>
                                            <p class="text-[9px] font-bold text-slate-500 uppercase mt-0.5 truncate">${new Date(t.date).toLocaleDateString()} — ${t.note || '-'}</p>
                                        </div>
                                        <p class="font-black text-sm ${color} whitespace-nowrap">${sign}${Number(t.amount).toLocaleString()}</p>
                                    </div>`;
                        }).join('') || '<div class="p-8 text-center border border-dashed border-slate-700/50 rounded-3xl text-slate-500 text-xs font-bold uppercase tracking-widest mt-4">No transactions recorded</div>'}
                    </div>
                </div> `;

            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
        };

        // --- HELPER: Set Original Cost for Existing Commodities ---
        window.setOriginalCost = async function () {
            const commodities = state.data.accounts.filter(a =>
                a.type === 'Commodity' || (a.subtype && ['Gold', 'Silver', 'Platinum', 'Palladium', 'Oil', 'Diamond'].includes(a.subtype))
            );

            if (commodities.length === 0) {
                window.showToast('No commodity accounts found', 'info');
                return;
            }

            // Show list of commodities
            const list = commodities.map((acc, idx) =>
                `${idx + 1}. ${acc.name} (${acc.subtype || 'Commodity'}) - Current: ${acc.originalCost !== undefined ? acc.currency + ' ' + acc.originalCost : 'Not Set'}`
            ).join('\n');

            window.showPrompt(
                'Set Original Cost',
                `Select commodity by number:\n\n${list}\n\nEnter: [Number] [Amount]\nExample: 1 750`,
                async (input) => {
                    const parts = input.trim().split(' ');
                    if (parts.length !== 2) {
                        window.showToast('Invalid format. Use: [Number] [Amount]', 'error');
                        return;
                    }

                    const idx = parseInt(parts[0]) - 1;
                    const cost = parseFloat(parts[1]);

                    if (isNaN(idx) || idx < 0 || idx >= commodities.length || isNaN(cost)) {
                        window.showToast('Invalid input', 'error');
                        return;
                    }

                    const acc = commodities[idx];
                    const accIdx = state.data.accounts.findIndex(a => a.id === acc.id);
                    state.data.accounts[accIdx].originalCost = cost;

                    await updateDb();
                    window.showToast(`Original cost set to ${acc.currency} ${cost} for ${acc.name}`, 'success');
                    window.renderApp();
                },
                'text'
            );
        };

        // --- NEW: Edit Initial Cost for ANY Investment Account (MF, Stocks, Broken history) ---
        window.editOriginalCost = function (id) {
            const acc = state.data.accounts.find(a => a.id === id);
            if (!acc) return;

            window.showPrompt(
                "Set Initial Investment",
                `Enter the amount you invested BEFORE you started using this app.\n\n(Current Set Value: ${acc.originalCost || 0} ${acc.currency})`,
                async (val) => {
                    const cost = parseFloat(val);
                    if (isNaN(cost) || cost < 0) {
                        return window.showToast("Invalid Amount", "error");
                    }

                    acc.originalCost = cost;
                    await updateDb();
                    window.recalculateBalances(); // Instantly apply new base value
                    window.showToast("Initial Investment Updated!", "success");

                    // Refresh View
                    window.viewAccountLedger(id);
                    window.renderApp();
                },
                'number',
                acc.originalCost || '' // Pre-fill
            );
        };

        // --- ANALYTICS & CHARTS ---
        // --- SMART INSIGHTS ENGINE ---
        window.generateSmartInsights = function () {
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
                        .filter(t => t.type === 'expense' && t.category === cat && new Date(t.date) >= mStart)
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
                            text: `Slow down on <b> ${cat}</b> !You've used ${Math.round(spentPct * 100)}% of budget, but month is only ${Math.round(monthProgress * 100)}% done.`
                        });
                    } else if (spentPct >= 1.0) {
                        insights.push({
                            type: 'danger',
                            icon: 'x-octagon',
                            text: `<b>${cat}</b> budget exceeded by ${Math.round((spentPct - 1) * 100)}%. Stop spending here!`
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

        window.renderSmartInsights = function () {
            const list = document.getElementById('insights-list');
            if (!list) return;
            const msgs = window.generateSmartInsights();

            if (msgs.length === 0) {
                document.getElementById('smart-insights-panel').classList.add('hidden');
                return;
            }

            document.getElementById('smart-insights-panel').classList.remove('hidden');
            list.innerHTML = msgs.map(m => {
                const colors = m.type === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                    (m.type === 'danger' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100');
                const iconColor = m.type === 'warning' ? 'text-amber-500' : (m.type === 'danger' ? 'text-red-500' : 'text-emerald-500');
                return `
                <div class="p-4 rounded-2xl border ${colors} flex items-start gap-3 shadow-sm text-left">
                    <div class="mt-0.5"><i data-lucide="${m.icon}" class="w-5 h-5 ${iconColor}"></i></div>
                    <p class="text-xs font-medium leading-relaxed">${m.text}</p>
                </div>`;
            }).join('');
            lucide.createIcons();

            // Auto-hide after 1 minute (60000ms)
            setTimeout(() => {
                document.getElementById('smart-insights-panel').classList.add('hidden');
            }, 60000);
        };

        // --- ANALYTICS & CHARTS ---


        window.renderCharts = function () {
            const r = state.data.settings.rate;
            const cur = window.chartCurrency || 'AED';

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
                    const val = window.toChartCur(Number(t.amount), t.currency || 'AED', r);
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

        // --- AUTOMATION: SELF REMINDERS ---
        window.checkSelfReminders = function () {
            if (!state.data.settings.whapiToken) return;
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            const myName = state.user.displayName || "Me";
            const myPhone = state.user.phoneNumber || state.data.settings.myPhone;

            if (!myPhone) return;

            // 1. BNPL Due Today
            state.data.debts.filter(d => d.isBnpl && !d.settled).forEach(d => {
                d.schedule.forEach((s, idx) => {
                    if (!s.paid && (s.date === todayStr || s.dueDate === todayStr)) {
                        const msg = `🔔 *Payment Due Today*\n\nInstallment ${idx + 1}/${d.installments} for **${d.party}**\nAmount: ${d.currency} ${s.amount}\n\nPlease ensure sufficient funds are available.`;
                        window.sendWhapiReminder(myName, msg, true); // sendToSelf=true
                    }
                });
            });

            // 2. Personal Payables Due Today (New)
            state.data.debts.filter(d => d.type === 'payable' && !d.isBnpl && !d.settled && d.repaymentDate === todayStr).forEach(d => {
                const msg = `🔔 *Payment Due Today*\n\nYou owe **${d.party}** ${d.currency} ${d.amount}\nNote: ${d.notes || 'No notes'}\n\nPlease settle this debt.`;
                window.sendWhapiReminder(myName, msg, true);
            });

            // 2. Receivables Due Today (Existing logic presumed)
            state.data.debts.filter(d => d.type === 'receivable' && !d.settled && d.repaymentDate === todayStr).forEach(d => {
                const msg = `🔔 *Collection Due Today*\n\n${d.party} owes you ${d.currency} ${d.amount}\nNote: ${d.notes || 'No notes'}`;
                window.sendWhapiReminder(myName, msg, true);
            });
        };

        // --- NEW FUNCTIONS ---



        window.cloneTransaction = async (id) => {
            const tx = state.data.transactions.find(t => t.id === id);
            if (!tx || tx.accountId === 'virtual_writeoff' || tx.type.includes('transfer')) {
                alert("Cannot clone this transaction type.");
                return;
            }

            const newTx = {
                ...tx,
                id: window.genId(),
                date: new Date().toISOString(),
                note: tx.note + ' (Clone)'
            };

            state.data.transactions.push(newTx);
            await updateDb();
            // Integrity: Recalculate balances from ledger instead of manual math
            window.recalculateBalances();
            window.renderApp();
            window.showToast("Transaction Cloned", "success");
        };

        window.deleteTransaction = async (id) => {
            window.showConfirm(
                "⚠? DELETE TRANSACTION?",
                "This will permanently remove the record and update your balances.",
                async () => {
                    try {
                        const tx = state.data.transactions.find(t => t.id === id);
                        if (!tx) return; // Ignore double clicks or already deleted items

                        // 1. REVERSE DEBT (If linked)
                        if (tx.debtId) {
                            const dIdx = state.data.debts.findIndex(d => d.id === tx.debtId);
                            if (dIdx !== -1) {
                                // Revert amount logic
                                const d = state.data.debts[dIdx];
                                // If it was a payment (settlement/install), we ADD back to debt
                                // If it was a 'loan given' transaction... usually we don't delete those to reverse, we delete the debt.
                                // But if we delete a "Repayment" transaction:
                                if (d.type === 'payable' || d.type === 'receivable') {
                                    // Logic: d.amount is the *remaining* balance.
                                    // We need to add back the tx.amount.
                                    // Security: Validate tx.amount > 0 and d.amount matches expected?
                                    // Just add it back.
                                    // 1. If it was settled, unsettle it.
                                    if (d.settled) state.data.debts[dIdx].settled = false;

                                    // 2. Add amount
                                    state.data.debts[dIdx].amount = window.toCurrency((parseFloat(d.amount) || 0) + parseFloat(tx.amount));

                                    console.log(`Reverted Debt ${d.id}: +${tx.amount}`);
                                }
                            }
                        }

                        // 2. Remove Transaction
                        state.data.transactions = state.data.transactions.filter(t => t.id !== id);

                        // 3. Save & Refresh Dashboard
                        await updateDb();
                        window.recalculateBalances();

                        console.log("Deleted transaction:", id);
                        window.showToast("Transaction Deleted", "success");
                        window.renderApp();

                        // 4. Refresh Active Modal Views
                        if (document.getElementById('master-ledger-body')) {
                            if (typeof window.filterLedger === 'function') window.filterLedger();
                        } else if (document.getElementById('modal-title') && document.getElementById('modal-title').innerText.includes("Debt")) {
                            const modalContent = document.getElementById('modal-content');
                            if (modalContent && typeof window.renderDebtUI === 'function') {
                                modalContent.innerHTML = window.renderDebtUI(); 
                                lucide.createIcons();
                            }
                        }
                    } catch (error) {
                        console.error("Delete failed:", error);
                        window.showToast("Delete failed: " + error.message, "error");
                    }
                }
            );
        };
        window.confirmDeleteTransaction = window.deleteTransaction;

        window.editTransaction = (id) => {
            const tx = state.data.transactions.find(t => t.id === id);
            if (!tx) return;

            // Block complex edits
            if (tx.type.includes('transfer') || ['Settlement', 'Lending', 'Borrowing'].includes(tx.category) || tx.accountId === 'virtual_writeoff') {
                alert("⚠? Complex Entry Locked\n\nTransfers, Debt Settlements, and Write-offs cannot be edited directly because they affect multiple records.\n\nPlease DELETE this entry and create a new one.");
                return;
            }

            // Open Modal
            window.openModal('transaction');

            // Fill values
            document.getElementById('tt').value = tx.type;
            window.setT(tx.type); // Update UI buttons
            document.getElementById('ta').value = tx.accountId;
            document.getElementById('tc').value = tx.category;
            document.getElementById('tam').value = tx.amount;
            document.getElementById('tn').value = tx.note;

            // Change Save button to Update
            const btn = document.getElementById('btn-save-tx');
            btn.innerText = "Update Entry";
            btn.onclick = () => window.updateTransaction(id);
        };

        window.updateTransaction = async (id) => {
            // Get New Values
            const aId = document.getElementById('ta').value;
            const amt = parseFloat(document.getElementById('tam').value);
            const type = document.getElementById('tt').value;
            const cat = document.getElementById('tc').value;
            const note = document.getElementById('tn').value;

            if (!aId || isNaN(amt)) return;

            // Security: Prevent negative amounts
            if (amt < 0) {
                window.showToast("Amount cannot be negative", "error");
                return;
            }

            window.setBtnLoading('btn-save-tx', true);

            // 1. Update Transaction Object
            const txIdx = state.data.transactions.findIndex(t => t.id === id);
            const oldTx = state.data.transactions[txIdx];

            state.data.transactions[txIdx] = {
                ...oldTx,
                accountId: aId,
                amount: window.toCurrency(amt),
                type: type,
                category: cat,
                note: note,
            };

            await updateDb();
            // Integrity: Recalculate balances from ledger
            window.recalculateBalances();

            window.closeModal();
            window.renderApp();
            window.showToast("Transaction Updated", "success");
            window.setBtnLoading('btn-save-tx', false);
        };

        onAuthStateChanged(auth, (user) => {
            if (user && state.data?.settings?.pinCode && sessionStorage.getItem('fs_is_locked') === 'true') {
                document.getElementById('pin-lock-screen')?.classList.replace('hidden', 'flex');
            }
            state.user = user;
            const initialLoader = document.getElementById('initial-loader');
            if (initialLoader) initialLoader.style.display = 'none';
            const projectTag = document.getElementById('project-tag');
            if (user && !user.isAnonymous) {
                document.getElementById('auth-screen').style.display = 'none';
                document.getElementById('app-content').style.display = 'flex';
                onSnapshot(doc(db, 'artifacts', appId, 'users', user.uid, 'finance', 'main'), async (snap) => {
                    if (snap.exists()) {
                        const dbData = snap.data();
                        state.data = { ...state.data, ...dbData };
                        // THEME PERSISTENCE
                        if (state.data.settings && state.data.settings.theme) {
                            window.applyTheme(state.data.settings.theme);
                        }

                        // Defensive Defaults
                        if (!state.data.goals) state.data.goals = [];
                        if (!state.data.portfolio) state.data.portfolio = {};
                        if (!state.data.commodityRates) state.data.commodityRates = { Gold: 7200, Silver: 90 };
                        if (!state.data.commodityRatesAED) state.data.commodityRatesAED = { Gold: 315, Silver: 3.5 };
                        if (!state.data.contacts) state.data.contacts = []; // New Feature: People Ledger
                        if (!state.data.allocationTargets) state.data.allocationTargets = { 'Real Estate': 0, 'Gold': 20, 'Equity': 50, 'Cash': 30 };
                        if (!state.data.budgets) state.data.budgets = {};
                        if (!state.data.budgetRollovers) state.data.budgetRollovers = {};
                        if (!state.data.fixedCategories) state.data.fixedCategories = []; // New Feature
                        if (!state.data.subscriptions) state.data.subscriptions = [];
                        if (!state.data.sinkingFunds) state.data.sinkingFunds = []; // New Feature
                        if (!state.data.settings.theme) state.data.settings.theme = 'emerald';

                        // Force update asset types to ensure new features appear
                        const requiredTypes = ['Bank Account', 'Cash', 'Savings', 'Investment', 'Real Estate'];
                        state.data.assetTypes = [...new Set([...(state.data.assetTypes || []), ...requiredTypes])].filter(t => t !== 'Commodity' && t !== 'Mutual Fund' && t !== 'Vehicle' && t !== 'Collectible'); // Clean up

                        // Retrofit existing accounts if needed
                        state.data.accounts.forEach(a => {
                            if (!a.currency) a.currency = 'INR'; // Default fallback
                        });

                        // Messaging Migration
                        if (state.data.settings.whapiToken && !state.data.settings.messagingToken) {
                            state.data.settings.messagingToken = state.data.settings.whapiToken;
                        }
                        try {
                            window.checkDueDebts();
                            window.checkSelfReminders();
                            window.fetchExchangeRate();
                            window.fetchMetalsRate();
                            window.checkSubscriptions();
                            await window.checkBudgetRollover();
                            window.recalculateBalances(); // Always self-heal ledger balances on load
                            window.renderApp();
                        } catch (e) {
                            console.error("Init Error", e);
                        }
                    } else {
                        // Init new user
                        state.data = { accounts: [], transactions: [], settings: { rate: 22.75 } }; // Basic default
                        updateDb();
                    }
                });
            } else {
                document.getElementById('auth-screen').style.display = 'flex';
                document.getElementById('app-content').style.display = 'none';
            }
        });


        // --- IMPULSE TEST LOGIC ---
        window.runImpulseTest = function () {
            window.showPrompt("Impulse Reality Check", "Cost of item you want to buy (AED)?", (priceStr) => {
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

                    const curVal = acc.currency === 'AED' ? window.toCurrency(acc.balance * state.data.settings.rate) : acc.balance;
                    const invVal = acc.currency === 'AED' ? window.toCurrency(netInvested * state.data.settings.rate) : netInvested;

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
                    window.showToast("📉 You have no passive income yet! Invest first!", "warning");
                    return;
                }

                const recoveryMonths = price / monthlyPassive;
                const years = (recoveryMonths / 12).toFixed(1);

                window.showConfirm(
                    "? TIME TO RECOVERY",
                    `To earn back the cost of **AED ${price.toLocaleString()}** passively, it will take your portfolio:\n\n📅 **${recoveryMonths.toFixed(1)} MONTHS**\n\n(Based on avg growth of AED ${Math.round(monthlyPassive)}/mo).\n\nIs it worth ${Math.round(recoveryMonths * 30)} days of freedom?`,
                    () => { } // No action on OK, just info
                );
            }, "number");
        };

        // --- OVERRIDE: Budgeting in AED ---
        window.renderBudgetUI = function () {
            const startDay = state.data.settings.budgetStartDay || 1;
            const today = new Date();
            const currentDay = today.getDate();

            // Determine Cycle (Payday to Payday-1)
            let startDate, endDate;
            if (currentDay >= startDay) {
                startDate = new Date(today.getFullYear(), today.getMonth(), startDay);
                // Ends next month on startDay - 1
                // Handle edge case: if startDay is 1, end is 0 (last day of prev month? No)
                // If start 1: Jan 1 to Jan 31.
                // If start 25: Jan 25 to Feb 24.

                // Construct next month date
                let nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, startDay);
                nextMonth.setDate(nextMonth.getDate() - 1); // Subtract 1 day
                endDate = nextMonth;
            } else {
                // Previous cycle
                startDate = new Date(today.getFullYear(), today.getMonth() - 1, startDay);
                let thisMonth = new Date(today.getFullYear(), today.getMonth(), startDay);
                thisMonth.setDate(thisMonth.getDate() - 1);
                endDate = thisMonth;
            }

            // Set restriction: time components (00:00:00 vs 23:59:59)
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);

            const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            const daysPassed = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
            // Correct logic: if today is start date, passed is 0? No, should be 1?
            // Let's settle on: Days Left
            const daysLeft = Math.max(0, Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)));
            const progressMonth = Math.min(100, Math.max(0, ((totalDays - daysLeft) / totalDays) * 100)); // Visual progress

            const rate = state.data.settings.rate;

            let totalFixedBudget = 0, totalFixedSpend = 0;
            let totalDiscBudget = 0, totalDiscSpend = 0;

            // Prepare Data
            const items = state.data.expenseCategories.map(cat => {
                const b = (state.data.budgets && state.data.budgets[cat]) || 0;
                const rollover = (state.data.budgetRollovers && state.data.budgetRollovers[cat]) || 0;
                const totalLimit = b + rollover;
                const isFixed = (state.data.fixedCategories || []).includes(cat);

                // Calc spend this cycle (Normalized to AED)
                const spend = state.data.transactions.filter(t => {
                    if (t.type !== 'expense' || t.category !== cat) return false;
                    const d = new Date(t.date);
                    return d >= startDate && d <= endDate;
                }).reduce((s, t) => {
                    const acc = state.data.accounts.find(a => a.id === t.accountId);
                    const cur = t.currency || acc?.currency || 'AED';
                    let val = parseFloat(t.amount);
                    if (cur !== 'AED') val = val / rate;
                    return s + window.toCurrency(val);
                }, 0);

                // Forecast
                // Daily avg based on DAYS PASSED in cycle
                const daysGone = totalDays - daysLeft;
                const dailyAvg = daysGone > 0 ? (spend / daysGone) : 0;
                const forecast = spend + (dailyAvg * daysLeft);
                const forecastPct = totalLimit > 0 ? (forecast / totalLimit) * 100 : 0;
                const currentPct = totalLimit > 0 ? (spend / totalLimit) * 100 : 0;

                if (isFixed) { totalFixedBudget += totalLimit; totalFixedSpend += spend; }
                else { totalDiscBudget += totalLimit; totalDiscSpend += spend; }

                return { cat, b, rollover, totalLimit, spend, isFixed, forecast, forecastPct, currentPct };
            });

            // GHOST EXPENSE: Inject BNPL Obligations
            let bnplLimit = 0;
            let bnplSpent = 0;
            state.data.debts.filter(d => d.isBnpl && !d.settled).forEach(d => {
                d.schedule.forEach(s => {
                    const sDate = new Date(s.date || s.dueDate);
                    // Check if due in this cycle
                    if (sDate >= startDate && sDate <= endDate) {
                        const amt = parseFloat(s.amount) * (d.currency === 'AED' ? 1 : (1 / rate));
                        bnplLimit += amt;
                        if (s.paid) bnplSpent += amt;
                    }
                });
            });

            if (bnplLimit > 0) {
                items.push({
                    cat: 'BNPL Commitments ??',
                    b: bnplLimit,
                    rollover: 0,
                    totalLimit: bnplLimit,
                    spend: bnplSpent,
                    isFixed: true,
                    forecast: bnplLimit, // Obligatory
                    forecastPct: 100,
                    currentPct: (bnplSpent / bnplLimit) * 100
                });
                totalFixedBudget += bnplLimit;
                totalFixedSpend += bnplSpent;
            }

            // Calc Safe Spend (Macro-Bucket: Total Cash - Upcoming Bills)
            const totalCashAvailable = state.data.accounts
                .filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type))
                .reduce((sum, a) => {
                    let val = parseFloat(a.balance) || 0;
                    if (a.currency && a.currency !== 'AED') val = val / rate;
                    return sum + val;
                }, 0);

            const upcomingBills = Math.max(0, totalFixedBudget - totalFixedSpend);
            const remainingDisc = Math.max(0, totalCashAvailable - upcomingBills);
            const safeDaily = daysLeft > 0 ? (remainingDisc / daysLeft) : 0;

            // Separate lists
            const fixedItems = items.filter(i => i.isFixed);
            const discItems = items.filter(i => !i.isFixed);

            const renderItem = (i) => {
                const isOver = i.spend > i.totalLimit;
                const isTrendingOver = i.forecast > i.totalLimit;
                const alertLim = state.data.settings.budgetAlertLimit || 80;
                const color = isOver ? 'bg-red-500' : (i.currentPct > alertLim ? 'bg-amber-500' : 'bg-emerald-500');
                const canSweep = !i.isFixed && !isTrendingOver && i.spend > 0 && daysLeft < 10; // Only sweep near end of month or if safe

                return `<div class="text-slate-900 bg-white p-5 rounded-[2rem] border shadow-sm relative overflow-hidden">
                    <div class="flex justify-between items-center mb-2 relative z-10">
                        <div class="flex items-center gap-2">
                             ${i.isFixed ? '<i data-lucide="lock" class="w-3 h-3 text-slate-300"></i>' : ''}
                             <p class="font-black text-slate-800">${i.cat}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-xs font-black text-slate-900 num-font mb-0.5">AED ${Math.round(i.spend).toLocaleString()} <span class="text-slate-400 font-sans tracking-normal">/ ${i.totalLimit.toLocaleString()}</span></p>
                            ${i.rollover > 0 ? `<p class="text-[8px] font-bold text-amber-500 uppercase">+AED ${Math.round(i.rollover)} Rollover</p>` : ''}
                        </div>
                    </div>
                    
                    <!-- Progress Bar Container -->
                    <div class="h-3 w-full bg-slate-100 rounded-full overflow-hidden relative mb-2">
                        <!-- Ghost Bar (Forecast) -->
                        <div class="absolute top-0 left-0 h-full bg-slate-200 transition-all duration-700 w-0" style="width: ${Math.min(100, i.forecastPct)}%"></div>
                        <!-- Month Line Marker -->
                        <div class="absolute top-0 h-full border-r-2 border-slate-300/50 z-20" style="left: ${progressMonth}%"></div>
                        <!-- Actual Spend -->
                        <div class="absolute top-0 left-0 h-full ${color} w-0 transition-all duration-1000 z-10" style="width: ${Math.min(100, i.currentPct)}%"></div>
                    </div>

                    <div class="flex justify-between items-center relative z-10">
                        <div class="flex gap-2">
                            <button onclick="window.setBudget('${i.cat}')" class="text-[9px] font-bold text-slate-400 hover:text-emerald-500 uppercase">Edit Limit</button>
                            ${canSweep ? `<button onclick="window.sweepBudget('${i.cat}', ${Math.max(0, i.totalLimit - i.spend)})" class="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 rounded-full hover:bg-emerald-100 uppercase flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3"></i> Sweep AED ${Math.round(i.totalLimit - i.spend)}</button>` : ''}
                        </div>
                        
                        ${isTrendingOver && !isOver ? `<p class="text-[8px] font-bold text-amber-500 uppercase animate-pulse">Trending Over (+AED ${Math.round(i.forecast - i.totalLimit)})</p>` :
                        `<p class="text-[9px] font-bold text-slate-400 uppercase">AED ${Math.max(0, i.totalLimit - i.spend).toLocaleString()} Left</p>`}
                    </div>
                </div>`;
            };

            return `<div class="max-w-xl mx-auto space-y-8">

                <!-- 0. BNPL ANALYZER (Tabby/Tamara) -->
                ${window.renderBNPLAnalyzer ? window.renderBNPLAnalyzer() : ''}

                <!-- PROJECTS & TAGS LINK -->
                <button onclick="window.openModal('tags')" class="w-full bg-pink-50 border border-pink-100 p-6 rounded-[2rem] hover:bg-pink-100 transition-colors flex items-center justify-between group">
                    <div class="flex items-center gap-3">
                        <div class="bg-pink-200 p-3 rounded-full text-pink-600">
                            <i data-lucide="hash" class="w-5 h-5"></i>
                        </div>
                        <div class="text-left">
                            <p class="font-black text-pink-600">Projects & Tag Analytics</p>
                            <p class="text-[10px] font-bold text-pink-400">View expenses categorized by #tags</p>
                        </div>
                    </div>
                    <i data-lucide="chevron-right" class="w-5 h-5 text-pink-400 group-hover:translate-x-1 transition-transform"></i>
                </button>

                <!-- SAFE TO SPEND GLOBALLY -->
                <div class="text-slate-900 bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p class="text-[9px] uppercase font-black text-emerald-500 mb-1 tracking-widest flex items-center"><i data-lucide="shield-check" class="w-3 h-3 mr-1"></i> Total Safe to Spend</p>
                        <p class="text-[10px] font-bold text-slate-400">Total Liquid Cash excluding Goal Savings</p>
                    </div>
                    <div class="text-right">
                        <p id="safe-to-spend-budget" class="font-black text-2xl text-slate-800">AED 0.00</p>
                    </div>
                </div>
                <!-- 1. VELOCITY CARD -->
                <div class="bg-slate-900 text-white p-8 rounded-[3rem] shadow-xl text-center relative overflow-hidden">
                    <button onclick="window.runImpulseTest()" class="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors z-20" title="Impulse Test"><i data-lucide="timer" class="w-5 h-5"></i></button>
                    <div class="relative z-10">
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Daily Safe Spend</p>
                        <h2 class="text-4xl font-black text-emerald-400 mb-1 num-font">AED ${Math.floor(safeDaily).toLocaleString()}<span class="text-sm text-slate-500 font-sans tracking-normal ml-1">/day</span></h2>
                        <p class="text-[10px] font-bold text-slate-500 mt-2">${daysLeft} Days Left • AED ${Math.round(remainingDisc).toLocaleString()} Available</p>
                    </div>
                    <div class="absolute -right-4 -bottom-4 opacity-10"><i data-lucide="activity" class="w-32 h-32"></i></div>
                </div>

                <!-- 2. FIXED OBLIGATIONS -->
                ${fixedItems.length > 0 ? `
                <div>
                     <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4 ml-4">Fixed Obligations</h4>
                     <div class="space-y-4 opacity-80 hover:opacity-100 transition-opacity">
                        ${fixedItems.map(renderItem).join('')}
                     </div>
                </div>` : ''}

                <!-- 3. DISCRETIONARY -->
                <div>
                    <div class="flex justify-between items-center mb-4 px-4">
                        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest">Discretionary</h4>
                        <button onclick="window.openBudgetSettings()" class="bg-slate-100 text-slate-500 p-2 rounded-full hover:bg-slate-200"><i data-lucide="settings-2" class="w-4 h-4"></i></button>
                    </div>
                    <div class="space-y-4">
                        ${discItems.map(renderItem).join('')}
                    </div>
                </div>
            </div>`;
        };

        // Global Alias for BNPL Settlement (Moved from renderDebtUI)
        window.openBnplSettleModal = function (id, idx) {
            const d = state.data.debts.find(x => x.id === id);
            if (!d || !d.schedule[idx]) return;

            const inst = d.schedule[idx];
            const amt = inst.amount;

            window.showConfirm("Process Settlement", `
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
                `<option value="${a.id}">${a.name} (${window.toCurrency(a.balance)} ${a.currency})</option>`
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

                // 1. Mark Paid
                inst.paid = true;
                inst.status = 'paid'; // FIXED: Explicitly set status string to break visibility loop
                // Recalculate current amount to be safe from float drift
                let remaining = 0;
                d.schedule.forEach(s => { if (!s.paid) remaining += parseFloat(s.amount); });
                d.currentAmount = remaining;

                if (d.currentAmount < 0.1) { d.currentAmount = 0; d.settled = true; }

                // 2. Prepare Transaction Data
                const finalAmt = parseFloat(amt);
                const baseAmt = (acc.currency === 'AED') ? finalAmt : (finalAmt / state.data.settings.rate);

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

                // 3. Log Transaction (Handles State Push + DB Save + Recalc Balances)
                // We save the amount in the ACCOUNT'S Check currency to ensure the Ledger subtracts correctly.
                await window.saveTransaction({
                    id: window.genId(),
                    accountId: acc.id,
                    type: 'expense',
                    amount: window.toCurrency(baseAmt),
                    currency: acc.currency,
                    category: 'BNPL Payment',
                    note: finalNote,
                    date: finalDateIso,
                    debtId: d.id,
                    tags: ['#BNPL']
                });

                // 4. UI Refresh
                window.renderApp();

                // Refresh Modal Content (Instant Feedback)
                const modalContent = document.getElementById('modal-content');
                if (modalContent) { modalContent.innerHTML = window.renderDebtUI(); lucide.createIcons(); }

                window.showToast("Payment Recorded Successfully", "success");

            }, "Confirm Payment");
        };
        window.settleInstallment = window.openBnplSettleModal;

        // --- QUICK INVEST / LIQUIDATE ---
        window.quickInvest = function(accId) {
            const acc = state.data.accounts.find(a => a.id === accId);
            if (!acc) return;

            window.showConfirm("Invest Funds", `
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
                                `<option value="${a.id}">${a.name} (${window.toCurrency(a.balance)} ${a.currency})</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
            `, async () => {
                const amt = parseFloat(document.getElementById('quick-inv-amt').value);
                const sId = document.getElementById('quick-inv-source').value;
                if (!amt || amt <= 0 || !sId) return window.showToast("Invalid Amount", "error");
                
                const sAcc = state.data.accounts.find(a => a.id === sId);
                const tIdx = state.data.accounts.findIndex(a => a.id === accId);
                if (!sAcc || tIdx === -1) return;

                // Create Expense on Source
                await window.saveTransaction({
                    id: window.genId(),
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
                await window.saveTransaction({
                    id: window.genId(),
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

                window.renderApp();
                window.viewAccountLedger(acc.id);
                window.showToast("Investment Recorded Successfully", "success");
            }, "Confirm Investment");
        };

        window.quickLiquidate = function(accId) {
            const acc = state.data.accounts.find(a => a.id === accId);
            if (!acc) return;

            window.showConfirm("Liquidate Asset", `
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
                                `<option value="${a.id}">${a.name} (${window.toCurrency(a.balance)} ${a.currency})</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
            `, async () => {
                const amt = parseFloat(document.getElementById('quick-liq-amt').value);
                const tId = document.getElementById('quick-liq-dest').value;
                if (!amt || amt <= 0 || !tId) return window.showToast("Invalid Amount", "error");
                
                const tAcc = state.data.accounts.find(a => a.id === tId);
                const sIdx = state.data.accounts.findIndex(a => a.id === accId);
                if (!tAcc || sIdx === -1) return;

                // Create Expense on Source (Asset)
                await window.saveTransaction({
                    id: window.genId(),
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
                await window.saveTransaction({
                    id: window.genId(),
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

                window.renderApp();
                window.viewAccountLedger(acc.id);
                window.showToast("Liquidation Recorded Successfully", "success");
            }, "Confirm Liquidation");
        };

        // Initialize (re-call just in case it was missed, though existing call should be fine)
        if (window.init) window.init();

        // --- NEW SALARY AND BUDGET FEATURES ---
        window.calcSalAlloc = function () {
            const amt = parseFloat(document.getElementById('sal-amount').value) || 0;
            const savPct = parseFloat(document.getElementById('sal-sav-pct').value) || 0;
            const invPct = parseFloat(document.getElementById('sal-inv-pct').value) || 0;
            const expPct = parseFloat(document.getElementById('sal-exp-pct').value) || 0;

            document.getElementById('sal-sav-val').innerText = (amt * (savPct/100)).toFixed(2);
            document.getElementById('sal-inv-val').innerText = (amt * (invPct/100)).toFixed(2);
            document.getElementById('sal-exp-val').innerText = (amt * (expPct/100)).toFixed(2);
        };

        window.processSalary = async function () {
            const amt = parseFloat(document.getElementById('sal-amount').value) || 0;
            const aId = document.getElementById('sal-acc').value;
            if (amt <= 0 || !aId) {
                window.showToast("Please enter a valid amount and select account", "error");
                return;
            }
            
            const savAmt = parseFloat(document.getElementById('sal-sav-val').innerText);
            const invAmt = parseFloat(document.getElementById('sal-inv-val').innerText);
            const expAmt = parseFloat(document.getElementById('sal-exp-val').innerText);

            const rateSnapshot = state.data.settings.rate;
            const date = new Date().toISOString();

            // 1. Income transaction (Salary)
            state.data.transactions.push({
                id: window.genId(), accountId: aId, amount: window.toCurrency(amt), type: 'income', category: 'Salary', note: `Salary Processed (Sav: ${savAmt}, Inv: ${invAmt}, Exp: ${expAmt})`, date, exchangeRate: rateSnapshot
            });

            window.showToast("Salary Processed & Logged!", "success");
            window.recalculateBalances();
            await window.updateDb();
            window.renderApp();
            window.closeModal();
        };

        window.printSalary = function () {
            window.print();
        };

        window.checkBudgetWarning = function () {
            const typeEl = document.getElementById('tt');
            const warningEl = document.getElementById('tx-warning');
            if (!typeEl || !warningEl) return;
            
            const type = typeEl.value;
            if (type !== 'expense') {
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
                if (t.type === 'expense' && t.category === cat && t.date >= startOfMonth) {
                    spent += parseFloat(t.amount);
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


// --- NEW BUDGET WIZARD OVERRIDE ---
window.startBudgetWizard = function (step = 1) {
    window.budgetWizardState = window.budgetWizardState || {
        expectedSalary: state.data.settings.expectedSalary || 0,
        tempBudgets: { ...state.data.budgets }
    };

    let content = '';
    
    if (step === 1) {
        content = `
            <div class="text-slate-900 max-w-md mx-auto bg-white/70 backdrop-blur-xl p-10 rounded-[3rem] border shadow-2xl text-center">
                <div class="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                    <i data-lucide="wallet" class="w-10 h-10 text-emerald-500"></i>
                </div>
                <h2 class="text-2xl font-black text-slate-900 mb-2">Monthly Income</h2>
                <p class="text-xs font-bold text-slate-500 mb-8">What is your expected total income for this month?</p>
                
                <div class="mb-8">
                    <input type="number" id="wizard-salary" value="${window.budgetWizardState.expectedSalary}" class="w-full text-center text-4xl font-black text-emerald-600 bg-transparent border-b-4 border-slate-200 focus:border-emerald-500 outline-none pb-4 transition-colors" placeholder="0.00">
                    <p class="text-[10px] font-black uppercase text-slate-400 mt-2">Base Currency</p>
                </div>
                
                <button onclick="window.budgetWizardState.expectedSalary = parseFloat(document.getElementById('wizard-salary').value) || 0; window.startBudgetWizard(2)" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest py-4 rounded-2xl transition-all shadow-lg">Next: Categories <i data-lucide="arrow-right" class="w-4 h-4 inline ml-2"></i></button>
            </div>
        `;
    } 
            else if (step === 2) {
        content = window.render3PillarCategoryManager("window.renderBudgetUIOverride()");
    }
    else if (step === 3) {
        content = `
            <div class="text-slate-900 max-w-xl mx-auto bg-white/70 backdrop-blur-xl p-10 rounded-[3rem] border shadow-2xl h-[85vh] flex flex-col">
                <div class="flex justify-between items-center mb-6">
                    <button onclick="window.openCategoryManager('window.renderBudgetUIOverride()')" class="text-slate-400 hover:text-slate-600"><i data-lucide="arrow-left" class="w-5 h-5"></i></button>
                    <h2 class="text-xl font-black text-slate-900">Allocate Funds</h2>
                    <div class="w-5"></div>
                </div>
                
                <div class="bg-slate-900 text-white p-6 rounded-3xl mb-6 shadow-xl relative overflow-hidden flex-shrink-0">
                    <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 relative z-10">Unallocated Left</p>
                    <h3 id="wizard-unallocated" class="text-3xl font-black text-emerald-400 num-font relative z-10">AED ${window.budgetWizardState.expectedSalary.toLocaleString()}</h3>
                    <div class="absolute right-[-20px] bottom-[-20px] opacity-10"><i data-lucide="pie-chart" class="w-32 h-32"></i></div>
                    
                    <div class="w-full bg-slate-800 rounded-full h-2 mt-4 relative z-10">
                        <div id="wizard-progress" class="bg-emerald-500 h-2 rounded-full transition-all" style="width: 0%"></div>
                    </div>
                </div>
                
                <div class="flex-1 overflow-auto pr-2 space-y-4">
                    ${state.data.expenseCategories.map(cat => {
                        const val = window.budgetWizardState.tempBudgets[cat] || 0;
                        return `
                        <div class="text-slate-900 flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border">
                            <span class="w-1/3 text-xs font-black text-slate-700 uppercase truncate">${cat}</span>
                            <div class="text-slate-900 w-2/3 flex items-center bg-white border rounded-xl overflow-hidden focus-within:border-emerald-500 transition-colors">
                                <span class="pl-4 text-[10px] font-black text-slate-400">AED</span>
                                <input type="number" data-cat="${cat}" value="${val}" class="wizard-budget-input w-full p-3 font-black text-right outline-none text-slate-700" oninput="window.calcWizardUnallocated()">
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
                
                <button onclick="window.saveBudgetWizard()" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase tracking-widest py-4 rounded-2xl transition-all shadow-lg mt-6 flex-shrink-0">Save & Finish <i data-lucide="check" class="w-4 h-4 inline ml-2"></i></button>
            </div>
        `;
        
        setTimeout(window.calcWizardUnallocated, 50);
    }
    
    document.getElementById('modal-content').innerHTML = content;
    lucide.createIcons();
};

window.addWizardCategory = async function() {
    const val = document.getElementById('wizard-new-cat').value.trim();
    const type = document.getElementById('wizard-new-type').value; 
    if (!val || state.data[type].includes(val)) return;
    state.data[type].push(val);
    await window.updateDb();
    window.startBudgetWizard(2);
};

window.delWizardCategory = async function(cat, typeStr) {
    const type = typeStr === 'Expense' ? 'expenseCategories' : 'incomeCategories';
    state.data[type] = state.data[type].filter(c => c !== cat);
    await window.updateDb();
    window.startBudgetWizard(2);
};

window.calcWizardUnallocated = function() {
    const total = window.budgetWizardState.expectedSalary;
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

window.saveBudgetWizard = async function() {
    state.data.settings.expectedSalary = window.budgetWizardState.expectedSalary;
    document.querySelectorAll('.wizard-budget-input').forEach(input => {
        const cat = input.getAttribute('data-cat');
        const val = parseFloat(input.value) || 0;
        state.data.budgets[cat] = val;
    });
    await window.updateDb();
    window.showToast("Budget successfully saved!", "success");
    window.budgetWizardState = null; 
    window.openModal('budget'); 
};

window.renderBudgetUI = function () {
    const expectedSalary = state.data.settings.expectedSalary;
    
    if (!expectedSalary || Object.keys(state.data.budgets || {}).length === 0) {
        return `
            <div class="max-w-md mx-auto text-center mt-20">
                <div class="w-24 h-24 bg-emerald-100 rounded-[3rem] flex items-center justify-center mx-auto mb-8 shadow-inner shadow-emerald-200">
                    <i data-lucide="compass" class="w-12 h-12 text-emerald-500"></i>
                </div>
                <h2 class="text-3xl font-black text-slate-900 mb-4">Set Up Your Budget</h2>
                <p class="text-slate-500 mb-8 font-bold leading-relaxed text-sm">Let's build a budget that works for you. We'll start with your income and allocate it across your goals, investments, and expenses.</p>
                <button onclick="window.startBudgetWizard(1)" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase tracking-widest py-5 rounded-2xl transition-all shadow-xl shadow-emerald-200">Start Questionnaire</button>
            </div>
        `;
    }

    let totalAllocated = 0;
    let totalSpent = 0;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    
    const catHTML = state.data.expenseCategories.map(cat => {
        const budget = state.data.budgets[cat] || 0;
        if (budget === 0) return '';
        
        let spent = 0;
        state.data.transactions.forEach(t => {
            if ((t.type === 'expense' || t.type === 'transfer_out') && t.category === cat && t.date >= startOfMonth) {
                spent += parseFloat(t.amount);
            }
        });
        
        totalAllocated += budget;
        totalSpent += spent;
        
        const pct = budget > 0 ? (spent / budget) * 100 : 0;
        const isOver = spent > budget;
        const color = isOver ? 'bg-rose-500' : 'bg-emerald-500';
        
        return `
            <div class="text-slate-900 bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm mb-4 relative overflow-hidden group hover:border-emerald-200 transition-colors">
                <div class="flex justify-between items-end mb-3">
                    <div>
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">${cat}</p>
                        <h4 class="text-lg font-black text-slate-800">AED ${spent.toLocaleString()}</h4>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] font-bold text-slate-400 uppercase">Limit: AED ${budget.toLocaleString()}</p>
                    </div>
                </div>
                <div class="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full ${color} transition-all duration-1000" style="width: ${Math.min(100, pct)}%"></div>
                </div>
                ${isOver ? `<p class="text-[9px] font-black text-rose-500 uppercase mt-2">Over Budget by AED ${(spent - budget).toLocaleString()}</p>` : ''}
            </div>
        `;
    }).join('');

    const unallocated = expectedSalary - totalAllocated;

    return `
        <div class="max-w-xl mx-auto space-y-6 pb-20">
            <div class="flex justify-between items-center px-2">
                <h2 class="text-2xl font-black text-slate-900">Current Budget</h2>
                <button onclick="window.startBudgetWizard(1)" class="bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2"><i data-lucide="edit-3" class="w-3 h-3"></i> Edit Setup</button>
            </div>
            
            <div class="bg-slate-900 p-8 rounded-[3rem] shadow-xl text-white relative overflow-hidden">
                <div class="relative z-10 flex justify-between items-center mb-6">
                    <div>
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Expected Income</p>
                        <h3 class="text-2xl font-black text-emerald-400">AED ${expectedSalary.toLocaleString()}</h3>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Unallocated</p>
                        <h3 class="text-xl font-black ${unallocated < 0 ? 'text-rose-400' : 'text-slate-300'}">AED ${unallocated.toLocaleString()}</h3>
                    </div>
                </div>
                
                <div class="text-slate-900 relative z-10 bg-white/10 p-5 rounded-3xl backdrop-blur-md border border-white/10">
                    <div class="flex justify-between items-center mb-2">
                        <p class="text-xs font-bold text-slate-300 uppercase">Total Spend</p>
                        <p class="text-xs font-black text-white">AED ${totalSpent.toLocaleString()} <span class="text-slate-400">/ ${totalAllocated.toLocaleString()}</span></p>
                    </div>
                    <div class="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div class="h-full bg-emerald-500 transition-all duration-1000" style="width: ${totalAllocated > 0 ? Math.min(100, (totalSpent / totalAllocated) * 100) : 0}%"></div>
                    </div>
                </div>
                
                <div class="absolute -right-4 -top-4 opacity-5 pointer-events-none"><i data-lucide="pie-chart" class="w-48 h-48"></i></div>
            </div>
            
            <div class="px-2">
                <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Expense & Investment Budgets</h4>
                ${catHTML}
            </div>
        </div>
    `;
};


// --- ENVELOPE BUDGETING LOGIC ---

// Ensure ledger exists
window.state.data.envelopeLedger = window.state.data.envelopeLedger || [];

// Core calculation engine
window.getEnvelopeStats = function() {
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
            if ((t.type === 'expense' || t.type === 'transfer_out') && t.category) {
                if (!stats.categories[t.category]) stats.categories[t.category] = { funded: 0, spent: 0, available: 0 };
                stats.categories[t.category].spent += window.getTransactionBaseAmount(t);
            }
        }
    });

    stats.unallocatedCash = stats.totalCredit - (stats.totalFunded - stats.totalDefunded);

    // Calculate Available per category and aggregate per pillar
    const allCats = window.getAllBudgetCategories();
    allCats.forEach(cat => {
        if (!stats.categories[cat]) stats.categories[cat] = { funded: 0, spent: 0, available: 0 };
        const c = stats.categories[cat];
        c.available = c.funded - c.spent;
        
        const pillar = window.getCategoryPillar(cat);
        if (stats.pillars[pillar]) {
            stats.pillars[pillar].funded += c.funded;
            stats.pillars[pillar].spent += c.spent;
            stats.pillars[pillar].available += c.available;
        }
    });

    return stats;
};

// 1. Process Salary Revamp
window.isProcessingSalary = false;
window.processSalary = async function () {
    if (window.isProcessingSalary) return;
    window.isProcessingSalary = true;

    const btn = document.activeElement;
    let originalText = '';
    if (btn && btn.tagName === 'BUTTON') {
        originalText = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 inline animate-spin"></i> Processing...`;
        btn.disabled = true;
        if (window.lucide) window.lucide.createIcons();
    }

    try {
        const amt = parseFloat(document.getElementById('sal-amount').value) || 0;
        const aId = document.getElementById('sal-acc').value;
        if (amt <= 0 || !aId) {
            window.showToast("Please enter a valid amount and select account", "error");
            if (btn && btn.tagName === 'BUTTON') {
                btn.innerHTML = originalText;
                btn.disabled = false;
                if (window.lucide) window.lucide.createIcons();
            }
            window.isProcessingSalary = false;
            return;
        }
        
        const rateSnapshot = state.data.settings.rate;
        const date = new Date().toISOString();

        // Generate Report of outgoing cycle
        const oldStats = window.getEnvelopeStats();
        if (!state.data.budgetReports) state.data.budgetReports = [];
        
        if (state.data.settings.lastSalaryDate) {
            state.data.budgetReports.push({
                id: window.genId(),
                date: date, // End date of report
                startDate: state.data.settings.lastSalaryDate,
                stats: JSON.parse(JSON.stringify(oldStats))
            });
            window.showToast("Monthly Budget Report generated!", "info");
        }

        // RESET BUDGET LEDGER (Wipe old allocations and negative balances)
        state.data.envelopeLedger = [];

        // Log the income to the bank
        state.data.transactions.push({
            id: window.genId(), accountId: aId, amount: window.toCurrency(amt), type: 'income', category: 'Salary', note: `Salary Credited`, date, exchangeRate: rateSnapshot
        });

        // Log the credit to the envelope system
        state.data.envelopeLedger.push({
            id: window.genId(), date, type: 'credit', amount: amt
        });

        // Set last salary date for tracking period
        state.data.settings.lastSalaryDate = date;

        await window.updateDb();
        window.showToast("Salary Credited! Now allocate it.", "success");
        window.fireConfetti();
        
        // Jump straight to the Checklist
        window.renderBudgetUIOverride();
    } catch (err) {
        console.error(err);
        window.showToast("An error occurred while processing", "error");
        if (btn && btn.tagName === 'BUTTON') {
            btn.innerHTML = originalText;
            btn.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }
    } finally {
        window.isProcessingSalary = false;
    }
};

// 2. Budget UI Override (The Checklist & Dashboard combined)
window.renderBudgetUIOverride = function () {
    const stats = window.getEnvelopeStats();
    let content = '';

    const hasUnallocated = stats.unallocatedCash > 0.01;
    const totalAllocated = stats.totalFunded - stats.totalDefunded;
    const expFunded = stats.pillars.expense.funded;
    const savFunded = stats.pillars.savings.funded;
    const invFunded = stats.pillars.investment.funded;

    const expPct = totalAllocated > 0 ? Math.round((expFunded / totalAllocated) * 100) : 0;
    const savPct = totalAllocated > 0 ? Math.round((savFunded / totalAllocated) * 100) : 0;
    const invPct = totalAllocated > 0 ? Math.max(0, 100 - expPct - savPct) : 0;

    content += `
        <div class="max-w-xl mx-auto space-y-6 pb-24 fade-in">
            <!-- UNALLOCATED CASH & 3-PILLAR SPLIT HERO CARD -->
            <div class="bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-700/80 shadow-2xl text-white relative overflow-hidden">
                <div class="relative z-10 text-center mb-5">
                    <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Unallocated Cash</p>
                    <h3 class="text-4xl md:text-5xl font-black ${hasUnallocated ? 'text-emerald-400' : 'text-white'} num-font">AED ${stats.unallocatedCash.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
                </div>

                <!-- 3-PILLAR ALLOCATION BAR -->
                <div class="relative z-10 bg-slate-900/90 p-4 rounded-2xl border border-slate-700/60 mb-4">
                    <div class="flex justify-between items-center text-[10px] font-black uppercase tracking-wider mb-2">
                        <span class="text-rose-400">🛒 Living (${expPct}%)</span>
                        <span class="text-emerald-400">🛡️ Savings (${savPct}%)</span>
                        <span class="text-indigo-400">📈 Invest (${invPct}%)</span>
                    </div>
                    <div class="w-full bg-slate-800 rounded-full h-3 flex overflow-hidden p-0.5 gap-0.5 border border-slate-700/50">
                        <div class="bg-rose-500 h-full rounded-l-full transition-all duration-500" style="width: ${expPct}%"></div>
                        <div class="bg-emerald-500 h-full transition-all duration-500" style="width: ${savPct}%"></div>
                        <div class="bg-indigo-500 h-full rounded-r-full transition-all duration-500" style="width: ${invPct}%"></div>
                    </div>
                    <div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800 text-center">
                        <div>
                            <p class="text-[9px] font-bold text-slate-400">Living</p>
                            <p class="text-xs font-black text-rose-400 num-font">AED ${expFunded.toLocaleString()}</p>
                        </div>
                        <div>
                            <p class="text-[9px] font-bold text-slate-400">Savings</p>
                            <p class="text-xs font-black text-emerald-400 num-font">AED ${savFunded.toLocaleString()}</p>
                        </div>
                        <div>
                            <p class="text-[9px] font-bold text-slate-400">Investments</p>
                            <p class="text-xs font-black text-indigo-400 num-font">AED ${invFunded.toLocaleString()}</p>
                        </div>
                    </div>
                </div>
                
                <div class="relative z-10 flex justify-between items-center px-2">
                    <button onclick="window.openCategoryManager('window.renderBudgetUIOverride()')" class="text-[10px] font-black text-slate-300 hover:text-white uppercase tracking-widest transition-colors flex items-center gap-1.5 bg-slate-800/80 px-3.5 py-2 rounded-xl border border-slate-700">
                        <i data-lucide="settings" class="w-3.5 h-3.5 inline"></i> Manage Categories
                    </button>
                    <button onclick="window.viewBudgetReports()" class="text-[10px] font-black text-rose-400 bg-rose-500/10 border border-rose-500/30 px-3.5 py-2 rounded-xl hover:bg-rose-500/20 transition-all flex items-center gap-1.5">
                        <i data-lucide="file-text" class="w-3.5 h-3.5"></i> Past Reports
                    </button>
                </div>
            </div>
    `;

    // Helper to render a category envelope
    const renderEnvelopeCard = (cat, pillarBorder, btnBg) => {
        const cStats = stats.categories[cat] || { funded: 0, spent: 0, available: 0 };
        const isNegative = cStats.available < 0;
        const color = isNegative ? 'text-rose-400' : 'text-white';
        
        return `
            <div class="bg-slate-800/90 p-4 rounded-2xl border border-slate-700/80 shadow-md relative overflow-hidden group hover:border-${pillarBorder} hover:bg-slate-800 transition-all cursor-pointer" onclick="window.showCategoryDetails('${cat}')">
                <div class="flex justify-between items-center">
                    <div class="w-1/2 text-left">
                        <p class="text-xs font-black uppercase text-slate-200 tracking-wider mb-1 truncate">${cat}</p>
                        <h4 class="text-lg font-black ${color} num-font">AED ${cStats.available.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h4>
                        <p class="text-[9px] font-bold text-slate-400 mt-0.5">${cStats.spent > 0 ? `Used: AED ${cStats.spent.toLocaleString()}` : 'Budget Available'}</p>
                    </div>
                    
                    <div class="w-1/2 flex items-center justify-end gap-3" onclick="event.stopPropagation()">
                        <div class="flex flex-col items-end mr-1">
                            <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Funded</p>
                            <p class="text-xs font-black text-slate-200 num-font">AED ${cStats.funded.toLocaleString()}</p>
                        </div>
                        <button onclick="window.promptFundCategory('${cat}')" title="Add Funds" class="${btnBg} text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md shrink-0">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
                ${isNegative ? `<div class="absolute bottom-0 left-0 w-full h-1 bg-rose-500"></div>` : ''}
            </div>
        `;
    };

    // PILLAR 1: LIVING EXPENSES
    const expenses = state.data.expenseCategories || [];
    content += `
        <div class="space-y-3">
            <div class="flex justify-between items-center px-2">
                <h4 class="text-xs font-black uppercase text-rose-400 tracking-widest flex items-center gap-2">
                    <i data-lucide="shopping-bag" class="w-4 h-4 text-rose-400"></i> Living Expenses (Needs & Lifestyle)
                </h4>
                <span class="text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2.5 py-0.5 rounded-full">${expenses.length} Envelopes</span>
            </div>
            <div class="space-y-2.5">
                ${expenses.map(cat => renderEnvelopeCard(cat, 'rose-500/50', 'bg-rose-600 hover:bg-rose-500')).join('') || '<p class="text-xs font-bold text-slate-500 text-center py-3 bg-slate-800/40 rounded-2xl">No living expense envelopes</p>'}
            </div>
        </div>
    `;

    // PILLAR 2: SAVINGS & SINKING FUNDS
    const savings = state.data.savingsCategories || [];
    content += `
        <div class="space-y-3 pt-2">
            <div class="flex justify-between items-center px-2">
                <div class="text-left">
                    <h4 class="text-xs font-black uppercase text-emerald-400 tracking-widest flex items-center gap-2">
                        <i data-lucide="shield" class="w-4 h-4 text-emerald-400"></i> Savings & Sinking Funds (Future Goals)
                    </h4>
                    <p class="text-[9px] font-bold text-slate-400 ml-6">Wedding, Car, Vacation, Emergency Top-Ups</p>
                </div>
                <span class="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">${savings.length} Funds</span>
            </div>
            <div class="space-y-2.5">
                ${savings.map(cat => renderEnvelopeCard(cat, 'emerald-500/50', 'bg-emerald-600 hover:bg-emerald-500')).join('') || '<p class="text-xs font-bold text-slate-500 text-center py-3 bg-slate-800/40 rounded-2xl">No savings funds</p>'}
            </div>
        </div>
    `;

    // PILLAR 3: INVESTMENTS & WEALTH GROWTH
    const investments = state.data.investmentCategories || [];
    content += `
        <div class="space-y-3 pt-2">
            <div class="flex justify-between items-center px-2">
                <div class="text-left">
                    <h4 class="text-xs font-black uppercase text-indigo-400 tracking-widest flex items-center gap-2">
                        <i data-lucide="trending-up" class="w-4 h-4 text-indigo-400"></i> Investments & Wealth Growth
                    </h4>
                    <p class="text-[9px] font-bold text-slate-400 ml-6">Mutual Funds, Sarwa, Gold, Stocks</p>
                </div>
                <span class="text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-0.5 rounded-full">${investments.length} Assets</span>
            </div>
            <div class="space-y-2.5">
                ${investments.map(cat => renderEnvelopeCard(cat, 'indigo-500/50', 'bg-indigo-600 hover:bg-indigo-500')).join('') || '<p class="text-xs font-bold text-slate-500 text-center py-3 bg-slate-800/40 rounded-2xl">No investment envelopes</p>'}
            </div>
        </div>
    `;

    content += `</div>`;
    
    const container = document.getElementById('modal-content');
    if (container) {
        container.innerHTML = content;
        lucide.createIcons();
    }
};

window.promptFundCategory = function(cat) {
    const stats = window.getEnvelopeStats();
    
    window.showPrompt(`Fund ${cat}`, `Enter amount to assign to ${cat}. (Unallocated Cash: ${stats.unallocatedCash})`, async (val) => {
        const amount = parseFloat(val);
        if (isNaN(amount) || amount === 0) return;
        
        // If they enter a positive number, it's funding. If negative, defunding.
        if (amount > 0 && amount > stats.unallocatedCash) {
            window.showToast("Not enough unallocated cash!", "error");
            return;
        }

        const type = amount > 0 ? 'fund' : 'defund';
        
        state.data.envelopeLedger.push({
            id: window.genId(),
            date: new Date().toISOString(),
            type: type,
            category: cat,
            amount: Math.abs(amount)
        });

        await window.updateDb();
        window.renderBudgetUIOverride();
    });
};

window.viewBudgetReports = function() {
    let content = `
        <div class="max-w-4xl mx-auto space-y-6 pb-20 pt-2 fade-in text-left">
            <div class="flex items-center justify-between mb-6 px-2">
                <div class="flex items-center gap-3">
                    <button onclick="window.renderBudgetUIOverride()" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-2xl text-slate-300 hover:text-white transition-all">
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
        content += `<div class="text-center py-16 bg-slate-800/60 rounded-[2.5rem] border border-slate-700/80"><p class="text-sm font-bold text-slate-400">No past reports available yet. They will appear here every time you process Salary Day!</p></div>`;
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

            content += `
                <div class="bg-slate-800/95 p-6 rounded-[2rem] border border-slate-700/80 shadow-xl space-y-4 hover:border-emerald-500/40 transition-all">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">Cycle Ended</span>
                            <h4 class="text-lg font-black text-white">${dateStr}</h4>
                        </div>
                        <div class="flex items-center gap-2">
                            ${totalSurplus > 0 ? `
                                <button onclick="window.openSurplusSweepModal(${totalSurplus})" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 text-xs font-black shadow-lg shadow-emerald-500/20">
                                    <i data-lucide="arrow-right-circle" class="w-4 h-4"></i> Sweep to Vault
                                </button>
                            ` : ''}
                            <button onclick="window.downloadBudgetReportPDF('${rep.id}')" title="Download Executive PDF" class="bg-slate-700 hover:bg-slate-600 text-white px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold border border-slate-600">
                                <i data-lucide="file-down" class="w-4 h-4 text-emerald-400"></i> PDF Report
                            </button>
                            <button onclick="window.downloadBudgetReport('${rep.id}')" title="Download Text Summary" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white p-2 rounded-xl transition-all border border-slate-700">
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
    
    content += `</div></div>`;
    document.getElementById('modal-content').innerHTML = content;
    lucide.createIcons();
};

window.downloadBudgetReport = function(id) {
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
        
        const catTxs = txs.filter(t => t.category === cat);
        if (catTxs.length === 0) {
            text += `  (No transactions)\n`;
        } else {
            catTxs.forEach(t => {
                const acc = state.data.accounts.find(a => a.id === t.accountId);
                const cur = t.currency || (acc ? acc.currency : 'AED');
                const baseAmt = window.getTransactionBaseAmount(t);
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
    a.download = `Budget_Report_${end.toLocaleDateString().replace(/\\//g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.downloadBudgetReportPDF = function(id) {
    try {
        const rep = state.data.budgetReports?.find(r => r.id === id);
        if (!rep) {
            window.showToast("Report not found", "error");
            return;
        }

        const { jsPDF } = window.jspdf;
        if (!jsPDF) {
            window.showToast("PDF engine not loaded", "error");
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
        window.showToast("Executive PDF Report Generated!", "success");
    } catch (err) {
        console.error("PDF generation failed", err);
        window.showToast("Failed to generate PDF. Check console.", "error");
    }
};


window.showCategoryDetails = function(cat) {
    const txs = state.data.transactions.filter(t => (t.type === 'expense' || t.type === 'transfer_out') && t.category === cat)
                  .sort((a,b) => new Date(b.date) - new Date(a.date));
                  
    const stats = window.getEnvelopeStats().categories[cat] || { funded: 0, spent: 0, available: 0 };

    let content = `
        <div class="max-w-4xl mx-auto bg-slate-800/95 backdrop-blur-xl p-8 rounded-[2.5rem] border border-slate-700 shadow-2xl h-[85vh] flex flex-col fade-in">
            <div class="flex justify-between items-center mb-6">
                <button onclick="window.renderBudgetUIOverride()" class="p-2.5 bg-slate-700/50 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all"><i data-lucide="arrow-left" class="w-5 h-5"></i></button>
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
        content += `<p class="text-xs font-bold text-slate-400 text-center mt-10">No activity yet for this category.</p>`;
    } else {
        txs.forEach(t => {
            const acc = state.data.accounts.find(a => a.id === t.accountId);
            const cur = t.currency || (acc ? acc.currency : 'AED');
            const baseAmt = window.getTransactionBaseAmount(t);
            const isNonBase = cur !== 'AED';
            content += `
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

    content += `</div></div>`;
    
    document.getElementById('modal-content').innerHTML = content;
    lucide.createIcons();
};

// 3. Override Salary Modal UI to be simple
window.renderGuiltFreeModal = function() {
    const c = document.getElementById('modal-content');
    const r = state.data.settings.rate;
    
    // 1. Get Liquid Assets
    const liquidAccounts = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type));
    const liquidTotalAED = liquidAccounts.reduce((s, a) => s + (a.currency === 'AED' ? a.balance : a.balance / r), 0);
    
    // 2. Get Budgets
    const budgets = state.data.budgets || {};
    const totalBudgetsAED = Object.values(budgets).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
    
    const guiltFree = liquidTotalAED - totalBudgetsAED;
    const isNegative = guiltFree < 0;

    let html = `<div class="max-w-2xl mx-auto space-y-6 fade-in text-left pb-16">
        
        <div class="bg-gradient-to-br from-rose-500/20 via-slate-800 to-slate-900 border-2 border-rose-500/30 rounded-[2.5rem] p-8 text-center mb-8 shadow-2xl backdrop-blur-md">
            <h2 class="text-xs font-black text-rose-400 uppercase tracking-widest mb-2">Available Guilt-Free Amount</h2>
            <p class="text-5xl font-black ${isNegative ? 'text-slate-400' : 'text-white'} tracking-tight num-font mb-4">
                ${isNegative ? '0.00 AED' : window.fmtMoney(guiltFree, 'AED')}
            </p>
            <p class="text-sm font-bold text-slate-300 max-w-md mx-auto">This is money you have in your liquid accounts (Cash/Bank) that is <span class="text-rose-400">not assigned</span> to any monthly budget. Spend it however you like!</p>
            ${isNegative ? `<p class="mt-4 text-xs font-black text-rose-400 bg-rose-500/10 border border-rose-500/30 inline-block px-4 py-2 rounded-xl">⚠️ You are underfunded by ${window.fmtMoney(Math.abs(guiltFree), 'AED')}. Your liquid cash cannot cover your planned budgets.</p>` : ''}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Liquid Assets Breakdown -->
            <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg">
                <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><i data-lucide="wallet" class="w-4 h-4 text-rose-400"></i> Liquid Accounts</h3>
                <div class="space-y-3">
                    ${liquidAccounts.map(a => `
                        <div class="flex justify-between items-center border-b border-slate-700/50 pb-2">
                            <div>
                                <p class="text-xs font-black text-white">${a.name}</p>
                                <p class="text-[9px] font-bold text-slate-400">${a.type}</p>
                            </div>
                            <p class="text-xs font-black text-slate-200 num-font">${window.fmtMoney(a.balance, a.currency)}</p>
                        </div>
                    `).join('')}
                    <div class="flex justify-between items-center pt-2">
                        <p class="text-xs font-black text-slate-300 uppercase">Total Liquid</p>
                        <p class="text-sm font-black text-white num-font">${window.fmtMoney(liquidTotalAED, 'AED')}</p>
                    </div>
                </div>
            </div>

            <!-- Planned Envelopes Breakdown -->
            <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg">
                <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><i data-lucide="layers" class="w-4 h-4 text-rose-400"></i> Planned Envelopes</h3>
                <div class="space-y-3">
                    ${Object.keys(budgets).map(cat => `
                        <div class="flex justify-between items-center border-b border-slate-700/50 pb-2">
                            <p class="text-xs font-black text-white">${cat}</p>
                            <p class="text-xs font-black text-slate-200 num-font">${window.fmtMoney(budgets[cat], 'AED')}</p>
                        </div>
                    `).join('')}
                    <div class="flex justify-between items-center pt-2">
                        <p class="text-xs font-black text-slate-300 uppercase">Total Allocated</p>
                        <p class="text-sm font-black text-rose-400 num-font">${window.fmtMoney(totalBudgetsAED, 'AED')}</p>
                    </div>
                </div>
            </div>
        </div>

    </div>`;

    c.innerHTML = html;
    lucide.createIcons();
};

window.renderStreakDetailsModal = function() {
    const c = document.getElementById('modal-content');
    
    // 1. Calculate the streak logic
    let currentStreak = window.getNoSpendStreak();
    
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

    let html = `
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
                    return `
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
                            <span class="font-black text-lg ${isSpend ? 'text-rose-400' : 'text-emerald-400'} num-font">${isSpend ? '- ' + window.fmtMoney(day.spent, 'AED') : '0.00 AED'}</span>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
        
    </div>`;
    
    c.innerHTML = html;
    lucide.createIcons();
};

window.renderAppOverrides = function() {
    // We override the click handler for the Salary Day button if needed, 
    // but the actual modal rendering happens in openModal('salary').
    // Let's hook into window.openModal to intercept 'salary' and 'budget'.
    
    const originalOpenModal = window.openModal;
    window.openModal = function(type, param) {
        if (type === 'budget') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'Monthly Budgeting';
            window.renderBudgetUIOverride();
            return;
        }
        
        if (type === 'salary') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'Process Salary Day';
            const c = document.getElementById('modal-content');
            c.innerHTML = `
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
                            ${state.data.accounts.map(a => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}
                        </select>
                    </div>
                    
                    <button onclick="window.processSalary()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2">Record & Start Budgeting <i data-lucide="arrow-right" class="w-4 h-4"></i></button>
                </div>
            `;
            lucide.createIcons();
            return;
        }
        
        if (type === 'guilt_free') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'Guilt-Free Spend Details';
            window.renderGuiltFreeModal();
            return;
        }

        if (type === 'streak_details') {
            document.getElementById('modal-backdrop').classList.replace('hidden', 'flex');
            document.getElementById('modal-title').innerText = 'No-Spend Streak Breakdown';
            window.renderStreakDetailsModal();
            return;
        }

        // Otherwise, call original
        originalOpenModal(type, param);
    };
};

window.renderAppOverrides();





// --- SMART INPUT SYSTEM ---
window.openSmartInput = function() {
    const modal = document.getElementById('smart-input-modal');
    modal.classList.replace('hidden', 'flex');
    const inp = document.getElementById('smart-input-field');
    inp.value = '';
    setTimeout(() => inp.focus(), 100);
    lucide.createIcons();
};

window.processSmartInput = async function() {
    const inp = document.getElementById('smart-input-field').value.trim();
    if (!inp) return;
    
    // Simple regex to parse "50 coffee" or "coffee 50"
    const match = inp.match(/^(\d+(?:\.\d+)?)\s+(.+)$/) || inp.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
    if (!match) {
        window.showToast("Format: 'Amount Description' (e.g. 50 Coffee)", "error");
        return;
    }

    let amt = 0;
    let desc = '';
    if (!isNaN(parseFloat(match[1]))) {
        amt = parseFloat(match[1]);
        desc = match[2];
    } else {
        desc = match[1];
        amt = parseFloat(match[2]);
    }

    // Auto-categorize based on keywords (rudimentary smart engine)
    let category = 'Other';
    const lowerDesc = desc.toLowerCase();
    if (lowerDesc.includes('starbucks') || lowerDesc.includes('coffee') || lowerDesc.includes('food') || lowerDesc.includes('lunch') || lowerDesc.includes('dinner')) category = 'Dining';
    else if (lowerDesc.includes('uber') || lowerDesc.includes('taxi') || lowerDesc.includes('fuel')) category = 'Transport';
    else if (lowerDesc.includes('grocery') || lowerDesc.includes('supermarket') || lowerDesc.includes('lulu') || lowerDesc.includes('carrefour')) category = 'Groceries';
    else if (lowerDesc.includes('amazon') || lowerDesc.includes('noon')) category = 'Shopping';

    // Find default Cash/Bank account
    const acc = state.data.accounts.find(a => a.type === 'Cash' || a.type === 'Bank Account') || state.data.accounts[0];
    if (!acc) {
        window.showToast("No account found to log expense", "error");
        return;
    }

    // Log the transaction
    state.data.transactions.push({
        id: window.genId(),
        accountId: acc.id,
        amount: window.toCurrency(amt), // Store natively, assuming base currency for smart input
        type: 'expense',
        category: category,
        note: desc,
        date: new Date().toISOString(),
        exchangeRate: state.data.settings.rate
    });

    window.showToast(`Logged ${amt} ${cur} to ${category}`, "success");
    document.getElementById('smart-input-modal').classList.replace('flex', 'hidden');
    window.recalculateBalances();
    await window.updateDb();
    window.renderApp();
};
// --- OVERRIDE RENDER LEDGER FOR DATE GROUPING ---
window.renderLedger = function(items) {
    const body = document.getElementById('master-ledger-body'); if (!body) return;
    const sorted = [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (sorted.length === 0) {
        body.innerHTML = `<div class="p-12 text-center text-slate-500 font-bold text-xs uppercase tracking-widest border border-dashed border-slate-700/50 rounded-2xl mt-8">No transactions found</div>`;
        return;
    }
    
    let html = `<div class="w-full border border-slate-700/50 rounded-2xl overflow-hidden bg-slate-900/50 shadow-2xl">
        <!-- Grid Header -->
        <div class="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-slate-700/50 bg-slate-800/80">
            <div class="col-span-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Date & Time</div>
            <div class="col-span-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Details</div>
            <div class="col-span-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Account</div>
            <div class="col-span-4 text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Amount</div>
        </div>
        <div class="flex flex-col divide-y divide-slate-700/50">`;

    sorted.forEach(t => {
        let accName = 'N/A';
        let acc = null;
        if (t.accountId === 'virtual_writeoff') {
            accName = 'Write-off';
        } else {
            acc = state.data.accounts.find(a => a.id === t.accountId);
            accName = acc?.name || 'N/A';
        }
        
        const isTransfer = t.type.includes('transfer');
        const isIncome = t.type === 'income' || t.type === 'transfer_in';
        
        let colorClass = isTransfer ? 'text-slate-300' : (isIncome ? 'text-emerald-400' : 'text-rose-400');
        let bgClass = isTransfer ? 'bg-slate-500/10 text-slate-400 border-slate-500/20' : (isIncome ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20');
        
        const sign = isIncome ? '+' : '-';
        const displayType = isTransfer ? (t.type === 'transfer_in' ? 'Inflow' : 'Outflow') : (t.type === 'income' ? 'Income' : 'Expense');
        
        const d = new Date(t.date);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const amtParts = Math.abs(t.amount).toFixed(2).split('.');
        const intAmt = new Intl.NumberFormat('en-US').format(parseInt(amtParts[0]));
        const txCur = t.currency || acc?.currency || 'AED';
        const currSymbol = txCur === 'INR' ? '₹' : (txCur === 'AED' ? 'AED' : txCur); 

        html += `
        <div class="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 p-4 hover:bg-slate-800/60 transition-colors items-center group cursor-pointer" onclick="window.editTransaction('${t.id}')">
            <!-- Mobile: Date & Category row, Desktop: Date column -->
            <div class="col-span-1 md:col-span-3 flex justify-between md:block items-center">
                <div class="flex flex-col text-left">
                    <span class="text-xs font-bold text-slate-300">${dateStr}</span>
                    <span class="text-[9px] font-bold text-slate-500 uppercase tracking-widest">${timeStr}</span>
                </div>
                <!-- Mobile only amount -->
                <div class="md:hidden text-right">
                    <p class="text-sm font-black ${colorClass} tracking-tight">${sign}${currSymbol} ${intAmt}<span class="text-[10px] opacity-50">.${amtParts[1]}</span></p>
                </div>
            </div>
            
            <!-- Details Column -->
            <div class="col-span-1 md:col-span-3 flex flex-col justify-center text-left">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-black text-slate-100 truncate">${t.category || displayType}</span>
                </div>
                <span class="text-[10px] text-slate-500 truncate mt-0.5">${t.note || 'No notes'}</span>
            </div>

            <!-- Account Column -->
            <div class="col-span-1 md:col-span-2 flex items-center justify-start md:justify-start">
                <span class="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded border ${bgClass} truncate max-w-[120px]">${accName}</span>
            </div>

            <!-- Desktop Amount Column -->
            <div class="hidden md:flex col-span-4 items-center justify-end gap-4">
                <button onclick="event.stopPropagation(); window.deleteTransaction('${t.id}')" class="text-[9px] font-black text-rose-500/50 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all uppercase tracking-widest border border-rose-500/0 hover:border-rose-500/50 rounded px-2 py-1">Delete</button>
                <p class="text-base font-black ${colorClass} tracking-tight num-font text-right w-28"><span class="text-[10px] opacity-70 mr-1">${sign}${currSymbol}</span>${intAmt}<span class="text-xs opacity-50 ml-0.5">.${amtParts[1]}</span></p>
            </div>
        </div>`;
    });
    
    html += `</div></div>`;
    
    body.innerHTML = html;
    lucide.createIcons();
};
// --- OVERRIDE BUDGET UI: CLEAN ORGANIZED DESKTOP GRID WITH SMART TOOLS ---
window.renderBudgetUIOverride = function () {
    const stats = window.getEnvelopeStats();
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

    content += `
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
                            ${hasTemplate && hasUnallocated ? `
                                <button onclick="window.applyBudgetTemplate()" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20">
                                    <i data-lucide="zap" class="w-4 h-4"></i> 1-Click Auto-Fund (AED ${templateSum.toLocaleString()})
                                </button>
                            ` : ''}
                            <button onclick="window.saveBudgetAsTemplate()" title="Save current envelope plan as default monthly template" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 border border-slate-700">
                                <i data-lucide="bookmark" class="w-4 h-4 text-emerald-400"></i> ${hasTemplate ? 'Update Template' : 'Save as Template'}
                            </button>
                            <button onclick="window.openCategoryManager('window.renderBudgetUIOverride()')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 border border-slate-700">
                                <i data-lucide="settings" class="w-4 h-4"></i> Manage Categories
                            </button>
                            <button onclick="window.viewBudgetReports()" class="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5">
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
        let statusBadge = `<span class="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">${realPct}% Spent</span>`;
        
        if (realPct >= 85 && !isOver) {
            barColor = 'bg-amber-500';
            statusBadge = `<span class="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">${realPct}% Spent</span>`;
        }
        if (isOver) {
            barColor = 'bg-rose-500';
            statusBadge = `<span class="text-[9px] font-black text-rose-300 bg-rose-500/20 px-2.5 py-0.5 rounded-full border border-rose-500/40 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3 text-rose-400"></i> Over by AED ${overAmount.toLocaleString()}</span>`;
        }
        
        return `
            <div class="bg-slate-800/90 p-5 rounded-[2rem] border ${isOver ? 'border-rose-500/60' : 'border-slate-700/80'} shadow-lg hover:border-rose-500/50 hover:bg-slate-800 transition-all cursor-pointer flex flex-col justify-between" onclick="window.showCategoryDetails('${cat}')">
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
                        ${isOver ? `
                            <div class="flex items-center justify-between mt-2 pt-2 border-t border-rose-500/20" onclick="event.stopPropagation()">
                                <p class="text-[9px] font-bold text-rose-400">Exceeded by AED ${overAmount.toLocaleString()}</p>
                                <button onclick="window.openCoverOverspending('${cat}', ${overAmount})" class="bg-rose-500 hover:bg-rose-600 text-white text-[9px] font-black uppercase px-2.5 py-1 rounded-lg transition-all shadow-md">
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
                        
                        <button onclick="event.stopPropagation(); window.promptFundCategory('${cat}')" title="Assign / Add Funds" class="bg-rose-600 hover:bg-rose-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md shadow-rose-600/30 shrink-0">
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
            statusBadge = `<span class="text-[9px] font-black bg-emerald-400 text-slate-950 px-2.5 py-0.5 rounded-full shadow-lg shadow-emerald-400/20 flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3 text-slate-950"></i> ${realPct}% (+AED ${extraSaved.toLocaleString()})</span>`;
        } else if (isExactlyComplete) {
            statusBadge = `<span class="text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-0.5 rounded-full">✅ 100% Saved</span>`;
        } else {
            statusBadge = `<span class="text-[9px] font-bold bg-slate-900 text-emerald-400 border border-slate-700 px-2.5 py-0.5 rounded-full">${realPct}% Deposited</span>`;
        }

        return `
            <div class="bg-slate-800/90 p-5 rounded-[2rem] border ${isOverSaved ? 'border-emerald-400/60 shadow-emerald-500/10' : 'border-emerald-500/30'} shadow-lg hover:border-emerald-500/60 hover:bg-slate-800 transition-all cursor-pointer flex flex-col justify-between" onclick="window.showCategoryDetails('${cat}')">
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
                        ${isOverSaved ? `
                            <p class="text-[10px] font-black text-emerald-300 mt-1 flex items-center gap-1">
                                <i data-lucide="trending-up" class="w-3.5 h-3.5 text-emerald-400"></i> +AED ${extraSaved.toLocaleString()} above target!
                            </p>
                        ` : `
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
                        
                        <button onclick="event.stopPropagation(); window.promptFundCategory('${cat}')" title="Assign / Add Funds" class="bg-emerald-600 hover:bg-emerald-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-md shadow-emerald-600/30 shrink-0">
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
            statusBadge = `<span class="text-[9px] font-black bg-indigo-400 text-slate-950 px-2.5 py-0.5 rounded-full shadow-lg shadow-indigo-400/20 flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3 text-slate-950"></i> ${realPct}% (+AED ${extraInvested.toLocaleString()})</span>`;
        } else if (isExactlyComplete) {
            statusBadge = `<span class="text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2.5 py-0.5 rounded-full">📈 100% Deployed</span>`;
        } else {
            statusBadge = `<span class="text-[9px] font-bold bg-slate-900 text-indigo-400 border border-slate-700 px-2.5 py-0.5 rounded-full">${realPct}% Invested</span>`;
        }
        
        return `
            <div class="bg-slate-800/90 p-5 rounded-[2rem] border ${isOverInvested ? 'border-indigo-400/60 shadow-indigo-500/10' : 'border-indigo-500/30'} shadow-lg hover:border-indigo-500/60 hover:bg-slate-800 transition-all cursor-pointer flex flex-col justify-between" onclick="window.showCategoryDetails('${cat}')">
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
                        ${isOverInvested ? `
                            <p class="text-[10px] font-black text-indigo-300 mt-1 flex items-center gap-1">
                                <i data-lucide="trending-up" class="w-3.5 h-3.5 text-indigo-400"></i> +AED ${extraInvested.toLocaleString()} extra deployed!
                            </p>
                        ` : `
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
                        
                        <button onclick="event.stopPropagation(); window.promptFundCategory('${cat}')" title="Assign / Add Funds" class="bg-indigo-600 hover:bg-indigo-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-indigo-600/30 shrink-0">
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
    content += `
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
                ${expenses.map(cat => renderExpenseCard(cat)).join('') || '<p class="text-xs font-bold text-slate-500 text-center py-8 col-span-full bg-slate-800/40 rounded-2xl">No living expense envelopes</p>'}
            </div>
        </div>
    `;

    // SECTION 2: 🛡️ SAVINGS & SINKING FUNDS (SPACIOUS 3-4 COLUMN DESKTOP GRID)
    content += `
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
                ${savings.map(cat => renderSavingsCard(cat)).join('') || '<p class="text-xs font-bold text-slate-500 text-center py-8 col-span-full bg-slate-800/40 rounded-2xl">No savings funds</p>'}
            </div>
        </div>
    `;

    // SECTION 3: 📈 INVESTMENTS & WEALTH GROWTH (SPACIOUS 3-4 COLUMN DESKTOP GRID)
    content += `
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
                ${investments.map(cat => renderInvestmentCard(cat)).join('') || '<p class="text-xs font-bold text-slate-500 text-center py-8 col-span-full bg-slate-800/40 rounded-2xl">No investment envelopes</p>'}
            </div>
        </div>
    `;

    content += `</div>`;
    
    const container = document.getElementById('modal-content');
    if (container) {
        container.innerHTML = content;
        lucide.createIcons();
    }
};

// Wire it to override the original modal call
window.renderBudgetUI = function() {
    window.renderBudgetUIOverride();
    return ""; 
};
// --- NO-SPEND STREAK TRACKER ---
window.getNoSpendStreak = function() {
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
// --- OVERRIDE CONTACT MANAGER ---
window.openContactModal = function () {
    const m = document.getElementById('contact-modal');
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    document.getElementById('contact-relation').value = 'Friend';
    m.classList.replace('hidden', 'flex');
};

window.saveNewContact = async function () {
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const rel = document.getElementById('contact-relation').value;

    if (!name) {
        window.showToast("Name is required", "error");
        return;
    }
    if (!phone) {
        window.showToast("Mobile Number is mandatory!", "error");
        return;
    }

    if (!state.data.contacts) state.data.contacts = [];
    if (state.data.contacts.find(c => c.name.toLowerCase() === name.toLowerCase())) {
        window.showToast("Contact already exists", "warn");
        return;
    }

    const newC = { id: window.genId(), name: name, phone: phone, relation: rel, creditScore: 100 };
    state.data.contacts.push(newC);
    
    document.getElementById('contact-modal').classList.replace('flex', 'hidden');
    window.showToast("Contact Added Successfully", "success");

    await window.updateDb();
    
    // Re-render UI
    if (typeof renderApp === 'function') renderApp();
    const modalContent = document.getElementById('modal-content');
    if (modalContent && !document.getElementById('modal-backdrop').classList.contains('hidden') && typeof window.renderDebtUI === 'function') {
        modalContent.innerHTML = window.renderDebtUI();
        lucide.createIcons();
        // Set the dropdown to the new contact
        setTimeout(() => {
            const dw = document.getElementById('dw');
            if (dw) dw.value = name;
        }, 50);
    }
};
// --- BULK REMIND OVERDUE ---
window.bulkRemindOverdue = async function() {
    const overdueDebts = state.data.debts.filter(d => {
        if (d.settled || d.type !== 'receivable') return false;
        if (!d.repaymentDate) return false;
        return new Date(d.repaymentDate) < new Date();
    });

    if (overdueDebts.length === 0) {
        window.showToast("No overdue debts found to remind.", "success");
        return;
    }

    if (!confirm(`Are you sure you want to send reminders to ${overdueDebts.length} people?`)) return;

    window.showToast(`Sending ${overdueDebts.length} reminders...`, "info");
    
    for (let d of overdueDebts) {
        const amtStr = `${d.amount} ${d.currency}`;
        // Wait 2 seconds between sends to avoid API rate limits
        await new Promise(r => setTimeout(r, 2000));
        window.sendWhapiReminder(d.party, amtStr, false, 1);
    }
    
    window.showToast("Bulk reminders sent successfully!", "success");
};
// --- CONFETTI ANIMATION ---
window.fireConfetti = function() {
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


// ============================================================
// 1. QUICK 4-DIGIT PIN LOCK SYSTEM
// ============================================================
let currentPinBuffer = '';

function hashPin(pin) {
    let hash = 0;
    for (let i = 0; i < pin.length; i++) {
        hash = ((hash << 5) - hash) + pin.charCodeAt(i);
        hash |= 0;
    }
    return 'pin_' + Math.abs(hash).toString(36);
}

window.lockAppNow = function () {
    if (!state.data.settings || !state.data.settings.pinCode) {
        window.promptSetPin();
        return;
    }
    currentPinBuffer = '';
    window.updatePinDots();
    const pinScreen = document.getElementById('pin-lock-screen');
    if (pinScreen) {
        pinScreen.classList.replace('hidden', 'flex');
        const err = document.getElementById('pin-error-msg');
        if (err) err.classList.add('hidden');
    }
    sessionStorage.setItem('fs_is_locked', 'true');
};

window.unlockApp = function () {
    currentPinBuffer = '';
    const pinScreen = document.getElementById('pin-lock-screen');
    if (pinScreen) {
        pinScreen.classList.replace('flex', 'hidden');
    }
    sessionStorage.removeItem('fs_is_locked');
    window.showToast("Dashboard Unlocked", "success");
};

window.handlePinInput = function (digit) {
    if (currentPinBuffer.length < 4) {
        currentPinBuffer += digit;
        window.updatePinDots();
        if (currentPinBuffer.length === 4) {
            setTimeout(window.verifyPin, 120);
        }
    }
};

window.handlePinBackspace = function () {
    if (currentPinBuffer.length > 0) {
        currentPinBuffer = currentPinBuffer.slice(0, -1);
        window.updatePinDots();
        const err = document.getElementById('pin-error-msg');
        if (err) err.classList.add('hidden');
    }
};

window.updatePinDots = function () {
    for (let i = 1; i <= 4; i++) {
        const dot = document.getElementById(`pin-dot-${i}`);
        if (dot) {
            if (i <= currentPinBuffer.length) {
                dot.className = "pin-dot w-4 h-4 rounded-full bg-rose-500 border-2 border-rose-400 scale-125 shadow-lg shadow-rose-500/50 transition-all duration-200";
            } else {
                dot.className = "pin-dot w-4 h-4 rounded-full border-2 border-slate-600 bg-transparent transition-all duration-200";
            }
        }
    }
};

window.verifyPin = function () {
    const savedPinHash = state.data.settings?.pinCode;
    if (savedPinHash && hashPin(currentPinBuffer) === savedPinHash) {
        window.unlockApp();
    } else {
        const errMsg = document.getElementById('pin-error-msg');
        if (errMsg) errMsg.classList.remove('hidden');
        currentPinBuffer = '';
        window.updatePinDots();
        if (navigator.vibrate) navigator.vibrate(200);
    }
};

window.openPinPasswordFallback = function () {
    if (confirm("Unlock with account password? This will return to the sign-in screen.")) {
        sessionStorage.removeItem('fs_is_locked');
        window.handleSignOut();
    }
};

window.promptSetPin = function () {
    window.showPrompt("Set 4-Digit Quick PIN", "Enter a new 4-digit PIN (e.g. 1234):", (newPin) => {
        if (!newPin || !/^\d{4}$/.test(newPin.trim())) {
            window.showToast("PIN must be exactly 4 digits!", "error");
            return;
        }
        window.showPrompt("Confirm PIN", "Re-enter your 4-digit PIN to confirm:", async (confirmPin) => {
            if (newPin.trim() !== confirmPin.trim()) {
                window.showToast("PINs do not match!", "error");
                return;
            }
            if (!state.data.settings) state.data.settings = {};
            state.data.settings.pinCode = hashPin(newPin.trim());
            state.data.settings.pinEnabled = true;
            await window.updateDb();
            window.showToast("4-Digit PIN Set Successfully!", "success");
            if (typeof renderApp === 'function') renderApp();
            if (!document.getElementById('modal-backdrop').classList.contains('hidden')) {
                window.openModal('auth');
            }
        });
    });
};

window.removePin = async function () {
    if (!confirm("Are you sure you want to remove your Quick PIN lock?")) return;
    if (state.data.settings) {
        delete state.data.settings.pinCode;
        state.data.settings.pinEnabled = false;
    }
    await window.updateDb();
    window.showToast("PIN Lock Removed", "info");
    window.openModal('auth');
};

// Keyboard listener for PC unlock
window.addEventListener('keydown', (e) => {
    const pinScreen = document.getElementById('pin-lock-screen');
    if (pinScreen && !pinScreen.classList.contains('hidden')) {
        if (e.key >= '0' && e.key <= '9') {
            window.handlePinInput(e.key);
        } else if (e.key === 'Backspace') {
            window.handlePinBackspace();
        } else if (e.key === 'Escape') {
            window.openPinPasswordFallback();
        }
    }
});

// ============================================================
// 2. 1-CLICK ENCRYPTED LOCAL BACKUP & RESTORE
// ============================================================
window.exportLocalBackup = function () {
    const backupData = {
        app: 'FINZSHAANIREE',
        version: '2.5',
        exportedAt: new Date().toISOString(),
        userEmail: state.user?.email,
        data: state.data
    };
    
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `FINZ_Backup_${today}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    window.showToast("Backup exported successfully!", "success");
};

window.triggerRestoreBackup = function () {
    document.getElementById('backup-file-input')?.click();
};

window.handleBackupFileSelected = function (event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const parsed = JSON.parse(e.target.result);
            if (!parsed.data || !Array.isArray(parsed.data.accounts)) {
                throw new Error("Invalid or corrupted backup format.");
            }
            if (!confirm(`Restore backup from ${parsed.exportedAt || 'file'}?\n\nWarning: This will overwrite your current ledger with the backup data.`)) {
                return;
            }
            state.data = { ...state.data, ...parsed.data };
            await window.updateDb();
            window.recalculateBalances();
            window.renderApp();
            window.showToast("Backup restored successfully!", "success");
            window.closeModal();
        } catch (err) {
            window.showToast("Restore failed: " + err.message, "error");
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
};

// ============================================================
// 3. GOLD & SILVER INVESTED TRACKER & FINANCIAL RUNWAY STATS
// ============================================================
window.getMetalsInvestedStats = function () {
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

window.getFinancialRunwayStats = function () {
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


// ============================================================
// EMERGENCY FUND SYSTEM
// ============================================================

window.openEmergencyFundWizard = function () {
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

    c.innerHTML = `
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
                    <input type="number" value="${salary > 0 ? salary : ''}" placeholder="0" class="text-lg font-black text-emerald-400 num-font bg-transparent border-b border-emerald-500/30 outline-none w-24 text-center focus:border-emerald-500" onchange="window.updateEmfSalary(this.value)">
                </div>
                <p class="text-[9px] font-bold text-slate-500 mt-1">editable</p>
            </div>
        </div>

        <!-- Step 1: Buffer months selection -->
        <div class="bg-slate-800/90 rounded-[2rem] p-6 border border-slate-700/80 shadow-lg space-y-4">
            <p class="text-xs font-black text-white">Step 1 — How many months of safety buffer do you need?</p>
            <p class="text-[10px] font-bold text-slate-400">Choose based on your financial situation:</p>
            <div class="grid grid-cols-2 gap-3">
                <button onclick="window.selectEmfMonths(3)" id="emf-btn-3" class="p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-left hover:border-emerald-500/60 transition-all emf-month-btn">
                    <p class="text-lg font-black text-white">3 Months</p>
                    <p class="text-[10px] font-bold text-slate-400">Stable job, dual income</p>
                </button>
                <button onclick="window.selectEmfMonths(6)" id="emf-btn-6" class="p-4 rounded-2xl border-2 border-emerald-500/60 bg-emerald-500/10 text-left transition-all emf-month-btn">
                    <p class="text-lg font-black text-emerald-300">6 Months</p>
                    <p class="text-[10px] font-bold text-slate-400">Single income expat <span class="text-emerald-400">★ Recommended</span></p>
                </button>
                <button onclick="window.selectEmfMonths(9)" id="emf-btn-9" class="p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-left hover:border-emerald-500/60 transition-all emf-month-btn">
                    <p class="text-lg font-black text-white">9 Months</p>
                    <p class="text-[10px] font-bold text-slate-400">Family breadwinner</p>
                </button>
                <button onclick="window.selectEmfMonths(12)" id="emf-btn-12" class="p-4 rounded-2xl border-2 border-slate-700 bg-slate-900 text-left hover:border-emerald-500/60 transition-all emf-month-btn">
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
                <input type="number" id="emf-custom-target" class="mt-4 w-full bg-slate-800 border border-slate-700 text-white p-3 rounded-xl text-center font-black text-sm outline-none focus:border-emerald-500 placeholder-slate-500" placeholder="Or enter custom target..." oninput="document.getElementById('emf-target-display').innerText = 'AED ' + (parseFloat(this.value) || 0).toLocaleString()">
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

        <button onclick="window.saveEmergencyFund()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white p-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 text-sm">
            <i data-lucide="shield-check" class="w-5 h-5"></i> Create My Emergency Fund
        </button>
    </div>`;

    // Store auto-calculated values for use in wizard
    window._emfMonthlyBurn = monthlyBurn;
    window._emfSelectedMonths = 6; // default
    lucide.createIcons();
};


window.updateEmfSalary = function(val) {
    const newVal = Number(val) || 0;
    if (!state.data.settings) state.data.settings = {};
    state.data.settings.expectedSalary = newVal;
    window.showToast("Salary updated. Recalculating...", "success");
    // Recalculate target
    const burn = state.data.settings.expectedSalary * 0.7; // Fallback if no transactions
    // Wait, the wizard calculates it as totalExpAED / 3 or expectedSalary * 0.7
    // To make it easy, just re-render the wizard which will recalculate everything
    setTimeout(() => window.openEmergencyFundWizard(), 500);
};

window.selectEmfMonths = function (months) {
    window._emfSelectedMonths = months;
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
    const burn = window._emfMonthlyBurn || 0;
    const target = burn * months;
    const formulaEl = document.getElementById('emf-formula-line');
    const targetEl = document.getElementById('emf-target-display');
    const topupEl = document.getElementById('emf-monthly-topup');

    if (formulaEl) formulaEl.innerText = `AED ${burn.toLocaleString(undefined, {maximumFractionDigits: 0})} × ${months} months`;
    if (targetEl) targetEl.innerText = `AED ${target.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
    if (topupEl) topupEl.innerText = `AED ${(target / 12).toLocaleString(undefined, {maximumFractionDigits: 0})}`;
};

window.saveEmergencyFund = async function () {
    const name = document.getElementById('emf-name')?.value || 'Emergency Fund';
    const currency = document.getElementById('emf-currency')?.value || 'AED';
    const initialBalance = parseFloat(document.getElementById('emf-initial-balance')?.value) || 0;
    const customTarget = parseFloat(document.getElementById('emf-custom-target')?.value);
    const months = window._emfSelectedMonths || 6;
    const burn = window._emfMonthlyBurn || 0;
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

    await window.updateDb();
    window.recalculateBalances();
    window.renderApp();
    window.closeModal();
    window.showToast(`Emergency Fund created! Target: AED ${target.toLocaleString(undefined, {maximumFractionDigits: 0})}`, 'success');

    // Auto-open the dashboard
    setTimeout(() => window.openEmergencyFundDashboard(), 300);
};

window.openEmergencyFundDashboard = function (accId) {
    let emfAcc;
    if (accId) {
        emfAcc = state.data.accounts.find(a => a.id === accId);
    } else {
        emfAcc = state.data.accounts.find(a => a.type === 'Emergency Fund');
    }
    if (!emfAcc) {
        window.openEmergencyFundWizard();
        return;
    }
    
    const target = emfAcc.target || state.data.settings?.emfTarget || 0;
    if (target === 0) {
        window.editEmfTarget(emfAcc.id);
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

    c.innerHTML = `
    <div class="max-w-md mx-auto space-y-6 fade-in pb-12">
        <!-- Hero Progress Card -->
        <div class="bg-gradient-to-br from-emerald-500/20 via-slate-800 to-slate-900 border-2 border-emerald-500/30 rounded-[2.5rem] p-8 text-center shadow-2xl relative overflow-hidden">
            <div class="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
                <i data-lucide="shield" class="w-40 h-40 text-emerald-400"></i>
            </div>
            <p class="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">Emergency Fund</p>
            <h2 class="text-5xl font-black text-white num-font mb-1">${window.fmtMoney(balance, currency)}</h2>
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
                <p class="text-lg font-black text-white num-font">${window.fmtMoney(target, currency)}</p>
                <p class="text-[9px] font-bold text-slate-400">${months} months buffer</p>
            </div>
            <div class="bg-slate-800/90 rounded-[2rem] p-5 border border-slate-700/80 text-center">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Shortfall</p>
                <p class="text-lg font-black ${shortfall > 0 ? 'text-rose-400' : 'text-emerald-400'} num-font">${shortfall > 0 ? window.fmtMoney(shortfall, currency) : 'Fully Funded!'}</p>
                ${shortfall > 0 ? `<p class="text-[9px] font-bold text-slate-400">~${monthsToComplete} months to complete</p>` : ''}
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
            ${emfTxs.length > 0 ? emfTxs.map(t => `
            <div class="flex justify-between items-center p-3 rounded-xl bg-slate-900/60 border border-slate-700/50">
                <div>
                    <p class="text-xs font-black text-white">${t.note || 'Top-up'}</p>
                    <p class="text-[9px] font-bold text-slate-400">${new Date(t.date).toLocaleDateString()}</p>
                </div>
                <p class="text-sm font-black ${t.type === 'income' || t.type === 'transfer_in' ? 'text-emerald-400' : 'text-rose-400'} num-font">
                    ${t.type === 'income' || t.type === 'transfer_in' ? '+' : '-'} ${window.fmtMoney(t.amount, currency)}
                </p>
            </div>`).join('') : `<p class="text-xs font-bold text-slate-400 text-center py-4">No transactions yet. Start topping up your fund!</p>`}
        </div>

        <!-- Action Buttons -->
        <div class="grid grid-cols-2 gap-4">
            <button onclick="window.viewAccountLedger('${emfAcc.id}')" class="p-4 bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 rounded-2xl text-center transition-all">
                <i data-lucide="list" class="w-5 h-5 text-slate-300 mx-auto mb-1.5"></i>
                <p class="text-[10px] font-black text-slate-300 uppercase tracking-wider">Ledger</p>
            </button>
            <button onclick="window.editEmfTarget('${emfAcc.id}')" class="p-4 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-2xl text-center transition-all">
                <i data-lucide="edit-3" class="w-5 h-5 text-emerald-400 mx-auto mb-1.5"></i>
                <p class="text-[10px] font-black text-emerald-400 uppercase tracking-wider">Edit Target</p>
            </button>
            <button onclick="window.deleteEmfAccount('${emfAcc.id}')" class="p-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-2xl text-center transition-all col-span-2">
                <i data-lucide="trash-2" class="w-5 h-5 text-rose-400 mx-auto mb-1.5"></i>
                <p class="text-[10px] font-black text-rose-400 uppercase tracking-wider">Delete Fund</p>
            </button>
        </div>
    </div>`;

    lucide.createIcons();
};


window.editEmfTarget = async function (id) {
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
            await window.updateDb();
            window.recalculateBalances();
            window.renderApp();
            window.openEmergencyFundDashboard(acc.id);
            window.showToast("Emergency Fund target updated!", "success");
        } else {
            alert("Please enter a valid positive number.");
        }
    }
};

window.deleteEmfAccount = async function (id) {
    const acc = state.data.accounts.find(a => a.id === id);
    const name = acc ? acc.name : 'this Emergency Fund';
    if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) return;
    
    state.data.accounts = (state.data.accounts || []).filter(a => a.id !== id);
    state.data.transactions = (state.data.transactions || []).filter(t => t.accountId !== id);
    if (state.data.settings?.emfAccountId === id) {
        delete state.data.settings.emfAccountId;
    }
    await window.updateDb();
    window.closeModal();
    window.recalculateBalances();
    window.renderApp();
    window.showToast(`Deleted ${name}`, "success");
};


// --- UNIFIED 3-PILLAR CATEGORY MANAGEMENT ---
window.categoryManagerBackAction = "window.renderBudgetUIOverride()";

window.getAllBudgetCategories = function() {
    const expenses = state.data?.expenseCategories || [];
    const savings = state.data?.savingsCategories || [];
    const investments = state.data?.investmentCategories || [];
    return [...expenses, ...savings, ...investments];
};

window.getCategoryPillar = function(cat) {
    if ((state.data?.savingsCategories || []).includes(cat)) return 'savings';
    if ((state.data?.investmentCategories || []).includes(cat)) return 'investment';
    return 'expense';
};


window.renderCategoryOptions = function (includeNone = false) {
    const exp = state.data?.expenseCategories || [];
    const sav = state.data?.savingsCategories || [];
    const inv = state.data?.investmentCategories || [];
    
    let html = includeNone ? '<option value="">-- None (Just a Transfer) --</option>' : '';
    if (exp.length > 0) {
        html += `<optgroup label="🛒 Living Expenses">${exp.map(c => `<option value="${c}">${c}</option>`).join('')}</optgroup>`;
    }
    if (sav.length > 0) {
        html += `<optgroup label="🛡️ Savings & Sinking Funds">${sav.map(c => `<option value="${c}">${c}</option>`).join('')}</optgroup>`;
    }
    if (inv.length > 0) {
        html += `<optgroup label="📈 Investments">${inv.map(c => `<option value="${c}">${c}</option>`).join('')}</optgroup>`;
    }
    return html;
};

window.openCategoryManager = function(onBack = "window.renderBudgetUIOverride()") {
    window.categoryManagerBackAction = onBack;
    const c = document.getElementById('modal-content');
    const t = document.getElementById('modal-title');
    const b = document.getElementById('modal-backdrop');
    if (b) b.classList.replace('hidden', 'flex');
    if (t) t.innerText = 'Manage 3-Pillar Categories';
    if (c) {
        c.innerHTML = window.render3PillarCategoryManager(window.categoryManagerBackAction);
        if (window.lucide) window.lucide.createIcons();
    }
};

window.refreshCategoryManager = function() {
    const c = document.getElementById('modal-content');
    const t = document.getElementById('modal-title');
    const currentTitle = t?.innerText || '';
    
    if (c) {
        if (currentTitle === 'Configuration Hub' || currentTitle === 'App Settings') {
            c.innerHTML = window.renderSettingsUI();
        } else {
            if (t) t.innerText = 'Manage 3-Pillar Categories';
            c.innerHTML = window.render3PillarCategoryManager(window.categoryManagerBackAction || "window.renderBudgetUIOverride()");
        }
        if (window.lucide) window.lucide.createIcons();
    }
};

window.deleteCategory = async function(cat) {
    if (!confirm(`Are you sure you want to delete "${cat}"?`)) return;
    
    const keys = ['expenseCategories', 'savingsCategories', 'investmentCategories', 'incomeCategories'];
    keys.forEach(k => {
        if (state.data[k]) {
            state.data[k] = state.data[k].filter(c => c !== cat);
        }
    });
    
    await window.updateDb();
    window.renderApp();
    window.refreshCategoryManager();
    window.showToast(`Deleted "${cat}"`, "success");
};
window.delWizardCategory = (cat) => window.deleteCategory(cat);
window.delCategory = (type, name) => window.deleteCategory(name);

window.setCategoryPillar = async function(cat, currentPillar, newPillar) {
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
    
    await window.updateDb();
    window.renderApp();
    window.refreshCategoryManager();
    window.showToast(`Moved "${cat}" to ${newPillar.toUpperCase()}`, "success");
};

window.addWizardCategory = async function () {
    const input = document.getElementById('wizard-new-cat') || document.getElementById('settings-new-cat');
    const typeSelect = document.getElementById('wizard-new-type') || document.getElementById('settings-new-type');
    const val = input?.value?.trim();
    if (!val) return;
    
    const type = typeSelect ? typeSelect.value : 'expenseCategories';
    if (!state.data[type]) state.data[type] = [];
    
    if (!state.data[type].includes(val)) {
        state.data[type].push(val);
        await window.updateDb();
        window.renderApp();
        if (input) input.value = '';
        window.refreshCategoryManager();
        window.showToast(`Added "${val}"`, "success");
    } else {
        window.showToast("Category already exists!", "error");
    }
};

window.render3PillarCategoryManager = function(onBackAction = "window.renderBudgetUIOverride()") {
    window.categoryManagerBackAction = onBackAction;
    
    const renderCatCard = (c, pillarType) => `
        <div class="bg-slate-900/90 p-4 rounded-2xl border border-slate-700/70 hover:border-slate-500 transition-all flex items-center justify-between gap-4 group shadow-sm">
            <span class="font-black text-sm text-white min-w-0 flex-1 block overflow-hidden text-ellipsis whitespace-nowrap" title="${c}">${c}</span>
            <div class="flex items-center gap-2 shrink-0">
                <select onchange="window.setCategoryPillar('${c}', '${pillarType}', this.value)" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 rounded-xl px-3 py-2 font-bold outline-none cursor-pointer">
                    <option value="expense" ${pillarType === 'expense' ? 'selected' : ''}>🛒 Living</option>
                    <option value="savings" ${pillarType === 'savings' ? 'selected' : ''}>🛡️ Savings</option>
                    <option value="investment" ${pillarType === 'investment' ? 'selected' : ''}>📈 Invest</option>
                </select>
                <button onclick="window.deleteCategory('${c}')" title="Delete Category" class="text-slate-400 hover:text-rose-400 p-2 rounded-xl hover:bg-rose-500/10 transition-all">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
    `;
    
    const expenses = state.data.expenseCategories || [];
    const savings = state.data.savingsCategories || [];
    const investments = state.data.investmentCategories || [];
    
    return `
        <div class="text-slate-100 w-full max-w-7xl mx-auto bg-slate-900/95 backdrop-blur-2xl p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left flex flex-col max-h-[88vh] fade-in">
            <!-- Header -->
            <div class="flex justify-between items-center mb-6 shrink-0 border-b border-slate-800 pb-4">
                <div class="flex items-center gap-3">
                    <button onclick="${onBackAction}" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-2xl text-slate-300 hover:text-white transition-all">
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
                    <button onclick="window.addWizardCategory()" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-8 py-3.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shrink-0 shadow-lg shadow-emerald-500/20 transition-all">
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
                        ${expenses.map(c => renderCatCard(c, 'expense')).join('') || '<p class="text-xs text-slate-500 text-center py-8">No living expense categories</p>'}
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
                        ${savings.map(c => renderCatCard(c, 'savings')).join('') || '<p class="text-xs text-slate-500 text-center py-8">No savings funds</p>'}
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
                        ${investments.map(c => renderCatCard(c, 'investment')).join('') || '<p class="text-xs text-slate-500 text-center py-8">No investment categories</p>'}
                    </div>
                </div>
            </div>
        </div>
    `;
};


// --- SMART 1-CLICK BUDGET TEMPLATES & REBALANCING ---
window.saveBudgetAsTemplate = async function() {
    const stats = window.getEnvelopeStats();
    const template = {};
    Object.keys(stats.categories).forEach(cat => {
        if (stats.categories[cat].funded > 0) {
            template[cat] = stats.categories[cat].funded;
        }
    });
    if (Object.keys(template).length === 0) {
        window.showToast("No funded envelopes to save as template", "warn");
        return;
    }
    state.data.budgetTemplate = template;
    await window.updateDb();
    window.showToast("Standard Budget Template Saved!", "success");
    window.renderBudgetUIOverride();
};

window.applyBudgetTemplate = async function() {
    const template = state.data.budgetTemplate;
    if (!template || Object.keys(template).length === 0) {
        window.showToast("No saved template found. Click 'Save Current as Template' first!", "info");
        return;
    }
    const stats = window.getEnvelopeStats();
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
                id: window.genId(),
                date,
                type: 'fund',
                category: cat,
                amount: toFund
            });
            currentUnallocated -= toFund;
        }
    });
    
    await window.updateDb();
    window.renderBudgetUIOverride();
    window.showToast("All envelopes auto-funded from template!", "success");
    if (window.fireConfetti) window.fireConfetti();
};

window.openCoverOverspending = function(targetCat, deficit) {
    const stats = window.getEnvelopeStats();
    const surplusCategories = Object.keys(stats.categories).filter(c => c !== targetCat && stats.categories[c].available > 0);
    
    let options = '';
    if (stats.unallocatedCash >= deficit) {
        options += `<option value="__unallocated__">Unallocated Cash (Available: AED ${stats.unallocatedCash.toLocaleString()})</option>`;
    } else if (stats.unallocatedCash > 0) {
        options += `<option value="__unallocated__">Unallocated Cash (Partial: AED ${stats.unallocatedCash.toLocaleString()})</option>`;
    }
    
    surplusCategories.forEach(c => {
        options += `<option value="${c}">${c} (Surplus: AED ${stats.categories[c].available.toLocaleString()})</option>`;
    });
    
    if (!options) {
        window.showToast("No surplus available in unallocated cash or other envelopes.", "warn");
        return;
    }
    
    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Cover Overspending';
    
    c.innerHTML = `
        <div class="max-w-xl mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button onclick="window.renderBudgetUIOverride()" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
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
            
            <button onclick="window.executeCoverOverspending('${targetCat}')" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                <i data-lucide="check-circle" class="w-5 h-5"></i> Rebalance & Cover Now
            </button>
        </div>
    `;
    if (window.lucide) window.lucide.createIcons();
};

window.executeCoverOverspending = async function(targetCat) {
    const src = document.getElementById('cover-source')?.value;
    const amt = parseFloat(document.getElementById('cover-amount')?.value) || 0;
    if (amt <= 0) return;
    
    const date = new Date().toISOString();
    
    if (src === '__unallocated__') {
        state.data.envelopeLedger.push({
            id: window.genId(),
            date,
            type: 'fund',
            category: targetCat,
            amount: amt
        });
    } else {
        state.data.envelopeLedger.push({
            id: window.genId(),
            date,
            type: 'defund',
            category: src,
            amount: amt
        });
        state.data.envelopeLedger.push({
            id: window.genId(),
            date,
            type: 'fund',
            category: targetCat,
            amount: amt
        });
    }
    
    await window.updateDb();
    window.renderBudgetUIOverride();
    window.showToast(`Covered AED ${amt.toLocaleString()} for ${targetCat}!`, "success");
};

window.openSurplusSweepModal = function(surplusAmt) {
    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Sweep Surplus to Savings / Assets';
    
    const mainAccs = state.data.accounts.filter(a => ['Bank Account', 'Cash'].includes(a.type));
    const targetAccs = state.data.accounts.filter(a => ['Savings', 'Investment', 'Mutual Fund', 'Emergency Fund'].includes(a.type));
    
    c.innerHTML = `
        <div class="max-w-xl mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button onclick="window.viewBudgetReports()" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
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
                        ${mainAccs.map(a => `<option value="${a.id}">${a.name} (${a.currency}) - Balance: AED ${a.balance.toLocaleString()}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">To Wealth Asset (Destination)</label>
                    <select id="sweep-target" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${targetAccs.map(a => `<option value="${a.id}">${a.name} (${a.type})</option>`).join('')}
                    </select>
                </div>
                
                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Sweep Amount</label>
                    <input type="number" id="sweep-amt" value="${surplusAmt}" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-emerald-400 font-black text-xl outline-none num-font">
                </div>
            </div>
            
            <button onclick="window.executeSurplusSweep()" class="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                <i data-lucide="arrow-right-circle" class="w-5 h-5"></i> Execute Sweep Transfer
            </button>
        </div>
    `;
    if (window.lucide) window.lucide.createIcons();
};

window.executeSurplusSweep = async function() {
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
        id: window.genId(),
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
        id: window.genId(),
        accountId: tId,
        amount: amt,
        type: 'transfer_in',
        category: 'Transfer',
        note: `Surplus Sweep from ${sAcc?.name || 'Bank'}`,
        date,
        exchangeRate: rateSnapshot
    });

    window.recalculateBalances();
    await window.updateDb();
    window.renderApp();
    window.viewBudgetReports();
    window.showToast(`Swept AED ${amt.toLocaleString()} to ${tAcc?.name || 'Savings'}!`, "success");
    if (window.fireConfetti) window.fireConfetti();
};


// --- DIRECT WHATSAPP SHARE & PARTIAL SETTLEMENT FOR DEBTS ---
window.shareWhatsAppReminder = function(pName) {
    const pItems = state.data.debts.filter(d => d.party === pName && !d.settled);
    if (pItems.length === 0) return window.showToast("No active records found for " + pName, "info");

    let netBalances = {};
    let itemLines = [];

    pItems.forEach(d => {
        const amt = Number(d.amount);
        if (!netBalances[d.currency]) netBalances[d.currency] = 0;

        let label = d.type === 'receivable' ? 'Lent' : 'Borrowed';
        if (d.notes && !d.notes.includes('[Written Off]')) {
            label = `${label} - ${d.notes}`;
        }
        
        let dueStr = '';
        if (d.repaymentDate && d.repaymentDate !== 'N/A' && d.repaymentDate !== 'null') {
            const dueDate = new Date(d.repaymentDate);
            if (!isNaN(dueDate.getTime())) {
                dueStr = ` (Due: ${dueDate.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})})`;
            } else {
                dueStr = ` (Due: ${d.repaymentDate})`;
            }
        }

        if (d.type === 'receivable') {
            netBalances[d.currency] += amt;
            itemLines.push(`• ${amt.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})} ${d.currency} (${label})${dueStr}`);
        } else if (d.type === 'payable') {
            netBalances[d.currency] -= amt;
            itemLines.push(`• ${amt.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})} ${d.currency} (${label})${dueStr}`);
        }
    });

    const nl = String.fromCharCode(10);
    let txt = `Hey ${pName},` + nl + nl + `Hope you're doing well! Just a quick note regarding our balance:` + nl + nl;
    txt += itemLines.join(nl) + nl + nl;

    let hasPositive = false;
    let hasNegative = false;

    Object.entries(netBalances).forEach(([currency, amount]) => {
        if (amount > 0.01) {
            hasPositive = true;
            txt += `Total Pending: ${amount.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})} ${currency}` + nl;
        } else if (amount < -0.01) {
            hasNegative = true;
            txt += `Total I Owe You: ${Math.abs(amount).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})} ${currency}` + nl;
        }
    });

    if (hasPositive) {
        txt += nl + `Whenever it's convenient for you, please let me know or transfer it over. Thanks!`;
    } else if (hasNegative) {
        txt += nl + `Let me know your preferred payment method and I'll send it over. Thanks!`;
    } else {
        txt += nl + `All settled up. Thanks!`;
    }

    const url = `https://wa.me/?text=${encodeURIComponent(txt)}`;
    window.open(url, '_blank');
    window.showToast("Opening WhatsApp...", "success");
};

window.openPartialSettleModal = function(debtId) {
    const d = state.data.debts.find(x => x.id === debtId);
    if (!d) return;

    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = 'Record Partial Repayment';

    const accounts = state.data.accounts.filter(a => ['Bank Account', 'Cash', 'Savings'].includes(a.type));

    c.innerHTML = `
        <div class="max-w-lg mx-auto bg-slate-900 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl text-left space-y-6 fade-in">
            <div class="flex items-center gap-3 pb-4 border-b border-slate-800">
                <button onclick="window.navDebt('person_ledger', '${d.party}')" class="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-all">
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
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Amount ${d.type === 'receivable' ? 'Received' : 'Paid'}</label>
                    <input type="number" id="partial-pay-amt" placeholder="0.00" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-emerald-400 font-black text-2xl outline-none num-font focus:border-emerald-500">
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">${d.type === 'receivable' ? 'Deposit Into Account' : 'Pay From Account'}</label>
                    <select id="partial-pay-acc" class="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                        ${accounts.map(a => `<option value="${a.id}">${a.name} (${a.currency}) - Balance: ${a.balance.toLocaleString()}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Payment Date</label>
                    <input type="date" id="partial-pay-date" value="${new Date().toISOString().split('T')[0]}" class="w-full p-3.5 bg-slate-800 border border-slate-700 rounded-2xl text-white font-bold text-sm outline-none">
                </div>
            </div>

            <button onclick="window.commitPartialPayment('${d.id}')" class="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 p-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                <i data-lucide="check-circle-2" class="w-5 h-5"></i> Commit Partial Payment
            </button>
        </div>
    `;
    if (window.lucide) window.lucide.createIcons();
};

window.commitPartialPayment = async function(debtId) {
    const d = state.data.debts.find(x => x.id === debtId);
    if (!d) return;

    const amt = parseFloat(document.getElementById('partial-pay-amt')?.value) || 0;
    const accId = document.getElementById('partial-pay-acc')?.value;
    const payDate = document.getElementById('partial-pay-date')?.value || new Date().toISOString();

    if (amt <= 0) {
        window.showToast("Please enter a valid payment amount", "error");
        return;
    }

    if (amt > Number(d.amount)) {
        window.showToast(`Amount cannot exceed outstanding balance of ${d.amount} ${d.currency}`, "error");
        return;
    }

    if (!d.originalAmount) d.originalAmount = Number(d.amount);

    const acc = state.data.accounts.find(a => a.id === accId);
    const rateSnapshot = state.data.settings?.rate || 22.75;

    // Log the transaction
    const isReceivable = d.type === 'receivable';
    state.data.transactions.push({
        id: window.genId(),
        accountId: accId,
        amount: isReceivable ? amt : -amt,
        type: isReceivable ? 'income' : 'expense',
        category: 'Debt Settlement',
        note: `Partial payment ${isReceivable ? 'from' : 'to'} ${d.party}`,
        date: new Date(payDate).toISOString(),
        exchangeRate: rateSnapshot,
        debtId: d.id
    });

    // Reduce debt
    d.amount = Number(d.amount) - amt;
    if (d.amount <= 0.01) {
        d.settled = true;
        d.amount = 0;
        d.settledDate = new Date().toISOString();
        window.showToast(`Debt with ${d.party} fully settled!`, "success");
    } else {
        window.showToast(`Recorded partial payment of ${amt.toLocaleString()} ${d.currency}!`, "success");
    }

    window.recalculateBalances();
    await window.updateDb();
    window.renderApp();
    window.navDebt('person_ledger', d.party);
    if (window.fireConfetti) window.fireConfetti();
};


// ==========================================
// FEATURE 1: NET WORTH MILESTONE ROADMAP
// ==========================================
window.getNetWorthMilestoneStats = function() {
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

window.openMilestoneModal = function() {
    const stats = window.getNetWorthMilestoneStats();
    const c = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    const b = document.getElementById('modal-backdrop');
    
    if (b) b.classList.replace('hidden', 'flex');
    if (titleEl) titleEl.innerText = 'Lifetime Net Worth Roadmap';

    c.innerHTML = `
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

                        return `
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
    `;

    if (window.lucide) window.lucide.createIcons();
};


// ==========================================
// FEATURE 2: 1-CLICK VAULT BACKUP & RESTORE
// ==========================================
window.exportFullVaultBackup = function() {
    try {
        const backupData = {
            version: '2.0',
            exportedAt: new Date().toISOString(),
            data: state.data
        };

        const jsonStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `FINZ_VAULT_BACKUP_${dateStr}_${timeStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        window.showToast("Full Vault Backup exported securely!", "success");
    } catch (err) {
        console.error("Backup export failed", err);
        window.showToast("Failed to export backup", "error");
    }
};

window.triggerRestorePicker = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) window.restoreVaultFromFile(file);
    };
    input.click();
};

window.restoreVaultFromFile = function(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            const importedData = parsed.data || parsed;
            
            if (!importedData.accounts || !Array.isArray(importedData.accounts)) {
                window.showToast("Invalid backup file format.", "error");
                return;
            }

            const accCount = importedData.accounts.length;
            const txCount = (importedData.transactions || []).length;
            const dateStr = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleDateString() : 'Unknown Date';

            if (!confirm(`Restore Vault Backup from ${dateStr}? \n\nContains: ${accCount} Accounts & ${txCount} Transactions. \n\nThis will replace your current active ledger.`)) {
                return;
            }

            state.data = importedData;
            window.recalculateBalances();
            await window.updateDb();
            window.renderApp();
            
            // Close modal if open
            const b = document.getElementById('modal-backdrop');
            if (b) b.classList.replace('flex', 'hidden');

            window.showToast("Vault Restored Successfully!", "success");
            if (window.fireConfetti) window.fireConfetti();
        } catch (err) {
            console.error("Failed to parse backup", err);
            window.showToast("Failed to read backup file. Invalid JSON.", "error");
        }
    };
    reader.readAsText(file);
};
