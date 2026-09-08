import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { cloudEnabled, supabase } from './supabase';

interface AuthValue {
  enabled: boolean;
  /** Undefined until the initial session lookup finishes. */
  ready: boolean;
  user: User | null;
  session: Session | null;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  /** Verifies the current password before setting the new one. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Turns Supabase's error strings into something a student can act on. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return 'Could not reach the accounts service. Check your connection — or the app may be misconfigured.';
  }
  if (m.includes('invalid login credentials')) {
    return 'That email and password combination was not recognised.';
  }
  if (m.includes('email not confirmed')) {
    return 'Check your inbox and confirm your email address before signing in.';
  }
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'An account with that email already exists — try signing in instead.';
  }
  if (m.includes('password should be') || m.includes('password must')) {
    return 'Passwords need to be at least 8 characters.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts just now. Wait a minute and try again.';
  }
  // Raised when leaked-password protection is on and the password appears in a
  // known breach.
  if (m.includes('pwned') || m.includes('known to be weak') || m.includes('compromis')) {
    return 'That password appears in a known data breach. Pick a different one.';
  }
  if (m.includes('should be different from the old')) {
    return 'That is the password you already have.';
  }
  return message;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!cloudEnabled);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      enabled: cloudEnabled,
      ready,
      session,
      user: session?.user ?? null,

      async signUp(email, password) {
        const client = supabase!;
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        });
        if (error) throw new Error(friendly(error.message));
        // Supabase returns a user with no session when confirmation is required.
        return { needsConfirmation: !data.session };
      },

      async signIn(email, password) {
        const client = supabase!;
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new Error(friendly(error.message));
      },

      async signOut() {
        await supabase?.auth.signOut();
      },

      async changePassword(currentPassword, newPassword) {
        const client = supabase!;
        const email = session?.user?.email;
        if (!email) throw new Error('You are not signed in.');

        // Re-authenticate first: a session alone should not be enough to
        // change the password on a machine somebody walked away from.
        const { error: checkError } = await client.auth.signInWithPassword({
          email,
          password: currentPassword,
        });
        if (checkError) {
          throw new Error(
            checkError.message.toLowerCase().includes('invalid login')
              ? 'That is not your current password.'
              : friendly(checkError.message),
          );
        }

        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) throw new Error(friendly(error.message));
      },

      async sendPasswordReset(email) {
        const client = supabase!;
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname,
        });
        if (error) throw new Error(friendly(error.message));
      },
    }),
    [ready, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
