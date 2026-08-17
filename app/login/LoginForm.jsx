'use client';

import { useActionState } from 'react';
import { signIn } from './actions';

export default function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-stone-500" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          className="w-full rounded border border-stone-300 px-3 py-2 focus:border-stone-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-stone-500" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded border border-stone-300 px-3 py-2 focus:border-stone-500 focus:outline-none"
        />
      </div>

      {state?.error && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-stone-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
