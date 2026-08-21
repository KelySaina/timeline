export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  birthday: string | null;
  avatarKey: string | null;
  tokenVersion: number;
};

export type CoupleContext = {
  id: string;
  role: 'owner' | 'partner';
  title: string | null;
  startedOn: string | null;
  theme: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      couple?: CoupleContext;
      valid?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}
