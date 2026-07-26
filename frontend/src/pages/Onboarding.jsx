import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

const STEPS = ['Pick an image', 'Create workspace', 'Connect'];

export default function Onboarding({ user, onUserUpdate }) {
  const { notify } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState('');
  const [name, setName] = useState('my-first-workspace');
  const [workspace, setWorkspace] = useState(null);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    api
      .listImages()
      .then((data) => {
        setImages(data.images);
        setSelectedImage(data.images[0] || '');
      })
      .catch((err) => notify(err.message, { type: 'error' }));
  }, []);

  async function finish() {
    setFinishing(true);
    try {
      const { user: updated } = await api.completeOnboarding();
      onUserUpdate?.(updated);
      navigate('/dashboard');
    } catch (err) {
      notify(err.message, { type: 'error' });
    } finally {
      setFinishing(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const { workspace } = await api.createWorkspace({ name, image: selectedImage });
      setWorkspace(workspace);
      setStep(2);
      notify('Workspace created.', { type: 'success' });
    } catch (err) {
      notify(err.message, { type: 'error' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ember)', fontSize: 20 }}>&gt;_</span>
        <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>Welcome, {user?.name?.split(' ')[0] || 'there'}.</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 28 }}>
        Let's get your first workspace running — it takes about a minute.
      </p>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
        {STEPS.map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div
              style={{
                height: 3,
                borderRadius: 2,
                background: i <= step ? 'var(--teal)' : 'var(--border)',
                marginBottom: 6,
              }}
            />
            <div style={{ fontSize: 11, color: i === step ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 24 }}>
        {step === 0 && (
          <>
            <h3 style={{ fontSize: 14, margin: '0 0 14px' }}>What kind of workspace do you need?</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {images.map((img) => (
                <label
                  key={img}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    border: `1px solid ${selectedImage === img ? 'var(--ember)' : 'var(--border)'}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <input
                    type="radio"
                    name="image"
                    value={img}
                    checked={selectedImage === img}
                    onChange={() => setSelectedImage(img)}
                  />
                  <span className="mono">{img}</span>
                </label>
              ))}
              {images.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading images…</p>}
            </div>
            <button className="btn btn-primary" disabled={!selectedImage} onClick={() => setStep(1)}>
              Continue
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h3 style={{ fontSize: 14, margin: '0 0 14px' }}>Name your workspace</h3>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-first-workspace"
              style={{ width: '100%', marginBottom: 20 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="btn btn-primary" disabled={creating || !name} onClick={handleCreate}>
                {creating ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </>
        )}

        {step === 2 && workspace && (
          <>
            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>
              <span className="status-dot running" /> {workspace.name} is starting up
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              Your workspace will show as <strong>running</strong> on the dashboard in a few seconds.
              From there you can open the browser terminal right away, or click "Connect via SSH" for
              VS Code Remote-SSH details.
            </p>
            <button className="btn btn-primary" disabled={finishing} onClick={finish}>
              {finishing ? 'Finishing…' : 'Go to dashboard'}
            </button>
          </>
        )}
      </div>

      {step < 2 && (
        <button
          onClick={finish}
          disabled={finishing}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 12,
            marginTop: 16,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Skip for now →
        </button>
      )}
    </div>
  );
}
