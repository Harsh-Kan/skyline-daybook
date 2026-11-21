import type { SupabaseClient } from '@supabase/supabase-js';
import { TransactionType, type Transaction } from './types';
import { isPlatformAdmin } from './platform';

export type TransactionInput = Omit<Transaction, 'id' | 'runningBalance' | 'createdAt'>;
export const TRANSACTION_COLUMNS = 'id, company_id, bank_id, transaction_date, particulars, transaction_type, payment_in, payment_out, created_at, created_by';

interface TransactionRow {
  id: string; company_id: string; bank_id: string | null; transaction_date: string;
  particulars: string; transaction_type: string; payment_in: number | string | null;
  payment_out: number | string | null; created_at: string | null; created_by: string | null;
}

const fromRow = (row: TransactionRow): Transaction => ({
  id: row.id, companyId: row.company_id, accountId: row.bank_id ?? '',
  date: row.transaction_date, particulars: row.particulars,
  type: row.transaction_type as TransactionType,
  paymentIn: Number(row.payment_in ?? 0), paymentOut: Number(row.payment_out ?? 0),
  createdAt: row.created_at ? Date.parse(row.created_at) : 0,
  createdBy: row.created_by ?? undefined, runningBalance: 0
});

const toRow = (input: TransactionInput) => {
  if (!input.accountId || !input.particulars.trim()) throw new Error('Choose a bank and enter particulars.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date))
    || new Date(input.date).toISOString().slice(0, 10) !== input.date)
    throw new Error('Enter a valid transaction date.');
  if (![TransactionType.GST, TransactionType.NON_GST].includes(input.type))
    throw new Error('Choose a valid transaction type.');
  const amounts = [input.paymentIn, input.paymentOut];
  if (amounts.some(value => !Number.isFinite(value) || value < 0 || value >= 1e13)
    || amounts.every(value => value > 0)) throw new Error('Enter a valid payment in or payment out.');
  return {
    bank_id: input.accountId, transaction_date: input.date, particulars: input.particulars.trim(),
    transaction_type: input.type, payment_in: input.paymentIn, payment_out: input.paymentOut
  };
};

export function transactionStore(client: SupabaseClient) {
  const authorize = async (companyId: string, expectedUserId: string, bankId?: string) => {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (data.user?.id !== expectedUserId) throw new Error('Your authenticated session changed. Please sign in again.');
    if (!(await isPlatformAdmin(client, expectedUserId))) {
      const [profile, member] = await Promise.all([
      client.from('profiles').select('company_id').eq('id', expectedUserId).single(),
      client.from('company_users').select('role').eq('company_id', companyId).eq('user_id', expectedUserId).single()
    ]);
    if (profile.error) throw profile.error;
    if (member.error) throw member.error;
    if (profile.data.company_id !== companyId) throw new Error('This company does not match your authenticated profile.');
    }
    if (bankId) {
      const bank = await client.from('banks').select('id').eq('company_id', companyId).eq('id', bankId).single();
      if (bank.error) throw bank.error;
      if (!bank.data) throw new Error('This bank is not available in your company.');
    }
  };

  const load = async (companyId: string): Promise<Transaction[]> => {
    const rows: Transaction[] = [];
    // Page until exhausted; the API may cap a response at fewer than 1,000 rows.
    for (let offset = 0; ; ) {
      const { data, error } = await client.from('transactions').select(TRANSACTION_COLUMNS)
        .eq('company_id', companyId).order('id', { ascending: true }).range(offset, offset + 499);
      if (error) throw error;
      if (!data?.length) return rows;
      rows.push(...data.map(fromRow));
      offset += data.length;
    }
  };
  const add = async (companyId: string, userId: string, input: TransactionInput) => {
    const payload = toRow(input);
    await authorize(companyId, userId, input.accountId);
    const { data, error } = await client.from('transactions').insert({
      ...payload, company_id: companyId, user_id: userId, created_by: userId
    }).select(TRANSACTION_COLUMNS).single();
    if (error) throw error;
    if (!data?.id) throw new Error('The database did not confirm transaction creation.');
    return fromRow(data);
  };
  const update = async (companyId: string, userId: string, id: string, input: TransactionInput) => {
    const payload = toRow(input);
    await authorize(companyId, userId, input.accountId);
    const { data, error } = await client.from('transactions').update(payload)
      .eq('company_id', companyId).eq('id', id).select(TRANSACTION_COLUMNS).single();
    if (error) throw error;
    if (!data?.id) throw new Error('The database did not confirm transaction update.');
    return fromRow(data);
  };
  const remove = async (companyId: string, userId: string, id: string) => {
    await authorize(companyId, userId);
    const { data, error } = await client.from('transactions').delete()
      .eq('company_id', companyId).eq('id', id).select('id').single();
    if (error) throw error;
    if (data?.id !== id) throw new Error('The database did not confirm transaction deletion.');
    return id;
  };
  return { load, add, update, remove };
}
