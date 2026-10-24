import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, PoolConfig } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _isSqlAvailable: boolean | undefined;
  var _isSqlChecked: boolean | undefined;
  var _activeSupabaseUrl: string | undefined;
}

let isChecked = false;
let isAvailable = false;
let activeConnectionString: string | undefined =
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;

export const setSupabaseConnectionString = (connStr: string | undefined) => {
  activeConnectionString = connStr;
  isChecked = false;
  isAvailable = false;
  if (global._postgresPool) {
    try {
      global._postgresPool.end();
    } catch (_) {}
    global._postgresPool = undefined;
  }
};

export const getActiveConnectionString = (): string | undefined => {
  return activeConnectionString;
};

export const getPoolConfig = (): PoolConfig => {
  const connStr = activeConnectionString || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (connStr && connStr.trim().startsWith('postgres')) {
    return {
      connectionString: connStr.trim(),
      ssl: {
        rejectUnauthorized: false,
      },
      max: 10,
      connectionTimeoutMillis: 3000,
    };
  }

  return {
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    max: 10,
    connectionTimeoutMillis: 1500,
  };
};

export const checkSqlAvailability = async (): Promise<boolean> => {
  if (isChecked) return isAvailable;

  const config = getPoolConfig();
  if (!config.connectionString && (!config.host || !config.user)) {
    isChecked = true;
    isAvailable = false;
    return false;
  }

  const testPool = new Pool(config);

  try {
    await testPool.query('SELECT 1');
    isAvailable = true;
    console.log('[Database] Successfully connected to PostgreSQL / Supabase!');
  } catch (err: any) {
    isAvailable = false;
  } finally {
    try {
      await testPool.end();
    } catch (_) {}
    isChecked = true;
  }

  return isAvailable;
};

export const getSqlAvailabilitySync = (): boolean => {
  return isAvailable;
};

export const createPool = () => {
  if (!global._postgresPool) {
    const config = getPoolConfig();
    global._postgresPool = new Pool(config);

    global._postgresPool.on('error', (err) => {
      if (err.message.includes('ENOENT') || err.message.includes('Connection terminated')) {
        isAvailable = false;
        return;
      }
      console.warn('[SQL Pool Warning]:', err.message);
    });
  }
  return global._postgresPool;
};

const pool = createPool();
export const db = drizzle(pool, { schema });
