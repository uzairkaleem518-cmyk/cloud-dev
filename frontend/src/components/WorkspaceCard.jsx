import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SSHConnectModal from './SSHConnectModal.jsx';
import ResourceGauge from './ResourceGauge.jsx';

export default function WorkspaceCard({ workspace, onStart, onStop, onDelete, busy }) {
  const navigate = useNavigate();
  const [showSSH, setShowSSH] = useState(false);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{workspace.name}</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {workspace.image}
          </div>
        </div>
        <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}>
          <span className={`status-dot ${workspace.status}`} />
          {workspace.status}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {workspace.cpuLimit} vCPU · {workspace.memoryLimitMb} MB RAM
      </div>

      <ResourceGauge workspaceId={workspace.id} running={workspace.status === 'running'} />

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {workspace.status === 'running' ? (
          <>
            <button className="btn btn-primary" onClick={() => navigate(`/workspace/${workspace.id}`)}>
              Open terminal
            </button>
            <button className="btn" onClick={() => setShowSSH(true)}>
              Connect via SSH
            </button>
            <button className="btn" disabled={busy} onClick={() => onStop(workspace.id)}>
              Stop
            </button>
          </>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={() => onStart(workspace.id)}>
            Start
          </button>
        )}
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => onDelete(workspace.id)}
          style={{ marginLeft: 'auto' }}
        >
          Delete
        </button>
      </div>

      {showSSH && <SSHConnectModal workspace={workspace} onClose={() => setShowSSH(false)} />}
    </div>
  );
}
