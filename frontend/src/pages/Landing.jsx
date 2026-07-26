import React from 'react';
import { Link } from 'react-router-dom';

const FEATURES = [
  {
    title: 'Instant cloud workspaces',
    body: 'Click "New workspace" and get a fully provisioned, isolated container in under a minute - no local Docker setup, no dependency hell.',
  },
  {
    title: 'Browser terminal, zero install',
    body: 'Every workspace opens in an in-browser terminal immediately. Nothing to configure before you can start typing.',
  },
  {
    title: 'Real VS Code, over SSH',
    body: 'Prefer your own editor? Connect with VS Code Remote-SSH or our companion extension and work exactly like you would locally.',
  },
  {
    title: 'Self-hosted, your data',
    body: "Run it on your own server. It's open source - no vendor lock-in, no third party holding your code.",
  },
  {
    title: 'Per-user resource quotas',
    body: 'Admins set CPU/RAM limits per user and a cluster-wide cap, so one workspace can never take down the whole host.',
  },
  {
    title: 'Built for teams',
    body: 'An admin panel for managing users, plans, and workspaces across your whole team from one place.',
  },
];

export default function Landing() {
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 24px' }}>
      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '22px 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ember)', fontSize: 20 }}>&gt;_</span>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Forge</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn" to="/pricing">
            Pricing
          </Link>
          <Link className="btn" to="/login">
            Sign in
          </Link>
          <Link className="btn btn-primary" to="/login?mode=register">
            Get started
          </Link>
        </div>
      </nav>

      <section style={{ padding: '64px 0 56px', textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            fontSize: 12,
            color: 'var(--teal)',
            border: '1px solid var(--border-bright)',
            borderRadius: 20,
            padding: '4px 12px',
            marginBottom: 20,
          }}
        >
          Open source · self-hosted
        </div>
        <h1 style={{ fontSize: 40, lineHeight: 1.15, margin: '0 0 18px', fontWeight: 800 }}>
          Cloud dev environments,
          <br />
          on your own infrastructure.
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 16,
            maxWidth: 560,
            margin: '0 auto 32px',
            lineHeight: 1.6,
          }}
        >
          The Codespaces / Gitpod experience — instant containers, a browser terminal,
          VS Code Remote-SSH — without handing your code to someone else's cloud.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link className="btn btn-primary" to="/login?mode=register" style={{ padding: '10px 22px', fontSize: 14 }}>
            Get started free
          </Link>
          <Link className="btn" to="/pricing" style={{ padding: '10px 22px', fontSize: 14 }}>
            See pricing
          </Link>
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          padding: '20px 0 72px',
        }}
      >
        {FEATURES.map((f) => (
          <div
            key={f.title}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 22,
            }}
          >
            <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{f.title}</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>{f.body}</p>
          </div>
        ))}
      </section>

      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '20px 0 40px',
          color: 'var(--text-muted)',
          fontSize: 12,
          textAlign: 'center',
        }}
      >
        Forge is open source. Self-host it, fork it, or run it for your team.
      </footer>
    </div>
  );
}
