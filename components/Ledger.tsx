
import React, { useState, useMemo, useEffect } from 'react';
import { Transaction, TransactionType, BankConfig } from '../types';
import { formatCurrency, formatDate } from '../utils/formatters';
import { Download, Plus, Trash2, Edit2, X, Filter } from 'lucide-react';
import { errorMessage } from '../bankAccounts';
import type { TransactionInput } from '../transactions';

interface LedgerProps {
  accountId: string;
  bankConfigs: BankConfig[];
  transactions: Transaction[];
  onAdd: (tx: TransactionInput) => Promise<void>;
  onEdit: (id: string, updated: TransactionInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isSaving?: boolean;
  onAccountChange: (id: string) => void;
}

export const Ledger: React.FC<LedgerProps> = ({ 
  accountId, 
  bankConfigs, 
  transactions, 
  onAdd, 
  onEdit,
  onDelete,
  onAccountChange,
  isSaving = false
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const operationPending = React.useRef(false);
  const busy = isSaving || pending;
  const transactionDialog = React.useRef<HTMLDialogElement | null>(null);
  const deleteDialog = React.useRef<HTMLDialogElement | null>(null);
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
  const cancelDelete = () => {
    if (busy || operationPending.current) return;
    setDeleteTarget(null); setOperationError(null);
  };
  useEffect(() => {
    if (!showAddForm || !transactionDialog.current) return;
    const dialog = transactionDialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [showAddForm]);
  const closeTransactionForm = () => {
    if (busy || operationPending.current) return;
    setShowAddForm(false); setEditId(null); setOperationError(null);
  };
  
  // Filtering State
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    particulars: '',
    type: TransactionType.NON_GST,
    paymentIn: 0,
    paymentOut: 0,
    accountId: accountId === 'all' ? (bankConfigs[0]?.id || '') : accountId
  });

  useEffect(() => {
    if (editId) return; // Never silently remap an existing transaction.
    setFormData(previous => ({ ...previous, accountId: accountId === 'all'
      ? (bankConfigs.some(bank => bank.id === previous.accountId) ? previous.accountId : bankConfigs[0]?.id || '')
      : accountId }));
  }, [accountId, bankConfigs, editId]);

  const accountName = useMemo(() => {
    if (accountId === 'all') return 'Consolidated Ledger';
    return bankConfigs.find(b => b.id === accountId)?.name || 'Account';
  }, [accountId, bankConfigs]);

  const filteredAndSorted = useMemo(() => {
    let list = accountId === 'all' 
      ? [...transactions] 
      : transactions.filter(t => t.accountId === accountId);
    
    // Apply Date Filter
    if (startDate) {
      list = list.filter(t => t.date >= startDate);
    }
    if (endDate) {
      list = list.filter(t => t.date <= endDate);
    }

    // Apply GST/Non-GST Filter
    if (typeFilter !== 'all') {
      list = list.filter(t => t.type === typeFilter);
    }

    const sorted = list.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateA - dateB;
      return a.createdAt - b.createdAt;
    });

    let currentBalance = 0;
    return sorted.map(tx => {
      currentBalance += tx.paymentIn - tx.paymentOut;
      return { ...tx, runningBalance: currentBalance };
    });
  }, [transactions, accountId, startDate, endDate, typeFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || operationPending.current) return;
    if (!editId && !bankConfigs.some(bank => bank.id === (accountId === 'all' ? formData.accountId : accountId))) return;
    operationPending.current = true;
    setPending(true); setOperationError(null);
    try {
      if (editId) {
        await onEdit(editId, {
          ...formData,
          paymentIn: Number(formData.paymentIn),
          paymentOut: Number(formData.paymentOut),
        });
        setEditId(null);
      } else {
        await onAdd({
          ...formData,
          accountId: accountId === 'all' ? formData.accountId : accountId,
          paymentIn: Number(formData.paymentIn),
          paymentOut: Number(formData.paymentOut),
        });
      }
      setFormData({
        ...formData,
        particulars: '',
        paymentIn: 0,
        paymentOut: 0
      });
      setShowAddForm(false);
    } catch (error) { setOperationError(errorMessage(error)); }
    finally { operationPending.current = false; setPending(false); }
  };

  const deleteTransaction = async () => {
    if (!deleteTarget || busy || operationPending.current) return;
    operationPending.current = true;
    setPending(true); setOperationError(null);
    try { await onDelete(deleteTarget.id); setDeleteTarget(null); }
    catch (error) { setOperationError(errorMessage(error)); }
    finally { operationPending.current = false; setPending(false); }
  };

  const handleEdit = (tx: Transaction) => {
    setOperationError(null);
    setFormData({
      date: tx.date,
      particulars: tx.particulars,
      type: tx.type,
      paymentIn: tx.paymentIn,
      paymentOut: tx.paymentOut,
      accountId: tx.accountId
    });
    setEditId(tx.id);
    setShowAddForm(true);
  };

  const handleExport = () => {
    const data = filteredAndSorted.map(t => ({
      Date: formatDate(t.date),
      Source: bankConfigs.find(b => b.id === t.accountId)?.name || `Historical account ${t.accountId}`,
      Particulars: t.particulars,
      Type: t.type,
      'Payment In': t.paymentIn,
      'Payment Out': t.paymentOut,
      'Running Balance': t.runningBalance
    }));

    const ws = (window as any).XLSX.utils.json_to_sheet(data);
    const wb = (window as any).XLSX.utils.book_new();
    (window as any).XLSX.utils.book_append_sheet(wb, ws, "Daybook");
    (window as any).XLSX.writeFile(wb, `${accountName.replace(/\s+/g, '_')}_Ledger.xlsx`);
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{accountName}</h2>
          <p className="text-xs text-gray-500">Manage your transactions and view history</p>
        </div>
        <div className="flex items-center gap-2">
          {accountId !== 'all' && (
             <select 
                aria-label="Bank account"
                value={accountId}
                onChange={(e) => onAccountChange(e.target.value)}
                className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-violet-500 outline-none"
              >
                {!bankConfigs.some(bank => bank.id === accountId) && <option value={accountId}>Historical account {accountId}</option>}
                {bankConfigs.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
          )}
          <button 
            onClick={handleExport}
            className="p-1.5 bg-white border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            title="Export to Excel"
          >
            <Download size={16} />
          </button>
          <button 
            disabled={busy || (accountId === 'all' ? bankConfigs.length === 0 : !bankConfigs.some(bank => bank.id === accountId))}
            onClick={() => {
              setEditId(null);
              setOperationError(null);
              setShowAddForm(!showAddForm);
            }}
            className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-1.5 text-xs rounded-lg hover:bg-violet-700 transition-colors font-medium"
          >
            <Plus size={16} />
            <span>{editId ? 'Edit Transaction' : 'New Transaction'}</span>
          </button>
        </div>
      </div>

      {/* Advanced Filters */}
      <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-wrap gap-3 items-center">
         <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase">From:</label>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border p-1 rounded text-xs outline-none focus:ring-1 focus:ring-violet-500"
                />
            </div>
            <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase">To:</label>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border p-1 rounded text-xs outline-none focus:ring-1 focus:ring-violet-500"
                />
            </div>
         </div>
         
         <div className="h-5 w-px bg-gray-200" />

         <div className="flex items-center gap-2">
            <Filter size={14} className="text-gray-400" />
            <label className="text-[10px] font-bold text-gray-500 uppercase">Transaction Type:</label>
            <select 
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="border p-1 rounded text-xs outline-none focus:ring-1 focus:ring-violet-500 bg-white"
            >
              <option value="all">All Transactions</option>
              <option value={TransactionType.GST}>GST Only</option>
              <option value={TransactionType.NON_GST}>Non-GST Only</option>
            </select>
         </div>

         <button 
           onClick={() => { setStartDate(''); setEndDate(''); setTypeFilter('all'); }}
           className="text-[11px] text-violet-600 font-bold hover:underline ml-auto"
         >
           Reset All Filters
         </button>
      </div>

      {deleteTarget && <dialog ref={deleteDialog} role="dialog" aria-modal="true" aria-labelledby="delete-transaction-heading" aria-describedby="delete-transaction-description"
        onCancel={event => { event.preventDefault(); cancelDelete(); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border-0 bg-white p-6 shadow-2xl backdrop:bg-black/50">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600"><Trash2 size={22} /></div>
        <h3 id="delete-transaction-heading" className="text-lg font-bold text-gray-900">Delete transaction?</h3>
        <p id="delete-transaction-description" className="mt-2 text-sm text-gray-600">Are you sure you want to delete this transaction?</p>
        <p className="mt-3 break-words text-sm font-semibold text-gray-800">{deleteTarget.particulars}</p>
        <p className="mt-1 text-sm text-gray-500">{formatDate(deleteTarget.date)} · {formatCurrency(deleteTarget.paymentIn || deleteTarget.paymentOut)}</p>
        {operationError && <p role="alert" className="mt-3 text-sm text-red-700">{operationError}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" autoFocus disabled={busy} onClick={cancelDelete} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={busy} onClick={() => void deleteTransaction()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">{pending ? 'Deleting...' : 'Confirm delete'}</button>
        </div>
      </dialog>}
      {operationError && !showAddForm && !deleteTarget && <p role="alert" className="text-red-700">{operationError}</p>}
      {showAddForm && (
        <dialog ref={transactionDialog} role="dialog" aria-modal="true" aria-labelledby="transaction-form-heading"
          onCancel={event => { event.preventDefault(); closeTransactionForm(); }}
          className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border-0 bg-white p-6 shadow-2xl backdrop:bg-black/50">
          <div className="flex justify-between items-center mb-4">
             <h3 id="transaction-form-heading" className="text-lg font-bold text-gray-900">{editId ? 'Edit Transaction' : 'New Transaction'}</h3>
             <button type="button" disabled={busy} aria-label="Close transaction form" onClick={closeTransactionForm} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X size={20}/></button>
          </div>
          {operationError && <p role="alert" className="mb-4 text-red-700">{operationError}</p>}
          <form onSubmit={handleSubmit}>
          <fieldset disabled={busy} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 uppercase">Date</label>
              <input 
                type="date" 
                required
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 uppercase">Type</label>
              <select 
                value={formData.type}
                onChange={(e) => setFormData({...formData, type: e.target.value as TransactionType})}
                className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value={TransactionType.GST}>GST</option>
                <option value={TransactionType.NON_GST}>Non-GST</option>
              </select>
            </div>
            {accountId === 'all' && (
               <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-semibold text-gray-500 uppercase">Account</label>
                <select 
                  value={formData.accountId}
                  onChange={(e) => setFormData({...formData, accountId: e.target.value})}
                  className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {editId && !bankConfigs.some(bank => bank.id === formData.accountId) && <option value={formData.accountId}>Historical account {formData.accountId}</option>}
                  {bankConfigs.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-semibold text-gray-500 uppercase">Particulars</label>
              <input 
                type="text" 
                autoFocus
                required
                placeholder="Description"
                value={formData.particulars}
                onChange={(e) => setFormData({...formData, particulars: e.target.value})}
                className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 uppercase">Payment In</label>
              <input 
                type="number" 
                min="0" step="0.01"
                placeholder="0"
                value={formData.paymentIn || ''}
                disabled={formData.paymentOut > 0}
                onChange={(e) => setFormData({...formData, paymentIn: Number(e.target.value)})}
                className={`w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-violet-500 ${formData.paymentOut > 0 ? 'bg-gray-100' : ''}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 uppercase">Payment Out</label>
              <input 
                type="number" 
                min="0" step="0.01"
                placeholder="0"
                value={formData.paymentOut || ''}
                disabled={formData.paymentIn > 0}
                onChange={(e) => setFormData({...formData, paymentOut: Number(e.target.value)})}
                className={`w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-violet-500 ${formData.paymentIn > 0 ? 'bg-gray-100' : ''}`}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end space-x-3 mt-2">
              <button 
                type="button" 
                onClick={closeTransactionForm}
                className="px-6 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-semibold"
              >
                {pending ? 'Saving...' : editId ? 'Save Changes' : 'Add Transaction'}
              </button>
            </div>
          </fieldset>
          </form>
        </dialog>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase">Date</th>
                {accountId === 'all' && <th className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase">Source</th>}
                <th className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase">Particulars</th>
                <th className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase">Type</th>
                <th className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase text-right">Payment In</th>
                <th className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase text-right">Payment Out</th>
                <th className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase text-right">Balance</th>
                <th className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={accountId === 'all' ? 8 : 7} className="px-3 py-8 text-center text-gray-400 italic">
                    No transactions found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((t) => (
                  <tr key={t.id} className="hover:bg-violet-50/30 transition-colors group">
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600 font-medium">
                      {formatDate(t.date)}
                    </td>
                    {accountId === 'all' && (
                      <td className="px-3 py-2 text-xs whitespace-nowrap text-violet-700 font-semibold uppercase">
                        {bankConfigs.find(b => b.id === t.accountId)?.name || `Historical account ${t.accountId}`}
                      </td>
                    )}
                    <td className="px-3 py-2 text-xs text-gray-900 font-medium">
                      {t.particulars}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        t.type === TransactionType.GST ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-right whitespace-nowrap font-semibold text-green-600">
                      {t.paymentIn > 0 ? formatCurrency(t.paymentIn) : '-'}
                    </td>
                    <td className="px-3 py-2 text-xs text-right whitespace-nowrap font-semibold text-red-600">
                      {t.paymentOut > 0 ? formatCurrency(t.paymentOut) : '-'}
                    </td>
                    <td className="px-3 py-2 text-xs text-right whitespace-nowrap font-bold text-gray-900">
                      {formatCurrency(t.runningBalance)}
                    </td>
                    <td className="px-3 py-2 text-xs text-center">
                      <div className="flex justify-center gap-1.5">
                        <button 
                          type="button"
                          title="Edit transaction"
                          disabled={busy}
                          aria-label={`Edit transaction ${t.particulars}`}
                          onClick={() => handleEdit(t)}
                          className="rounded-lg bg-violet-50 p-1.5 text-violet-600 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:opacity-50"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          type="button"
                          title="Delete transaction"
                          disabled={busy}
                          aria-label={`Delete transaction ${t.particulars}`}
                          onClick={() => { setOperationError(null); setDeleteTarget(t); }}
                          className="rounded-lg bg-red-50 p-1.5 text-red-600 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredAndSorted.length > 0 && (
              <tfoot className="bg-gray-50 border-t font-bold">
                <tr>
                  <td colSpan={accountId === 'all' ? 4 : 3} className="px-3 py-2 text-right text-gray-500 uppercase text-xs">Total for Selection</td>
                  <td className="px-3 py-2 text-right text-green-700">
                    {formatCurrency(filteredAndSorted.reduce((sum, t) => sum + t.paymentIn, 0))}
                  </td>
                  <td className="px-3 py-2 text-right text-red-700">
                    {formatCurrency(filteredAndSorted.reduce((sum, t) => sum + t.paymentOut, 0))}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900 bg-gray-100">
                    {formatCurrency(filteredAndSorted[filteredAndSorted.length - 1].runningBalance)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
