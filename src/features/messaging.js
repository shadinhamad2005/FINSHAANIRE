export function install({ state, actions, ui: FinzUI }) {
    actions.closeReminder = () => document.getElementById('reminder-overlay')?.classList.add('hidden');
    const phone = value => String(value || '').replace(/[^0-9]/g, '');
    actions.openWhatsAppReminder = async function (name, details, isRaw = false, netValue = 1) {
        const contact = state.data.contacts.find(c => c.name === name);
        if (!contact?.phone) {
            actions.showPrompt(`Phone for ${name}`, 'Enter the mobile number with country code:', async value => {
                if (!/^\d{8,15}$/.test(phone(value))) throw new Error('Enter a valid international mobile number.');
                if (contact) contact.phone = phone(value);
                else state.data.contacts.push({ id: actions.genId(), name, phone: phone(value), relation: 'Friend' });
                await actions.updateDb(); await actions.openWhatsAppReminder(name, details, isRaw, netValue);
            }, 'tel');
            return;
        }
        const template = netValue < 0 ? state.data.settings.tplPayment || 'Hi {name}, I will settle the {amount} I owe you soon.' :
            state.data.settings.tplReminder || 'Hi {name}, a friendly reminder regarding {amount}. Please let me know the status.';
        const body = isRaw ? String(details) : template.replaceAll('{name}', name).replaceAll('{amount}', String(details)).replaceAll('{note}', 'debt').replaceAll('{currency}', '');
        window.open(`https://wa.me/${phone(contact.phone)}?text=${encodeURIComponent(body)}`, '_blank', 'noopener,noreferrer');
    };
    actions.openWhatsApp = (name, amount, currency) => actions.openWhatsAppReminder(name, `${amount} ${currency}`);
    actions.copyReminder = async (party, amount, currency, date, note) => {
        await navigator.clipboard.writeText(`Hi ${party}, a reminder regarding ${amount} ${currency}, due ${date || 'today'}. ${note || ''}`);
        actions.showToast('Draft copied.', 'success');
    };
    actions.shareWhatsAppReminder = name => {
        const open = state.data.debts.filter(d => d.party === name && !d.settled);
        const amount = open.map(d => `${d.amount} ${d.currency}`).join(', ');
        // Use the "I will pay you" template when, overall, the user owes this person.
        const rate = state.data.settings.rate || 22.75;
        const net = open.reduce((sum, d) => sum + (d.type === 'payable' || d.isBnpl ? -1 : 1) * Number(d.amount) * (d.currency === 'INR' ? 1 / rate : 1), 0);
        return actions.openWhatsAppReminder(name, amount, false, net < 0 ? -1 : 1);
    };
    actions.sendReminder = actions.shareWhatsAppReminder;
    // Browsers allow one new window per click, so each person gets their own Send button.
    actions.bulkRemindOverdue = async () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const debts = state.data.debts.filter(d => !d.settled && d.type === 'receivable' && Date.parse(d.repaymentDate) < today.getTime());
        if (!debts.length) return actions.showToast('No overdue amounts owed to you.', 'info');
        const people = new Map();
        for (const d of debts) people.set(d.party, [...(people.get(d.party) || []), `${d.amount} ${d.currency}`]);
        const rows = [...people].map(([name, amounts]) => FinzUI.html`
            <div class="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border mb-2 text-left">
                <div><p class="text-xs font-black text-slate-800">${name}</p><p class="text-[10px] font-bold text-slate-500">${amounts.join(', ')}</p></div>
                <button data-finz-click="${FinzUI.handler(function () { this.textContent = 'Opened'; this.disabled = true; return actions.openWhatsAppReminder(name, amounts.join(', ')); })}" class="px-3 py-2 bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase">WhatsApp</button>
            </div>`).join('');
        actions.showConfirm(`Overdue reminders (${people.size})`, FinzUI.html`<div class="max-h-[50vh] overflow-auto">${rows}</div>`, () => {}, 'Done');
    };
}
