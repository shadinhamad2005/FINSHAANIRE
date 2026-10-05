const { test, before, after } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, deleteDoc, runTransaction } = require('firebase/firestore');
const core = require('../js/finance-core.js');
let env;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-finz', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } }); });
after(async () => { await env?.cleanup(); });
const path = uid => `artifacts/finshaanire-v2/users/${uid}/finance/main`;
test('owner can write and read their valid ledger', async () => {
    const db = env.authenticatedContext('alice').firestore(); await assertSucceeds(setDoc(doc(db, path('alice')), core.defaults())); await assertSucceeds(getDoc(doc(db, path('alice'))));
});
test('other users cannot read, overwrite or delete another ledger', async () => {
    const db = env.authenticatedContext('bob').firestore(); await assertFails(getDoc(doc(db, path('alice')))); await assertFails(setDoc(doc(db, path('alice')), core.defaults())); await assertFails(deleteDoc(doc(db, path('alice'))));
});
test('anonymous clients cannot read or write finance records', async () => {
    const db = env.unauthenticatedContext().firestore(); await assertFails(getDoc(doc(db, path('alice')))); await assertFails(setDoc(doc(db, path('alice')), core.defaults()));
});
test('malformed ledger settings and browser-held messaging secrets are rejected', async () => {
    const db = env.authenticatedContext('alice').firestore(); const bad = core.defaults(); bad.settings.rate = -1;
    await assertFails(setDoc(doc(db, path('alice')), bad)); bad.settings.rate = 22.75; bad.settings.messagingToken = 'secret'; await assertFails(setDoc(doc(db, path('alice')), bad));
});
test('storage segments are accessible only to their owner', async () => {
    const segment = path('alice').replace(/main$/, 'main_chunk_abcd-1234_0');
    const alice = env.authenticatedContext('alice').firestore(), bob = env.authenticatedContext('bob').firestore();
    await assertSucceeds(setDoc(doc(alice, segment), { json: '{"accounts":[]}' }));
    await assertFails(getDoc(doc(bob, segment))); await assertFails(setDoc(doc(bob, segment), { json: '{}' })); await assertSucceeds(deleteDoc(doc(alice, segment)));
});
test('private messaging records and unknown applications deny browser access', async () => {
    const db = env.authenticatedContext('alice').firestore(); await assertFails(getDoc(doc(db, 'serverMessaging/alice/requests/test')));
    await assertFails(setDoc(doc(db, path('alice').replace('finshaanire-v2', 'other-app')), core.defaults()));
});
test('real concurrent transactions preserve both independent additions', async () => {
    const db = env.authenticatedContext('writer').firestore(), ref = doc(db, path('writer'));
    const baseline = core.defaults();
    await setDoc(ref, baseline);
    async function save(id) {
        const local = core.clone(baseline); local.transactions.push({ id, accountId: 'bank', amount: 10, type: 'income', date: '2026-09-21' });
        await runTransaction(db, async tx => {
            const snapshot = await tx.get(ref);
            await new Promise(resolve => setTimeout(resolve, 25));
            tx.set(ref, core.merge(baseline, local, snapshot.data()));
        });
    }
    await Promise.all([save('one'), save('two')]);
    require('node:assert/strict').deepEqual((await getDoc(ref)).data().transactions.map(t => t.id).sort(), ['one', 'two']);
});
