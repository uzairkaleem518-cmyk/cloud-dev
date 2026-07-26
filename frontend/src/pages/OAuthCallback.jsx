import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, setToken } from '../api/client.js';

export default function OAuthCallback({ onLogin }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('No token received from sign-in. Please try again.');
      return;
    }

    setToken(token);
    api
      .me()
      .then(({ user }) => {
        onLogin(user);
        navigate(user.onboarded ? '/dashboard' : '/onboarding', { replace: true });
      })
      .catch(() => setError('Could not complete sign-in. Please try again.'));
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        textAlign: 'center',
        padding: 24,
      }}
    >
      {error ? (
        <div>
          <p style={{ color: 'var(--red)', fontSize: 14, marginBottom: 12 }}>{error}</p>
          <Link className="btn" to="/login">
            Back to login
          </Link>
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Signing you in…</p>
      )}
    </div>
  );
}
