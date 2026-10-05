(function () {
    'use strict';
    module.exports = function (root, { state, auth, db, appId, doc, getDoc, runTransaction, onSnapshot, onAuthStateChanged, prepareCommit, assertTransferGroups }) {
        const F = require('./finance-core.js');
        let baseline = F.defaults(), queued = null, queue = Promise.resolve(), pending = 0;
        let unsubscribe = null, generation = 0, loaded = false, locked = false, runningSchedules = false;
        const refFor = uid => doc(db, 'artifacts', appId, 'users', uid, 'finance', 'main');
        const chunkRef = (uid, id) => doc(db, 'artifacts', appId, 'users', uid, 'finance', id);
        const byteLength = value => new TextEncoder().encode(JSON.stringify(value)).length;
        async function readLedger(snap, uid, read) {
            if (!snap.exists()) return F.defaults();
            const data = snap.data();
            if (data._ledgerChunks) {
                if (!Array.isArray(data._ledgerChunks) || data._ledgerChunks.length > 200 ||
                    !data._ledgerChunks.every(id => /^main_chunk_[a-f0-9-]+_\d+$/.test(id))) throw new Error('Invalid ledger storage manifest.');
                const parts = [];
                for (const id of data._ledgerChunks) {
                    const part = await read(chunkRef(uid, id));
                    if (!part.exists() || typeof part.data().json !== 'string') throw new Error('A ledger storage segment is unavailable. Please reload.');
                    parts.push(part.data().json);
                }
                return F.normalize(JSON.parse(parts.join('')));
            }
            return F.normalize(data);
        }
        function writeLedger(transaction, ref, uid, data, oldManifest) {
            if (byteLength(data) <= 700000 && !oldManifest?.length) {
                transaction.set(ref, clean(data)); return;
            }
            // Split the serialized ledger, so growth in any collection cannot exceed a document limit.
            const json = JSON.stringify(clean(data)), parts = [], version = crypto.randomUUID();
            let offset = 0;
            while (offset < json.length) {
                let stop = Math.min(offset + 100000, json.length);
                if (stop < json.length && /[\uD800-\uDBFF]/.test(json[stop - 1])) stop--;
                parts.push(json.slice(offset, stop)); offset = stop;
            }
            if (parts.length > 200) throw new Error('Ledger exceeds the supported storage size. Nothing was saved.');
            const ids = parts.map((_, i) => `main_chunk_${version}_${i}`);
            for (let i = 0; i < ids.length; i++) transaction.set(chunkRef(uid, ids[i]), { json: parts[i] });
            transaction.set(ref, { _ledgerChunks: ids, _ledgerFormat: 1 });
            for (const id of oldManifest || []) transaction.delete(chunkRef(uid, id));
        }
        const clean = value => {
            if (Array.isArray(value)) return value.map(v => clean(v === undefined ? null : v));
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]));
            return value;
        };
        root.recalculateBalances = () => F.recalculate(state.data);
        root.genId = () => crypto.randomUUID();
        root.updateDb = function ({ replace = false } = {}) {
            if (!state.user || !loaded) return Promise.reject(new Error('Your account is still loading. Please try again.'));
            const uid = state.user.uid, session = generation;
            const base = F.clone(queued || baseline), proposed = clean(F.clone(state.data));
            queued = F.clone(proposed);
            pending++;
            const job = queue.then(async () => {
                if (session !== generation) throw new Error('Sign-in changed before saving.');
                let committed;
                await runTransaction(db, async transaction => {
                    const ref = refFor(uid), snap = await transaction.get(ref);
                    const remote = await readLedger(snap, uid, ref => transaction.get(ref));
                    if (replace && !F.same(F.recalculate(F.clone(base)), F.recalculate(F.clone(remote)))) {
                        throw new Error('Another device changed the ledger. Review the latest data before restoring.');
                    }
                    committed = F.normalize(replace ? proposed : F.merge(base, proposed, remote));
                    if (prepareCommit) committed = prepareCommit(remote, committed);
                    if (assertTransferGroups) assertTransferGroups(committed.transactions);
                    committed = F.recalculate(committed);
                    const previousBalances = F.recalculate(F.clone(remote));
                    for (const account of committed.accounts) {
                        if (!['Bank Account', 'Cash', 'Savings'].includes(account.type)) continue;
                        const before = previousBalances.accounts.find(a => a.id === account.id)?.balance || 0;
                        if (account.balance < 0 && account.balance < before) throw new Error('This change would leave insufficient funds. Adjust the related expenses first.');
                    }
                    for (const entry of proposed.transactions) {
                        const before = base.transactions.find(t => t.id === entry.id);
                        if (!before && entry.accountId !== 'virtual_writeoff' && !committed.accounts.some(a => a.id === entry.accountId)) {
                            throw new Error('The account for this entry was removed before saving.');
                        }
                        if (['expense', 'transfer_out'].includes(entry.type) && !F.same(before, entry) &&
                            committed.accounts.find(a => a.id === entry.accountId)?.balance < 0) {
                            throw new Error('Insufficient funds after applying the latest changes from another device.');
                        }
                    }
                    writeLedger(transaction, ref, uid, committed, snap.exists() ? snap.data()._ledgerChunks : null);
                });
                if (session !== generation) return;
                baseline = F.clone(committed);
                if (pending === 1) state.data = F.clone(committed);
            }).catch(async error => {
                if (session === generation) {
                    try {
                        const latest = await getDoc(refFor(uid));
                        if (latest.exists()) baseline = await readLedger(latest, uid, getDoc);
                    } catch (_) { /* Keep the last confirmed snapshot if the network is unavailable. */ }
                    state.data = F.clone(baseline);
                    root.recalculateBalances();
                    root.renderApp();
                    root.showToast('Save failed: ' + error.message, 'error');
                }
                throw error;
            }).finally(() => {
                pending--;
                if (!pending) queued = null;
            });
            queue = job.catch(() => {});
            return job;
        };
        const reveal = () => {
            const app = document.getElementById('app-content');
            const screen = document.getElementById('pin-lock-screen');
            if (app) app.style.display = locked ? 'none' : 'flex';
            if (screen) {
                screen.classList.toggle('hidden', !locked);
                screen.classList.toggle('flex', locked);
            }
        };
        let pin = '', attempts = 0, blockedUntil = 0;
        const attemptKey = () => 'finz_pin_attempts_' + state.user?.uid;
        const saveAttempts = () => sessionStorage.setItem(attemptKey(), JSON.stringify({ attempts, blockedUntil }));
        const unlock = () => {
            locked = false; pin = ''; attempts = 0; blockedUntil = 0;
            sessionStorage.removeItem('fs_is_locked'); saveAttempts(); reveal();
            root.showToast('Dashboard Unlocked', 'success');
            runStartup();
        };
        root.lockAppNow = () => {
            if (!state.data.settings.pinCode) return root.promptSetPin();
            locked = true; pin = ''; sessionStorage.setItem('fs_is_locked', 'true');
            root.updatePinDots(); reveal();
        };
        root.unlockApp = () => root.openPinPasswordFallback();
        root.updatePinDots = () => {
            for (let i = 1; i <= 4; i++) {
                const dot = document.getElementById('pin-dot-' + i);
                if (dot) dot.className = 'pin-dot w-4 h-4 rounded-full border-2 transition-all ' + (i <= pin.length ? 'bg-rose-500 border-rose-400' : 'border-slate-600 bg-transparent');
            }
        };
        root.handlePinInput = digit => {
            if (!locked || !/^\d$/.test(digit) || pin.length >= 4 || Date.now() < blockedUntil) return;
            pin += digit; root.updatePinDots();
            if (pin.length === 4) root.verifyPin();
        };
        root.handlePinBackspace = () => { pin = pin.slice(0, -1); root.updatePinDots(); };
        async function pinHash(value, salt) {
            const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']);
            const bytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
            return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
        }
        function legacyHash(value) {
            let hash = 0; for (const c of value) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
            return 'pin_' + Math.abs(hash).toString(36);
        }
        let verifying = false;
        root.verifyPin = async () => {
            if (!locked || verifying || pin.length !== 4) return;
            if (Date.now() < blockedUntil) { root.showToast('Too many attempts. Please wait one minute.', 'error'); return; }
            verifying = true;
            const entered = pin, session = generation, stored = state.data.settings.pinCode;
            try {
                const valid = stored?.version === 2 ? await pinHash(entered, stored.salt) === stored.hash : legacyHash(entered) === stored;
                if (session !== generation) return;
                if (valid) {
                    if (typeof stored === 'string') {
                        const salt = crypto.randomUUID();
                        state.data.settings.pinCode = { version: 2, salt, hash: await pinHash(entered, salt) };
                        await root.updateDb();
                    }
                    unlock();
                } else {
                    attempts++; pin = ''; root.updatePinDots();
                    document.getElementById('pin-error-msg')?.classList.remove('hidden');
                    if (attempts >= 5) { blockedUntil = Date.now() + 60000; attempts = 0; root.showToast('Too many attempts. Please wait one minute.', 'error'); }
                    saveAttempts();
                }
            } catch (error) { root.showToast('Unable to unlock: ' + error.message, 'error'); }
            finally { verifying = false; }
        };
        root.promptSetPin = () => root.showPrompt('Set 4-Digit Quick PIN', 'Enter a new 4-digit PIN:', value => {
            if (!/^\d{4}$/.test(value || '')) return root.showToast('Enter exactly four digits.', 'error');
            root.showPrompt('Confirm PIN', 'Re-enter the PIN:', async confirmation => {
                if (confirmation !== value) return root.showToast('PINs do not match.', 'error');
                try {
                    const salt = crypto.randomUUID();
                    state.data.settings.pinCode = { version: 2, salt, hash: await pinHash(value, salt) };
                    state.data.settings.pinEnabled = true;
                    await root.updateDb(); root.showToast('PIN saved.', 'success');
                } catch (_) { /* updateDb reports failures. */ }
            }, 'password');
        }, 'password');
        root.removePin = async () => {
            if (locked) return;
            if (!confirm('Remove the Quick PIN lock?')) return;
            delete state.data.settings.pinCode; delete state.data.settings.pinEnabled;
            await root.updateDb();
            root.showToast('PIN removed.', 'success');
        };
        function exportBackup() {
            const blob = new Blob([JSON.stringify(F.publicBackup(state.data), null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob), a = document.createElement('a');
            a.href = url; a.download = `FINZ_Backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            root.showToast('Backup exported. Keep this unencrypted financial file private.', 'success');
        }
        root.exportBackup = root.exportLocalBackup = root.exportFullVaultBackup = exportBackup;
        root.restoreVaultFromFile = async file => {
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) return root.showToast('Backup exceeds the supported size.', 'error');
            try {
                const parsed = JSON.parse(await file.text());
                const restored = F.validateBackup(parsed);
                // A backup cannot change this account's credentials or device lock.
                for (const key of ['messagingToken', 'whapiToken', 'pinCode', 'pinEnabled']) {
                    delete restored.settings[key];
                    if (state.data.settings[key] !== undefined) restored.settings[key] = F.clone(state.data.settings[key]);
                }
                if (!confirm(`Restore ${restored.accounts.length} accounts and ${restored.transactions.length} transactions? This replaces your current ledger.`)) return;
                state.data = restored;
                await root.updateDb({ replace: true }); root.renderApp(); root.closeModal();
                root.showToast('Backup restored.', 'success');
            } catch (error) { root.showToast('Restore failed: ' + error.message, 'error'); }
        };
        root.importBackup = input => root.restoreVaultFromFile(input.files?.[0]);
        root.handleBackupFileSelected = async event => {
            await root.restoreVaultFromFile(event.target.files?.[0]); event.target.value = '';
        };
        root.triggerRestoreBackup = root.triggerRestorePicker = () => {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
            input.onchange = () => root.restoreVaultFromFile(input.files?.[0]); input.click();
        };
        root.checkSubscriptions = async () => {
            if (runningSchedules || locked || !loaded) return;
            runningSchedules = true;
            let changed = false;
            try {
                const today = new Date();
                for (const sub of state.data.subscriptions) {
                    const trial = sub.freeTrialEndDate ? new Date(sub.freeTrialEndDate + 'T00:00:00') : null;
                    if (trial && today < trial) continue;
                    let due = new Date(sub.nextDate);
                    if (trial && due < trial) due = trial;
                    let count = 0;
                    while (today >= due && count++ < 120) {
                        const acc = state.data.accounts.find(a => a.id === sub.accountId);
                        const target = state.data.accounts.find(a => a.id === sub.targetAccountId);
                        if (!acc || sub.type === 'transfer' && (!target || target.id === acc.id)) break;
                        const amount = Number(sub.amount);
                        if (!Number.isFinite(amount) || amount <= 0) break;
                        root.recalculateBalances();
                        if (sub.type !== 'income' && acc.balance < amount) break;
                        const occurrence = `sub_${sub.id}_${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}`;
                        if (!state.data.transactions.some(t => t.id === occurrence || t.id === occurrence + '_out')) {
                            const common = { date: due.toISOString(), exchangeRate: state.data.settings.rate, subscriptionId: sub.id };
                            if (sub.type === 'transfer') {
                                const incoming = F.convert(amount, acc.currency, target.currency, state.data.settings.rate);
                                state.data.transactions.push(
                                    { ...common, id: occurrence + '_out', transferGroupId: occurrence, accountId: acc.id, currency: acc.currency, amount, type: 'transfer_out', transferTo: target.id, category: 'Auto-Transfer', note: sub.name },
                                    { ...common, id: occurrence + '_in', transferGroupId: occurrence, accountId: target.id, currency: target.currency, amount: incoming, type: 'transfer_in', transferFrom: acc.id, category: 'Auto-Transfer', note: sub.name }
                                );
                            } else {
                                state.data.transactions.push({ ...common, id: occurrence, accountId: acc.id, currency: acc.currency, amount, type: sub.type, category: sub.category || 'Recurring', note: `Auto-Pay: ${sub.name}` });
                            }
                        }
                        due = F.nextDue(due, sub.billingCycle, sub.day);
                        sub.nextDate = due.toISOString(); changed = true;
                    }
                }
                if (changed) { root.recalculateBalances(); await root.updateDb(); root.renderApp(); }
            } finally { runningSchedules = false; }
        };
        async function runStartup() {
            if (!loaded || locked) return;
            try {
                root.recalculateBalances(); root.renderApp();
                root.checkDueDebts();
                await root.checkSubscriptions();
                await root.checkBudgetRollover();

                root.fetchExchangeRate(); root.fetchMetalsRate();
            } catch (error) { root.showToast('Unable to finish loading: ' + error.message, 'error'); }
        }
        onAuthStateChanged(auth, user => {
            generation++; unsubscribe?.(); unsubscribe = null; loaded = false; locked = false;
            state.user = user; state.data = F.defaults(); baseline = F.defaults();
            document.getElementById('app-content').style.display = 'none';
            document.getElementById('initial-loader').style.display = 'none';
            document.getElementById('auth-screen').style.display = user && !user.isAnonymous ? 'none' : 'flex';
            document.getElementById('pin-lock-screen')?.classList.replace('flex', 'hidden');
            if (!user || user.isAnonymous) return;
            const session = generation;
            let snapshotSequence = 0;
            unsubscribe = onSnapshot(refFor(user.uid), async snap => {
                if (session !== generation || snap.metadata.hasPendingWrites) return;
                if (pending) {
                    await queue;
                    if (session !== generation) return;
                    snap = await getDoc(refFor(user.uid));
                }
                const sequence = ++snapshotSequence;
                try {
                    const first = !loaded;
                    const data = await readLedger(snap, user.uid, getDoc);
                    if (sequence !== snapshotSequence || session !== generation || pending) return;
                    delete data.settings.messagingToken; delete data.settings.whapiToken;
                    state.data = data; baseline = F.clone(data); loaded = true;
                    if (first) {
                        locked = Boolean(data.settings.pinCode);
                        try { ({ attempts = 0, blockedUntil = 0 } = JSON.parse(sessionStorage.getItem(attemptKey()) || '{}')); } catch (_) { attempts = 0; blockedUntil = 0; }
                        if (!snap.exists()) await root.updateDb();
                    }
                    if (data.settings.theme) root.applyTheme(data.settings.theme);
                    reveal();
                    if (first) await runStartup();
                    else if (!locked) { root.recalculateBalances(); root.renderApp(); }
                } catch (error) { root.showToast('Unable to load your ledger: ' + error.message, 'error'); }
            }, error => root.showToast('Unable to load your ledger: ' + error.message, 'error'));
        });
    };
})();
