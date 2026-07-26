/**
 * The orchestrator is a privileged daemon (it holds docker.sock) so it
 * must never be reachable without proof the caller is the trusted
 * backend. Auth here is a single shared secret, not a full JWT/user
 * system - the backend already did real user auth before it ever calls
 * this daemon. Rotate ORCHESTRATOR_TOKEN and restart both processes to
 * invalidate it.
 */
function requireOrchestratorToken(req, res, next) {
  const expected = process.env.ORCHESTRATOR_TOKEN;
  if (!expected) {
    // Fail closed: an orchestrator with no token configured refuses all
    // requests rather than silently running unauthenticated with root-ish
    // Docker access.
    return res.status(500).json({ error: 'ORCHESTRATOR_TOKEN is not configured on this host' });
  }
  const provided = req.headers['x-orchestrator-token'];
  if (provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireOrchestratorToken };
