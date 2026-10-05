export function install({ state, actions }) {
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
        const amount = state.data.debts.filter(d => d.party === name && !d.settled).map(d => `${d.amount} ${d.currency}`).join(', ');
        return actions.openWhatsAppReminder(name, amount);
    };
    actions.sendReminder = actions.shareWhatsAppReminder;
    actions.bulkRemindOverdue = async () => {
        const debts = state.data.debts.filter(d => !d.settled && d.type === 'receivable' && Date.parse(d.repaymentDate) < Date.now());
        if (!confirm(`Send reminders for ${debts.length} overdue balances?`)) return;
        for (const debt of debts) await actions.openWhatsAppReminder(debt.party, `${debt.amount} ${debt.currency}`);
        actions.showToast('Reminders processed.', 'success');
    };
}
