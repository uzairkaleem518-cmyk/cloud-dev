import React, { useState } from 'react';
import { api } from '../api/client.js';

export default function SSHConnectModal({ workspace, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');

  React.useEffect(() => {
    api
      .getSSHConnect(workspace.id)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [workspace.id]);

  function copy(text, label) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  }

  function downloadKey() {
    const blob = new Blob([data.privateKey], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forge-${workspace.id}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const sshCommand = data
    ? `ssh -i ~/.forge/keys/${workspace.id} -p ${data.port} ${data.username}@${data.host}`
    : '';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-bright)',
          borderRadius: 10,
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Connect via SSH / VS Code</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <div style={{ color: 'var(--text-secondary)' }}>Generating a fresh keypair…</div>}
        {error && <div style={{ color: 'var(--red)' }}>{error}</div>}

        {data && (
          <>
            <div
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 12,
                fontSize: 13,
                color: 'var(--ember)',
                marginBottom: 16,
              }}
            >
              This key is shown once and not stored on the server. Save it now — requesting a
              new connection later replaces it.
            </div>

            <Field label="1. Save the private key" hint="Save to ~/.forge/keys/<workspace-id> with chmod 600">
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={downloadKey}>
                  Download key file
                </button>
                <button className="btn" onClick={() => copy(data.privateKey, 'key')}>
                  {copied === 'key' ? 'Copied!' : 'Copy key text'}
                </button>
              </div>
            </Field>

            <Field label="2. Add to your SSH config (optional, for VS Code Remote-SSH)">
              <pre style={preStyle}>{data.sshConfigSnippet}</pre>
              <button className="btn" onClick={() => copy(data.sshConfigSnippet, 'config')} style={{ marginTop: 8 }}>
                {copied === 'config' ? 'Copied!' : 'Copy config block'}
              </button>
            </Field>

            <Field label="3. Or connect directly from a terminal">
              <pre style={preStyle}>{sshCommand}</pre>
              <button className="btn" onClick={() => copy(sshCommand, 'cmd')} style={{ marginTop: 8 }}>
                {copied === 'cmd' ? 'Copied!' : 'Copy command'}
              </button>
            </Field>

            <Field label="4. In VS Code">
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                Install the <strong>Remote - SSH</strong> extension, run "Remote-SSH: Connect to
                Host…", pick <span className="mono">forge-{workspace.id}</span>, and open{' '}
                <span className="mono">{data.remotePath}</span>. Or install the Forge extension
                and use "Forge: Connect to Workspace" to do all of this in one click.
              </p>
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  );
}

const preStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: 12,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  overflowX: 'auto',
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};
