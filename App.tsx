
import React, { useState, useEffect, useRef } from 'react';
import { AuthView, ResetPasswordView } from './components/Auth';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Ledger } from './components/Ledger';
import { Settings } from './components/Settings';
import { Transaction, User, BankConfig } from './types';
import { supabase } from './supabase';
import { bankAccounts, errorMessage, isCashAccount } from './bankAccounts';
import { getPlanName, getSubscription, SUBSCRIPTION_COLUMNS, Subscription } from './subscriptions';
import { transactionStore, type TransactionInput } from './transactions';
import { isPlatformAdmin, type PlatformCompany } from './platform';
import { CompanySwitchboard } from './components/CompanySwitchboard';
const banks = bankAccounts(supabase);
const entries = transactionStore(supabase);


const App: React.FC = () => {
  const [view, setView] = useState<'dashboard' | 'ledger' | 'settings' | 'consolidated'>('dashboard');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workspaceCompany, setWorkspaceCompany] = useState<PlatformCompany | null>(null);
  const workspaceGeneration = useRef(0);
  const [authLoading, setAuthLoading] = useState(true);
  const [recoveryPage, setRecoveryPage] = useState(() =>
    new URLSearchParams(window.location.search).get('reset-password') === '1'
    || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'
  );
  const [recoveryUserId, setRecoveryUserId] = useState<string | null>(null);
  const [requestResetLink, setRequestResetLink] = useState(false);
  const [reload, setReload] = useState(0);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [banksSaving, setBanksSaving] = useState(false);
  const savingRef = useRef(false);
  const renamingRef = useRef(false);
  const activeUserRef = useRef<string | undefined>(undefined);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [transactionSaving, setTransactionSaving] = useState(false);
  const transactionWrite = useRef(false);
  const transactionRequest = useRef(0);
  const [transactionReload, setTransactionReload] = useState(0);

  const [bankConfigs, setBankConfigs] = useState<BankConfig[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [bankError, setBankError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyPlan, setCompanyPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planReload, setPlanReload] = useState(0);



  useEffect(() => {
    let cancelled = false;
    let request = 0;
    if (!companyId) return;
    const loadPlan = async () => {
      const activeRequest = ++request;
      setPlanLoading(true);
      setPlanError(null);
      setCompanyPlan(null);
      setSubscription(null);
      try {
        const { data, error } = await supabase.from('companies')
          .select(SUBSCRIPTION_COLUMNS).eq('id', companyId).single();
        if (error) throw error;
        if (!cancelled && activeRequest === request) {
          setCompanyPlan(getPlanName(data.plan_name));
          setSubscription(getSubscription(data));
        }
      } catch (error) {
        if (!cancelled && activeRequest === request) setPlanError(errorMessage(error));
      } finally {
        if (!cancelled && activeRequest === request) setPlanLoading(false);
      }
    };
    void loadPlan();
    window.addEventListener('focus', loadPlan);
    return () => { cancelled = true; window.removeEventListener('focus', loadPlan); };
  }, [companyId, planReload]);

  useEffect(() => {
    let active = true;
    const applySession = (session: { user: { id: string; email?: string } } | null) => {
      if (!active) return;
      const authUser = session?.user;
      if (activeUserRef.current !== authUser?.id) {
        workspaceGeneration.current++;
        setWorkspaceReady(false);
        setView('dashboard');
        setWorkspaceCompany(null);
        transactionRequest.current++;
        setTransactions([]);
        setTransactionError(null);
      }
      activeUserRef.current = authUser?.id;
      if (authUser) setRequestResetLink(false);
      setCurrentUser(previous => previous?.id === authUser?.id ? previous : authUser ? {
        id: authUser.id, email: authUser.email, role: 'EXECUTIVE', isAdmin: false
      } : null);
      setAuthLoading(false);
    };
    let authEventReceived = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      authEventReceived = true;
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        setRecoveryPage(true);
        setRecoveryUserId(session.user.id);
      }
      if (event === 'SIGNED_OUT') setRecoveryUserId(null);
      applySession(session);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error && active) { setBankError(error.message); setAuthLoading(false); }
      else if (!authEventReceived) applySession(data.session);
    }).catch(error => {
      if (active) { setBankError(errorMessage(error)); setAuthLoading(false); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWorkspaceReady(false);
    setCompanyId(null);
    setBankConfigs([]);
    setTransactions([]);
    transactionRequest.current++;
    setTransactionLoading(false);
    setTransactionError(null);
    if (!currentUser?.id || recoveryPage) return;
    const userId = currentUser.id;
    setBanksLoading(true);
    setBankError(null);
    (async () => {
      try {
        const { data: identity, error: identityError } = await supabase.auth.getUser();
        if (identityError) throw identityError;
        if (!identity.user || identity.user.id !== userId)
          throw new Error('Your authenticated session changed. Please sign in again.');
        if (cancelled) return;
        const platformAdmin = await isPlatformAdmin(supabase, userId);
        if (cancelled) return;
        if (platformAdmin && !workspaceCompany) {
          setCurrentUser(previous => previous?.id === userId ? { ...previous, role: 'SUPER_ADMIN', isAdmin: true, companyId: undefined, companyName: undefined } : previous);
          setWorkspaceReady(true);
          return;
        }
        const { data: profile, error: profileError } = platformAdmin
          ? { data: { company_id: null }, error: null }
          : await supabase.from('profiles').select('company_id').eq('id', userId).single();
        if (profileError) throw profileError;
        if (cancelled) return;
        let company: string | null = platformAdmin ? workspaceCompany!.id : profile.company_id;
        if (!company) {
          const { data, error } = await supabase.rpc('create_trial_company', { p_company_name: 'My Company' });
          if (error?.code === 'PGRST202') throw new Error('Company setup is temporarily unavailable. Please contact support.');
          if (error) throw error;
          if (typeof data !== 'string' || !data) throw new Error('Company setup could not be confirmed. Please retry.');
          if (cancelled) return;
          company = data;
        }
        const [companyResult, membershipResult, records, transactionRecords] = await Promise.all([
          supabase.from('companies').select('company_name').eq('id', company).single(),
          platformAdmin ? Promise.resolve({ data: { role: 'SUPER_ADMIN' }, error: null }) : supabase.from('company_users').select('role').eq('company_id', company).eq('user_id', userId).single(),
          banks.load(company),
          entries.load(company)
        ]);
        if (companyResult.error) throw companyResult.error;
        if (membershipResult.error) throw membershipResult.error;
        if (cancelled) return;
        const role = String(membershipResult.data.role).toUpperCase();
        const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
        // Cash is a default company account, provisioned once with a real UUID.
        const companyRecords = records.some(isCashAccount)
          ? records : await banks.ensureCash(company, userId);
        if (cancelled) return;
        setCurrentUser(previous => previous?.id === userId ? { ...previous,
          companyId: company, companyName: companyResult.data.company_name,
          role: isAdmin ? (role as User['role']) : 'EXECUTIVE', isAdmin
        } : previous);
        setCompanyId(company);
        setBankConfigs(companyRecords);
        setTransactions(transactionRecords);
        setTransactionError(null);
        setWorkspaceReady(true);
      } catch (error) {
        if (!cancelled) setBankError(errorMessage(error));
      } finally {
        if (!cancelled) setBanksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id, recoveryPage, reload, workspaceCompany?.id]);

  const finishRecovery = () => {
    const url = new URL(window.location.href);
    for (const key of ['reset-password', 'error', 'error_code', 'error_description']) {
      url.searchParams.delete(key);
    }
    url.hash = '';
    window.history.replaceState(window.history.state, '', url);
    setRecoveryUserId(null);
    setRecoveryPage(false);
  };

  const requestNewRecoveryLink = async () => {
    if (currentUser) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
    setRequestResetLink(true);
    finishRecovery();
  };

  const switchWorkspace = (company: PlatformCompany | null) => {
    if (savingRef.current || transactionWrite.current) return;
    workspaceGeneration.current++;
    transactionRequest.current++;
    setWorkspaceCompany(company);
    setCompanyId(null);
    setBankConfigs([]);
    setTransactions([]);
    setSubscription(null);
    setCompanyPlan(null);
    setBankError(null);
    setTransactionError(null);
    setBanksLoading(true);
    setView('dashboard');
    setSelectedAccountId('all');
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) { setBankError(error.message); return; }
    setCurrentUser(null);
    setView('dashboard');
    setSelectedAccountId('all');
  };

  const renameCompany = async (name: string): Promise<string> => {
    const userId = currentUser?.id;
    const targetCompany = companyId;
    if (!userId || !targetCompany || !currentUser.isAdmin) {
      throw new Error('Only administrators can rename a company.');
    }
    if (renamingRef.current) throw new Error('A company name change is already in progress.');
    renamingRef.current = true;
    try {
      const { data, error } = await supabase.rpc('rename_company', {
        p_company_id: targetCompany,
        p_company_name: name
      });
      if (error?.code === 'PGRST202') {
        throw new Error('Company name changes are unavailable until the database update is applied. Please contact your administrator.');
      }
      if (error) throw error;
      if (typeof data !== 'string' || !data) throw new Error('The company name could not be confirmed.');
      setCurrentUser(previous => previous?.id === userId && previous.companyId === targetCompany
        ? { ...previous, companyName: data }
        : previous);
      return data;
    } finally {
      renamingRef.current = false;
    }
  };

  useEffect(() => {
    if (!companyId || !currentUser?.id) return;
    let cancelled = false;
    const userId = currentUser.id;
    const refresh = async () => {
      if (transactionWrite.current) return;
      const request = ++transactionRequest.current;
      setTransactionLoading(true);
      try {
        const records = await entries.load(companyId);
        if (!cancelled && request === transactionRequest.current && activeUserRef.current === userId) {
          setTransactions(records);
          setTransactionError(null);
        }
      } catch (error) {
        if (!cancelled && request === transactionRequest.current) setTransactionError(errorMessage(error));
      } finally {
        if (!cancelled && request === transactionRequest.current) setTransactionLoading(false);
      }
    };
    if (transactionReload) void refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, [companyId, currentUser?.id, transactionReload]);

  const writeTransaction = async (operation: (company: string, userId: string) => Promise<void>) => {
    if (!companyId || !currentUser?.id) throw new Error('Please sign in again.');
    if (transactionWrite.current || savingRef.current || transactionLoading || transactionError)
      throw new Error('Please wait or reload transactions before saving.');
    transactionWrite.current = true;
    transactionRequest.current++;
    setTransactionSaving(true);
    try { await operation(companyId, currentUser.id); }
    finally { transactionWrite.current = false; setTransactionSaving(false); }
  };
  const handleAddTransaction = (input: TransactionInput) => writeTransaction(async (company, userId) => {
    const request = transactionRequest.current;
    const record = await entries.add(company, userId, input);
    if (activeUserRef.current === userId && request === transactionRequest.current)
      setTransactions(previous => [...previous, record]);
  });
  const handleEditTransaction = (id: string, input: TransactionInput) => writeTransaction(async (company, userId) => {
    const request = transactionRequest.current;
    const record = await entries.update(company, userId, id, input);
    if (activeUserRef.current === userId && request === transactionRequest.current)
      setTransactions(previous => previous.map(tx => tx.id === id ? record : tx));
  });
  const handleDeleteTransaction = (id: string) => writeTransaction(async (company, userId) => {
    const request = transactionRequest.current;
    await entries.remove(company, userId, id);
    if (activeUserRef.current === userId && request === transactionRequest.current)
      setTransactions(previous => previous.filter(tx => tx.id !== id));
  });


  const saveBanks = async (operation: () => Promise<void>) => {
    if (!companyId || !currentUser?.id || !currentUser.isAdmin)
      throw new Error('Only a company administrator can manage bank accounts.');
    if (savingRef.current) throw new Error('A bank save is already in progress.');
    const userId = currentUser.id;
    const generation = workspaceGeneration.current;
    savingRef.current = true;
    setBanksSaving(true);
    try { await operation(); }
    catch (error) {
      try {
        const records = await banks.load(companyId);
        if (activeUserRef.current === userId && generation === workspaceGeneration.current) setBankConfigs(records);
      } catch { /* Retain last known records and surface the original error. */ }
      throw error;
    } finally { savingRef.current = false; setBanksSaving(false); }
  };
  const updateBankNames = (configs: BankConfig[]) => saveBanks(async () => {
    const userId = currentUser!.id;
    const generation = workspaceGeneration.current;
    const records = await banks.save(companyId!, configs);
    if (activeUserRef.current === userId && generation === workspaceGeneration.current) setBankConfigs(records);
  });
  const addBank = () => saveBanks(async () => {
    const userId = currentUser!.id!;
    const generation = workspaceGeneration.current;
    const record = await banks.add(companyId!, userId);
    if (activeUserRef.current === userId && generation === workspaceGeneration.current) setBankConfigs(previous => [...previous, record]);
    const records = await banks.load(companyId!);
    if (activeUserRef.current === userId && generation === workspaceGeneration.current) setBankConfigs(records);
  });
  const deleteBank = (bankId: string) => saveBanks(async () => {
    if (transactionWrite.current || transactionLoading || transactionError)
      throw new Error('Reload transactions before deleting a bank.');
    if (transactions.some(transaction => transaction.accountId === bankId))
      throw new Error('This bank has transactions and cannot be deleted.');
    const userId = currentUser!.id;
    const generation = workspaceGeneration.current;
    const deletedId = await banks.remove(companyId!, bankId);
    if (activeUserRef.current === userId && generation === workspaceGeneration.current) {
      setBankConfigs(previous => previous.filter(bank => bank.id !== deletedId));
      setSelectedAccountId(previous => previous === deletedId ? 'all' : previous);
    }
  });

  if (authLoading) return <div role="status">Restoring your session...</div>;
  if (recoveryPage) return <ResetPasswordView
    key={recoveryUserId ?? 'unverified-recovery'}
    userId={currentUser?.id === recoveryUserId ? recoveryUserId : null}
    onFinish={finishRecovery}
    onRequestLink={requestNewRecoveryLink}
  />;
  if (!currentUser) return <AuthView initialMode={requestResetLink ? 'forgot' : 'login'}
    onLogin={() => { /* Auth events supply the verified user. */ }} />;
  if (bankError) return <div role="alert">Unable to open your workspace: {bankError}
    <button onClick={() => setReload(value => value + 1)}>Retry</button>
    {currentUser.role === 'SUPER_ADMIN' && workspaceCompany && <button onClick={() => switchWorkspace(null)}>Back to Company Switchboard</button>}
    <button onClick={handleLogout}>Sign out</button>
  </div>;
  if (banksLoading || !workspaceReady) return <div role="status">Loading your company and bank accounts...</div>;
  if (currentUser.role === 'SUPER_ADMIN' && !workspaceCompany) return <CompanySwitchboard onOpen={company => switchWorkspace(company)} onLogout={handleLogout} />;
  return (
    <Layout
      user={currentUser}
      onBackToSwitchboard={currentUser.role === 'SUPER_ADMIN' ? () => switchWorkspace(null) : undefined}
      switchingDisabled={banksSaving || transactionSaving}
      companyPlan={companyPlan}
      planLoading={planLoading}
      planError={planError}
      onRefreshPlan={() => setPlanReload(value => value + 1)}
      onLogout={handleLogout}
      currentView={view}
      onViewChange={(v) => {
        setView(v);
        if (v === 'consolidated') setSelectedAccountId('all');
        if (v === 'ledger') setSelectedAccountId((bankConfigs.find(isCashAccount) ?? bankConfigs[0])?.id ?? '');
      }}
      bankConfigs={bankConfigs}
    >
      {transactionError && <div role="alert" className="mb-4 text-red-700">{transactionError}
        <button className="ml-3 underline" onClick={() => setTransactionReload(value => value + 1)}>Reload transactions</button>
      </div>}
      {view === 'dashboard' && currentUser && (
        <Dashboard
          companyName={currentUser.companyName}
          transactions={transactions}
          bankConfigs={bankConfigs}
          onNavigateLedger={(id) => {
            setSelectedAccountId(id);
            setView('ledger');
          }}
        />
      )}
      {view === 'ledger' && (
        <Ledger
          accountId={selectedAccountId === 'all'
            ? (bankConfigs.find(isCashAccount) ?? bankConfigs[0])?.id ?? ''
            : selectedAccountId}
          bankConfigs={bankConfigs}
          transactions={transactions}
          isSaving={transactionSaving || transactionLoading || Boolean(transactionError)}
          onAdd={handleAddTransaction}
          onEdit={handleEditTransaction}
          onDelete={handleDeleteTransaction}
          onAccountChange={setSelectedAccountId}
        />
      )}
      {view === 'consolidated' && (
        <Ledger
          accountId="all"
          bankConfigs={bankConfigs}
          transactions={transactions}
          isSaving={transactionSaving || transactionLoading || Boolean(transactionError)}
          onAdd={handleAddTransaction}
          onEdit={handleEditTransaction}
          onDelete={handleDeleteTransaction}
          onAccountChange={() => { }}
        />
      )}
      {view === 'settings' && (
        <Settings
          user={currentUser}
          bankConfigs={bankConfigs}
          onSave={updateBankNames}
          onAdd={addBank}
          onDelete={deleteBank}
          onRenameCompany={renameCompany}
          transactions={transactions}
          isSaving={banksSaving || transactionSaving || transactionLoading || Boolean(transactionError)}
          companyPlan={companyPlan}
          subscription={subscription}
          subscriptionLoading={planLoading}
          subscriptionError={planError}
        />
      )}
    </Layout>
  );
};

export default App;
