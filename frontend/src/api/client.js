const BASE = '/api';

function getToken() {
  return localStorage.getItem('cde_token');
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: () => request('/auth/me'),
  completeOnboarding: () => request('/auth/onboarding/complete', { method: 'POST' }),
  oauthConfig: () => request('/auth/oauth-config'),

  listWorkspaces: () => request('/workspaces'),
  listImages: () => request('/workspaces/images'),
  createWorkspace: (payload) => request('/workspaces', { method: 'POST', body: payload }),
  startWorkspace: (id) => request(`/workspaces/${id}/start`, { method: 'POST' }),
  stopWorkspace: (id) => request(`/workspaces/${id}/stop`, { method: 'POST' }),
  deleteWorkspace: (id) => request(`/workspaces/${id}`, { method: 'DELETE' }),
  getStats: (id) => request(`/workspaces/${id}/stats`),
  getSSHConnect: (id) => request(`/workspaces/${id}/ssh-connect`, { method: 'POST' }),

  // Admin-only (server also enforces this - these just 403 for non-admins)
  adminOverview: () => request('/admin/overview'),
  adminListUsers: () => request('/admin/users'),
  adminUpdateUser: (id, payload) => request(`/admin/users/${id}`, { method: 'PATCH', body: payload }),
  adminListWorkspaces: () => request('/admin/workspaces'),
  adminDeleteWorkspace: (id) => request(`/admin/workspaces/${id}`, { method: 'DELETE' }),
  adminSendTestEmail: (id, type) => request(`/admin/users/${id}/test-email`, { method: 'POST', body: { type } }),
  adminListHosts: () => request('/admin/hosts'),

  // Billing (Stripe) - both return a URL to redirect the browser to.
  checkoutPlan: (plan) => request('/billing/checkout', { method: 'POST', body: { plan } }),
  billingPortal: () => request('/billing/portal', { method: 'POST' }),
};

export function setToken(token) {
  localStorage.setItem('cde_token', token);
}
export function clearToken() {
  localStorage.removeItem('cde_token');
}
export { getToken };
