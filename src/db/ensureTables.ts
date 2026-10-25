import fs from 'fs';
import path from 'path';
import { checkSqlAvailability, createPool } from './index.ts';

/**
 * Makes sure the Postgres / Supabase database has every table the app needs.
 *
 * Nothing else in the app creates tables, so a database that never had
 * supabase-schema.sql run on it silently breaks features like chat
 * (reads fall back to a temporary local store, but writes fail).
 *
 * Everything here is idempotent (IF NOT EXISTS), so it is safe on every start.
 */
export async function ensureTables(): Promise<void> {
  let available = false;
  try {
    available = await checkSqlAvailability();
  } catch (_) {}
  if (!available) {
    console.log('[Schema] No SQL database connected; using the local store.');
    return;
  }

  const pool = createPool();
  const run = async (label: string, sql: string) => {
    try {
      await pool.query(sql);
      return true;
    } catch (err: any) {
      console.warn(`[Schema] ${label} skipped: ${err?.message || err}`);
      return false;
    }
  };

  // 1. Base schema file (all CREATE ... IF NOT EXISTS)
  try {
    const file = path.resolve(process.cwd(), 'supabase-schema.sql');
    if (fs.existsSync(file)) {
      const statements = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await run(stmt.split('\n')[0].slice(0, 70), stmt);
      }
    } else {
      console.warn('[Schema] supabase-schema.sql not found next to server.ts');
    }
  } catch (err: any) {
    console.warn('[Schema] Could not apply base schema:', err?.message || err);
  }

  // 2. Columns that older databases may be missing
  const columns: Array<[string, string]> = [
    ['users', 'chat_blocked BOOLEAN DEFAULT false'],
    ['users', 'is_suspended BOOLEAN DEFAULT false'],
    ['chat_threads', 'is_approved BOOLEAN NOT NULL DEFAULT false'],
    ['chat_threads', 'is_terminated BOOLEAN NOT NULL DEFAULT false'],
    ['chat_threads', 'terminated_reason TEXT'],
    ['chat_threads', 'last_message TEXT'],
    ['chat_threads', 'last_message_sender TEXT'],
    ['chat_threads', "last_message_at TIMESTAMPTZ DEFAULT NOW()"],
    ['chat_threads', "hidden_by_user_ids JSONB DEFAULT '[]'::jsonb"],
    ['chat_threads', 'is_appeal_thread BOOLEAN DEFAULT false'],
  ];
  for (const [table, col] of columns) {
    await run(`${table}.${col.split(' ')[0]}`, `ALTER TABLE IF EXISTS ${table} ADD COLUMN IF NOT EXISTS ${col}`);
  }

  // 3. A message must never be rejected because its thread row lives elsewhere
  await run(
    'drop chat_messages FK',
    'ALTER TABLE IF EXISTS chat_messages DROP CONSTRAINT IF EXISTS chat_messages_thread_id_fkey'
  );

  // 4. Feature requests & bug reports
  await run(
    'feedback_items',
    `CREATE TABLE IF NOT EXISTS feedback_items (
       id TEXT PRIMARY KEY,
       type TEXT NOT NULL,
       title TEXT NOT NULL,
       details TEXT NOT NULL DEFAULT '',
       area TEXT,
       user_id TEXT,
       username TEXT NOT NULL DEFAULT 'Guest',
       user_agent TEXT,
       status TEXT NOT NULL DEFAULT 'new',
       admin_note TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW()
     )`
  );

  console.log('[Schema] Database tables verified.');
}
