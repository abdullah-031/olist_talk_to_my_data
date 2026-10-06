import { useState } from 'react';
import { LoaderCircle, LockKeyhole, TriangleAlert } from 'lucide-react';
import { request } from '../api';

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in. Please try again.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm animate-rise">
        <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-strong">
          <LockKeyhole aria-hidden="true" size={20} />
        </span>
        <h1 className="mt-5 mb-2 text-2xl font-semibold tracking-tight text-ink">
          Talk to your data
        </h1>
        <p className="mt-0 mb-7 text-sm text-ink-2">
          Sign in with the username and password you were given to try the assistant.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="text-xs font-semibold text-ink-2">
              Username
            </label>
            <input
              id="username"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[0.9375rem] text-ink outline-none transition-colors focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-semibold text-ink-2">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[0.9375rem] text-ink outline-none transition-colors focus:border-accent"
            />
          </div>

          {error && (
            <p
              className="m-0 flex items-start gap-2 rounded-xl border border-warn-ink/20 bg-warn-bg px-3 py-2.5 text-sm text-warn-ink"
              role="alert"
            >
              <TriangleAlert aria-hidden="true" size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[0.9375rem] font-semibold text-on-accent shadow-sm transition-[background-color,opacity] hover:bg-accent-strong disabled:opacity-50"
          >
            {busy && <LoaderCircle aria-hidden="true" size={16} className="animate-spin" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 mb-0 text-xs text-ink-3">
          Your conversations stay private to this browser.
        </p>
      </div>
    </main>
  );
}
