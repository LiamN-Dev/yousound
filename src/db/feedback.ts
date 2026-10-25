import fs from 'fs';
import path from 'path';
import { checkSqlAvailability, createPool } from './index.ts';

export type FeedbackType = 'feature' | 'bug';
export type FeedbackStatus = 'new' | 'in_progress' | 'done' | 'declined';

export interface FeedbackItem {
  id: string;
  type: FeedbackType;
  title: string;
  details: string;
  area?: string | null;
  userId?: string | null;
  username: string;
  userAgent?: string | null;
  status: FeedbackStatus;
  adminNote?: string | null;
  createdAt: string;
}

// ---- JSON file fallback (used when no SQL database is connected) ----
const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'feedback.json');

function readFile(): FeedbackItem[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as FeedbackItem[];
  } catch {
    return [];
  }
}

function writeFile(items: FeedbackItem[]) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    console.warn('[Feedback] Could not write local file:', err);
  }
}

function rowToItem(r: any): FeedbackItem {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    details: r.details || '',
    area: r.area,
    userId: r.user_id,
    username: r.username || 'Guest',
    userAgent: r.user_agent,
    status: r.status,
    adminNote: r.admin_note,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function createFeedbackDb(
  data: Pick<FeedbackItem, 'type' | 'title' | 'details' | 'area' | 'userId' | 'username' | 'userAgent'>
): Promise<FeedbackItem> {
  const item: FeedbackItem = {
    id: `fb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: data.type,
    title: data.title,
    details: data.details,
    area: data.area || null,
    userId: data.userId || null,
    username: data.username || 'Guest',
    userAgent: data.userAgent || null,
    status: 'new',
    adminNote: null,
    createdAt: new Date().toISOString(),
  };

  if (await checkSqlAvailability()) {
    try {
      await createPool().query(
        `INSERT INTO feedback_items (id, type, title, details, area, user_id, username, user_agent, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new',$9)`,
        [item.id, item.type, item.title, item.details, item.area, item.userId, item.username, item.userAgent, item.createdAt]
      );
      return item;
    } catch (err) {
      console.error('[Feedback] SQL insert failed, using local file:', err);
    }
  }
  const all = readFile();
  all.unshift(item);
  writeFile(all);
  return item;
}

export async function listFeedbackDb(): Promise<FeedbackItem[]> {
  const local = readFile();
  if (await checkSqlAvailability()) {
    try {
      const res = await createPool().query('SELECT * FROM feedback_items ORDER BY created_at DESC LIMIT 500');
      const fromSql = res.rows.map(rowToItem);
      const ids = new Set(fromSql.map((i) => i.id));
      return [...fromSql, ...local.filter((i) => !ids.has(i.id))];
    } catch (err) {
      console.error('[Feedback] SQL list failed, using local file:', err);
    }
  }
  return local;
}

export async function updateFeedbackDb(
  id: string,
  patch: { status?: FeedbackStatus; adminNote?: string | null }
): Promise<boolean> {
  if (await checkSqlAvailability()) {
    try {
      const res = await createPool().query(
        `UPDATE feedback_items
           SET status = COALESCE($2, status),
               admin_note = CASE WHEN $3::boolean THEN $4 ELSE admin_note END
         WHERE id = $1`,
        [id, patch.status ?? null, patch.adminNote !== undefined, patch.adminNote ?? null]
      );
      if ((res.rowCount ?? 0) > 0) return true;
    } catch (err) {
      console.error('[Feedback] SQL update failed:', err);
    }
  }
  const all = readFile();
  const idx = all.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  if (patch.status) all[idx].status = patch.status;
  if (patch.adminNote !== undefined) all[idx].adminNote = patch.adminNote;
  writeFile(all);
  return true;
}

export async function deleteFeedbackDb(id: string): Promise<boolean> {
  let done = false;
  if (await checkSqlAvailability()) {
    try {
      const res = await createPool().query('DELETE FROM feedback_items WHERE id = $1', [id]);
      done = (res.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[Feedback] SQL delete failed:', err);
    }
  }
  const all = readFile();
  const next = all.filter((i) => i.id !== id);
  if (next.length !== all.length) {
    writeFile(next);
    done = true;
  }
  return done;
}
