import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PLANS } from '../plans.js';
import { api, getToken } from '../api/client.js';

export default function Pricing() {
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState('');
  const isLoggedIn = Boolean(getToken());

  async function handlePlanClick(plan) {
    // Free plan (or anyone not logged in) just goes through normal
    // signup/login - no Stripe involved for $0.
    if (plan.id === 'free' || !isLoggedIn) return; // <Link> handles navigation

    setError('');
    setLoadingPlan(plan.id);
    try {
      const { url } = await api.checkoutPlan(plan.id);
      window.location.href = url; // hand off to Stripe Checkout
    } catch (err) {
      setError(err.message);
      setLoadingPlan(null);
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }}>
      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '22px 0',
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'baseline', gap: 8, textDecoration: 'none' }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ember)', fontSize: 20 }}>&gt;_</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Forge</span>
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn" to="/login">
            Sign in
          </Link>
        </div>
      </nav>

      <div style={{ textAlign: 'center', padding: '36px 0 44px' }}>
        <h1 style={{ fontSize: 30, margin: '0 0 10px', fontWeight: 800 }}>Simple, self-hosted pricing</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
          Every plan runs on your own server. Pricing only sets your resource quota — admins can
          always adjust it per user afterwards.
        </p>
        {error && (
          <p style={{ color: 'var(--ember, #e5534b)', fontSize: 13, marginTop: 12 }}>{error}</p>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 18,
          paddingBottom: 60,
          alignItems: 'stretch',
        }}
      >
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            style={{
              background: 'var(--bg-card)',
              border: plan.highlighted ? '1px solid var(--ember)' : '1px solid var(--border)',
              borderRadius: 12,
              padding: 26,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
            {plan.highlighted && (
              <span
                style={{
                  position: 'absolute',
                  top: -11,
                  left: 24,
                  background: 'var(--ember)',
                  color: '#1b1204',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 10px',
                  borderRadius: 10,
                }}
              >
                MOST POPULAR
              </span>
            )}
            <h2 style={{ fontSize: 17, margin: '4px 0 4px' }}>{plan.name}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '0 0 16px', minHeight: 32 }}>
              {plan.tagline}
            </p>
            <div style={{ marginBottom: 20 }}>
              <span style={{ fontSize: 30, fontWeight: 800 }}>{plan.price}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}> {plan.period}</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
              {plan.features.map((f) => (
                <li
                  key={f}
                  style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    padding: '7px 0',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  {f}
                </li>
              ))}
            </ul>
            {plan.id === 'free' || !isLoggedIn ? (
              <Link
                className={plan.highlighted ? 'btn btn-primary' : 'btn'}
                to={`/login?mode=register&plan=${plan.id}`}
                style={{ textAlign: 'center' }}
              >
                {plan.cta}
              </Link>
            ) : (
              <button
                type="button"
                className={plan.highlighted ? 'btn btn-primary' : 'btn'}
                onClick={() => handlePlanClick(plan)}
                disabled={loadingPlan === plan.id}
                style={{ textAlign: 'center' }}
              >
                {loadingPlan === plan.id ? 'Redirecting…' : `Upgrade to ${plan.name}`}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
