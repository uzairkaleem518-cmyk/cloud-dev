const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getBackendUrl() {
  return vscode.workspace.getConfiguration('forge').get('backendUrl');
}

async function apiRequest(context, path, options = {}) {
  const token = await context.secrets.get('forge.token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${getBackendUrl()}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function login(context) {
  const email = await vscode.window.showInputBox({ prompt: 'Forge account email' });
  if (!email) return;
  const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
  if (!password) return;

  try {
    const data = await apiRequest(context, '/api/auth/login', { method: 'POST', body: { email, password } });
    await context.secrets.store('forge.token', data.token);
    vscode.window.showInformationMessage(`Signed in to Forge as ${data.user.email}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Forge sign-in failed: ${err.message}`);
  }
}

async function signOut(context) {
  await context.secrets.delete('forge.token');
  vscode.window.showInformationMessage('Signed out of Forge.');
}

/**
 * Writes/updates a single Host block in the user's ~/.ssh/config, keeping
 * every other entry untouched. Matches by the "Host forge-<id>" line.
 */
function upsertSSHConfigEntry(hostAlias, block) {
  const sshDir = path.join(os.homedir(), '.ssh');
  const configPath = path.join(sshDir, 'config');
  fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });

  let existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const hostHeader = `Host ${hostAlias}`;

  const lines = existing.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === hostHeader);

  if (startIdx === -1) {
    existing = existing.trimEnd() + `\n\n${block}\n`;
  } else {
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^Host\s/.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    lines.splice(startIdx, endIdx - startIdx, ...block.split('\n'));
    existing = lines.join('\n');
  }

  fs.writeFileSync(configPath, existing, { mode: 0o600 });
}

async function connect(context) {
  let workspaces;
  try {
    const data = await apiRequest(context, '/api/workspaces');
    workspaces = data.workspaces.filter((w) => w.status === 'running');
  } catch (err) {
    vscode.window.showErrorMessage(`Could not load workspaces: ${err.message}. Try "Forge: Sign In" first.`);
    return;
  }

  if (workspaces.length === 0) {
    vscode.window.showWarningMessage('No running Forge workspaces. Start one from the dashboard first.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    workspaces.map((w) => ({ label: w.name, description: w.image, id: w.id })),
    { placeHolder: 'Choose a workspace to connect to' }
  );
  if (!picked) return;

  let conn;
  try {
    conn = await apiRequest(context, `/api/workspaces/${picked.id}/ssh-connect`, { method: 'POST' });
  } catch (err) {
    vscode.window.showErrorMessage(`Could not prepare SSH access: ${err.message}`);
    return;
  }

  const keysDir = path.join(os.homedir(), '.forge', 'keys');
  fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(keysDir, picked.id);
  fs.writeFileSync(keyPath, conn.privateKey, { mode: 0o600 });

  const hostAlias = `forge-${picked.id}`;
  upsertSSHConfigEntry(
    hostAlias,
    [
      `Host ${hostAlias}`,
      `  HostName ${conn.host}`,
      `  Port ${conn.port}`,
      `  User ${conn.username}`,
      `  IdentityFile ${keyPath}`,
      `  StrictHostKeyChecking accept-new`,
    ].join('\n')
  );

  const remoteUri = vscode.Uri.parse(`vscode-remote://ssh-remote+${hostAlias}${conn.remotePath}`);
  await vscode.commands.executeCommand('vscode.openFolder', remoteUri, { forceNewWindow: true });
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('forge.login', () => login(context)),
    vscode.commands.registerCommand('forge.signOut', () => signOut(context)),
    vscode.commands.registerCommand('forge.connect', () => connect(context))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
