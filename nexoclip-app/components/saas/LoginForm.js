'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { saasFetch } from '../../src/lib/saas/api.js';
import { getAuthRequest, validateAuthFields } from '../../src/lib/saas/authForm.js';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginForm() {
  const router = useRouter();
  const requestedReturnTo = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('next');
  const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
    ? requestedReturnTo
    : '/studio';
  const [step, setStep] = useState('email'); // 'email' | 'password'
  const [values, setValues] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (!code) return;
    const messages = {
      google: 'Google sign-in failed. Please try again.',
      google_state: 'Your sign-in session expired. Please try again.',
      google_unconfigured: 'Google sign-in is not configured yet.',
    };
    setError(messages[code] || 'Something went wrong. Please try again.');
  }, []);

  function continueWithEmail(event) {
    event.preventDefault();
    setNotice(null);
    const email = values.email.trim();
    if (!email) return setError('Email is required.');
    if (!EMAIL_RE.test(email)) return setError('Enter a valid email address.');
    setError(null);
    setStep('password');
  }

  function backToEmail() {
    setError(null);
    setNotice(null);
    setStep('email');
  }

  async function submitLogin(event) {
    event.preventDefault();
    const errors = validateAuthFields(values);
    if (errors.password) return setError(errors.password);
    setLoading(true);
    setError(null);
    try {
      const { path, options } = getAuthRequest('login', values);
      await saasFetch(path, options);
      router.push(returnTo);
    } catch (cause) {
      setError(cause?.message || 'We could not sign you in. Please try again.');
      setLoading(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-black/15 bg-white px-3.5 py-3 text-sm text-[#111] placeholder:text-black/35 outline-none transition focus:border-black/40 disabled:opacity-60';
  const primaryBtn =
    'w-full rounded-lg bg-gradient-to-b from-[#3a3a3a] to-[#1e1e1e] px-4 py-3 text-sm font-medium text-white transition hover:from-[#454545] hover:to-[#252525] disabled:opacity-60';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2f2f2] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex justify-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#0b0b0c] text-lg font-black text-[#22d3ee]">
            N
          </div>
        </div>

        <h1 className="mb-8 text-center text-2xl font-semibold text-[#111]">Welcome to Nexoclip</h1>

        {error && (
          <p role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-3 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 text-sm text-black/60">
            {notice}
          </p>
        )}

        {step === 'email' ? (
          <>
            <a
              href="/api/auth/google"
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 text-sm font-medium text-[#111] shadow-sm transition hover:bg-black/[0.02]"
            >
              <GoogleIcon />
              Continue with Google
            </a>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-black/10" />
              <span className="text-xs font-medium text-black/40">OR</span>
              <span className="h-px flex-1 bg-black/10" />
            </div>

            <form onSubmit={continueWithEmail} className="space-y-3" noValidate>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="Enter email"
                autoFocus
                value={values.email}
                onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
                className={inputClass}
              />
              <button type="submit" className={primaryBtn}>Continue</button>
            </form>
          </>
        ) : (
          <form onSubmit={submitLogin} className="space-y-3" noValidate>
            <button
              type="button"
              onClick={backToEmail}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-black/10 bg-white px-3.5 py-2.5 text-left text-sm text-[#111] transition hover:bg-black/[0.02]"
            >
              <span className="min-w-0 truncate">{values.email}</span>
              <span className="flex-shrink-0 text-xs font-medium text-black/45">Change</span>
            </button>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              autoFocus
              value={values.password}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
              disabled={loading}
              className={inputClass}
            />
            <button type="submit" disabled={loading} className={primaryBtn}>
              {loading ? 'Please wait…' : 'Continue'}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-xs leading-5 text-black/45">
          New to Nexoclip?{' '}
          <Link href="/register" className="font-medium text-black/70 underline underline-offset-2 hover:text-black">
            Create an account
          </Link>
          <br />
          By clicking “Continue” you agree to our{' '}
          <a href="https://www.nexoclip.com/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-black/70">Terms of use</a>{' '}&amp;{' '}
          <a href="https://www.nexoclip.com/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-black/70">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}
