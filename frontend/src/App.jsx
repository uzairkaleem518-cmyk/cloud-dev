import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Pricing from './pages/Pricing.jsx';
import Login from './pages/Login.jsx';
import OAuthCallback from './pages/OAuthCallback.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import WorkspaceView from './pages/WorkspaceView.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import { api, getToken, clearToken } from './api/client.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setChecked(true);
      return;
    }
    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => clearToken())
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return null;

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Landing />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route
          path="/login"
          element={user ? <Navigate to="/dashboard" /> : <Login onLogin={setUser} />}
        />
        <Route path="/oauth-callback" element={<OAuthCallback onLogin={setUser} />} />
        <Route
          path="/onboarding"
          element={
            !user ? (
              <Navigate to="/login" />
            ) : user.onboarded ? (
              <Navigate to="/dashboard" />
            ) : (
              <Onboarding user={user} onUserUpdate={setUser} />
            )
          }
        />
        <Route
          path="/dashboard"
          element={
            !user ? (
              <Navigate to="/login" />
            ) : !user.onboarded ? (
              <Navigate to="/onboarding" />
            ) : (
              <Dashboard user={user} onLogout={() => setUser(null)} />
            )
          }
        />
        <Route
          path="/workspace/:id"
          element={user ? <WorkspaceView /> : <Navigate to="/login" />}
        />
        <Route
          path="/admin"
          element={
            user?.role === 'admin' ? <AdminPanel user={user} /> : <Navigate to={user ? '/dashboard' : '/login'} />
          }
        />
      </Routes>
    </div>
  );
}
