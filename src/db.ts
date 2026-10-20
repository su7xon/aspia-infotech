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
      CREATE TABLE IF NOT EXISTS answer_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        confidence_score REAL,
        passed_threshold INTEGER DEFAULT 0,
        grounding_passed INTEGER DEFAULT 1,
        model_used TEXT,
        feedback TEXT CHECK (feedback IN ('positive','negative','none')) DEFAULT 'none',
        feedback_note TEXT,
        sources TEXT,
        created_at TEXT DEFAULT (datetime('now'))
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

export async function deleteSopByFilename(filename: string): Promise<void> {
  await runSql('DELETE FROM sops WHERE filename = ?', [filename]);
  await runSql('DELETE FROM uploaded_docs WHERE filename = ?', [filename]);
}

export async function clearAllSopsFromDb(): Promise<void> {
  await runSql('DELETE FROM sops');
  await runSql('DELETE FROM uploaded_docs');
}

export async function upsertUploadedDoc(filename: string, category: string, chunks: number, bytes: number): Promise<void> {
  if (DRIVER === 'mysql') {
    await runSql(
      'INSERT INTO uploaded_docs (filename, category, chunks, bytes) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE category = VALUES(category), chunks = VALUES(chunks), bytes = VALUES(bytes)',
      [filename, category, chunks, bytes]
    );
  } else {
    await runSql(
      'INSERT INTO uploaded_docs (filename, category, chunks, bytes) VALUES (?, ?, ?, ?) ON CONFLICT(filename) DO UPDATE SET category = excluded.category, chunks = excluded.chunks, bytes = excluded.bytes',
      [filename, category, chunks, bytes]
    );
  }
}

export async function listUploadedDocs(): Promise<any[]> {
  return querySql('SELECT * FROM uploaded_docs ORDER BY uploaded_at DESC');
}

export async function logChatMessage(sessionId: string, sender: 'user' | 'assistant', content: string, image?: string | null, confidence?: number, modelUsed?: string) {
  await runSql(
    'INSERT INTO chat_messages (session_id, sender, content, image, confidence_score, model_used) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, sender, content, image || null, confidence ?? null, modelUsed || null]
  );
}

export const logMessage = logChatMessage;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function getRecentMessages(sessionId: string, limit: number): Promise<HistoryMessage[]> {
  const rows = await querySql(
    'SELECT sender, content FROM chat_messages WHERE session_id = ? AND image IS NULL ORDER BY id DESC LIMIT ?',
    [sessionId, limit]
  );
  return (rows as any[])
    .reverse()
    .map(r => ({ role: r.sender as 'user' | 'assistant', content: String(r.content ?? '') }))
    .filter(r => r.content.trim().length > 0);
}

export async function ensureSession(sessionId: string) {
  if (DRIVER === 'mysql') {
    await runSql('INSERT IGNORE INTO chat_sessions (id) VALUES (?)', [sessionId]);
  } else {
    await runSql('INSERT OR IGNORE INTO chat_sessions (id) VALUES (?)', [sessionId]);
  }
}

export function getPool(): any {
  return DRIVER === 'mysql' ? getMysqlPool() : getSqlite();
}


export interface FeedbackEntry {
  session_id: string;
  question: string;
  answer: string;
  confidence_score: number | null;
  passed_threshold: boolean;
  grounding_passed: boolean;
  model_used: string | null;
  feedback?: 'positive' | 'negative' | 'none';
  feedback_note?: string;
  sources?: string;
}

export async function logAnswerFeedback(entry: FeedbackEntry): Promise<number> {
  const res = await runSql(
    `INSERT INTO answer_feedback (session_id, question, answer, confidence_score, passed_threshold, grounding_passed, model_used, feedback, feedback_note, sources)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.session_id,
      entry.question,
      entry.answer,
      entry.confidence_score ?? null,
      entry.passed_threshold ? 1 : 0,
      entry.grounding_passed ? 1 : 0,
      entry.model_used || null,
      entry.feedback || 'none',
      entry.feedback_note || null,
      entry.sources || null,
    ]
  );
  if (DRIVER === 'mysql') return (res as any).insertId;
  return Number((res as any).lastInsertRowid || 0);
}

export async function updateFeedback(feedbackId: number, feedback: 'positive' | 'negative', note?: string): Promise<boolean> {
  const res = await runSql(
    'UPDATE answer_feedback SET feedback = ?, feedback_note = ? WHERE id = ?',
    [feedback, note || null, feedbackId]
  );
  if (DRIVER === 'mysql') return (res as any).affectedRows > 0;
  return (res as any).changes > 0;
}

export interface AccuracyStats {
  total_answers: number;
  total_rated: number;
  positive: number;
  negative: number;
  unrated: number;
  accuracy_percent: number;
  avg_confidence: number;
  threshold_pass_rate: number;
  grounding_pass_rate: number;
  true_positive: number;
  false_positive: number;
  true_negative: number;
  false_negative: number;
  precision: number;
  recall: number;
  f1_score: number;
}

export async function getFeedbackStats(): Promise<AccuracyStats> {
  const rows = await querySql('SELECT * FROM answer_feedback ORDER BY id');
  const total = rows.length;
  if (total === 0) {
    return {
      total_answers: 0, total_rated: 0, positive: 0, negative: 0, unrated: 0,
      accuracy_percent: 0, avg_confidence: 0, threshold_pass_rate: 0,
      grounding_pass_rate: 0, true_positive: 0, false_positive: 0,
      true_negative: 0, false_negative: 0, precision: 0, recall: 0, f1_score: 0,
    };
  }

  const positive = rows.filter((r: any) => r.feedback === 'positive').length;
  const negative = rows.filter((r: any) => r.feedback === 'negative').length;
  const rated = positive + negative;
  const unrated = total - rated;

  const avgConf = rows.reduce((s: number, r: any) => s + (r.confidence_score || 0), 0) / total;
  const thresholdPassed = rows.filter((r: any) => r.passed_threshold).length;
  const groundingPassed = rows.filter((r: any) => r.grounding_passed).length;

  const tp = rows.filter((r: any) => r.passed_threshold && r.feedback === 'positive').length;
  const fp = rows.filter((r: any) => r.passed_threshold && r.feedback === 'negative').length;
  const tn = rows.filter((r: any) => !r.passed_threshold && r.feedback === 'positive').length;
  const fn = rows.filter((r: any) => !r.passed_threshold && r.feedback === 'negative').length;

  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  return {
    total_answers: total,
    total_rated: rated,
    positive,
    negative,
    unrated,
    accuracy_percent: rated > 0 ? Math.round((positive / rated) * 100) : 0,
    avg_confidence: Math.round(avgConf * 10000) / 10000,
    threshold_pass_rate: Math.round((thresholdPassed / total) * 100),
    grounding_pass_rate: Math.round((groundingPassed / total) * 100),
    true_positive: tp,
    false_positive: fp,
    true_negative: tn,
    false_negative: fn,
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    f1_score: Math.round(f1 * 10000) / 10000,
  };
}

export async function getRecentFeedback(limit: number = 50): Promise<any[]> {
  return querySql('SELECT * FROM answer_feedback ORDER BY id DESC LIMIT ?', [limit]);
}