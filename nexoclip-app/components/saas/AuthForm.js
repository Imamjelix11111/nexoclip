'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { saasFetch } from '../../src/lib/saas/api.js';
import { getAuthRequest, validateAuthFields } from '../../src/lib/saas/authForm.js';

export default function AuthForm({ mode = 'login' }) {
  const router = useRouter();
  const register = mode === 'register';
  const [values, setValues] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const errors = validateAuthFields(values);
    if (Object.keys(errors).length) return setError(Object.values(errors)[0]);
    setLoading(true); setError(null);
    try { await saasFetch(getAuthRequest(mode, values).path, getAuthRequest(mode, values).options); router.push('/studio'); }
    catch (cause) { setError(cause?.message || 'We could not complete that request. Please try again.'); setLoading(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4 py-12"><form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-2xl border border-white/10 bg-white/[.04] p-8" noValidate>
    <h1 className="text-2xl font-semibold text-white">{register ? 'Create your NexoClip account' : 'Welcome back'}</h1>
    <p className="text-sm text-white/60">{register ? 'Start your hosted AI content workspace.' : 'Sign in to continue to your workspace.'}</p>
    {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    <label className="block text-sm text-white/80">Email<input name="email" type="email" autoComplete="email" value={values.email} onChange={e => setValues(v => ({ ...v, email: e.target.value }))} disabled={loading} className="mt-2 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-white" /></label>
    <label className="block text-sm text-white/80">Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={values.password} onChange={e => setValues(v => ({ ...v, password: e.target.value }))} disabled={loading} className="mt-2 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-white" /></label>
    <button type="submit" disabled={loading} className="w-full rounded-lg bg-cyan-400 px-4 py-2 font-medium text-black disabled:opacity-50">{loading ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
    <p className="text-center text-sm text-white/60">{register ? 'Already have an account? ' : 'New to NexoClip? '}<Link className="text-cyan-300" href={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p>
    <Link className="block text-center text-sm text-white/50" href="/studio">Continue to Studio</Link>
  </form></main>;
}
