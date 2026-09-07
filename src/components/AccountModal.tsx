import { useState } from 'react';
import { Modal } from './Modal';
import { useAuth } from '../cloud/auth';

type Mode = 'signin' | 'signup' | 'reset';

const COPY: Record<Mode, { title: string; submit: string }> = {
  signin: { title: 'Sign in', submit: 'Sign in' },
  signup: { title: 'Create an account', submit: 'Create account' },
  reset: { title: 'Reset your password', submit: 'Send reset link' },
};

export function AccountModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!auth.enabled) {
    return (
      <Modal title="Accounts are not set up" onClose={onClose}>
        <p>
          This copy of the app was built without cloud credentials, so it runs entirely in your
          browser. Your work is still autosaved locally, and you can save <code>.eer.json</code>{' '}
          files or share diagrams as links.
        </p>
        <p className="panel-hint">
          To switch cloud sync on, set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> and rebuild — see the README.
        </p>
      </Modal>
    );
  }

  if (auth.user) {
    return (
      <Modal title="Account" onClose={onClose}>
        <p>
          Signed in as <strong>{auth.user.email}</strong>.
        </p>
        <p className="panel-hint">
          Diagrams you save to the cloud are private to this account until you publish one from the
          library.
        </p>
        <button
          type="button"
          onClick={async () => {
            await auth.signOut();
            onClose();
          }}
        >
          Sign out
        </button>
      </Modal>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await auth.signIn(email.trim(), password);
        onClose();
      } else if (mode === 'signup') {
        const { needsConfirmation } = await auth.signUp(email.trim(), password);
        if (needsConfirmation) {
          setDone(`Almost there — confirm the link we sent to ${email.trim()}, then sign in.`);
          setMode('signin');
          setPassword('');
        } else {
          onClose();
        }
      } else {
        await auth.sendPasswordReset(email.trim());
        setDone('If that address has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={COPY[mode].title} onClose={onClose}>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>

        {mode !== 'reset' && (
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            />
          </label>
        )}

        {error && <p className="auth-error">{error}</p>}
        {done && <p className="auth-note">{done}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Working…' : COPY[mode].submit}
        </button>

        <div className="auth-switch">
          {mode !== 'signin' && (
            <button type="button" className="link" onClick={() => setMode('signin')}>
              Sign in
            </button>
          )}
          {mode !== 'signup' && (
            <button type="button" className="link" onClick={() => setMode('signup')}>
              Create an account
            </button>
          )}
          {mode !== 'reset' && (
            <button type="button" className="link" onClick={() => setMode('reset')}>
              Forgot password
            </button>
          )}
        </div>

        <p className="panel-hint">
          Accounts exist only to save your diagrams across devices. Nothing else is collected.
        </p>
      </form>
    </Modal>
  );
}
