
import React, { useState, useEffect, useRef } from 'react';
import { User, BankConfig, Transaction } from '../types';
import { isCashAccount, cashFirst, errorMessage } from '../bankAccounts';
import { supabase } from '../supabase';
import { Subscription, PLAN_LIMITS, formatLimit } from '../subscriptions';
import { CompanyProfile } from './CompanyProfile';
import { ShieldAlert, Save, RefreshCw, Lock, Plus, ArrowUp, ArrowDown, MoveVertical, Users, Pencil, Trash2 } from 'lucide-react';

const transactionDeleteWarning = 'Cannot delete: this bank has transactions, even if its balance is zero.';

interface SettingsProps {
  user: User;
  bankConfigs: BankConfig[];
  onSave: (configs: BankConfig[]) => Promise<void>;
  onAdd: () => Promise<void>;
  onDelete: (bankId: string) => Promise<void>;
  onRenameCompany: (name: string) => Promise<string>;
  transactions: Transaction[];
  isSaving: boolean;
  companyPlan: string | null;
  subscription: Subscription | null;
  subscriptionLoading: boolean;
  subscriptionError: string | null;
}

export const Settings: React.FC<SettingsProps> = ({ user, bankConfigs, onSave, onAdd, onDelete, onRenameCompany, transactions, isSaving, companyPlan, subscription, subscriptionLoading, subscriptionError }) => {
  const [configs, setConfigs] = useState<BankConfig[]>(() => cashFirst(bankConfigs));
  const [isSaved, setIsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BankConfig | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<string | null>(null);
  const [blockedDeleteBankId, setBlockedDeleteBankId] = useState<string | null>(null);
  const nameInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const deleteDialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (!deleteTarget || !deleteDialog.current) return;
    const dialog = deleteDialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [deleteTarget]);
  useEffect(() => { setConfigs(cashFirst(bankConfigs)); setHasChanges(false); }, [bankConfigs]);
  const [isReorderMode, setIsReorderMode] = useState(false);
  
  const [members, setMembers] = useState<{ user_id: string; role: string }[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const maxBanks = subscription?.bankLimit ?? null;
  const banksWithTransactions = new Set(transactions.map(transaction => transaction.accountId));
  useEffect(() => {
    let cancelled = false;
    setMembers([]); setMembersError(null); setMembersLoading(true);
    if (!user.companyId) { setMembersLoading(false); return; }
    supabase.from('company_users').select('user_id, role').eq('company_id', user.companyId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setMembersError(error.message);
        else setMembers(data ?? []);
        setMembersLoading(false);
      });
    return () => { cancelled = true; };
  }, [user.companyId]);

  if (!user.isAdmin) {
  return (
    <div className="max-w-md mx-auto mt-20 text-center space-y-4">
      <div className="inline-flex items-center justify-center p-4 bg-red-100 text-red-600 rounded-full mb-4">
        <ShieldAlert size={48} />
      </div>
      <h2 className="text-2xl font-bold text-gray-900">Permission Denied</h2>
      <p className="text-gray-500">Only Administrator can access this option.</p>
    </div>
  );
}

  const handleNameChange = (id: string, newName: string) => {
    setIsSaved(false); setHasChanges(true);
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));
  };

  const addBankAccount = async () => {
    setSaveError(null); setIsSaved(false);
    try {
      // Persist the current draft before the insert refreshes shared records.
      if (hasChanges) await onSave(configs);
      await onAdd();
      setIsSaved(true);
    }
    catch (error) { setSaveError(errorMessage(error)); }
  };

  const bankCount = bankConfigs.filter(bank => !isCashAccount(bank)).length;
  const addDisabledReason = isSaving
    ? 'Please wait while bank accounts are being saved.'
    : subscriptionLoading ? 'Loading your company subscription...'
    : subscriptionError ? subscriptionError
    : subscription?.trialExpired ? 'Your 14-day Trial has ended. Choose a subscription plan to add banks. Existing accounts and Cash remain available.'
    : maxBanks === null || (maxBanks !== Infinity && (!Number.isInteger(maxBanks) || maxBanks < 0))
      ? 'Your subscription bank limit is unavailable. Reload the page or contact your administrator.'
      : bankCount >= maxBanks
        ? `Your subscription allows ${maxBanks} bank account${maxBanks === 1 ? '' : 's'}, and ${bankCount} already exist. Your subscription limit must increase before adding another bank. Cash Account is free.`
        : null;

  const moveAccount = (index: number, direction: 'up' | 'down') => {
    const newConfigs = [...configs];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex < 0 || targetIndex >= newConfigs.length) return;
    if (isCashAccount(newConfigs[index]) || isCashAccount(newConfigs[targetIndex])) return;
    
    const [movedItem] = newConfigs.splice(index, 1);
    newConfigs.splice(targetIndex, 0, movedItem);
    setIsSaved(false); setHasChanges(true);
    setConfigs(newConfigs);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null); setIsSaved(false);
    try { await onSave(configs); setIsSaved(true); }
    catch (error) { setSaveError(errorMessage(error)); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isCashAccount(deleteTarget) || isSaving) return;
    setSaveError(null); setIsSaved(false); setDeletedMessage(null); setBlockedDeleteBankId(null);
    try {
      if (banksWithTransactions.has(deleteTarget.id))
        throw new Error(transactionDeleteWarning);
      if (hasChanges) await onSave(configs);
      await onDelete(deleteTarget.id);
      setDeletedMessage(`${deleteTarget.name} deleted.`);
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes('has transactions')) setBlockedDeleteBankId(deleteTarget.id);
      else setSaveError(message);
    }
    finally { setDeleteTarget(null); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">System Configuration</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-violet-50 px-3 py-2 rounded-lg border border-violet-100">
            <span className="text-[10px] font-bold text-violet-700 uppercase tracking-tighter">Enable Repositioning</span>
            <button 
              onClick={() => setIsReorderMode(!isReorderMode)}
              className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${isReorderMode ? 'bg-violet-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isReorderMode ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          
          <button 
            onClick={() => addBankAccount()}
            disabled={Boolean(addDisabledReason)}
            title={addDisabledReason ?? (hasChanges ? 'Save pending changes and add a bank' : 'Add a bank account')}
            className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors font-bold text-xs uppercase disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> Add New Bank
          </button>
        </div>
      </div>

      {saveError && <p role="alert" className="text-red-700">{saveError}</p>}
      {deletedMessage && <p role="status" className="text-green-700">{deletedMessage}</p>}
      {deleteTarget && <dialog ref={deleteDialog} role="dialog" aria-modal="true" aria-labelledby="delete-bank-heading" aria-describedby="delete-bank-description"
        onCancel={event => { event.preventDefault(); if (!isSaving) setDeleteTarget(null); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border-0 bg-white p-6 shadow-2xl backdrop:bg-black/50">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600"><Trash2 size={22} /></div>
        <h3 id="delete-bank-heading" className="break-words text-lg font-bold text-gray-900">Delete {deleteTarget.name}?</h3>
        <p id="delete-bank-description" className="mt-2 text-sm text-gray-500">This cannot be undone.</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" autoFocus disabled={isSaving} onClick={() => setDeleteTarget(null)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={isSaving} onClick={confirmDelete} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">{isSaving ? 'Deleting...' : 'Confirm delete'}</button>
        </div>
      </dialog>}
      {isSaving && <p role="status">Saving bank accounts...</p>}
      {isSaved && <p role="status" className="text-green-700">Bank accounts saved.</p>}
      <p className="text-sm text-gray-500">{bankCount} / {maxBanks === null ? 'Unavailable' : formatLimit(maxBanks)} bank accounts</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Bank Management Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
               <div className="flex items-center gap-2 font-bold text-gray-700 uppercase text-xs tracking-widest">
                 <RefreshCw size={14} /> Manage Bank Accounts
               </div>
               {isReorderMode && <span className="text-[10px] text-violet-600 font-bold bg-violet-50 px-2 py-1 rounded">Reorder Mode Active</span>}
            </div>
            <form aria-label="Bank account configuration" onSubmit={handleSubmit} className="p-6 space-y-6">
              <fieldset disabled={isSaving} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {configs.length === 0 && <p>No bank accounts.</p>}
                {configs.map((config, index) => (
                  <div key={config.id} className="group relative bg-white border border-gray-100 p-3 rounded-xl hover:border-violet-200 transition-all shadow-sm flex items-center gap-3">
                    {isReorderMode && !isCashAccount(config) && (
                      <div className="flex flex-col gap-1 pr-2 border-r border-gray-100">
                        <button 
                          type="button"
                          disabled={index === 0 || isCashAccount(configs[index - 1])}
                          onClick={() => moveAccount(index, 'up')}
                          className={`p-1 rounded hover:bg-violet-100 text-gray-400 hover:text-violet-600 transition-colors ${index === 0 || isCashAccount(configs[index - 1]) ? 'opacity-20 cursor-not-allowed' : ''}`}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button 
                          type="button"
                          disabled={index === configs.length - 1}
                          onClick={() => moveAccount(index, 'down')}
                          className={`p-1 rounded hover:bg-violet-100 text-gray-400 hover:text-violet-600 transition-colors ${index === configs.length - 1 ? 'opacity-20 cursor-not-allowed' : ''}`}
                        >
                          <ArrowDown size={14} />
                        </button>
                      </div>
                    )}
                    
                    <div className="min-w-0 flex-1 space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 flex items-center gap-2 uppercase tracking-tighter overflow-hidden">
                        {isCashAccount(config) ? <Lock size={10} /> : <MoveVertical size={10} className="opacity-40" />}
                        <span className="truncate" title={config.id}>Ref: {config.id}</span>
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          ref={input => { nameInputs.current[config.id] = input; }}
                          value={config.name}
                          disabled={isCashAccount(config)}
                          onChange={(e) => handleNameChange(config.id, e.target.value)}
                          className={`min-w-0 flex-1 p-2 text-sm rounded-lg border outline-none focus:ring-2 focus:ring-violet-500 transition-all ${
                            isCashAccount(config) ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'border-gray-200'
                          }`}
                        />
                        {!isCashAccount(config) && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button type="button" aria-label={`Edit ${config.name}`} title="Edit bank name"
                              onClick={() => { nameInputs.current[config.id]?.focus(); nameInputs.current[config.id]?.select(); }}
                              className="rounded-lg p-2 text-violet-600 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500">
                              <Pencil size={16} />
                            </button>
                              <button type="button" disabled={isSaving} aria-label={`Delete ${config.name}`}
                                onClick={() => {
                                  setSaveError(null); setDeletedMessage(null); setDeleteTarget(null); setBlockedDeleteBankId(null);
                                  if (banksWithTransactions.has(config.id)) {
                                    setBlockedDeleteBankId(config.id);
                                    return;
                                  }
                                  setDeleteTarget(config);
                                }}
                                className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300">
                                <Trash2 size={16} />
                              </button>
                          </div>
                        )}
                      </div>
                      {blockedDeleteBankId === config.id && (
                        <p role="alert" className="text-xs text-amber-800">{transactionDeleteWarning}</p>
                      )}
                    </div>
                  </div>
                ))}
              </fieldset>

              <div className="pt-6 border-t flex flex-col md:flex-row md:items-center justify-between gap-4">
                 <button 
                   type="submit"
                   disabled={isSaving || !hasChanges}
                   className={`flex items-center justify-center space-x-2 px-6 py-2 rounded-lg font-bold transition-all shadow-md text-xs uppercase ${
                     isSaved ? 'bg-green-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-700'
                   }`}
                 >
                   <Save size={16} />
                   <span>{isSaving ? 'Saving...' : isSaved ? 'Saved' : 'Apply Layout'}</span>
                 </button>
              </div>
            </form>
          </div>
        </div>

        <div className="space-y-6">
          <CompanyProfile companyName={user.companyName ?? ''} onRename={onRenameCompany} />
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-3">
            <h3 className="font-bold text-gray-800">Company Subscription</h3>
            {!subscriptionLoading && companyPlan && <p className="font-bold text-violet-700">{companyPlan}</p>}
            {subscriptionLoading ? <p role="status">Loading subscription...</p> : subscriptionError ? <p role="alert" className="text-red-700">{subscriptionError}</p> : subscription && <>
              <p>Bank accounts: {formatLimit(subscription.bankLimit)}</p>
              <p>Users allowed: {subscription.userLimit}</p>
              <p>Cash Account: 1 included free</p>
              {subscription.trialEndsAt && <p className={subscription.trialExpired ? 'text-red-700' : 'text-gray-600'}>
                {subscription.trialExpired ? 'Trial expired' : subscription.trialDaysRemaining + ' days remaining in your 14-day Trial'}
                {' ? Ends ' + new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(subscription.trialEndsAt))}
              </p>}
            </>}
          </section>
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-3">
            <h3 className="flex items-center gap-2 font-bold text-gray-800"><Users size={16} /> Company Members</h3>
            {membersLoading ? <p role="status">Loading members...</p> : membersError ? <p role="alert" className="text-red-700">{membersError}</p> : <>
              <p>{members.length} / {subscription?.userLimit ?? 'Unavailable'} users</p>
              {members.map((member, index) => <div key={member.user_id} className="flex justify-between border-b py-2 text-sm">
                <span>{member.user_id === user.id ? (user.email || 'You') : 'Company member ' + (index + 1)}</span>
                <span className="text-gray-500">{member.role}</span>
              </div>)}
            </>}
          </section>
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-3">
            <h3 className="font-bold text-gray-800">Available Plans</h3>
            <table className="w-full text-left text-sm">
              <thead><tr><th className="py-2">Plan</th><th>Banks</th><th>Users</th></tr></thead>
              <tbody>
                <tr><td className="py-2">Trial ? 14 days</td><td>1</td><td>1</td></tr>
                {Object.entries(PLAN_LIMITS).map(([name, limits]) => <tr key={name}>
                  <td className="py-2">{name}</td><td>{formatLimit(limits.banks)}</td><td>{limits.users}</td>
                </tr>)}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
};
