import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

export default function AdminPanel({ user }) {
  const { notify, confirmAction } = useToast();
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  async function refresh() {
    const [ov, u, w] = await Promise.all([
      api.adminOverview(),
      api.adminListUsers(),
      api.adminListWorkspaces(),
    ]);
    setOverview(ov);
    setUsers(u.users);
    setWorkspaces(w.workspaces);
  }

  useEffect(() => {
    refresh()
      .catch((err) => notify(err.message, { type: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  async function saveUser(id, patch) {
    setSavingId(id);
    try {
      await api.adminUpdateUser(id, patch);
      notify('User updated.', { type: 'success' });
      await refresh();
    } catch (err) {
      notify(err.message, { type: 'error' });
    } finally {
      setSavingId(null);
    }
  }

  async function forceDeleteWorkspace(id, name) {
    const ok = await confirmAction(`This removes "${name}"'s container and volume permanently.`, {
      title: 'Force-delete this workspace?',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.adminDeleteWorkspace(id);
      notify('Workspace deleted.', { type: 'success' });
      await refresh();
    } catch (err) {
      notify(err.message, { type: 'error' });
    }
  }

  async function sendTestEmail(id, type) {
    try {
      await api.adminSendTestEmail(id, type);
      notify(`"${type}" email sent (or logged, if SMTP isn't configured yet).`, { type: 'success' });
    } catch (err) {
      notify(err.message, { type: 'error' });
    }
  }

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading admin panel…</div>;
  }

  const cpuPercent = overview?.maxCpu ? (overview.allocatedCpu / overview.maxCpu) * 100 : null;
  const memPercent = overview?.maxMemoryMb ? (overview.allocatedMemoryMb / overview.maxMemoryMb) * 100 : null;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ember)', fontSize: 20 }}>&gt;_</span>
          <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>Forge Admin</h1>
        </div>
        <Link className="btn" to="/dashboard">
          ← Back to dashboard
        </Link>
      </header>

      {overview && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
            marginBottom: 32,
          }}
        >
          <StatCard label="Users" value={overview.userCount} />
          <StatCard label="Workspaces" value={`${overview.runningCount}/${overview.totalWorkspaceCount} running`} />
          <StatCard
            label="Cluster CPU allocated"
            value={overview.maxCpu ? `${overview.allocatedCpu} / ${overview.maxCpu} vCPU` : `${overview.allocatedCpu} vCPU (no cap set)`}
            percent={cpuPercent}
          />
          <StatCard
            label="Cluster RAM allocated"
            value={
              overview.maxMemoryMb
                ? `${overview.allocatedMemoryMb} / ${overview.maxMemoryMb} MB`
                : `${overview.allocatedMemoryMb} MB (no cap set)`
            }
            percent={memPercent}
          />
        </section>
      )}

      <h2 style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 500 }}>Users</h2>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 32, overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Plan</th>
              <th>Role</th>
              <th>Workspaces</th>
              <th>Max workspaces</th>
              <th>CPU quota</th>
              <th>RAM quota (MB)</th>
              <th>Status</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                onSave={saveUser}
                onTestEmail={sendTestEmail}
                saving={savingId === u.id}
                isSelf={u.id === user.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 500 }}>All workspaces</h2>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Owner</th>
              <th>Image</th>
              <th>Status</th>
              <th>CPU / RAM</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((w) => (
              <tr key={w.id}>
                <td>{w.name}</td>
                <td>{w.owner?.email || '—'}</td>
                <td className="mono">{w.image}</td>
                <td>
                  <span className="status-dot" style={{ background: 'var(--teal)' }} />
                  {w.status}
                </td>
                <td>
                  {w.cpuLimit} vCPU · {w.memoryLimitMb} MB
                </td>
                <td>
                  <button className="btn btn-danger" onClick={() => forceDeleteWorkspace(w.id, w.name)}>
                    Force delete
                  </button>
                </td>
              </tr>
            ))}
            {workspaces.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                  No workspaces yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, percent }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
      {percent !== null && percent !== undefined && (
        <div className="gauge-track" style={{ marginTop: 8 }}>
          <div
            className={`gauge-fill ${percent >= 90 ? 'hot' : percent >= 70 ? 'warn' : ''}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function UserRow({ u, onSave, onTestEmail, saving, isSelf }) {
  const [draft, setDraft] = useState({
    role: u.role,
    maxWorkspaces: u.maxWorkspaces,
    cpuLimit: u.cpuLimit ?? '',
    memoryLimitMb: u.memoryLimitMb ?? '',
  });
  const [emailType, setEmailType] = useState('welcome');
  const dirty =
    draft.role !== u.role ||
    Number(draft.maxWorkspaces) !== u.maxWorkspaces ||
    String(draft.cpuLimit) !== String(u.cpuLimit ?? '') ||
    String(draft.memoryLimitMb) !== String(u.memoryLimitMb ?? '');

  return (
    <tr>
      <td>{u.email}</td>
      <td style={{ textTransform: 'capitalize' }}>{u.plan || 'free'}</td>
      <td>
        <select
          disabled={isSelf}
          value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td>{u.workspaceCount}</td>
      <td>
        <input
          type="number"
          min={0}
          value={draft.maxWorkspaces}
          onChange={(e) => setDraft({ ...draft, maxWorkspaces: e.target.value })}
        />
      </td>
      <td>
        <input
          type="number"
          placeholder="default"
          min={0}
          value={draft.cpuLimit}
          onChange={(e) => setDraft({ ...draft, cpuLimit: e.target.value })}
        />
      </td>
      <td>
        <input
          type="number"
          placeholder="default"
          min={0}
          value={draft.memoryLimitMb}
          onChange={(e) => setDraft({ ...draft, memoryLimitMb: e.target.value })}
        />
      </td>
      <td>
        {isSelf ? (
          <span className="tag">you</span>
        ) : u.suspended ? (
          <span className="tag suspended">suspended</span>
        ) : u.role === 'admin' ? (
          <span className="tag admin">admin</span>
        ) : (
          <span className="tag">active</span>
        )}
      </td>
      <td style={{ display: 'flex', gap: 6 }}>
        {!isSelf && (
          <>
            <button
              className="btn btn-primary"
              disabled={!dirty || saving}
              onClick={() =>
                onSave(u.id, {
                  role: draft.role,
                  maxWorkspaces: Number(draft.maxWorkspaces),
                  cpuLimit: draft.cpuLimit === '' ? null : Number(draft.cpuLimit),
                  memoryLimitMb: draft.memoryLimitMb === '' ? null : Number(draft.memoryLimitMb),
                })
              }
            >
              Save
            </button>
            <button className="btn" disabled={saving} onClick={() => onSave(u.id, { suspended: !u.suspended })}>
              {u.suspended ? 'Unsuspend' : 'Suspend'}
            </button>
          </>
        )}
      </td>
      <td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={emailType} onChange={(e) => setEmailType(e.target.value)} style={{ width: 110 }}>
          <option value="welcome">Welcome</option>
          <option value="usage_alert">Usage alert</option>
          <option value="payment_failed">Payment failed</option>
        </select>
        <button className="btn" onClick={() => onTestEmail(u.id, emailType)}>
          Send test
        </button>
      </td>
    </tr>
  );
}
