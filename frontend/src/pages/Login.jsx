import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, setToken } from '../api/client.js';

export default function Login({ onLogin }) {
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'login';
  const plan = searchParams.get('plan');
  const oauthError = searchParams.get('error');

  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(oauthError || '');
  const [loading, setLoading] = useState(false);
  const [oauthConfig, setOauthConfig] = useState({ google: false, github: false });
  const navigate = useNavigate();

  useEffect(() => {
    api.oauthConfig().then(setOauthConfig).catch(() => {});
  }, []);

  function oauthUrl(provider) {
    return `/api/auth/${provider}${plan ? `?plan=${encodeURIComponent(plan)}` : ''}`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data =
        mode === 'login'
          ? await api.login(form)
          : await api.register({ ...form, plan: plan || 'free' });
      setToken(data.token);
      onLogin(data.user);
      navigate(mode === 'register' ? '/onboarding' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: 380,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '32px 28px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ember)', fontSize: 20 }}>
            &gt;_
          </span>
          <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>Forge</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4, marginBottom: 24 }}>
          Self-hosted cloud dev environments.
        </p>

        {mode === 'register' && plan && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--teal)',
              border: '1px solid var(--border-bright)',
              borderRadius: 6,
              padding: '6px 10px',
              marginBottom: 16,
            }}
          >
            Signing up for the <strong style={{ textTransform: 'capitalize' }}>{plan}</strong> plan
          </div>
        )}

        {(oauthConfig.google || oauthConfig.github) && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {oauthConfig.google && (
                <a
                  href={oauthUrl('google')}
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    textDecoration: 'none',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.6 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z" />
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.6 3.5 24 3.5c-7.7 0-14.4 4.4-17.7 11.2z" />
                    <path fill="#4CAF50" d="M24 44.5c5.5 0 10.4-1.9 14.1-5.1l-6.5-5.4C29.6 35.8 27 36.7 24 36.7c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.5 39.9 16.2 44.5 24 44.5z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.5 5.4C41.4 36.5 44.5 30.8 44.5 24c0-1.2-.1-2.4-.3-3.5z" />
                  </svg>
                  Continue with Google
                </a>
              )}
              {oauthConfig.github && (
                <a
                  href={oauthUrl('github')}
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    textDecoration: 'none',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  Continue with GitHub
                </a>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' && (
            <input
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
          />

          {error && (
            <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>
          )}

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 13, color: 'var(--text-secondary)' }}>
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button
                onClick={() => setMode('register')}
                style={{ background: 'none', border: 'none', color: 'var(--ember)', cursor: 'pointer', padding: 0 }}
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => setMode('login')}
                style={{ background: 'none', border: 'none', color: 'var(--ember)', cursor: 'pointer', padding: 0 }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
      <div style={{ position: 'absolute', top: 20, left: 24 }}>
        <Link to="/" style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
