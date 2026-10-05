// Foundation behavior and screens. Dependencies stay inside the application context.
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

actions.Money = class Money {
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
        };
}
