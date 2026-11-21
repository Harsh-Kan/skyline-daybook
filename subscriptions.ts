export const TRIAL_DAYS = 14;
export const PLAN_LIMITS = {
  Startup: { banks: 2, users: 2 },
  Growth: { banks: 5, users: 5 },
  Business: { banks: Infinity, users: 10 }
} as const;
const TRIAL_LIMITS = { banks: 1, users: 1 } as const;

export const SUBSCRIPTION_COLUMNS = 'plan_name, trial_start_date, trial_end_date, created_at';

export const getPlanName = (name?: string | null) => name?.trim() || null;
export const isTrialPlan = (name?: string | null) => getPlanName(name)?.toLowerCase() === 'trial';

export function getPlanLimits(name?: string | null) {
  if (isTrialPlan(name)) return TRIAL_LIMITS;
  const normalizedName = getPlanName(name)?.toLowerCase();
  return Object.entries(PLAN_LIMITS).find(([plan]) => plan.toLowerCase() === normalizedName)?.[1];
}

export interface Subscription {
  planName: string;
  bankLimit: number;
  userLimit: number;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  trialExpired: boolean;
}

interface CompanySubscriptionRow {
  plan_name?: string | null;
  trial_start_date?: string | null;
  trial_end_date?: string | null;
  created_at?: string | null;
}

export function getSubscription(company: CompanySubscriptionRow, now = Date.now()): Subscription {
  const planName = getPlanName(company.plan_name);
  const limits = getPlanLimits(planName);
  if (!planName || !limits) throw new Error('The company subscription plan is not configured.');
  const { banks: bankLimit, users: userLimit } = limits;
  if (!isTrialPlan(planName)) {
    return { planName, bankLimit, userLimit, trialEndsAt: null, trialDaysRemaining: null, trialExpired: false };
  }
  const start = Date.parse(company.trial_start_date || company.created_at || '');
  const end = company.trial_end_date
    ? Date.parse(company.trial_end_date)
    : start + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(end)) throw new Error('The Trial end date is not configured.');
  return { planName, bankLimit, userLimit,
    trialEndsAt: new Date(end).toISOString(),
    trialDaysRemaining: Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000))),
    trialExpired: now >= end };
}

export const formatLimit = (limit: number) => limit === Infinity ? 'Unlimited' : String(limit);
