
import React from 'react';
import { User, BankConfig } from '../types';
import {
  LayoutDashboard,
  BookOpen,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  Wallet,
  RefreshCw
} from 'lucide-react';

interface LayoutProps {
  user: User;
  companyPlan: string | null;
  planLoading: boolean;
  planError: string | null;
  onRefreshPlan: () => void;
  onLogout: () => void;
  currentView: string;
  onViewChange: (view: any) => void;
  bankConfigs: BankConfig[];
  children: React.ReactNode;
  onBackToSwitchboard?: () => void;
  switchingDisabled?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({
  user,
  companyPlan,
  planLoading,
  planError,
  onRefreshPlan,
  onLogout,
  currentView,
  onViewChange,
  onBackToSwitchboard,
  switchingDisabled,
  children
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'ledger', label: 'Daybook', icon: BookOpen },
    { id: 'consolidated', label: 'Consolidated Ledger', icon: Wallet },
    { id: 'settings', label: 'Account Settings', icon: SettingsIcon },
  ];

  return (
    <div className="h-[100dvh] overflow-hidden flex bg-gray-50">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 h-full w-64 shrink-0 bg-violet-950 text-white transform transition-transform duration-200 ease-in-out z-30
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0 flex flex-col
      `}>
        <div className="p-6 shrink-0">
          <h1 className="break-words text-2xl font-bold tracking-tight">
            {user.companyName || 'My Company'}
          </h1>

          <p className="text-violet-300 text-[10px] mt-1 uppercase tracking-widest font-bold">
            Powered by Skyline Globle
          </p>
        </div>

        <nav className="mt-4 min-h-0 px-3 space-y-1 flex-1 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onViewChange(item.id);
                setIsSidebarOpen(false);
              }}
              className={`
                w-full flex items-center space-x-3 px-3 py-3 rounded-lg transition-colors group
                ${currentView === item.id ? 'bg-violet-800 text-white shadow-lg' : 'text-violet-200 hover:bg-violet-900 hover:text-white'}
              `}
            >
              <item.icon size={18} className="shrink-0" />
              <span className="font-medium text-sm whitespace-nowrap truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="shrink-0 p-4 border-t border-violet-900 bg-violet-950">
          <div className="flex items-center justify-between mb-4 px-2">
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold truncate">{user.fullName}</span>
              <span className="text-[10px] text-violet-400 uppercase font-black tracking-tighter">
                {user.role === 'SUPER_ADMIN' ? 'Super Admin' : user.isAdmin ? 'Administrator' : 'User'}
              </span>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-violet-900 hover:bg-red-900 transition-colors rounded-lg text-xs font-bold uppercase tracking-wider"
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {onBackToSwitchboard && <div className="shrink-0 bg-violet-950 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm" role="status">
          <strong>SUPER ADMIN — Viewing: {user.companyName}</strong>
          <button disabled={switchingDisabled} onClick={onBackToSwitchboard} className="rounded-lg border border-violet-400 px-3 py-1.5 hover:bg-violet-900 disabled:opacity-50">Back to Company Switchboard</button>
        </div>}
        <header className="bg-white border-b h-12 flex items-center justify-between px-4 shrink-0">
          <button
            className="lg:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-md"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="flex-1 flex items-center justify-end">
            <div className="mr-auto flex items-center gap-1 rounded-full border border-violet-100 bg-violet-50 px-2.5 py-0.5 text-[11px] text-violet-700">
              <span role={planError ? 'alert' : 'status'} title={planError || undefined}>
                Plan: <strong>{planLoading ? 'Loading...' : companyPlan || (planError ? 'Could not load' : 'Not configured')}</strong>
              </span>
              <button type="button" onClick={onRefreshPlan} disabled={planLoading}
                aria-label="Refresh company plan" title={planError || 'Refresh company plan'}
                className="rounded p-1 hover:bg-violet-100 disabled:opacity-50">
                <RefreshCw size={12} className={planLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mr-4 hidden md:block">
              Region: <span className="text-gray-900 ml-1">India</span> | Currency: <span className="text-gray-900 ml-1">INR (₹)</span>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-auto overscroll-contain p-3 md:p-4 lg:p-5">
          {children}
        </div>
      </main>
    </div>
  );
};
