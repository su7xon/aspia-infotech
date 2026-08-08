import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

dotenv.config();

const DRIVER = process.env.DB_DRIVER || 'sqlite';

let mysqlPool: any = null;
let sqliteDb: DatabaseSync | null = null;

export function getDriver(): string {
  return DRIVER;
}

const nodeRequire = createRequire(import.meta.url);

function getSqlite(): DatabaseSync {
  if (!sqliteDb) {
    const file = process.env.SQLITE_DB_FILE || './data/sop_chatbot.db';
    mkdirSync(dirname(file), { recursive: true });
    sqliteDb = new DatabaseSync(file);
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS sops (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Custom Policy',
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Session',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        sender TEXT NOT NULL CHECK (sender IN ('user','assistant')),
        content TEXT NOT NULL,
        image TEXT,
        confidence_score REAL,
        model_used TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS uploaded_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'Custom Policy',
        chunks INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        uploaded_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }
  return sqliteDb;
}

function getMysqlPool(): any {
  if (mysqlPool) return mysqlPool;
  const mysql = nodeRequire('mysql2/promise');
  mysqlPool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sop_chatbot',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  return mysqlPool;
}

async function runSql(sql: string, params: any[] = []): Promise<any> {
  if (DRIVER === 'mysql') {
    const pool = getMysqlPool();
    const [rows] = await pool.query(sql, params);
    return rows;
  }
  const stmt = getSqlite().prepare(sql);
  if (params.length === 0) return stmt.all();
  return stmt.run(...params);
}

async function querySql(sql: string, params: any[] = []): Promise<any[]> {
  if (DRIVER === 'mysql') {
    const pool = getMysqlPool();
    const [rows] = await pool.query(sql, params);
    return rows as any[];
  }
  return getSqlite().prepare(sql).all(...params) as any[];
}

export async function isDbAvailable(): Promise<boolean> {
  try {
    await runSql('SELECT 1');
    return true;
  } catch (e: any) {
    console.error('isDbAvailable error:', e.message);
    return false;
  }
}

export interface SopRow {
  id: string;
  title: string;
  filename: string;
  category: string;
  content: string;
}

export async function seedSopsIfEmpty(sops: SopRow[]) {
  const rows = await querySql('SELECT COUNT(*) AS count FROM sops');
  const count = Number(rows[0]?.count || 0);
  if (count > 0) return;
  for (const s of sops) {
    await runSql(
      'INSERT INTO sops (id, title, filename, category, content) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title',
      [s.id, s.title, s.filename, s.category, s.content]
    );
  }
}

export async function listSopsFromDb(): Promise<any[] | null> {
  return querySql('SELECT * FROM sops ORDER BY created_at DESC');
}

export async function insertSopToDb(sop: SopRow) {
  await runSql(
    'INSERT INTO sops (id, title, filename, category, content) VALUES (?, ?, ?, ?, ?)',
    [sop.id, sop.title, sop.filename, sop.category, sop.content]
  );
}

export async function deleteSopFromDb(id: string): Promise<boolean> {
  const res = await runSql('DELETE FROM sops WHERE id = ?', [id]);
  if (DRIVER === 'mysql') return (res as any).affectedRows > 0;
  return (res as any).changes > 0;
}

export async function logChatMessage(sessionId: string, sender: 'user' | 'assistant', content: string, image?: string | null, confidence?: number, modelUsed?: string) {
  await runSql(
    'INSERT INTO chat_messages (session_id, sender, content, image, confidence_score, model_used) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, sender, content, image || null, confidence ?? null, modelUsed || null]
  );
}

export const logMessage = logChatMessage;

export async function ensureSession(sessionId: string) {
  await runSql('INSERT OR IGNORE INTO chat_sessions (id) VALUES (?)', [sessionId]);
}

export function getPool(): any {
  return DRIVER === 'mysql' ? getMysqlPool() : getSqlite();
}