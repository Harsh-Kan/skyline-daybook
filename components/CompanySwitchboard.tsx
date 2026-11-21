import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Search, ArrowUpRight, RefreshCw, LogOut } from 'lucide-react';
import { supabase } from '../supabase';
import { loadCompanyIndex, type PlatformCompany } from '../platform';
import { formatLimit, getPlanLimits, getPlanName, isTrialPlan } from '../subscriptions';
import { errorMessage } from '../bankAccounts';

const normalizedStatus = (company: PlatformCompany) => company.status?.trim().toLowerCase() || 'unknown';

export function CompanySwitchboard({ onOpen, onLogout }: { onOpen: (company: PlatformCompany) => void; onLogout: () => void }) {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('serial-asc');
  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const refresh = async () => {
      const activeRequest = ++request;
      try {
        const records = await loadCompanyIndex(supabase);
        if (!cancelled && activeRequest === request) {
          setCompanies(records);
          setError(null);
        }
      } catch (error) {
        if (!cancelled && activeRequest === request) setError(errorMessage(error));
      } finally {
        if (!cancelled && activeRequest === request) setLoading(false);
      }
    };
    setLoading(true);
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, [reload]);
  const indexed = useMemo(() => [...companies].sort((a, b) => {
    const aTime = Date.parse(a.created_at || '') || 0;
    const bTime = Date.parse(b.created_at || '') || 0;
    return aTime - bTime || a.id.localeCompare(b.id);
  }).map((company, index) => ({ ...company, serial: index + 1 })), [companies]);
  const visible = useMemo(() => indexed.filter(company =>
    company.company_name.toLowerCase().includes(search.trim().toLowerCase()) && (status === 'all' || normalizedStatus(company) === status)
  ).sort((a, b) => {
    if (sort === 'name') return a.company_name.localeCompare(b.company_name) || a.serial - b.serial;
    if (sort === 'recent') return (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0) || a.serial - b.serial;
    return sort === 'serial-desc' ? b.serial - a.serial : a.serial - b.serial;
  }), [indexed, search, status, sort]);
  const overview = [
    ['Total companies', companies.length],
    ['Active companies', companies.filter(company => normalizedStatus(company) === 'active').length],
    ['Trial companies', companies.filter(company => isTrialPlan(company.plan_name)).length],
    ['Suspended companies', companies.filter(company => normalizedStatus(company) === 'suspended').length]
  ] as const;
  return <div className="min-h-screen bg-gray-50 text-gray-900">
    <header className="bg-violet-950 text-white px-5 md:px-10 py-5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3"><Building2 size={28} /><div><p className="font-bold text-xl">Skyline Global</p><p className="text-xs text-violet-200 tracking-widest uppercase">Platform administration · SUPER ADMIN</p></div></div>
      <button onClick={onLogout} className="flex items-center gap-2 rounded-lg bg-violet-900 px-4 py-2 text-sm"><LogOut size={16} />Logout</button>
    </header>
    <main className="max-w-screen-2xl mx-auto p-5 md:p-10 space-y-7">
      <div className="flex justify-between items-start gap-4"><div><h1 className="text-3xl font-bold">Company Switchboard</h1><p className="mt-2 text-gray-500">Your customer companies, subscriptions and accounting workspaces.</p></div><button disabled={loading} onClick={() => setReload(value => value + 1)} className="flex items-center gap-2 border rounded-lg bg-white px-3 py-2 disabled:opacity-50"><RefreshCw size={16} />Refresh</button></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{overview.map(([label, count]) => <div key={label} className="rounded-xl bg-white border border-gray-200 p-5"><p className="text-sm text-gray-500">{label}</p><p className="text-3xl font-bold mt-2">{loading || error ? '—' : count}</p></div>)}</div>
      <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="p-4 flex flex-wrap gap-3 border-b">
          <label className="flex items-center gap-2 border rounded-lg px-3 flex-1 min-w-48"><Search size={17} className="text-gray-400" /><input aria-label="Search companies" placeholder="Search companies…" value={search} onChange={event => setSearch(event.target.value)} className="w-full py-2 outline-none" /></label>
          <select aria-label="Filter companies by status" value={status} onChange={event => setStatus(event.target.value)} className="border rounded-lg px-3 py-2"><option value="all">All statuses</option>{[...new Set(['active', 'suspended', ...companies.map(normalizedStatus)])].sort().map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select>
          <select aria-label="Sort companies" value={sort} onChange={event => setSort(event.target.value)} className="border rounded-lg px-3 py-2"><option value="serial-asc">Sr No. ↑</option><option value="serial-desc">Sr No. ↓</option><option value="name">Company name A–Z</option><option value="recent">Recently created</option></select>
        </div>
        {loading ? <p role="status" className="p-8">Loading companies…</p> : error ? <div role="alert" className="p-8 text-red-700">Unable to load company index: {error}<button onClick={() => setReload(value => value + 1)} className="ml-3 underline">Retry</button></div> : <>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-gray-500"><tr>{['Sr No.', 'Company name', 'Subscription plan', 'Company status', 'Payment status', 'Banks used / allowed', 'Users used / allowed', 'Created', 'Workspace'].map(label => <th key={label} className="px-4 py-4 font-semibold whitespace-nowrap">{label}</th>)}</tr></thead>
            <tbody>{visible.map(company => {
              const planName = getPlanName(company.plan_name);
              const allowance = getPlanLimits(planName);
              const created = Date.parse(company.created_at || '');
              return <tr key={company.id} className="border-t hover:bg-violet-50/40">
                <td className="px-4 py-4 text-gray-500">{company.serial}</td>
                <td className="px-4 py-4 font-semibold">{company.company_name}</td>
                <td className="px-4 py-4">{planName || 'Not configured'}</td>
                <td className="px-4 py-4"><span className="rounded-full bg-gray-100 px-2 py-1 whitespace-nowrap">{company.status || 'Unknown'}</span></td>
                <td className="px-4 py-4">{company.payment_status || 'Unknown'}</td>
                <td className="px-4 py-4 whitespace-nowrap">{company.banks_used} / {allowance ? formatLimit(allowance.banks) : 'Unknown'}</td>
                <td className="px-4 py-4 whitespace-nowrap">{company.users_used} / {allowance ? formatLimit(allowance.users) : 'Unknown'}</td>
                <td className="px-4 py-4 whitespace-nowrap">{Number.isFinite(created) ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(created) : 'Unavailable'}</td>
                <td className="px-4 py-4"><button aria-label={`Open Company ${company.company_name}`} onClick={() => onOpen(company)} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 text-white px-3 py-2 whitespace-nowrap">Open Company<ArrowUpRight size={15} /></button></td>
              </tr>;
            })}{!visible.length && <tr><td colSpan={9} className="p-10 text-center text-gray-500">{companies.length ? 'No companies match your search and filter.' : 'No customer companies are available.'}</td></tr>}</tbody></table></div>
          <p className="p-4 border-t text-xs text-gray-500">{visible.length} of {companies.length} companies · Bank usage excludes the free Cash Account.</p>
        </>}
      </section>
    </main>
  </div>;
}
