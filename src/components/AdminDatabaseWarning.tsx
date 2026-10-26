import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface DbStatus {
  isSqlConnected?: boolean;
  lastError?: string | null;
  connectionSource?: 'env' | 'admin-panel' | 'none';
}

/**
 * Big red warning shown to admins when the database is NOT saving data permanently.
 * (When that happens, songs, accounts, announcements and chats vanish on every redeploy.)
 */
export const AdminDatabaseWarning: React.FC = () => {
  const [status, setStatus] = useState<DbStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/admin/database/status');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch (_) {}
    };
    load();
    const t = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!status || status.isSqlConnected !== false) return null;

  return (
    <div className="mb-5 p-4 sm:p-5 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-100">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed space-y-2">
          <p className="text-sm font-bold text-white">Your data is NOT being saved permanently</p>
          <p>
            The site is using a temporary disk that Render erases on every update. Songs, accounts,
            announcements and chats you add now will disappear at the next redeploy, and the 4 default songs will come back.
          </p>
          <p>
            <strong>How to fix it:</strong> in Render, open your service, go to <strong>Environment</strong>, add a variable
            named <code className="px-1 rounded bg-black/30">DATABASE_URL</code> and paste your Supabase{' '}
            <strong>Session pooler</strong> connection string (Supabase &rarr; Connect &rarr; Session pooler). Then redeploy.
          </p>
          {status.lastError && (
            <p className="text-rose-200/80 break-words">
              What the server reported: <span className="font-mono">{status.lastError}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
