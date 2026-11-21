
export enum TransactionType {
  GST = 'GST',
  NON_GST = 'Non-GST'
}

export interface Transaction {
  id: string;

  companyId?: string;

  createdBy?: string;

  accountId: string;

  date: string;

  particulars: string;

  type: TransactionType;

  paymentIn: number;

  paymentOut: number;

  runningBalance: number;

  createdAt: number;
}

export interface BankConfig {
  id: string;
  companyId?: string;
  name: string;
  position?: number;
  isCash?: boolean;
}

export interface User {
  id?: string;
  email?: string;
  fullName?: string;

  companyName?: string;

  companyId?: string;

  role:
    | 'SUPER_ADMIN'
    | 'ADMIN'
    | 'EXECUTIVE';

  isAdmin: boolean;
}

export interface AppState {
  currentUser: User | null;
  transactions: Transaction[];
  bankConfigs: BankConfig[];
}
