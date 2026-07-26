import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

function levelClass(percent) {
  if (percent >= 90) return 'hot';
  if (percent >= 70) return 'warn';
  return '';
}

export default function ResourceGauge({ workspaceId, running }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!running) {
      setStats(null);
      return;
    }

    let cancelled = false;
    async function poll() {
      try {
        const { stats } = await api.getStats(workspaceId);
        if (!cancelled) setStats(stats);
      } catch {
        // container may have just stopped between polls - ignore, next
        // successful poll (or the status flip) will resolve it
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workspaceId, running]);

  if (!running || !stats) return null;

  const memPercent = stats.memoryLimitMb ? (stats.memoryUsageMb / stats.memoryLimitMb) * 100 : 0;
  const cpuPercent = Math.min(stats.cpuPercent, 100);

  return (
    <div className="gauge">
      <div className="gauge-row">
        <span style={{ width: 32 }}>CPU</span>
        <div className="gauge-track">
          <div className={`gauge-fill ${levelClass(cpuPercent)}`} style={{ width: `${cpuPercent}%` }} />
        </div>
        <span style={{ width: 40, textAlign: 'right' }}>{stats.cpuPercent}%</span>
      </div>
      <div className="gauge-row">
        <span style={{ width: 32 }}>RAM</span>
        <div className="gauge-track">
          <div className={`gauge-fill ${levelClass(memPercent)}`} style={{ width: `${memPercent}%` }} />
        </div>
        <span style={{ width: 40, textAlign: 'right' }}>{Math.round(memPercent)}%</span>
      </div>
    </div>
  );
}
