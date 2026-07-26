import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const resolveRef = useRef(null);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message, { type = 'info', duration = 4000 } = {}) => {
      const id = ++idCounter;
      setToasts((t) => [...t, { id, message, type }]);
      if (duration) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const confirmAction = useCallback((message, { title = 'Are you sure?', danger = false } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setConfirmState({ message, title, danger });
    });
  }, []);

  function handleConfirmResult(result) {
    setConfirmState(null);
    resolveRef.current?.(result);
  }

  return (
    <ToastContext.Provider value={{ notify, confirmAction }}>
      {children}

      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 100,
          maxWidth: 340,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`toast toast-${t.type}`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {confirmState && (
        <div
          onClick={() => handleConfirmResult(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 380,
              maxWidth: '90vw',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-bright)',
              borderRadius: 10,
              padding: 22,
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>{confirmState.title}</h3>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-secondary)' }}>
              {confirmState.message}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => handleConfirmResult(false)}>
                Cancel
              </button>
              <button
                className={confirmState.danger ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => handleConfirmResult(true)}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
