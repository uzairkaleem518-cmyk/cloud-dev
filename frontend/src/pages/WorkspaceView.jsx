import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { getToken } from '../api/client.js';

export default function WorkspaceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [connError, setConnError] = useState('');

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 14,
      theme: {
        background: '#0f1214',
        foreground: '#e8ecee',
        cursor: '#e8873a',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

    const token = getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
     `${protocol}://${window.location.host}/ws/terminal?token=${token}&workspaceId=${id}`
    );
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      term.writeln('\x1b[38;2;79;209;197mConnected to workspace container.\x1b[0m');
    };
    ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
     term.write(event.data);
    } else {
     term.write(new Uint8Array(event.data));
    }
    };
    ws.onerror = () => {
      setConnError('Could not connect to the workspace terminal.');
    };
    ws.onclose = () => {
      term.writeln('\r\n\x1b[38;2;229;83;75m[disconnected]\x1b[0m');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
    };
  }, [id]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        <button className="btn" onClick={() => navigate('/dashboard')}>
          ← Back
        </button>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          workspace/{id}
        </span>
        {connError && <span style={{ color: 'var(--red)', fontSize: 13 }}>{connError}</span>}
      </div>
      <div ref={containerRef} style={{ flex: 1, padding: 8 }} />
    </div>
  );
}
