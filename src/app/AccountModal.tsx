import { useEffect, useState } from 'react';
import { Modal } from '../platform/Modal';
import { useAuth } from '../cloud/auth';
import { getProfile, updateDisplayName } from '../cloud/profile';

type Mode = 'signin' | 'signup' | 'reset';

const COPY: Record<Mode, { title: string; submit: string }> = {
  signin: { title: 'Sign in', submit: 'Sign in' },
  signup: { title: 'Create an account', submit: 'Create account' },
  reset: { title: 'Reset your password', submit: 'Send reset link' },
};

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function AccountModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();

  if (!auth.enabled) {
    return (
      <Modal title="Accounts are not set up" onClose={onClose}>
        <p>
          This copy of the app was built without cloud credentials, so it runs entirely in your
          browser. Your work is still autosaved locally, and you can save <code>.dbm.json</code>{' '}
          files or share diagrams as links.
        </p>
        <p className="panel-hint">
          To switch cloud sync on, set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> and rebuild — see the README.
        </p>
      </Modal>
    );
  }

  return auth.user ? <ManageAccount onClose={onClose} /> : <SignIn onClose={onClose} />;
}

/* -------------------------------------------------------------------------- */
/* Signed in                                                                  */
/* -------------------------------------------------------------------------- */

function ManageAccount({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const userId = auth.user!.id;

  const [displayName, setDisplayName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<null | 'name' | 'password'>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getProfile(userId)
      .then((p) => {
        if (!live) return;
        setDisplayName(p.displayName);
        setSavedName(p.displayName);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId]);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    setBusy('name');
    try {
      await updateDisplayName(userId, displayName);
      setSavedName(displayName.trim());
      setDone('Name updated. It is what teammates see next to your changes.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy('password');
    try {
      await auth.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone('Password changed. You are still signed in here.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Account" onClose={onClose}>
      <p className="panel-hint">
        Signed in as <strong>{auth.user!.email}</strong>
      </p>

      {error && <p className="auth-error">{error}</p>}
      {done && <p className="auth-note">{done}</p>}

      <section className="sublist">
        <h3>Display name</h3>
        <form className="auth-form" onSubmit={saveName}>
          <Field
            label="Name"
            hint="Shown next to your edits in a project's history and activity."
          >
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Brian"
            />
          </Field>
          <button
            type="submit"
            disabled={busy !== null || !displayName.trim() || displayName.trim() === savedName}
          >
            {busy === 'name' ? 'Saving…' : 'Save name'}
          </button>
        </form>
      </section>

      <section className="sublist">
        <h3>Change password</h3>
        <form className="auth-form" onSubmit={changePassword}>
          <Field
            label="Current password"
            hint="Asked for so that an unattended session cannot be used to lock you out."
          >
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </Field>
          <button
            type="submit"
            className="primary"
            disabled={busy !== null || !current || !next || !confirm}
          >
            {busy === 'password' ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="sublist">
        <p className="panel-hint">
          Diagrams you save are private to this account until you publish one from the library.
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
      </section>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Signed out                                                                 */
/* -------------------------------------------------------------------------- */

function SignIn({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

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
