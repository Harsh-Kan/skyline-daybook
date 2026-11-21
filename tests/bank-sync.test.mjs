// Run: node tests/bank-sync.test.mjs
// DOM dependency: npm install --prefix node_modules/.bank-test-tools --no-save --package-lock=false jsdom
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from '../node_modules/.bank-test-tools/node_modules/jsdom/lib/api.js';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'MouseEvent'])
  globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// JSDOM does not implement the browser's native dialog lifecycle.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const companyId = 'company-a';
const userId = 'authenticated-user';
const bankId = '10000000-0000-4000-8000-000000000001';
const cashId = '10000000-0000-4000-8000-000000000002';
const txs = [
  { id: 'old-tx', accountId: 'bank1', paymentIn: 50, paymentOut: 0, date: '2026-01-01', particulars: 'Historical', type: 'Non-GST', createdAt: 1 },
  { id: 'old-tx-2', accountId: 'bank2', paymentIn: 9000, paymentOut: 0, date: '2026-01-01', particulars: 'Dummy Bank Two', type: 'Non-GST', createdAt: 1 },
  { id: 'uuid-tx', accountId: bankId, paymentIn: 150, paymentOut: 0, date: '2026-01-02', particulars: 'Current', type: 'Non-GST', createdAt: 2 }
];
const serverTransaction = tx => ({
  id: tx.id, company_id: companyId, bank_id: tx.accountId, transaction_date: tx.date ?? '2026-01-01',
  particulars: tx.particulars ?? 'Server entry', transaction_type: tx.type ?? 'Non-GST',
  payment_in: tx.paymentIn ?? 0, payment_out: tx.paymentOut ?? 0,
  created_at: new Date(tx.createdAt ?? 1).toISOString(), created_by: userId, user_id: userId
});
const initialServerTransactions = [serverTransaction(txs[2])];
localStorage.setItem('skyline_transactions', JSON.stringify(txs));
localStorage.setItem('skyline_user', JSON.stringify({ id: 'stale-user', isAdmin: true }));
localStorage.setItem('skyline_bank_configs', JSON.stringify([{ id: 'fake-bank', name: 'Local Demo Bank' }]));
const db = {
  profiles: [{ id: userId, company_id: companyId }],
  companies: [{ id: companyId, company_name: 'Test Company', plan_name: 'Startup', max_banks: 999, max_users: 999, trial_start_date: new Date().toISOString(), trial_end_date: new Date(Date.now() + 14 * 86400000).toISOString() }],
  company_users: [{ company_id: companyId, user_id: userId, role: 'admin' }],
  banks: [
    { id: cashId, company_id: companyId, user_id: userId, name: 'Cash Account', position: 2 },
    { id: bankId, company_id: companyId, user_id: userId, name: 'Bank Account 1', position: 1 },
    { id: 'other-company-bank', company_id: 'company-b', name: 'Other Company Bank', position: 1 }
  ], transactions: structuredClone(initialServerTransactions)
};
let session = null;
let authCallback;
let releaseBanks;
let bankGate = new Promise(resolve => { releaseBanks = resolve; });
let failUpdate = false;
let failLoad = false;
let failInsert = false;
let failPlan = false;
let sessionRestores = 0;
let verifiedUserOverride;
let generatedIds = 0;
let deleteRpcError = null;
let failTransactionAction = null;
let failIndex = false;
let failOnboarding = false;
let failRename = false;
const resetRequests = [];
const passwordUpdates = [];
const calls = [];
const client = {
  async rpc(name, args) {
    if (name === 'create_trial_company') {
      calls.push({ action: 'rpc', name, args });
      if (failOnboarding) return { data: null, error: { code: 'PGRST202' } };
      const profile = db.profiles.find(profile => profile.id === session.user.id);
      const id = 'new-trial-company';
      const start = Date.now();
      db.companies.push({ id, company_name: args.p_company_name, plan_name: 'Trial',
        trial_start_date: new Date(start).toISOString(), trial_end_date: new Date(start + 14 * 86400000).toISOString() });
      db.company_users.push({ company_id: id, user_id: profile.id, role: 'admin' });
      profile.company_id = id;
      db.banks.push(...['Bank Account 1', 'Cash Account'].map((name, index) => ({
        id: `new-company-bank-${index}`, company_id: id, user_id: profile.id, name, position: index + 1
      })));
      return { data: id, error: null };
    }
    if (name === 'rename_company') {
      calls.push({ action: 'rpc', name, args });
      if (failRename === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } };
      if (failRename) return { data: null, error: { message: 'Rename denied' } };
      const company = db.companies.find(company => company.id === args.p_company_id);
      company.company_name = args.p_company_name;
      return { data: company.company_name, error: null };
    }
    if (name === 'platform_company_index') {
      if (![...db.profiles.filter(profile => profile.id === userId), ...db.company_users.filter(member => member.user_id === userId)]
        .some(row => typeof row.role === 'string' && row.role.trim().toUpperCase().replace(/[\s-]+/g, '_') === 'SUPER_ADMIN'))
        return { data: null, error: { message: 'SUPER_ADMIN access required' } };
      if (failIndex) return { data: null, error: { message: 'Company index unavailable' } };
      calls.push({ action: 'rpc', name, args });
      return { data: db.companies.slice(args.p_offset, args.p_offset + args.p_limit).map(company => ({
        ...company,
        banks_used: db.banks.filter(bank => bank.company_id === company.id && bank.name !== 'Cash Account').length,
        users_used: new Set(db.company_users.filter(member => member.company_id === company.id).map(member => member.user_id)).size
      })), error: null };
    }
    assert.equal(name, 'delete_bank_if_unused');
    calls.push({ table: 'banks', action: 'rpc', name, args });
    if (deleteRpcError) return { data: null, error: deleteRpcError };
    const bank = db.banks.find(bank => bank.id === args.p_bank_id && bank.company_id === args.p_company_id);
    if (!bank) return { data: null, error: { message: 'Bank not found in your company' } };
    if (bank.name === 'Cash Account') return { data: null, error: { message: 'Cash Account cannot be deleted' } };
    if (db.transactions.some(transaction => transaction.bank_id === bank.id))
      return { data: null, error: { message: 'This bank has transactions and cannot be deleted' } };
    db.banks.splice(db.banks.indexOf(bank), 1);
    return { data: bank.id, error: null };
  },
  auth: {
    getSession: async () => { sessionRestores++; return { data: { session }, error: null }; },
    getUser: async () => ({ data: { user: verifiedUserOverride ?? session?.user }, error: null }),
    async signInWithPassword({ email }) {
      session = { user: { id: userId, email } };
      authCallback('SIGNED_IN', session);
      return { data: session, error: null };
    },
    async resetPasswordForEmail(email, options) {
      resetRequests.push({ email, redirectTo: options.redirectTo });
      return { data: {}, error: null };
    },
    async updateUser({ password }) {
      passwordUpdates.push(password);
      authCallback('USER_UPDATED', session);
      return { data: { user: session.user }, error: null };
    },
    onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { session = null; authCallback('SIGNED_OUT', null); return { error: null }; }
  },
  from(table) {
    let action = 'select', payload, single = false, columns, range;
    const filters = [], orders = [];
    const query = {
      select(selectedColumns) { columns = selectedColumns; return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      order(key) { orders.push(key); return query; },
      range(start, end) { range = [start, end]; return query; },
      single() { single = true; return query; },
      insert(value) { action = 'insert'; payload = value; return query; },
      update(value) { action = 'update'; payload = value; return query; },
      delete() { assert.equal(table, 'transactions', 'Banks must use their safe RPC'); action = 'delete'; return query; },
      then(resolve, reject) {
        return (async () => {
          calls.push({ table, action, payload, filters, orders, columns });
          if (table === 'transactions' && action === failTransactionAction)
            return { data: null, error: { message: `Transaction ${action} denied` } };
          if (failPlan && table === 'companies' && columns?.includes('trial_end_date'))
            return { data: null, error: { message: 'Plan read denied' } };
          if (table === 'banks') {
            await bankGate;
            if (failLoad && action === 'select') return { data: null, error: { message: 'Bank SELECT denied' } };
          }
          if (failUpdate && action === 'update') return { data: null, error: { message: 'RLS update denied' } };
          if (failInsert && action === 'insert') return { data: null, error: { message: 'RLS insert denied' } };
          let rows = db[table].filter(row => filters.every(([key, value]) => row[key] === value));
          if (action === 'insert') {
            const row = { ...payload, created_at: new Date().toISOString(), id: '20000000-0000-4000-8000-' + String(++generatedIds).padStart(12, '0') };
            db[table].push(row); rows = [row];
          }
          if (action === 'update') rows.forEach(row => Object.assign(row, payload));
          if (action === 'delete') for (const row of rows) db[table].splice(db[table].indexOf(row), 1);
          rows = [...rows].sort((a, b) => {
            for (const key of orders) { if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1; }
            return 0;
          });
          if (range) rows = rows.slice(range[0], range[1] + 1);
          if (single && rows.length !== 1) return { data: null, error: { message: 'Expected exactly one visible row' } };
          return { data: structuredClone(single ? rows[0] : rows), error: null };
        })().then(resolve, reject);
      }
    };
    return query;
  }
};
globalThis.__bankTestClient = client;
await build({
  entryPoints: ['App.tsx', 'bankAccounts.ts', 'subscriptions.ts', 'transactions.ts', 'platform.ts'], outdir: 'node_modules/.bank-test-bundle',
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external',
  plugins: [{ name: 'test-supabase', setup(builder) {
    builder.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: 'mock', namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const supabase = globalThis.__bankTestClient;' }));
  } }]
});
const { default: App } = await import('../node_modules/.bank-test-bundle/App.js');
const { bankAccounts, isCashAccount } = await import('../node_modules/.bank-test-bundle/bankAccounts.js');
let root = createRoot(document.getElementById('root'));
const renderApp = () => root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
const text = () => document.body.textContent;
const button = label => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label);
async function click(label) {
  const target = button(label); assert.ok(target, `Missing button: ${label}`);
  assert.equal(target.disabled, false, `Button disabled: ${label}`);
  await act(async () => { target.click(); });
}
async function input(target, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const reactErrors = [];
const originalError = console.error;
console.error = (...args) => { reactErrors.push(args.join(' ')); originalError(...args); };
try {
  await act(async () => { renderApp(); });
  const accountOptions = document.querySelector('[aria-label="Account access"]');
  assert.deepEqual([...accountOptions.querySelectorAll('button')].map(option => option.textContent.trim()), ['Login', 'Sign Up']);
  assert.ok(!text().includes('Account Breakdown'), 'Cached user must not bypass Supabase authentication');
  await input(document.querySelector('#auth-email'), 'member@example.com');
  await click('Sign Up');
  assert.equal(document.querySelector('#auth-password').autocomplete, 'new-password');
  assert.ok(!button('Forgot password?'));
  await click('Login');
  await click('Forgot password?');
  assert.equal(document.querySelector('#auth-email').value, 'member@example.com');
  assert.equal(document.querySelector('#auth-password'), null, 'Requesting a reset link only requires an email');
  assert.equal(document.activeElement.id, 'auth-email');
  await click('Send reset link');
  assert.deepEqual(resetRequests, [{ email: 'member@example.com', redirectTo: 'http://localhost/?reset-password=1' }]);
  assert.match(document.querySelector('[role="status"]').textContent, /password reset link/);
  await click('Back to login');
  assert.equal(document.querySelector('#auth-email').value, 'member@example.com');
  assert.ok(!document.querySelector('[role="status"]'));
  await input(document.querySelector('input[type="password"]'), 'test-password');
  await act(async () => { document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.ok(text().includes('Loading your company and bank accounts'));
  assert.ok(!text().includes('No bank accounts'), 'Never show empty accounts during loading');
  await act(async () => { releaseBanks(); });
  assert.ok(text().includes('Account Breakdown'));
  assert.ok(text().includes('Plan: Startup'), 'The header shows the active company plan from Supabase');
  const callsBeforePlanRefresh = calls.length;
  db.companies[0].plan_name = 'Business';
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  assert.ok(text().includes('Plan: Business'), 'An open session must refresh the actual company plan');
  assert.ok(calls.slice(callsBeforePlanRefresh).every(call => call.action === 'select' && (
    call.table === 'companies' ? call.filters.some(([key, value]) => key === 'id' && value === companyId)
      : call.table === 'transactions' && call.filters.some(([key, value]) => key === 'company_id' && value === companyId)
  )), 'Focus refresh reads only the active company plan and transactions');
  failPlan = true;
  await act(async () => { document.querySelector('[aria-label="Refresh company plan"]').click(); });
  assert.ok(text().includes('Plan: Could not load'));
  assert.equal(document.querySelector('[role="alert"]').title, 'Plan read denied');
  failPlan = false;
  db.companies[0].plan_name = 'Trial';
  await act(async () => { document.querySelector('[aria-label="Refresh company plan"]').click(); });
  assert.ok(text().includes('Plan: Trial'), 'A retry must replace the error with the database plan');
  db.companies[0].plan_name = 'Startup';
  await act(async () => { document.querySelector('[aria-label="Refresh company plan"]').click(); });
  assert.ok(text().includes('Bank Account 1') && text().includes('Cash Account'));
  assert.ok(!text().includes('Other Company Bank'));
  assert.ok(!text().includes('Historical account bank1'));
  assert.ok(!text().includes('Historical account bank2'));
  assert.ok(!text().includes('Local Demo Bank'));
  assert.ok(!text().includes('200.00') && !text().includes('9,000.00'), 'Dummy balances must not enter summaries');
  assert.ok(text().includes('150.00'));
  assert.ok(calls.some(call => call.table === 'banks' && call.filters.some(([key, value]) => key === 'company_id' && value === companyId)));
  await click('Account Settings');
  assert.ok(text().includes('Users allowed: 2') && text().includes('1 / 2 users'));
  assert.ok(!text().includes('Max Registrations'), 'Local registration settings must not override company plan limits');
  let inputs = [...document.querySelectorAll('form[aria-label="Bank account configuration"] input[type="text"]')];
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].value, 'Cash Account', 'Cash stays first even when its database position is after a bank');
  assert.equal(inputs.find(item => item.value === 'Cash Account').disabled, true);
  const deleteWarning = 'Cannot delete: this bank has transactions, even if its balance is zero.';
  assert.ok(!text().includes(deleteWarning), 'Deletion warning stays hidden before clicking');
  assert.ok(!text().includes('Pending name or order changes') && !text().includes('Use the pencil') && !text().includes('Cash Account is included by default'));
  const protectedBin = document.querySelector('[aria-label="Delete Bank Account 1"]');
  assert.equal(protectedBin.disabled, false, 'Protected banks allow clicking to explain the restriction');
  const beforeProtectedClick = calls.filter(call => call.action === 'rpc').length;
  await act(async () => { protectedBin.click(); });
  assert.equal(document.querySelector('[role="alert"]').textContent, deleteWarning);
  assert.equal(document.querySelector('[role="alert"]').parentElement.querySelector('input').value, 'Bank Account 1', 'Warning belongs inside the clicked bank card');
  assert.ok(!document.querySelector('[role="dialog"]'));
  assert.equal(calls.filter(call => call.action === 'rpc').length, beforeProtectedClick, 'Protected banks must not send a delete request');
  assert.ok(!document.querySelector('[aria-label="Delete Cash Account"]'), 'Cash must never have a delete control');
  assert.ok(![...document.querySelectorAll('button')].some(item => /delete|remove bank/i.test(item.textContent)));
  await input(inputs.find(item => item.value === 'Bank Account 1'), 'Operating Bank');
  failUpdate = true;
  await act(async () => { document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.ok(text().includes('RLS update denied'));
  assert.ok(!text().includes('Bank accounts saved.'));
  failUpdate = false;
  await input(document.querySelector('form[aria-label="Bank account configuration"] input[type="text"]:not(:disabled)'), 'Operating Bank');
  await act(async () => { document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.ok(text().includes('Bank accounts saved.'));
  assert.equal(db.banks.find(bank => bank.id === bankId).name, 'Operating Bank');
  await input(document.querySelector('form[aria-label="Bank account configuration"] input[type="text"]:not(:disabled)'), 'Operating Bank ');
  assert.equal(button('Add New Bank').disabled, false, 'Pending edits must not silently disable Add Bank');
  assert.equal(button('Add New Bank').title, 'Save pending changes and add a bank');
  failInsert = true;
  await click('Add New Bank');
  assert.ok(text().includes('RLS insert denied'));
  assert.equal(document.querySelectorAll('form[aria-label="Bank account configuration"] input[type="text"]').length, 2, 'A failed insert must not create a phantom account');
  failInsert = false;
  await click('Add New Bank');
  assert.equal(db.banks.filter(bank => bank.company_id === companyId).length, 3);
  assert.equal(document.querySelectorAll('form[aria-label="Bank account configuration"] input[type="text"]').length, 3, 'Settings receives returned UUID records');
  const inserted = db.banks.find(bank => bank.name === 'Bank Account 2');
  assert.ok(inserted.id.startsWith('20000000-'));
  assert.equal(inserted.position, 3);
  assert.equal(button('Add New Bank').disabled, true, 'Cash must not consume the two-bank subscription');
  assert.ok(button('Add New Bank').title.includes('Your subscription allows 2 bank accounts'));
  await click('Dashboard');
  assert.ok(text().includes('Operating Bank') && text().includes('Bank Account 2'));
  await click('Consolidated Ledger');
  assert.equal(document.querySelector('main h2').textContent, 'Consolidated Ledger');
  await click('Daybook');
  const bankDropdown = () => document.querySelector('select[aria-label="Bank account"]');
  assert.equal(bankDropdown().value, cashId, 'Sidebar Daybook defaults to Cash after Consolidated Ledger');
  assert.equal(bankDropdown().options[0].value, cashId, 'Cash is first in the Daybook dropdown');
  assert.equal(document.querySelector('main h2').textContent, 'Cash Account');
  await act(async () => { bankDropdown().value = bankId; bankDropdown().dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(document.querySelector('main h2').textContent, 'Operating Bank');
  assert.ok(text().includes('Current'), 'Daybook shows the selected bank transactions');
  await act(async () => { bankDropdown().value = inserted.id; bankDropdown().dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(document.querySelector('main h2').textContent, 'Bank Account 2');
  assert.ok(!text().includes('Current'), 'Selecting another bank filters its transactions');
  await click('Dashboard');
  const selectedCard = [...document.querySelectorAll('h3')].find(heading => heading.textContent === 'Bank Account 2').closest('div.cursor-pointer');
  await act(async () => { selectedCard.click(); });
  assert.equal(bankDropdown().value, inserted.id, 'A dashboard card opens its own bank');
  await click('Daybook');
  assert.equal(bankDropdown().value, cashId, 'Independent Daybook navigation resets to Cash');
  await click('New Transaction');
  assert.ok([...bankDropdown().options].some(option => option.value === inserted.id && option.textContent === 'Bank Account 2'), 'The bank dropdown includes every company bank');
  assert.ok(!text().includes('Dummy Bank Two') && !text().includes('Historical account bank1'));
  // Simulate a browser refresh by discarding the entire React tree. Only the
  // Supabase mock retains the inserted record; no bank cache is used.
  const previousRestores = sessionRestores;
  await act(async () => { root.unmount(); });
  root = createRoot(document.getElementById('root'));
  await act(async () => { renderApp(); });
  assert.ok(sessionRestores > previousRestores);
  assert.ok(text().includes('Account Breakdown') && text().includes('Bank Account 2'));
  await click('Account Settings');
  assert.ok([...document.querySelectorAll('form[aria-label="Bank account configuration"] input[type="text"]')].some(input => input.value === 'Bank Account 2'));
  await click('Logout');
  assert.ok(button('Login'));
  await input(document.querySelector('#auth-email'), 'member@example.com');
  await input(document.querySelector('input[type="password"]'), 'test-password');
  await act(async () => { document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.ok(text().includes('Account Breakdown') && text().includes('Bank Account 2'));
  await click('Account Settings');
  const toggle = [...document.querySelectorAll('button')].find(item => item.parentElement.textContent.includes('Enable Repositioning'));
  await act(async () => { toggle.click(); });
  const cashCard = document.querySelector('form[aria-label="Bank account configuration"] input[type="text"]').closest('div.group');
  assert.equal(cashCard.querySelector('button'), null, 'Cash cannot be repositioned');
  assert.equal(document.querySelector('form button:has(svg.lucide-arrow-up)').disabled, true, 'Banks cannot move above Cash');
  const down = document.querySelector('form button:has(svg.lucide-arrow-down)');
  await act(async () => { down.click(); });
  assert.deepEqual([...document.querySelectorAll('form[aria-label="Bank account configuration"] input[type="text"]')].map(input => input.value), ['Cash Account', 'Bank Account 2', 'Operating Bank']);
  const up = [...document.querySelectorAll('form button:has(svg.lucide-arrow-up)')].at(-1);
  await act(async () => { up.click(); });
  await act(async () => { document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(db.banks.find(bank => bank.id === cashId).position, 1);
  assert.equal(db.banks.find(bank => bank.id === bankId).position, 2);
  const service = bankAccounts(client);
  const { getSubscription, PLAN_LIMITS } = await import('../node_modules/.bank-test-bundle/subscriptions.js');
  assert.deepEqual(PLAN_LIMITS, { Startup: { banks: 2, users: 2 }, Growth: { banks: 5, users: 5 }, Business: { banks: Infinity, users: 10 } });
  const fixedStart = '2026-11-01T00:00:00Z';
  const trial = getSubscription({ plan_name: 'Trial', max_banks: 999, max_users: 999, trial_start_date: fixedStart }, Date.parse(fixedStart));
  assert.equal(trial.bankLimit, 1); assert.equal(trial.userLimit, 1);
  assert.equal(trial.trialDaysRemaining, 14);
  assert.equal(trial.trialEndsAt, '2026-11-15T00:00:00.000Z');
  assert.equal(getSubscription({ plan_name: 'Trial', trial_start_date: fixedStart }, Date.parse(trial.trialEndsAt)).trialExpired, true);
  assert.throws(() => getSubscription({ plan_name: 'Trial' }), /end date/);
  assert.throws(() => getSubscription({ plan_name: 'Unknown' }), /not configured/);
  const companySnapshot = structuredClone(db.companies[0]);
  db.companies[0].plan_name = 'Trial';
  await act(async () => { document.querySelector('[aria-label="Refresh company plan"]').click(); });
  assert.ok(text().includes('Users allowed: 1') && text().includes('1 / 1 users'));
  assert.equal(button('Add New Bank').disabled, true, 'Existing accounts above a new plan limit are retained but additions are blocked');
  db.companies[0].plan_name = 'Business';
  await act(async () => { document.querySelector('[aria-label="Refresh company plan"]').click(); });
  assert.ok(text().includes('Bank accounts: Unlimited') && text().includes('Users allowed: 10'));
  assert.equal(button('Add New Bank').disabled, false);
  Object.assign(db.companies[0], companySnapshot);
  await act(async () => { document.querySelector('[aria-label="Refresh company plan"]').click(); });
  db.companies[0].plan_name = 'Growth';
  const growthBank = await service.add(companyId, userId);
  assert.ok(growthBank.id);
  db.banks.splice(db.banks.findIndex(bank => bank.id === growthBank.id), 1);
  db.companies[0].plan_name = 'Business'; db.companies[0].max_banks = 1;
  const businessBank = await service.add(companyId, userId);
  assert.ok(businessBank.id, 'Business is unlimited even if a legacy numeric limit is present');
  db.banks.splice(db.banks.findIndex(bank => bank.id === businessBank.id), 1);
  db.companies[0].plan_name = 'Trial'; db.companies[0].trial_end_date = '2000-01-01T00:00:00Z';
  await assert.rejects(service.add(companyId, userId), /Trial has ended/);
  Object.assign(db.companies[0], companySnapshot);
  const records = await service.load(companyId);
  await service.save(companyId, [...records.filter(bank => bank.id !== cashId), records.find(bank => bank.id === cashId)]);
  assert.equal(db.banks.find(bank => bank.id === cashId).position, 1, 'Saving always pins Cash first');
  await assert.rejects(service.save(companyId, records.filter(bank => bank.id !== cashId)), /Accounts changed/);
  await assert.rejects(service.save(companyId, records.filter(bank => bank.id !== bankId)), /Accounts changed/);
  await assert.rejects(service.save(companyId, records.map(bank => bank.id === cashId ? { ...bank, name: 'Renamed cash' } : bank)), /cannot be renamed/);
  await assert.rejects(service.add(companyId, userId), /limit has been reached/);
  await assert.rejects(service.add(companyId, userId, true), /already exists/);
  await assert.rejects(service.add(companyId, 'stale-user'), /session changed/);
  const originalCompany = db.profiles[0].company_id;
  db.profiles[0].company_id = 'wrong-company';
  await assert.rejects(service.add(companyId, userId), /does not match/);
  db.profiles[0].company_id = originalCompany;
  db.company_users[0].role = 'executive';
  await assert.rejects(service.save(companyId, records), /Only a company administrator/);
  db.company_users[0].role = 'admin';
  const originalCash = db.banks.find(bank => bank.id === cashId);
  db.banks.splice(db.banks.indexOf(originalCash), 1);
  failInsert = true;
  await act(async () => { root.unmount(); });
  root = createRoot(document.getElementById('root'));
  await act(async () => { renderApp(); });
  assert.ok(text().includes('The default Cash Account could not be initialized: RLS insert denied'));
  failInsert = false;
  await click('Retry');
  await click('Account Settings');
  assert.equal(button('Add New Bank').disabled, true);
  assert.ok(!button('Add free Cash Account'), 'Cash is a default account, not a manual addition');
  const freeCash = db.banks.find(bank => bank.company_id === companyId && bank.name === 'Cash Account');
  assert.ok(freeCash);
  assert.ok([...document.querySelectorAll('form[aria-label="Bank account configuration"] input[type="text"]')].some(input => input.value === 'Cash Account' && input.disabled));
  assert.ok(!text().includes('Cash Account is included by default'));
  await click('Dashboard');
  assert.ok(text().includes('Cash Account'), 'The Cash account must appear immediately in Dashboard');
  assert.equal(isCashAccount(freeCash), true, 'Cash can be created even when the paid bank limit is full');
  assert.ok(freeCash.id && freeCash.id !== 'cash', 'Cash must also use a returned database UUID');
  const cashInserts = calls.filter(call => call.action === 'insert' && call.payload?.name === 'Cash Account').length;
  await act(async () => { root.unmount(); });
  root = createRoot(document.getElementById('root'));
  await act(async () => { renderApp(); });
  assert.ok(text().includes('Cash Account'));
  assert.equal(calls.filter(call => call.action === 'insert' && call.payload?.name === 'Cash Account').length, cashInserts, 'Refreshing must reuse the default Cash UUID');
  db.banks.splice(db.banks.findIndex(bank => bank.id === freeCash.id), 1);
  db.banks.push(originalCash);
  await assert.rejects(service.remove(companyId, cashId), /Cash Account cannot be deleted/);
  await assert.rejects(service.remove('other-company', inserted.id), error => /Expected exactly one visible row|does not match/.test(error.message));
  await click('Account Settings');
  const requestDelete = async () => {
    const bin = document.querySelector('[aria-label="Delete Bank Account 2"]');
    assert.ok(bin && !bin.disabled);
    await act(async () => { bin.click(); });
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.equal(document.querySelector('[role="dialog"]').tagName, 'DIALOG');
    assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-modal'), 'true');
    assert.equal(document.querySelector('[role="dialog"]').open, true);
    assert.equal(document.body.style.overflow, 'hidden');
  };
  const rpcCalls = () => calls.filter(call => call.action === 'rpc').length;
  const beforeCancel = rpcCalls();
  await requestDelete(); await click('Cancel');
  assert.ok(!document.querySelector('[role="dialog"]'));
  assert.equal(document.body.style.overflow, '');
  assert.equal(rpcCalls(), beforeCancel, 'Cancel must not send a delete request');
  await requestDelete();
  await act(async () => { document.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true })); });
  assert.ok(!document.querySelector('dialog'), 'Escape closes confirmation without deleting');
  assert.equal(rpcCalls(), beforeCancel);
  // A server-only transaction is invisible to the frontend, but must block deletion.
  const hiddenTransaction = serverTransaction({ id: 'server-only', accountId: inserted.id, paymentIn: 1 });
  db.transactions.push(hiddenTransaction);
  await requestDelete(); await click('Confirm delete');
  assert.ok(text().includes(deleteWarning));
  assert.equal(document.querySelector('[role="alert"]').parentElement.querySelector('input').value, 'Bank Account 2', 'Server transaction warning belongs inside its bank card');
  assert.ok(db.banks.some(bank => bank.id === inserted.id));
  assert.ok(db.transactions.includes(hiddenTransaction));
  db.transactions.splice(db.transactions.indexOf(hiddenTransaction), 1);
  const settledHistory = [
    { id: 'settled-in', accountId: inserted.id, paymentIn: 75, paymentOut: 0 },
    { id: 'settled-out', accountId: inserted.id, paymentIn: 0, paymentOut: 75 }
  ];
  const settledServerHistory = settledHistory.map(serverTransaction);
  db.transactions.push(...settledServerHistory);
  await requestDelete(); await click('Confirm delete');
  assert.ok(text().includes(deleteWarning));
  assert.ok(db.banks.some(bank => bank.id === inserted.id), 'Zero balance must not allow deleting server transaction history');
  for (const transaction of settledServerHistory) db.transactions.splice(db.transactions.indexOf(transaction), 1);
  deleteRpcError = { code: 'PGRST202', message: 'Function not found' };
  await requestDelete(); await click('Confirm delete');
  assert.ok(text().includes('Safe bank deletion is not configured'));
  assert.ok(db.banks.some(bank => bank.id === inserted.id));
  deleteRpcError = { message: 'Safe bank deletion requires a validated immediate foreign key' };
  await requestDelete(); await click('Confirm delete');
  assert.ok(text().includes('requires a validated immediate foreign key'));
  assert.ok(db.banks.some(bank => bank.id === inserted.id));
  deleteRpcError = null;
  await requestDelete(); await click('Confirm delete');
  assert.ok(text().includes('Bank Account 2 deleted.'));
  assert.ok(!db.banks.some(bank => bank.id === inserted.id));
  assert.equal(document.querySelectorAll('form[aria-label="Bank account configuration"] input[type="text"]').length, 2);
  assert.equal(button('Add New Bank').disabled, false, 'Deleting an empty bank frees its subscription slot');
  await click('Dashboard');
  assert.ok(!text().includes('Bank Account 2'));
  await click('Daybook');
  assert.equal(bankDropdown().value, cashId);
  await act(async () => { bankDropdown().value = bankId; bankDropdown().dispatchEvent(new Event('change', { bubbles: true })); });
  await click('New Transaction');
  const entryModal = document.querySelector('dialog[aria-labelledby="transaction-form-heading"]');
  assert.ok(entryModal?.open, 'New Transaction opens a native modal');
  assert.equal(entryModal.getAttribute('aria-modal'), 'true');
  assert.equal(document.body.style.overflow, 'hidden');
  await act(async () => { entryModal.dispatchEvent(new Event('cancel', { cancelable: true })); });
  assert.ok(!document.querySelector('dialog'));
  assert.equal(document.body.style.overflow, '');
  await click('New Transaction');
  assert.ok(![...document.querySelectorAll('option')].some(option => option.value === inserted.id));
  // Cloud CRUD must acknowledge the database before changing the form or rows.
  const storageBeforeCrud = localStorage.getItem('skyline_transactions');
  assert.equal(bankDropdown().value, bankId);
  await input(document.querySelector('input[placeholder="Description"]'), 'Cloud entry');
  await input(document.querySelectorAll('form input[type="number"]')[0], '20.25');
  const submitEntry = async () => act(async () => {
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  failTransactionAction = 'insert';
  await submitEntry();
  assert.ok(text().includes('Transaction insert denied'));
  assert.ok(document.querySelector('dialog [role="alert"]'), 'Save errors stay inside the open modal');
  assert.equal(document.querySelector('input[placeholder="Description"]').value, 'Cloud entry');
  assert.ok(!db.transactions.some(tx => tx.particulars === 'Cloud entry'));
  failTransactionAction = null;
  await submitEntry();
  const cloudEntry = db.transactions.find(tx => tx.particulars === 'Cloud entry');
  assert.ok(cloudEntry?.id.startsWith('20000000-'));
  assert.equal(cloudEntry.company_id, companyId);
  assert.equal(cloudEntry.bank_id, bankId);
  assert.equal(cloudEntry.user_id, userId);
  assert.equal(cloudEntry.created_by, userId);
  assert.equal(cloudEntry.payment_in, 20.25);
  assert.equal(cloudEntry.transaction_type, 'Non-GST');
  assert.ok(!document.querySelector('form'));
  assert.ok(!document.querySelector('dialog'));
  assert.equal(document.body.style.overflow, '');
  await act(async () => { root.unmount(); });
  root = createRoot(document.getElementById('root'));
  await act(async () => { renderApp(); });
  await click('Daybook');
  assert.equal(bankDropdown().value, cashId, 'Cash remains the default after a full remount');
  await act(async () => { bankDropdown().value = bankId; bankDropdown().dispatchEvent(new Event('change', { bubbles: true })); });
  assert.ok(text().includes('Cloud entry'), 'A remount reloads the saved row from Supabase');
  await act(async () => { document.querySelector('[aria-label="Edit transaction Cloud entry"]').click(); });
  assert.ok(document.querySelector('dialog')?.open, 'Editing also uses the transaction modal');
  await input(document.querySelector('input[placeholder="Description"]'), 'Updated cloud entry');
  failTransactionAction = 'update';
  await submitEntry();
  assert.equal(cloudEntry.particulars, 'Cloud entry');
  assert.ok(text().includes('Transaction update denied'));
  failTransactionAction = null;
  await submitEntry();
  assert.equal(cloudEntry.particulars, 'Updated cloud entry');
  const deleteCloudEntry = async () => act(async () => {
    document.querySelector('[aria-label="Delete transaction Updated cloud entry"]').click();
  });
  const deletesBeforePrompt = calls.filter(call => call.table === 'transactions' && call.action === 'delete').length;
  await deleteCloudEntry();
  assert.ok(document.querySelector('dialog[aria-labelledby="delete-transaction-heading"]')?.open);
  assert.ok(text().includes('Are you sure you want to delete this transaction?'));
  assert.equal(calls.filter(call => call.table === 'transactions' && call.action === 'delete').length, deletesBeforePrompt);
  await click('Cancel');
  assert.ok(!document.querySelector('dialog'));
  assert.ok(db.transactions.includes(cloudEntry));
  await deleteCloudEntry();
  await act(async () => { document.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true })); });
  assert.ok(!document.querySelector('dialog'));
  assert.equal(calls.filter(call => call.table === 'transactions' && call.action === 'delete').length, deletesBeforePrompt, 'Cancel and Escape must not delete transactions');
  failTransactionAction = 'delete';
  await deleteCloudEntry();
  await click('Confirm delete');
  assert.ok(db.transactions.includes(cloudEntry));
  assert.ok(text().includes('Transaction delete denied'));
  assert.ok(document.querySelector('dialog [role="alert"]'), 'Failed deletion leaves the confirmation open for retry');
  failTransactionAction = null;
  await click('Confirm delete');
  assert.ok(!db.transactions.includes(cloudEntry));
  assert.ok(!document.querySelector('dialog'));
  assert.equal(document.body.style.overflow, '');
  assert.ok(!document.querySelector('[aria-label="Delete transaction Updated cloud entry"]'));
  assert.equal(localStorage.getItem('skyline_transactions'), storageBeforeCrud, 'CRUD never writes localStorage');
  const { transactionStore } = await import('../node_modules/.bank-test-bundle/transactions.js');
  const store = transactionStore(client);
  const validInput = { accountId: bankId, date: '2026-11-13', particulars: 'Validation', type: 'Non-GST', paymentIn: 1, paymentOut: 0 };
  await assert.rejects(store.add(companyId, 'wrong-user', validInput), /session changed/);
  await assert.rejects(store.add('company-b', userId, validInput), error => /Expected exactly one visible row|does not match/.test(error.message));
  await assert.rejects(store.add(companyId, userId, { ...validInput, accountId: 'other-company-bank' }), error => /Expected exactly one visible row/.test(error.message));
  await assert.rejects(store.add(companyId, userId, { ...validInput, paymentIn: NaN }), /valid payment/);
  await assert.rejects(store.add(companyId, userId, { ...validInput, paymentOut: 10 }), /valid payment/);
  await assert.rejects(store.update(companyId, userId, 'missing-row', validInput), error => /Expected exactly one visible row/.test(error.message));
  await assert.rejects(store.remove(companyId, userId, 'missing-row'), error => /Expected exactly one visible row/.test(error.message));
  const extraRows = Array.from({ length: 1100 }, (_, index) => serverTransaction({
    ...txs[2], id: 'page-' + String(index).padStart(4, '0')
  }));
  const otherTenantRow = { ...serverTransaction(txs[2]), id: 'other-tenant', company_id: 'company-b' };
  db.transactions.push(...extraRows, otherTenantRow);
  assert.equal((await store.load(companyId)).length, initialServerTransactions.length + extraRows.length, 'Load paginates beyond 1,000 rows and excludes other companies');
  db.transactions.splice(initialServerTransactions.length);
  failTransactionAction = 'select';
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  assert.ok(text().includes('Transaction select denied'));
  assert.equal(button('New Transaction').disabled, true, 'Read failures block writes');
  failTransactionAction = null;
  await click('Reload transactions');
  assert.equal(button('New Transaction').disabled, false);
  assert.equal(isCashAccount({ id: cashId, name: 'Cash Account' }), true);
  assert.equal(localStorage.getItem('skyline_transactions'), JSON.stringify(txs));
  assert.deepEqual(db.transactions, initialServerTransactions);
  assert.ok(calls.filter(call => call.table === 'transactions' && ['update', 'delete'].includes(call.action))
    .every(call => call.filters.some(([key, value]) => key === 'company_id' && value === companyId)
      && call.filters.some(([key]) => key === 'id')), 'Every mutation must use company and transaction ID filters');
  assert.ok(!calls.some(call => call.table === 'companies' && call.action === 'insert'));
  // Reload a settled database bank: localStorage must never supply ledger data.
  await act(async () => { root.unmount(); });
  localStorage.setItem('skyline_transactions', JSON.stringify([...txs, {
    ...txs[2], id: 'settled-local-out', paymentIn: 0, paymentOut: 150
  }]));
  db.transactions.push(serverTransaction({ ...txs[2], id: 'settled-server-out', paymentIn: 0, paymentOut: 150 }));
  root = createRoot(document.getElementById('root'));
  await act(async () => { renderApp(); });
  await click('Account Settings');
  const settledBin = document.querySelector('[aria-label="Delete Operating Bank"]');
  assert.ok(settledBin && !settledBin.disabled);
  assert.ok(!text().includes(deleteWarning));
  const beforeSettledClick = calls.filter(call => call.action === 'rpc').length;
  await act(async () => { settledBin.click(); });
  assert.equal(document.querySelector('[role="alert"]').textContent, deleteWarning);
  assert.ok(!document.querySelector('[role="dialog"]'));
  assert.equal(calls.filter(call => call.action === 'rpc').length, beforeSettledClick, 'Settled transaction history must still block deletion');
  await click('Logout');
  failLoad = true;
  await act(async () => { session = { user: { id: userId } }; authCallback('SIGNED_IN', session); });
  assert.ok(text().includes('Bank SELECT denied'), 'Errors must appear before the company loading gate');
  failLoad = false;
  await click('Retry');
  assert.ok(text().includes('Account Breakdown'));
  await click('Logout');
  verifiedUserOverride = { id: 'different-verified-user' };
  await act(async () => { session = { user: { id: userId } }; authCallback('SIGNED_IN', session); });
  assert.ok(text().includes('Your authenticated session changed'));
  verifiedUserOverride = undefined;
  const deniedIndex = await client.rpc('platform_company_index', { p_offset: 0, p_limit: 500 });
  assert.equal(deniedIndex.error.message, 'SUPER_ADMIN access required');
  const { loadCompanyIndex } = await import('../node_modules/.bank-test-bundle/platform.js');
  const pages = [];
  const paginatedIndex = await loadCompanyIndex({ async rpc(name, args) {
    pages.push(args.p_offset);
    return { data: Array.from({ length: args.p_offset === 0 ? 500 : 1 }, (_, index) => ({ id: String(args.p_offset + index) })), error: null };
  } });
  assert.equal(paginatedIndex.length, 501, 'The switchboard loads companies beyond a single API page');
  assert.deepEqual(pages, [0, 500]);
  // A platform administrator lands at the index and can switch without changing identity.
  db.profiles[0].role = 'super admin';
  assert.equal(db.company_users[0].role, 'admin', 'Profile SUPER_ADMIN works while company membership remains admin');
  db.companies[0].status = 'Active';
  db.companies[0].payment_status = 'paid';
  db.companies[0].created_at = '2026-01-01T00:00:00Z';
  db.companies.push({ id: 'company-b', company_name: 'Alpha Customer', plan_name: 'Trial', status: 'Suspended', payment_status: 'unpaid', created_at: '2026-11-10T00:00:00Z', trial_start_date: '2026-11-10T00:00:00Z' });
  db.banks.push({ id: 'company-b-cash', company_id: 'company-b', name: 'Cash Account', position: 1 });
  db.transactions.push({ ...serverTransaction({ ...txs[2], id: 'customer-b-entry', particulars: 'Company B only' }), company_id: 'company-b', bank_id: 'other-company-bank' });
  failIndex = true;
  await click('Retry');
  assert.ok(text().includes('Company index unavailable'));
  failIndex = false;
  await click('Retry');
  assert.ok(text().includes('Company Switchboard'));
  assert.ok(!text().includes('Account Breakdown'), 'SUPER_ADMIN never initially lands in its profile workspace');
  assert.ok(text().includes('Alpha Customer') && text().includes('Test Company'));
  assert.ok(text().includes('Suspended companies') && text().includes('Trial companies'));
  const overviewCards = [...document.querySelectorAll('main > div.grid > div')];
  assert.deepEqual(overviewCards.map(card => card.querySelectorAll('p')[1].textContent), ['2', '1', '1', '1']);
  const setSelect = async (label, value) => act(async () => {
    const select = document.querySelector(`select[aria-label="${label}"]`);
    select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await input(document.querySelector('[aria-label="Search companies"]'), 'alpha');
  assert.equal(document.querySelectorAll('tbody tr').length, 1);
  assert.ok(!document.querySelector('[aria-label="Open Company Test Company"]'));
  await input(document.querySelector('[aria-label="Search companies"]'), '');
  await setSelect('Filter companies by status', 'suspended');
  assert.equal(document.querySelectorAll('tbody tr').length, 1);
  await setSelect('Filter companies by status', 'all');
  await setSelect('Sort companies', 'name');
  assert.ok(document.querySelector('tbody tr').textContent.includes('Alpha Customer'));
  await setSelect('Sort companies', 'recent');
  assert.ok(document.querySelector('tbody tr').textContent.includes('Alpha Customer'));
  await setSelect('Sort companies', 'serial-asc');
  assert.ok(document.querySelector('tbody tr').textContent.includes('Test Company'));
  await setSelect('Sort companies', 'serial-desc');
  assert.ok(document.querySelector('tbody tr').textContent.includes('Alpha Customer'));
  const signInsBeforeSwitch = sessionRestores;
  failLoad = true;
  await act(async () => { document.querySelector('[aria-label="Open Company Alpha Customer"]').click(); });
  assert.ok(text().includes('Bank SELECT denied'));
  failLoad = false;
  await click('Back to Company Switchboard');
  assert.ok(text().includes('Company Switchboard'), 'A failed workspace load keeps platform navigation available');
  await act(async () => { document.querySelector('[aria-label="Open Company Alpha Customer"]').click(); });
  assert.ok(text().includes('SUPER ADMIN — Viewing: Alpha Customer'));
  assert.ok(text().includes('Account Breakdown'));
  assert.ok(!text().includes('Operating Bank'), 'Profile-company banks never leak into the selected workspace');
  await click('Consolidated Ledger');
  assert.ok(text().includes('Company B only'));
  assert.ok(text().includes('SUPER ADMIN — Viewing: Alpha Customer'), 'Platform banner persists across views');
  await click('Account Settings');
  assert.ok(text().includes('Trial') && !text().includes('Operating Bank'));
  await store.add('company-b', userId, { ...validInput, accountId: 'other-company-bank', particulars: 'Platform entry' });
  const platformEntry = db.transactions.find(transaction => transaction.particulars === 'Platform entry');
  assert.equal(platformEntry.company_id, 'company-b');
  assert.equal(platformEntry.created_by, userId, 'Company switching preserves the acting platform identity');
  await store.remove('company-b', userId, platformEntry.id);
  await click('Back to Company Switchboard');
  assert.ok(text().includes('Company Switchboard') && !text().includes('Company B only'));
  const upgradedCompany = db.companies.find(company => company.id === 'company-b');
  upgradedCompany.plan_name = 'Business';
  upgradedCompany.payment_status = 'trial';
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  const upgradedRow = document.querySelector('[aria-label="Open Company Alpha Customer"]').closest('tr');
  assert.equal(upgradedRow.cells[2].textContent, 'Business');
  assert.equal(document.querySelectorAll('th')[4].textContent, 'Payment status');
  assert.equal(upgradedRow.cells[4].textContent, 'trial');
  assert.match(upgradedRow.cells[5].textContent, /Unlimited/);
  assert.equal(document.querySelectorAll('main > div.grid > div')[2].querySelectorAll('p')[1].textContent, '0');
  await act(async () => { upgradedRow.querySelector('button').click(); });
  assert.ok(text().includes('Plan: Business'));
  await click('Account Settings');
  const subscriptionSection = [...document.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === 'Company Subscription');
  assert.equal(subscriptionSection.querySelector('p').textContent, 'Business');
  assert.ok(subscriptionSection.textContent.includes('Bank accounts: Unlimited'));
  assert.ok(!subscriptionSection.textContent.includes('Trial'), 'A Business plan ignores historical Trial dates and payment status');
  await click('Back to Company Switchboard');
  await act(async () => { document.querySelector('[aria-label="Open Company Test Company"]').click(); });
  assert.ok(text().includes('SUPER ADMIN — Viewing: Test Company') && text().includes('Operating Bank'));
  assert.ok(!text().includes('Company B only'));
  assert.equal(sessionRestores, signInsBeforeSwitch, 'Opening and returning never creates another auth session');
  await act(async () => { root.unmount(); });
  root = createRoot(document.getElementById('root'));
  await act(async () => { renderApp(); });
  assert.ok(text().includes('Company Switchboard'), 'Restored SUPER_ADMIN sessions also start at the platform index');
  await click('Logout');
  const newUserId = 'new-confirmed-user';
  db.profiles.push({ id: newUserId, company_id: null });
  const callsBeforeOnboarding = calls.length;
  failOnboarding = true;
  await act(async () => {
    session = { user: { id: newUserId, email: 'new-user@example.com' } };
    authCallback('SIGNED_IN', session);
  });
  assert.match(document.querySelector('[role="alert"]').textContent, /temporarily unavailable/);
  assert.equal(db.profiles.find(profile => profile.id === newUserId).company_id, null);
  failOnboarding = false;
  await click('Retry');
  assert.ok(text().includes('My Company Summary') && text().includes('Plan: Trial'));
  assert.ok(!button('Create Company'));
  assert.ok(text().includes('Cash Account') && text().includes('Bank Account 1'));
  assert.ok(!text().includes('Operating Bank'), 'The new workspace only shows its own accounts');
  const onboardingCalls = calls.slice(callsBeforeOnboarding);
  assert.deepEqual(onboardingCalls.filter(call => call.name === 'create_trial_company').map(call => call.args),
    [{ p_company_name: 'My Company' }, { p_company_name: 'My Company' }]);
  assert.ok(onboardingCalls.every(call => ['rpc', 'select'].includes(call.action)), 'Onboarding makes no direct client table writes');
  await click('Account Settings');
  const profileNameInput = document.querySelector('form[aria-labelledby] input[name="companyName"]');
  assert.equal(profileNameInput.value, 'My Company');
  await input(profileNameInput, '  New Customer  ');
  failRename = true;
  await click('Save company name');
  assert.match(document.querySelector('[role="alert"]').textContent, /Rename denied/);
  assert.equal(document.querySelector('aside h1').textContent, 'My Company');
  failRename = 'missing';
  await click('Save company name');
  assert.match(document.querySelector('[role="alert"]').textContent, /database update is applied/);
  assert.equal(profileNameInput.value, '  New Customer  ');
  failRename = false;
  await click('Save company name');
  assert.equal(document.querySelector('aside h1').textContent, 'New Customer');
  assert.equal(calls.findLast(call => call.name === 'rename_company').args.p_company_id, 'new-trial-company');
  await click('Dashboard');
  assert.ok(text().includes('New Customer Summary'));
  await act(async () => { root.unmount(); });
  root = createRoot(document.getElementById('root'));
  await act(async () => { renderApp(); });
  assert.ok(text().includes('New Customer Summary'), 'The saved company name persists after restoring the session');
  assert.equal(calls.slice(callsBeforeOnboarding).filter(call => call.name === 'create_trial_company').length, 2);
  // A stored login alone must never authorize a recovery callback.
  await act(async () => { root.unmount(); });
  window.history.replaceState(null, '', '/?reset-password=1#error_code=otp_expired');
  root = createRoot(document.getElementById('root'));
  await act(async () => { renderApp(); });
  assert.ok(text().includes('Reset link unavailable'));
  assert.equal(document.querySelector('#new-password'), null);
  assert.ok(!text().includes('New Customer Summary'));
  await click('Request a new link');
  assert.ok(button('Send reset link'));
  assert.equal(window.location.search, '');

  await act(async () => {
    session = { user: { id: newUserId, email: 'new-user@example.com' } };
    authCallback('PASSWORD_RECOVERY', session);
  });
  assert.ok(text().includes('Choose a new password') && !text().includes('New Customer Summary'));
  await input(document.querySelector('#new-password'), 'test-new-password');
  await input(document.querySelector('#confirm-password'), 'does-not-match');
  await click('Update password');
  assert.match(document.querySelector('[role="alert"]').textContent, /do not match/);
  assert.deepEqual(passwordUpdates, []);
  await input(document.querySelector('#confirm-password'), 'test-new-password');
  await click('Update password');
  assert.deepEqual(passwordUpdates, ['test-new-password']);
  assert.ok(text().includes('Password updated') && !text().includes('New Customer Summary'));
  await click('Continue to dashboard');
  assert.ok(text().includes('New Customer Summary'));
  assert.equal(reactErrors.length, 0, 'React must render and update without errors');
  console.log('PASS (mock Supabase + React DOM): login, verified identity, loading UI, company isolation, UUID insert, Settings/Dashboard/Ledger synchronization, full remount/session restore, logout/login persistence, rename/reorder, SELECT/INSERT/UPDATE failures, subscription limit, free Cash at limit, deletion protection, dummy exclusion without storage cleanup, real transaction preservation, and React error checks.');
} finally {
  console.error = originalError;
  await act(async () => { root.unmount(); });
  dom.window.close();
}
