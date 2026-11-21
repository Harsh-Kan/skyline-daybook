import type { SupabaseClient } from '@supabase/supabase-js';

export interface PlatformCompany {
  id: string;
  company_name: string;
  plan_name: string | null;
  status: string | null;
  payment_status: string | null;
  created_at: string | null;
  banks_used: number;
  users_used: number;
}

export const isSuperAdminRole = (role: unknown) =>
  typeof role === 'string' && role.trim().toUpperCase().replace(/[\s-]+/g, '_') === 'SUPER_ADMIN';

export async function isPlatformAdmin(client: SupabaseClient, userId: string) {
  // The platform role belongs to the signed-in profile. Keep existing platform
  // memberships working while installations transition to profile roles.
  const profile = await client.from('profiles').select('*').eq('id', userId);
  if (profile.error) throw profile.error;
  if ((profile.data ?? []).some(item => isSuperAdminRole(item.role))) return true;
  const { data, error } = await client.from('company_users').select('role').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).some(member => isSuperAdminRole(member.role));
}

export async function loadCompanyIndex(client: SupabaseClient): Promise<PlatformCompany[]> {
  const companies: PlatformCompany[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.rpc('platform_company_index', { p_offset: offset, p_limit: 500 });
    if (error) throw error;
    companies.push(...(data ?? []));
    if (!data || data.length < 500) return companies;
  }
}
