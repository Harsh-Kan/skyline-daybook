import React, { useEffect, useId, useState } from 'react';
import { errorMessage } from '../bankAccounts';

interface CompanyProfileProps {
  companyName: string;
  onRename: (name: string) => Promise<string>;
}

export function CompanyProfile({ companyName, onRename }: CompanyProfileProps) {
  const inputId = useId();
  const [name, setName] = useState(companyName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setName(companyName); }, [companyName]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (saving || !trimmed || trimmed === companyName) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      setName(await onRename(trimmed));
      setSaved(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby={`${inputId}-heading`} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h3 id={`${inputId}-heading`} className="font-bold text-gray-800">Company Profile</h3>
      <form aria-labelledby={`${inputId}-heading`} aria-busy={saving} onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label htmlFor={inputId} className="block text-sm font-semibold text-gray-700">Company name</label>
        <input
          id={inputId}
          name="companyName"
          type="text"
          required
          disabled={saving}
          value={name}
          onChange={event => {
            setName(event.target.value);
            setError(null);
            setSaved(false);
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-200"
        />
        <button type="submit" disabled={saving || !name.trim() || name.trim() === companyName}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save company name'}
        </button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {saved && <p role="status" className="text-sm text-green-700">Company name updated.</p>}
      </form>
    </section>
  );
}
