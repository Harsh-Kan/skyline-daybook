import type { SupabaseClient } from '@supabase/supabase-js';
import type { BankConfig } from './types';
import { getSubscription, SUBSCRIPTION_COLUMNS } from './subscriptions';
import { isPlatformAdmin } from './platform';

export const isCashAccount = (bank: BankConfig) =>
  bank.isCash === true || bank.id === 'cash' || bank.name.trim().toLowerCase() === 'cash account';

// Keep the saved order of bank accounts while pinning Cash above them.
export const cashFirst = (configs: BankConfig[]): BankConfig[] =>
  [...configs.filter(isCashAccount), ...configs.filter(bank => !isCashAccount(bank))];

export const errorMessage = (error: unknown) =>
  typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : 'Unable to synchronize bank accounts.';

export function bankAccounts(client: SupabaseClient) {
  const cashInitializations = new Map<string, Promise<BankConfig[]>>();
  const authorizeWrite = async (companyId: string, expectedUserId?: string) => {
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError) throw identityError;
    const userId = identity.user?.id;
    if (!userId || (expectedUserId && userId !== expectedUserId))
      throw new Error('Your authenticated session changed. Please sign in again.');
    if (await isPlatformAdmin(client, userId)) return;
    const [profile, membership] = await Promise.all([
      client.from('profiles').select('company_id').eq('id', userId).single(),
      client.from('company_users').select('role').eq('company_id', companyId).eq('user_id', userId).single()
    ]);
    if (profile.error) throw profile.error;
    if (membership.error) throw membership.error;
    if (profile.data.company_id !== companyId)
      throw new Error('This company does not match your authenticated profile.');
    const role = String(membership.data.role).toUpperCase();
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN')
      throw new Error('Only a company administrator can manage bank accounts.');
    // RLS remains the authority; these checks also catch stale UI/session state.
  };

  const load = async (companyId: string): Promise<BankConfig[]> => {
    const { data, error } = await client.from('banks')
      .select('id, company_id, name, position').eq('company_id', companyId)
      .order('position', { ascending: true }).order('id', { ascending: true });
    if (error) throw error;
    return cashFirst((data ?? []).map(bank => ({
      id: bank.id, companyId: bank.company_id, name: bank.name,
      position: bank.position, isCash: bank.name.trim().toLowerCase() === 'cash account'
    })));
  };

  const add = async (companyId: string, userId: string, cash = false) => {
    await authorizeWrite(companyId, userId);
    // Recheck the server, including the subscription, before every insert.
    const existing = await load(companyId);
    if (cash && existing.some(isCashAccount)) throw new Error('Cash Account already exists.');
    if (!cash) {
      const { data: company, error } = await client.from('companies')
        .select(SUBSCRIPTION_COLUMNS).eq('id', companyId).single();
      if (error) throw error;
      const subscription = getSubscription(company);
      if (subscription.trialExpired)
        throw new Error('Your 14-day Trial has ended. Choose a subscription plan to add another bank. Existing accounts and Cash are preserved.');
      if (existing.filter(bank => !isCashAccount(bank)).length >= subscription.bankLimit)
        throw new Error('Your subscription bank account limit has been reached. Cash Account is free.');
    }
    const position = Math.max(0, ...existing.map(bank => bank.position ?? 0)) + 1;
    const { data, error } = await client.from('banks').insert({
      company_id: companyId, user_id: userId,
      name: cash ? 'Cash Account' : `Bank Account ${existing.filter(bank => !isCashAccount(bank)).length + 1}`,
      position
    }).select('id, company_id, name, position').single();
    if (error) throw error;
    if (!data?.id) throw new Error('The inserted bank was not returned. Check the bank SELECT policy before retrying.');
    return { id: data.id, companyId: data.company_id, name: data.name,
      position: data.position, isCash: cash } satisfies BankConfig;
  };

  const ensureCash = (companyId: string, userId: string): Promise<BankConfig[]> => {
    const key = `${companyId}:${userId}`;
    const pending = cashInitializations.get(key);
    if (pending) return pending;
    const initialization = (async () => {
      const existing = await load(companyId);
      if (existing.some(isCashAccount)) return existing;
      try {
        await add(companyId, userId, true);
      } catch (error) {
        // Another initializer may already have provisioned Cash. Reuse its UUID.
        const latest = await load(companyId);
        if (latest.some(isCashAccount)) return latest;
        throw new Error(`The default Cash Account could not be initialized: ${errorMessage(error)}`);
      }
      return load(companyId);
    })().finally(() => { cashInitializations.delete(key); });
    cashInitializations.set(key, initialization);
    return initialization;
  };

  const save = async (companyId: string, configs: BankConfig[]) => {
    await authorizeWrite(companyId);
    const existing = await load(companyId);
    const submitted = new Set(configs.map(bank => bank.id));
    if (submitted.size !== configs.length || configs.length !== existing.length || existing.some(bank => !submitted.has(bank.id)))
      throw new Error('Accounts changed on the server. Reload before saving. Use the delete button to remove a bank only when it has no transactions.');
    for (const bank of configs) {
      const original = existing.find(item => item.id === bank.id)!;
      if (!bank.name.trim()) throw new Error('Bank names cannot be empty.');
      if (isCashAccount(original) && bank.name !== original.name)
        throw new Error('Cash Account cannot be renamed.');
      if (!isCashAccount(original) && bank.name.trim().toLowerCase() === 'cash account')
        throw new Error('Cash Account is reserved for the free cash account.');
    }
    // Update only names and display order; never IDs, ownership, or transactions.
    for (const [index, bank] of cashFirst(configs).entries()) {
      const { data, error } = await client.from('banks')
        .update({ name: bank.name.trim(), position: index + 1 })
        .eq('id', bank.id).eq('company_id', companyId).select('id').single();
      if (error) throw error;
      if (!data) throw new Error('Bank update was not authorized.');
    }
    return load(companyId);
  };
  const remove = async (companyId: string, bankId: string) => {
    await authorizeWrite(companyId);
    const existing = await load(companyId);
    const bank = existing.find(item => item.id === bankId);
    if (!bank) throw new Error('This bank is no longer available in your company.');
    if (isCashAccount(bank)) throw new Error('Cash Account cannot be deleted.');
    // Never substitute a client DELETE: the server must check all transactions,
    // including rows hidden by RLS, and protect against concurrent inserts.
    const { data, error } = await client.rpc('delete_bank_if_unused', {
      p_company_id: companyId, p_bank_id: bankId
    });
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883')
        throw new Error('Safe bank deletion is not configured in Supabase yet. The reviewed delete_bank_if_unused function must be installed first. No bank was deleted.');
      throw error;
    }
    if (data !== bankId) throw new Error('The database did not confirm bank deletion. Reload before retrying.');
    return bankId;
  };
  return { load, add, save, ensureCash, remove };
}
