// Transactions behavior and screens. Dependencies stay inside the application context.
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

actions.getTransactionBaseAmount = function (t) {
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



actions.filterLedger = function () {
            const q = document.getElementById('ledger-search').value.toLowerCase();
            const filter = actions.activeLedgerFilter || 'all';
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
            actions.renderLedger(filtered);
        };

actions.renderImportUI = function () {
            return FinzUI.html`<div class="text-slate-900 max-w-2xl mx-auto bg-white p-10 rounded-[3rem] border shadow-xl text-center">
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
                    ${state.data.accounts.map(a => FinzUI.html`<option value="${a.id}">${a.name} (${a.currency})</option>`).join('')}
                </select>

                <div id="csv-preview" class="hidden mb-6 max-h-40 overflow-auto border rounded-xl"></div>

                <div class="grid grid-cols-2 gap-4">
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.parseCSV() })}" class="bg-slate-100 text-slate-600 p-4 rounded-xl font-black uppercase text-[10px]">Parse Data</button>
                    <button data-finz-click="${FinzUI.handler(function(event) { return actions.bulkImport() })}" id="btn-import" class="bg-slate-900 text-white p-4 rounded-xl font-black uppercase text-[10px] opacity-50 cursor-not-allowed">Run Import</button>
                </div>
            </div>`;
        };

actions.parseCSV = function () {
            const raw = document.getElementById('csv-input').value;
            const rows = raw.split(/\r?\n/).filter(r => r.trim() !== '');
            actions.parsedRows = [];

            rows.forEach(r => {
                const parts = r.split(',').map(p => p.trim());
                if (parts.length >= 3) {
                    // Try to simplistic parse
                    const date = parts[0];
                    const desc = parts[1];
                    const amt = parseFloat(parts[2]);

                    if (!isNaN(amt)) {
                        actions.parsedRows.push({ date, desc, amt });
                    }
                }
            });

            if (actions.parsedRows.length > 0) {
                const prev = document.getElementById('csv-preview');
                FinzUI.setHTML(prev, FinzUI.html`<table class="w-full text-center text-[9px]"><thead class="bg-slate-100 font-bold"><tr><th class="p-2">Date</th><th class="p-2">Desc</th><th class="p-2">Amt</th></tr></thead>
                <tbody>${actions.parsedRows.map(r => FinzUI.html`<tr><td class="p-2 border-b">${r.date}</td><td class="p-2 border-b">${r.desc}</td><td class="p-2 border-b font-bold ${r.amt > 0 ? 'text-emerald-500' : 'text-red-500'}">${r.amt}</td></tr>`).join('')}</tbody></table>`);
                prev.classList.remove('hidden');
                document.getElementById('btn-import').classList.remove('opacity-50', 'cursor-not-allowed');
                alert(`✅ Parsed ${actions.parsedRows.length} rows! Review and click Import.`);
            } else {
                alert("Could not parse rows. Ensure format: YYYY-MM-DD, Description, Amount (Use minus for expense)");
            }
        };

actions.bulkImport = async function () {
            if (actions.parsedRows.length === 0) return;
            const aid = document.getElementById('csv-acc').value;
            if (!aid) return;

            if (!confirm(`Import ${actions.parsedRows.length} transactions to selected account?`)) return;

            actions.setBtnLoading('btn-import', true);
            const accIdx = state.data.accounts.findIndex(a => a.id === aid);
            let balChange = 0;

            actions.parsedRows.forEach(r => {
                const type = r.amt >= 0 ? 'income' : 'expense';
                balChange += r.amt;

                state.data.transactions.push({
                    id: actions.genId(),
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
            actions.closeModal();
            actions.renderApp();
            alert("Success! Transactions Imported.");
        };

actions.setQueryDates = function (mode) {
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

actions.currentQueryResult = [];

actions.executeCustomQuery = function () {
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
            actions.currentQueryResult = filtered;
            
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
            
            FinzUI.setHTML(sumEl, FinzUI.html`
                <div class="flex flex-col items-end justify-center">
                    <div>${actions.fmtMoney(sumAED, 'AED')}</div>
                    <div class="scale-75 origin-right opacity-80 -mt-1">${actions.fmtMoney(sumINR, 'INR')}</div>
                </div>
            `);
            
            if (filtered.length === 0) {
                FinzUI.setHTML(tbody, FinzUI.literal("<tr><td colspan=\"4\" class=\"p-4 text-center text-xs font-bold text-slate-400\">No transactions match your query.</td></tr>"));
            } else {
                FinzUI.setHTML(tbody, filtered.map(t => {
                    const isIncome = ['income', 'transfer_in'].includes(t.type);
                    const color = isIncome ? 'text-emerald-500' : 'text-slate-800';
                    const sign = isIncome ? '+' : (t.type.includes('transfer_out') ? '-' : (t.type === 'expense' ? '-' : ''));
                    const pDate = new Date(t.date).toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' });
                    
                    return FinzUI.html`
                    <tr class="text-slate-900 hover:bg-slate-50 transition-colors">
                        <td class="p-3 text-xs border-r border-slate-100">${pDate}</td>
                        <td class="p-3 text-xs">
                            <p class="font-bold text-slate-800 truncate max-w-[150px]">${t.note || t.category}</p>
                            <p class="text-[9px] uppercase tracking-widest text-slate-400">${t.category}</p>
                        </td>
                        <td class="p-3 text-[10px] font-black uppercase text-slate-500 border-x border-slate-100">${t.type.replace('_', ' ')}</td>
                        <td class="p-3 text-right font-black num-font ${color}">${sign}${t._currency || 'AED'} ${parseFloat(t.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    </tr>`;
                }).join(''));
            }
            
            resultsDiv.classList.remove('hidden');
        };

actions.exportCustomQueryPDF = function () {
            if (!actions.currentQueryResult || actions.currentQueryResult.length === 0) {
                 actions.showToast("Generate a query with data first.", "warn");
                 return;
            }
            try {
                const { jsPDF } = libraries.jspdf;
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
                doc.text(`Records: ${actions.currentQueryResult.length}`, 14, 52);
                doc.setFont("helvetica", "bold");
                doc.text(`Aggregate Sum: ${totalText}`, 140, 52);
                
                const tableBody = actions.currentQueryResult.map(t => [
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
                actions.showToast("Query Exported to PDF", "success");
            } catch (err) {
                console.error("PDF Export Error", err);
                actions.showToast("Error generating PDF. Check console.", "error");
            }
        };

actions.updateTransferUI = function () {
            const sId = document.getElementById('ts')?.value;
            const tId = document.getElementById('ttg')?.value;
            const sAcc = state.data.accounts.find(a => a.id === sId);
            const tAcc = state.data.accounts.find(a => a.id === tId);
            const rate = state.data.settings?.rate || 22.75;

            const sendBadge = document.getElementById('badge-send-cur');
            const lblSend = document.getElementById('lbl-send-amount');
            const crossBox = document.getElementById('cross-currency-box');
            const rateInput = document.getElementById('tx-rate');
            const lblReceived = document.getElementById('lbl-received-amount');
            const lblFee = document.getElementById('lbl-transfer-fee');

            const sCur = sAcc ? sAcc.currency : 'AED';
            const tCur = tAcc ? tAcc.currency : 'INR';

            if (sendBadge) sendBadge.innerText = sCur;
            if (lblSend) lblSend.innerText = `Sending Amount (${sCur})`;

            if (sCur !== tCur) {
                if (crossBox) crossBox.classList.remove('hidden');
                if (rateInput && (!rateInput.value || parseFloat(rateInput.value) <= 0)) {
                    rateInput.value = sCur === 'AED' ? rate.toFixed(2) : (1 / rate).toFixed(4);
                }
                if (lblReceived) lblReceived.innerText = `Received ${tCur} Amount (Credited)`;
                if (lblFee) lblFee.innerText = `Transfer / Exchange Fee (${sCur}) (Optional app charge / fee)`;
                actions.calcTransferEstimate('send');
            } else {
                if (crossBox) crossBox.classList.add('hidden');
            }
        };

actions.calcTransferEstimate = function (trigger = 'send') {
            const sId = document.getElementById('ts')?.value;
            const tId = document.getElementById('ttg')?.value;
            const sAcc = state.data.accounts.find(a => a.id === sId);
            const tAcc = state.data.accounts.find(a => a.id === tId);
            const defaultRate = state.data.settings?.rate || 22.75;

            const sCur = sAcc ? sAcc.currency : 'AED';
            const tCur = tAcc ? tAcc.currency : 'INR';

            const sendInput = document.getElementById('tamt');
            const rateInput = document.getElementById('tx-rate');
            const receiveInput = document.getElementById('tx-received');
            const feeInput = document.getElementById('tx-fee');
            const summaryPill = document.getElementById('remit-summary-pill');

            const sendVal = parseFloat(sendInput?.value) || 0;
            let rateVal = parseFloat(rateInput?.value) || (sCur === 'AED' ? defaultRate : 1 / defaultRate);
            let receiveVal = parseFloat(receiveInput?.value) || 0;
            const feeVal = parseFloat(feeInput?.value) || 0;

            if (sCur === tCur) {
                return;
            }

            if (trigger === 'send' || trigger === 'rate' || trigger === 'fee') {
                if (sendVal > 0 && rateVal > 0) {
                    receiveVal = sendVal * rateVal;
                    if (receiveInput) receiveInput.value = receiveVal.toFixed(2);
                } else if (sendVal === 0 && receiveInput) {
                    receiveInput.value = '';
                }
            } else if (trigger === 'receive') {
                if (sendVal > 0 && receiveVal > 0) {
                    rateVal = receiveVal / sendVal;
                    if (rateInput) rateInput.value = rateVal.toFixed(4);
                }
            }

            if (summaryPill) {
                if (sendVal > 0) {
                    const totalDebit = sendVal + feeVal;
                    FinzUI.setHTML(summaryPill, FinzUI.html`
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span><b>Debit:</b> ${sCur} ${totalDebit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}${feeVal > 0 ? ` (${sendVal.toLocaleString()} + ${feeVal.toLocaleString()} fee)` : ''}</span>
                            <span class="text-emerald-400"><b>Credit:</b> ${tCur} ${receiveVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                            <span class="text-amber-300 text-[10px]">1 ${sCur} = ${rateVal.toFixed(2)} ${tCur}</span>
                        </div>
                    `);
                } else {
                    summaryPill.innerText = `Enter ${sCur} amount to calculate received ${tCur}`;
                }
            }
        };

actions.saveTransaction = async function (txData) {
            let transaction = txData;

            // GLOBAL BALANCE SAFEGUARD (Programmatic calls)
            if (transaction) {
                if (transaction.type === 'expense' || transaction.type === 'transfer_out') {
                    const acc = state.data.accounts.find(a => a.id === transaction.accountId);
                    if (acc) {
                        // Parse amount safely (could be formatted string or number)
                        const reqAmt = parseFloat(transaction.amount);
                        if (acc.balance < reqAmt) {
                            actions.showToast(`Insufficient Funds! (${acc.currency} ${acc.balance} < ${reqAmt})`, "error");
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

                const validation = document.getElementById('tx-validation');
                if (validation) { validation.textContent = ''; validation.classList.add('hidden'); }
                const invalid = (message, field) => {
                    if (validation) { validation.textContent = message; validation.classList.remove('hidden'); }
                    actions.showToast(message, 'error');
                    field?.focus();
                };
                if (!aId || !state.data.accounts.some(a => a.id === aId)) {
                    invalid('Please select an available account.', document.getElementById('ta'));
                    return;
                }
                if (!Number.isFinite(amt) || amt <= 0 || actions.toCurrency(amt) <= 0) {
                    invalid('Enter an amount greater than zero to authorize this entry.', amtEl);
                    return;
                }

                actions.setBtnLoading('btn-save-tx', true);

                const idx = state.data.accounts.findIndex(a => a.id === aId);
                const currentBal = state.data.accounts[idx].balance;

                // Insufficient Funds Check
                if (type === 'expense' && currentBal < amt) {
                    actions.showToast("Insufficient Funds!", "error");
                    actions.setBtnLoading('btn-save-tx', false);
                    return;
                }

                // Snapshot current exchange rate
                const rateSnapshot = state.data.settings.rate;

                const excludeEl = document.getElementById('tx-exclude-budget');
                const isExcluded = excludeEl ? excludeEl.checked : false;

                transaction = {
                    id: actions.genId(),
                    accountId: aId,
                    amount: actions.toCurrency(amt),
                    type,
                    category: cat,
                    note,
                    date: new Date().toISOString(),
                    exchangeRate: rateSnapshot,
                    excludeFromBudget: (type === 'expense' && isExcluded)
                };
            } else if (transaction.excludeFromBudget !== undefined) {
                transaction.excludeFromBudget = Boolean(transaction.excludeFromBudget);
            }

            const account = state.data.accounts.find(a => a.id === transaction.accountId);
            const value = Number(transaction.amount);
            if (!account || !Number.isFinite(value) || value <= 0 || !['income', 'expense', 'transfer_in', 'transfer_out'].includes(transaction.type)) {
                actions.setBtnLoading('btn-save-tx', false);
                throw new Error('Invalid transaction account, type or amount.');
            }
            actions.recalculateBalances();
            if (['expense', 'transfer_out'].includes(transaction.type) && account.balance < value) {
                actions.setBtnLoading('btn-save-tx', false); throw new Error('Insufficient Funds');
            }
            transaction.amount = FinzCore.money(value);
            transaction.currency = account.currency;
            transaction.exchangeRate = transaction.exchangeRate || state.data.settings.rate;
            // 2. Commit to State
            state.data.transactions.push(transaction);

            // 3. Persist & Clean Up
            actions.recalculateBalances(); // Derive new balances
            try { await updateDb(); }
            finally { if (!txData) actions.setBtnLoading('btn-save-tx', false); }

            // Only handle UI cleanup if called from UI
            if (!txData) {
                actions.setBtnLoading('btn-save-tx', false);
                closeModal();
                actions.renderApp();
                // success toast handled by caller if programmatic, else here
                actions.showToast("Transaction Saved", "success");
            }
        };

actions.doTransfer = async function () {
            const sId = document.getElementById('ts')?.value;
            const tId = document.getElementById('ttg')?.value;
            const val = parseFloat(document.getElementById('tamt')?.value);
            const n = document.getElementById('trn')?.value?.trim() || 'Fund Transfer';
            const tCat = (document.getElementById('tcat') ? document.getElementById('tcat').value : '') || 'Transfer';

            if (!sId || !tId || isNaN(val)) {
                actions.showToast("Please enter a valid transfer amount", "error");
                return;
            }

            if (val <= 0) {
                actions.showToast("Transfer amount must be positive", "error");
                return;
            }

            if (sId === tId) {
                actions.showToast("Cannot transfer to the same account", "error");
                return;
            }

            const sIdx = state.data.accounts.findIndex(x => x.id === sId);
            const tIdx = state.data.accounts.findIndex(x => x.id === tId);
            const sAcc = state.data.accounts[sIdx];
            const tAcc = state.data.accounts[tIdx];

            if (!sAcc || !tAcc) return;

            const isCrossCurrency = sAcc.currency !== tAcc.currency;
            let customRate = state.data.settings?.rate || 22.75;
            let finalAmt = val;
            let fee = 0;

            if (isCrossCurrency) {
                customRate = parseFloat(document.getElementById('tx-rate')?.value) || customRate;
                const recVal = parseFloat(document.getElementById('tx-received')?.value);
                finalAmt = (!isNaN(recVal) && recVal > 0) ? recVal : (val * customRate);
                fee = parseFloat(document.getElementById('tx-fee')?.value) || 0;
            }

            if (!Number.isFinite(val) || !Number.isFinite(customRate) || customRate <= 0 || !Number.isFinite(finalAmt) || finalAmt <= 0 || !Number.isFinite(fee) || fee < 0) {
                actions.showToast('Enter a positive amount and rate, and a non-negative fee.', 'error'); return;
            }
            const totalDebit = val + fee;

            if (sAcc.balance < totalDebit) {
                const errDiv = document.getElementById('transfer-error-msg');
                const errMsg = `Insufficient Funds! (${sAcc.currency} ${sAcc.balance.toLocaleString()} available < ${totalDebit.toLocaleString()} required)`;
                if (errDiv) {
                    errDiv.innerText = errMsg;
                    errDiv.classList.remove('hidden');
                } else {
                    actions.showToast(errMsg, "error");
                }
                return;
            } else {
                const errDiv = document.getElementById('transfer-error-msg');
                if (errDiv) errDiv.classList.add('hidden');
            }

            actions.setBtnLoading('btn-do-transfer', true);

            const dateIso = new Date().toISOString();
            const transferGroupId = actions.genId();
            const noteSuffix = isCrossCurrency ? ` (Rate: ${customRate.toFixed(2)}${fee > 0 ? `, Fee: ${sAcc.currency} ${fee}` : ''})` : '';

            // 1. Transfer Out on Source Account
            state.data.transactions.push({
                id: actions.genId(), transferGroupId,
                accountId: sId,
                amount: actions.toCurrency(val),
                type: 'transfer_out',
                category: tCat,
                note: `To ${tAcc.name}: ${n}${noteSuffix}`,
                date: dateIso,
                exchangeRate: customRate,
                transferTo: tId,
                currency: sAcc.currency
            });

            // 2. Transfer In on Destination Account (Exact credited amount)
            state.data.transactions.push({
                id: actions.genId(), transferGroupId,
                accountId: tId,
                amount: actions.toCurrency(finalAmt),
                type: 'transfer_in',
                category: tCat,
                note: `From ${sAcc.name}: ${n}${noteSuffix}`,
                date: dateIso,
                exchangeRate: customRate,
                transferFrom: sId,
                currency: tAcc.currency
            });

            // 3. If there was a transfer fee, log it as an expense on the source account
            if (fee > 0) {
                state.data.transactions.push({
                    id: actions.genId(), transferGroupId,
                    accountId: sId,
                    amount: actions.toCurrency(fee),
                    type: 'expense',
                    category: 'Bank Charges',
                    note: `Transfer Fee for ${n} to ${tAcc.name}`,
                    date: dateIso,
                    exchangeRate: customRate
                });
            }

            actions.recalculateBalances();
            try {
                await actions.updateDb();
            } catch (err) {
                console.error("Error updating DB after transfer:", err);
                actions.setBtnLoading('btn-do-transfer', false);
                return;
            }

            actions.setBtnLoading('btn-do-transfer', false);
            actions.closeModal();
            actions.renderApp();
            actions.showToast(`Transferred ${sAcc.currency} ${val.toLocaleString()} → ${tAcc.currency} ${finalAmt.toLocaleString()} successfully!`, "success");
        };

actions.openMasterLedger = function () {
            const b = document.getElementById('modal-backdrop');
            const t = document.getElementById('modal-title');
            const c = document.getElementById('modal-content');
            
            // Expand modal to stretch horizontally
            c.classList.remove('max-w-4xl');
            c.classList.add('max-w-[95vw]');

            t.innerText = "Transaction Ledger";
            FinzUI.setHTML(c, FinzUI.html`
            <div class="w-full h-full flex flex-col space-y-4">
                <!--Search & Export Header-->
                <div class="flex flex-col md:flex-row justify-between items-center gap-4 py-2 border-b border-slate-700/50 flex-shrink-0">
                    <div class="relative w-full md:w-auto flex-grow max-w-xl">
                        <i data-lucide="search" class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"></i>
                        <input type="text" id="ledger-search" data-finz-input="${FinzUI.handler(function(event) { return actions.filterLedger() })}" 
                            placeholder="Search #tags, notes, amounts..." 
                            class="pl-12 pr-4 py-4 bg-slate-900/50 border border-slate-700/50 text-white rounded-2xl text-sm font-black outline-none w-full transition-all focus:ring-1 focus:ring-rose-500/50 placeholder:text-slate-500">
                    </div>
                    
                    <div class="flex items-center space-x-2">
                         <div class="flex items-center space-x-2 mr-4 hidden md:flex">
                             <input type="date" id="ledger-date-from" data-finz-change="${FinzUI.handler(function(event) { return actions.filterLedger() })}" class="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-bold text-slate-300 uppercase outline-none focus:border-rose-500 transition-all cursor-pointer hover:bg-slate-700 text-center w-28" placeholder="From">
                             <span class="text-slate-500 font-bold">-</span>
                             <input type="date" id="ledger-date-to" data-finz-change="${FinzUI.handler(function(event) { return actions.filterLedger() })}" class="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-bold text-slate-300 uppercase outline-none focus:border-rose-500 transition-all cursor-pointer hover:bg-slate-700 text-center w-28" placeholder="To">
                         </div>

                        <button data-finz-click="${FinzUI.handler(function(event) { return actions.openModal('reports') })}" class="flex items-center space-x-2 bg-slate-800 border border-slate-700 text-slate-300 px-6 py-3 rounded-2xl font-bold text-[10px] uppercase hover:bg-rose-600 hover:text-white transition-all">
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
                                <button id="filter-btn-all" data-finz-click="${FinzUI.handler(function(event) { return actions.setLedgerFilter('all') })}" class="px-4 py-2 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase shadow-[0_0_15px_rgba(225,29,72,0.3)] transform scale-105 transition-all border border-rose-500">All</button>
                                <button id="filter-btn-income" data-finz-click="${FinzUI.handler(function(event) { return actions.setLedgerFilter('income') })}" class="px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all">Income</button>
                                <button id="filter-btn-expense" data-finz-click="${FinzUI.handler(function(event) { return actions.setLedgerFilter('expense') })}" class="px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all">Expense</button>
                                <button id="filter-btn-transfer" data-finz-click="${FinzUI.handler(function(event) { return actions.setLedgerFilter('transfer') })}" class="px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all">Transfers</button>
                                <button id="filter-btn-high" data-finz-click="${FinzUI.handler(function(event) { return actions.setLedgerFilter('high') })}" class="px-4 py-2 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all">High Value (>5k)</button>
                            </div>
                            <!-- Mobile date picker and search fallbacks -->
                            <div class="flex items-center space-x-2 md:hidden">
                                <input type="text" id="ledger-search-mobile" data-finz-keyup="${FinzUI.handler(function(event) { document.getElementById('ledger-search').value = this.value; return actions.filterLedger() })}" placeholder="Search..." class="w-24 px-2 py-1 bg-slate-800 border border-slate-700 text-white rounded-lg text-[9px] font-bold outline-none">
                                <input type="date" id="ledger-date-from-mobile" data-finz-change="${FinzUI.handler(function(event) { document.getElementById('ledger-date-from').value = this.value; return actions.filterLedger() })}" class="px-2 py-1 bg-slate-800 border border-slate-700 text-white rounded-lg text-[9px] font-bold uppercase outline-none focus:border-rose-500 w-24">
                                <span class="text-slate-500">-</span>
                                <input type="date" id="ledger-date-to-mobile" data-finz-change="${FinzUI.handler(function(event) { document.getElementById('ledger-date-to').value = this.value; return actions.filterLedger() })}" class="px-2 py-1 bg-slate-800 border border-slate-700 text-white rounded-lg text-[9px] font-bold uppercase outline-none focus:border-rose-500 w-24">
                            </div>
                        </div>

                        <div id="master-ledger-body"></div>
                    </div>
                </div>
            </div>`);

            // Render Filters
            actions.setLedgerFilter = function (filterType) {
                actions.activeLedgerFilter = filterType;

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

                actions.filterLedger();
            };

            // Init Filter State
            actions.activeLedgerFilter = 'all';

            b.classList.replace('hidden', 'flex');
            if (typeof actions.renderLedger === 'function') {
                actions.renderLedger(state.data.transactions);
            }
            lucide.createIcons();
        };

actions.cloneTransaction = async (id) => {
            const tx = state.data.transactions.find(t => t.id === id);
            if (!tx || tx.accountId === 'virtual_writeoff' || tx.type.includes('transfer')) {
                alert("Cannot clone this transaction type.");
                return;
            }

            const newTx = {
                ...tx,
                id: actions.genId(),
                date: new Date().toISOString(),
                note: tx.note + ' (Clone)'
            };

            if (tx.debtId || tx.category === 'BNPL Payment') {
                actions.showToast('Linked debt payments cannot be cloned.', 'error'); return;
            }
            await actions.saveTransaction(newTx);
            // Integrity: Recalculate balances from ledger instead of manual math
            actions.recalculateBalances();
            actions.renderApp();
            actions.showToast("Transaction Cloned", "success");
        };

actions.deleteTransaction = async (id) => {
            actions.showConfirm(
                "⚠? DELETE TRANSACTION?",
                "This will permanently remove the record and update your balances.",
                async () => {
                    try {
                        const tx = state.data.transactions.find(t => t.id === id);
                        if (!tx) return; // Ignore double clicks or already deleted items

                        FinzCore.deleteEntry(state.data, id);

                        // 3. Save & Refresh Dashboard
                        await updateDb();
                        actions.recalculateBalances();

                        console.log("Deleted transaction:", id);
                        actions.showToast("Transaction Deleted", "success");
                        actions.renderApp();

                        // 4. Refresh Active Modal Views
                        if (document.getElementById('master-ledger-body')) {
                            if (typeof actions.filterLedger === 'function') actions.filterLedger();
                        } else if (document.getElementById('modal-title') && document.getElementById('modal-title').innerText.includes("Debt")) {
                            const modalContent = document.getElementById('modal-content');
                            if (modalContent && typeof actions.renderDebtUI === 'function') {
                                FinzUI.setHTML(modalContent, actions.renderDebtUI()); 
                                lucide.createIcons();
                            }
                        }
                    } catch (error) {
                        console.error("Delete failed:", error);
                        actions.showToast("Delete failed: " + error.message, "error");
                    }
                }
            );
        };

actions.confirmDeleteTransaction = actions.deleteTransaction;

actions.editTransaction = (id) => {
            const tx = state.data.transactions.find(t => t.id === id);
            if (!tx) return;

            // Block complex edits
            if (tx.debtId || tx.type.includes('transfer') || ['Settlement', 'Lending', 'Borrowing'].includes(tx.category) || tx.accountId === 'virtual_writeoff') {
                alert("⚠? Complex Entry Locked\n\nTransfers, Debt Settlements, and Write-offs cannot be edited directly because they affect multiple records.\n\nPlease DELETE this entry and create a new one.");
                return;
            }

            // Open Modal
            actions.openModal('transaction');

            // Fill values
            document.getElementById('tt').value = tx.type;
            actions.setT(tx.type); // Update UI buttons
            document.getElementById('ta').value = tx.accountId;
            document.getElementById('tc').value = tx.category;
            document.getElementById('tam').value = tx.amount;
            document.getElementById('tn').value = tx.note;
            const excludeEl = document.getElementById('tx-exclude-budget');
            if (excludeEl) {
                excludeEl.checked = Boolean(tx.excludeFromBudget);
            }

            // Change Save button to Update
            const original = document.getElementById('btn-save-tx');
            const btn = original.cloneNode(true); // Remove the create-entry listener before binding update.
            original.replaceWith(btn);
            btn.innerText = "Update Entry";
            btn.onclick = () => actions.updateTransaction(id);
        };

actions.updateTransaction = async (id) => {
            if (document.getElementById('btn-save-tx')?.disabled) return;
            // Get New Values
            const aId = document.getElementById('ta').value;
            const amt = parseFloat(document.getElementById('tam').value);
            const type = document.getElementById('tt').value;
            const cat = document.getElementById('tc').value;
            const note = document.getElementById('tn').value;

            if (!aId || isNaN(amt)) return;

            // Security: Prevent negative amounts
            if (amt < 0) {
                actions.showToast("Amount cannot be negative", "error");
                return;
            }

            actions.setBtnLoading('btn-save-tx', true);

            actions.recalculateBalances();
            const previous = state.data.transactions.find(t => t.id === id);
            const account = state.data.accounts.find(a => a.id === aId);
            if (previous?.debtId || previous?.type.includes('transfer')) {
                actions.setBtnLoading('btn-save-tx', false); actions.showToast('Linked entries cannot be edited separately.', 'error'); return;
            }
            if (!previous || !account || !Number.isFinite(amt) || amt <= 0) {
                actions.setBtnLoading('btn-save-tx', false); actions.showToast('Invalid entry.', 'error'); return;
            }
            const oldEffect = previous.accountId === aId ? (previous.type === 'income' ? Number(previous.amount) : -Number(previous.amount)) : 0;
            if (type === 'expense' && account.balance - oldEffect < amt) {
                actions.setBtnLoading('btn-save-tx', false); actions.showToast('Insufficient Funds!', 'error'); return;
            }
            // 1. Update Transaction Object
            const txIdx = state.data.transactions.findIndex(t => t.id === id);
            const oldTx = state.data.transactions[txIdx];
            const excludeEl = document.getElementById('tx-exclude-budget');
            const isExcluded = excludeEl ? excludeEl.checked : false;

            state.data.transactions[txIdx] = {
                ...oldTx,
                accountId: aId,
                amount: actions.toCurrency(amt),
                type: type,
                category: cat,
                note: note,
                currency: account.currency,
                exchangeRate: previous.accountId === aId ? previous.exchangeRate : state.data.settings.rate,
                excludeFromBudget: (type === 'expense' && isExcluded),
            };

            try { await updateDb(); }
            catch (_) { actions.setBtnLoading('btn-save-tx', false); return; }
            // Integrity: Recalculate balances from ledger
            actions.recalculateBalances();

            actions.closeModal();
            actions.renderApp();
            actions.showToast("Transaction Updated", "success");
            actions.setBtnLoading('btn-save-tx', false);
        };

actions.openSmartInput = function() {
    const modal = document.getElementById('smart-input-modal');
    modal.classList.replace('hidden', 'flex');
    const inp = document.getElementById('smart-input-field');
    inp.value = '';
    setTimeout(() => inp.focus(), 100);
    lucide.createIcons();
};

actions.processSmartInput = async function() {
    const inp = document.getElementById('smart-input-field').value.trim();
    if (!inp) return;
    
    // Simple regex to parse "50 coffee" or "coffee 50"
    const match = inp.match(/^(\d+(?:\.\d+)?)\s+(.+)$/) || inp.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
    if (!match) {
        actions.showToast("Format: 'Amount Description' (e.g. 50 Coffee)", "error");
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
        actions.showToast("No account found to log expense", "error");
        return;
    }

    // Log the transaction
    state.data.transactions.push({
        id: actions.genId(),
        accountId: acc.id,
        amount: actions.toCurrency(amt), // Store natively, assuming base currency for smart input
        type: 'expense',
        category: category,
        note: desc,
        date: new Date().toISOString(),
        exchangeRate: state.data.settings.rate
    });

    actions.showToast(`Logged ${amt} ${acc.currency} to ${category}`, "success");
    document.getElementById('smart-input-modal').classList.replace('flex', 'hidden');
    actions.recalculateBalances();
    await actions.updateDb();
    actions.renderApp();
};

actions.renderLedger = function(items) {
    const body = document.getElementById('master-ledger-body'); if (!body) return;
    const sorted = [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (sorted.length === 0) {
        FinzUI.setHTML(body, FinzUI.html`<div class="p-12 text-center text-slate-500 font-bold text-xs uppercase tracking-widest border border-dashed border-slate-700/50 rounded-2xl mt-8">No transactions found</div>`);
        return;
    }
    
    let html = FinzUI.html`<div class="w-full border border-slate-700/50 rounded-2xl overflow-hidden bg-slate-900/50 shadow-2xl">
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

        html += FinzUI.html`
        <div class="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 p-4 hover:bg-slate-800/60 transition-colors items-center group cursor-pointer" data-finz-click="${FinzUI.handler(function(event) { return actions.editTransaction(((t.id))) })}">
            <!-- Mobile: Date & Category row, Desktop: Date column -->
            <div class="col-span-1 md:col-span-3 flex justify-between md:block items-center">
                <div class="flex flex-col text-left">
                    <span class="text-xs font-bold text-slate-300">${dateStr}</span>
                    <span class="text-[9px] font-bold text-slate-500 uppercase tracking-widest">${timeStr}</span>
                </div>
                <!-- Mobile only amount & delete -->
                <div class="md:hidden flex items-center gap-2 text-right">
                    <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return (actions.deleteTransaction || actions.confirmDeleteTransaction)(((t.id))) })}" class="text-[9px] font-black text-rose-500/70 hover:text-rose-400 uppercase tracking-wider border border-rose-500/30 rounded px-1.5 py-0.5" title="Delete">Del</button>
                    <p class="text-sm font-black ${colorClass} tracking-tight">${sign}${currSymbol} ${intAmt}<span class="text-[10px] opacity-50">.${amtParts[1]}</span></p>
                </div>
            </div>
            
            <!-- Details Column -->
            <div class="col-span-1 md:col-span-3 flex flex-col justify-center text-left">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-black text-slate-100 truncate">${t.category || displayType}</span>
                    ${t.excludeFromBudget ? FinzUI.html`<span class="text-[8px] font-black uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded tracking-wider">Non-Budget</span>` : ''}
                </div>
                <span class="text-[10px] text-slate-500 truncate mt-0.5">${t.note || 'No notes'}</span>
            </div>

            <!-- Account Column -->
            <div class="col-span-1 md:col-span-2 flex items-center justify-start md:justify-start">
                <span class="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded border ${bgClass} truncate max-w-[120px]">${accName}</span>
            </div>

            <!-- Desktop Amount Column -->
            <div class="hidden md:flex col-span-4 items-center justify-end gap-4">
                <button data-finz-click="${FinzUI.handler(function(event) { event.stopPropagation(); return (actions.deleteTransaction || actions.confirmDeleteTransaction)(((t.id))) })}" class="text-[9px] font-black text-rose-500/50 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all uppercase tracking-widest border border-rose-500/0 hover:border-rose-500/50 rounded px-2 py-1">Delete</button>
                <p class="text-base font-black ${colorClass} tracking-tight num-font text-right w-28"><span class="text-[10px] opacity-70 mr-1">${sign}${currSymbol}</span>${intAmt}<span class="text-xs opacity-50 ml-0.5">.${amtParts[1]}</span></p>
            </div>
        </div>`;
    });
    
    html += FinzUI.html`</div></div>`;
    
    FinzUI.setHTML(body, html);
    lucide.createIcons();
};
}
