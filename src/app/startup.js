export function start(ctx) {
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

window.addEventListener('error', e => reportAppError(e.message));

window.addEventListener('unhandledrejection', e => reportAppError(e.reason?.message || e.reason));

setTimeout(function() {
            var loader = document.getElementById('initial-loader');
            var auth = document.getElementById('auth-screen');
            var app = document.getElementById('app-content');
            if (loader && loader.style.display !== 'none' && (!app || app.style.display !== 'flex')) {
                loader.style.display = 'none';
                if (auth) auth.style.display = 'flex';
            }
        }, 3500);

(function () {
            try {
                const saved = localStorage.getItem('fs_theme');
                if (saved) actions.applyTheme(saved);
            } catch(e) { console.warn('LocalStorage unavailable', e); }
        })();



state.data.envelopeLedger = state.data.envelopeLedger || [];

window.addEventListener('keydown', (e) => {
    const pinScreen = document.getElementById('pin-lock-screen');
    if (pinScreen && !pinScreen.classList.contains('hidden')) {
        if (e.key >= '0' && e.key <= '9') {
            actions.handlePinInput(e.key);
        } else if (e.key === 'Backspace') {
            actions.handlePinBackspace();
        } else if (e.key === 'Escape') {
            actions.openPinPasswordFallback();
        }
    }
});
FinzUI.register("static_0", function(event) { actions.handlePinInput('1') });
FinzUI.register("static_1", function(event) { actions.handlePinInput('2') });
FinzUI.register("static_2", function(event) { actions.handlePinInput('3') });
FinzUI.register("static_3", function(event) { actions.handlePinInput('4') });
FinzUI.register("static_4", function(event) { actions.handlePinInput('5') });
FinzUI.register("static_5", function(event) { actions.handlePinInput('6') });
FinzUI.register("static_6", function(event) { actions.handlePinInput('7') });
FinzUI.register("static_7", function(event) { actions.handlePinInput('8') });
FinzUI.register("static_8", function(event) { actions.handlePinInput('9') });
FinzUI.register("static_9", function(event) { actions.openPinPasswordFallback() });
FinzUI.register("static_10", function(event) { actions.handlePinInput('0') });
FinzUI.register("static_11", function(event) { actions.handlePinBackspace() });
FinzUI.register("static_12", function(event) { actions.openPinPasswordFallback() });
FinzUI.register("static_13", function(event) { actions.handleLogin() });
FinzUI.register("static_14", function(event) { actions.handleRegister() });
FinzUI.register("static_15", function(event) { document.getElementById('confirm-modal').classList.replace('flex', 'hidden') });
FinzUI.register("static_16", function(event) { if (document.getElementById('prompt-modal').dataset.busy === 'true') return; document.getElementById('prompt-modal').classList.replace('flex', 'hidden') });
FinzUI.register("static_17", function(event) { actions.lockAppNow() });
FinzUI.register("static_18", function(event) { actions.openModal('auth') });
FinzUI.register("static_19", function(event) { actions.openModal('budget') });
FinzUI.register("static_20", function(event) { actions.openModal('goals') });
FinzUI.register("static_21", function(event) { actions.openModal('analytics') });
FinzUI.register("static_22", function(event) { actions.toggleVisibility() });
FinzUI.register("static_23", function(event) { actions.openModal('settings') });
FinzUI.register("static_24", function(event) { actions.openModal('guilt_free') });
FinzUI.register("static_25", function(event) { actions.openModal('streak_details') });
FinzUI.register("static_26", function(event) { actions.openMilestoneModal() });
FinzUI.register("static_27", function(event) { actions.openModal('transaction') });
FinzUI.register("static_28", function(event) { actions.openModal('transfer') });
FinzUI.register("static_29", function(event) { actions.openModal('accounts') });
FinzUI.register("static_30", function(event) { actions.openModal('debt') });
FinzUI.register("static_31", function(event) { actions.openModal('subscriptions') });
FinzUI.register("static_32", function(event) { actions.openModal('salary') });
FinzUI.register("static_33", function(event) { actions.openModal('goals') });
FinzUI.register("static_34", function(event) { actions.openMasterLedger() });
FinzUI.register("static_35", function(event) { window.scrollTo(0,0) });
FinzUI.register("static_36", function(event) { actions.openMasterLedger() });
FinzUI.register("static_37", function(event) { actions.openSmartInput() });
FinzUI.register("static_38", function(event) { actions.openModal('budget') });
FinzUI.register("static_39", function(event) { actions.openModal('settings') });
FinzUI.register("static_40", function(event) { document.getElementById('smart-input-modal').classList.replace('flex', 'hidden') });
FinzUI.register("static_41", function(event) { if(event.key === 'Enter') actions.processSmartInput() });
FinzUI.register("static_42", function(event) { actions.processSmartInput() });
FinzUI.register("static_43", function(event) { document.getElementById('smart-input-modal').classList.replace('flex', 'hidden'); actions.openModal('transaction') });
FinzUI.register("static_44", function(event) { document.getElementById('contact-modal').classList.replace('flex', 'hidden') });
FinzUI.register("static_45", function(event) { actions.saveNewContact() });
FinzUI.register("static_46", function(event) { actions.closeModal() });
FinzUI.register("static_47", function(event) { actions.closeModal() });
FinzUI.bind(document);
}
