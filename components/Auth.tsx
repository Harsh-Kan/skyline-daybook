
import React, { useRef, useState } from 'react';
import { User } from '../types';
import { ArrowLeft, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../supabase';

interface AuthProps {
  onLogin: (user: User) => void;
  initialMode?: AuthMode;
}

type AuthMode = 'login' | 'signup' | 'forgot';
const authOptions = [{ mode: 'login', label: 'Login' }, { mode: 'signup', label: 'Sign Up' }] as const;
const submitLabels = { login: 'Log in', signup: 'Create account', forgot: 'Send reset link' };
const fieldClass = 'w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-200';
const linkClass = 'rounded text-sm font-semibold text-violet-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-600';

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-violet-950 bg-gradient-to-br from-violet-900 via-violet-950 to-slate-950 px-4 py-10 sm:py-14">
      <div className="w-full max-w-md">
        <header className="mb-7 text-center sm:mb-9">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Skyline Globle</h1>
          <p className="mt-2 text-sm font-semibold tracking-wide text-violet-200">Daybook Manager</p>
        </header>
        <section aria-labelledby="auth-heading" className="rounded-3xl bg-white p-6 shadow-2xl sm:p-9">
          {children}
        </section>
      </div>
    </main>
  );
}

export const AuthView: React.FC<AuthProps> = ({ onLogin, initialMode = 'login' }) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const recovering = mode === 'forgot';

  const changeMode = (nextMode: AuthMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'forgot' || recovering) emailInput.current?.focus();
    setMode(nextMode);
    setPassword('');
    setShowPassword(false);
    setError(null);
    setMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);

    const address = email.trim();
    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) throw error;
        if (data.user) {
          onLogin({
            id: data.user.id,
            email: data.user.email || '',
            fullName: '',
            companyName: '',
            // Company permissions are loaded from company_users after login.
            role: 'EXECUTIVE',
            isAdmin: false
          });
        }
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email: address, password });
        if (error) throw error;
        setMessage('Check your email to confirm your account.');
      } else {
        const redirect = new URL(window.location.href);
        redirect.search = '';
        redirect.hash = '';
        redirect.searchParams.set('reset-password', '1');
        const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: redirect.href });
        if (error) throw error;
        setMessage('If an account exists for this email, you’ll receive a password reset link.');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <AuthFrame>
          {!recovering && (
            <div role="group" aria-label="Account access" className="mb-7 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {authOptions.map(option => (
                <button
                  key={option.mode}
                  type="button"
                  aria-pressed={mode === option.mode}
                  disabled={submitting}
                  onClick={() => changeMode(option.mode)}
                  className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 ${mode === option.mode ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-600 hover:text-violet-800'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          <div className="mb-6">
            <h2 id="auth-heading" className="text-2xl font-bold tracking-tight text-slate-900">
              {recovering ? 'Reset your password' : mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h2>
            {recovering && <p className="mt-2 text-sm leading-relaxed text-slate-600">Enter your account email and we’ll send you a link to reset your password.</p>}
          </div>

          <form onSubmit={handleSubmit} aria-busy={submitting} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="auth-email" className="block text-sm font-semibold text-slate-700">Email address</label>
              <input
                ref={emailInput}
                id="auth-email"
                name="email"
                type="email"
                autoComplete={recovering ? 'email' : 'username'}
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
                className={fieldClass}
                placeholder="you@example.com"
              />
            </div>

            {!recovering && (
              <div className="space-y-2">
                <label htmlFor="auth-password" className="block text-sm font-semibold text-slate-700">Password</label>
                <div className="relative">
                  <input
                    id="auth-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    className={`${fieldClass} pr-12`}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(visible => !visible)}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-500 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600"
                  >
                    {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
                  </button>
                </div>
                {mode === 'login' && (
                  <div className="text-right">
                    <button type="button" onClick={() => changeMode('forgot')} disabled={submitting} className={linkClass}>Forgot password?</button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
                <AlertCircle size={18} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {message && (
              <div role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 size={18} className="shrink-0" />
                <span>{message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-violet-700 px-4 py-3 font-semibold text-white transition hover:bg-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-600 disabled:opacity-60"
            >
              {submitting ? 'Please wait…' : submitLabels[mode]}
            </button>
          </form>

          {recovering && (
            <button type="button" onClick={() => changeMode('login')} disabled={submitting} className={`${linkClass} mt-5 inline-flex items-center gap-2`}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to login
            </button>
          )}
    </AuthFrame>
  );
};

export function ResetPasswordView({ userId, onFinish, onRequestLink }: {
  userId: string | null;
  onFinish: () => void;
  onRequestLink: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updatePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || saving) return;
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data, error: identityError } = await supabase.auth.getUser();
      if (identityError || data.user?.id !== userId) {
        throw new Error('Your reset session has expired. Request a new link.');
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirmation('');
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update your password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const requestLink = async () => {
    setSaving(true);
    setError(null);
    try { await onRequestLink(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not return to password recovery.'); }
    finally { setSaving(false); }
  };

  return (
    <AuthFrame>
      <h2 id="auth-heading" className="text-2xl font-bold tracking-tight text-slate-900">
        {saved ? 'Password updated' : userId ? 'Choose a new password' : 'Reset link unavailable'}
      </h2>
      {saved ? (
        <button type="button" className={`${linkClass} mt-5`} onClick={onFinish}>Continue to dashboard</button>
      ) : (
        <>
          {userId ? (
            <form onSubmit={updatePassword} aria-busy={saving} className="mt-5 space-y-4">
              <div className="space-y-2">
                <label htmlFor="new-password" className="block text-sm font-semibold text-slate-700">New password</label>
                <input id="new-password" type="password" autoComplete="new-password" required className={fieldClass}
                  value={password} onChange={event => setPassword(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-password" className="block text-sm font-semibold text-slate-700">Confirm new password</label>
                <input id="confirm-password" type="password" autoComplete="new-password" required className={fieldClass}
                  value={confirmation} onChange={event => setConfirmation(event.target.value)} />
              </div>
              <button type="submit" disabled={saving} className="w-full rounded-xl bg-violet-700 px-4 py-3 font-semibold text-white hover:bg-violet-800 disabled:opacity-60">
                {saving ? 'Updating…' : 'Update password'}
              </button>
            </form>
          ) : <p className="mt-2 text-sm text-slate-600">This reset link is invalid, expired, or already used.</p>}
          {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
          <button type="button" className={`${linkClass} mt-5`} disabled={saving} onClick={requestLink}>Request a new link</button>
        </>
      )}
    </AuthFrame>
  );
}
