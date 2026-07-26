import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, clearToken } from '../api/client.js';
import WorkspaceCard from '../components/WorkspaceCard.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Dashboard({ user, onLogout }) {
  const { notify, confirmAction } = useToast();
  const [workspaces, setWorkspaces] = useState([]);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', image: '', repoUrl: '' });
  const [error, setError] = useState('');

  async function refresh() {
    const [wsData, imgData] = await Promise.all([api.listWorkspaces(), api.listImages()]);
    setWorkspaces(wsData.workspaces);
    setImages(imgData.images);
    if (!form.image && imgData.images.length) {
      setForm((f) => ({ ...f, image: imgData.images[0] }));
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createWorkspace(form);
      setShowCreate(false);
      setForm({ name: '', image: images[0] || '', repoUrl: '' });
      notify('Workspace created and starting up.', { type: 'success' });
      await refresh();
    } catch (err) {
      setError(err.message);
      notify(err.message, { type: 'error' });
    }
  }

  async function handleStart(id) {
    setBusyId(id);
    try {
      await api.startWorkspace(id);
      await refresh();
    } catch (err) {
      notify(err.message, { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleStop(id) {
    setBusyId(id);
    try {
      await api.stopWorkspace(id);
      notify('Workspace stopped.', { type: 'success' });
      await refresh();
    } catch (err) {
      notify(err.message, { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id) {
    const ok = await confirmAction(
      'This removes its container and all data permanently. This cannot be undone.',
      { title: 'Delete this workspace?', danger: true }
    );
    if (!ok) return;

    setBusyId(id);
    try {
      await api.deleteWorkspace(id);
      notify('Workspace deleted.', { type: 'success' });
      await refresh();
    } catch (err) {
      notify(err.message, { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ember)', fontSize: 20 }}>&gt;_</span>
          <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>Forge</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{user.email}</span>
          {user.hasBillingAccount && (
            <button
              className="btn"
              onClick={async () => {
                try {
                  const { url } = await api.billingPortal();
                  window.location.href = url;
                } catch (err) {
                  notify(err.message, { type: 'error' });
                }
              }}
            >
              Manage billing
            </button>
          )}
          {user.role === 'admin' && (
            <Link className="btn" to="/admin">
              Admin
            </Link>
          )}
          <button
            className="btn"
            onClick={() => {
              clearToken();
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: 0, color: 'var(--text-secondary)', fontWeight: 500 }}>
          Your workspaces ({workspaces.length}/{user.maxWorkspaces})
        </h2>
        <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
          + New workspace
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 20,
            marginBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <input
            placeholder="Workspace name (e.g. my-api-project)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <select value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })}>
            {images.map((img) => (
              <option key={img} value={img}>
                {img}
              </option>
            ))}
          </select>
          <input
            placeholder="Git repo URL (optional) — cloned automatically on first start"
            value={form.repoUrl}
            onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
          />
          {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit">
              Create + start
            </button>
            <button className="btn" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-secondary)' }}>Loading workspaces…</div>
      ) : workspaces.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border-bright)',
            borderRadius: 8,
            padding: 40,
            textAlign: 'center',
            color: 'var(--text-secondary)',
          }}
        >
          No workspaces yet. Create one to spin up your first cloud dev container.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              busy={busyId === ws.id}
              onStart={handleStart}
              onStop={handleStop}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
