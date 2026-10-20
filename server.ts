import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import {
  isDbAvailable,
  seedSopsIfEmpty,
  listSopsFromDb,
  insertSopToDb,
  deleteSopFromDb,
  deleteSopByFilename,
  clearAllSopsFromDb,
  upsertUploadedDoc,
  listUploadedDocs,
  logMessage,
  getRecentMessages,
  HistoryMessage,
  getDriver,
  ensureSession,
  logAnswerFeedback,
  updateFeedback,
  getFeedbackStats,
  getRecentFeedback,
} from './src/db';

const HISTORY_LIMIT = 8;

dotenv.config();

const app = express();
const PORT = 3000;
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8000';

app.use(express.json({ limit: '50mb' }));

let dbAvailable = false;

let sopDocuments: { id: string; title: string; filename: string; category: string; content: string }[] = [];

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Local SOP RAG Full-Stack App',
    sop_count: sopDocuments.length,
    db: dbAvailable ? `${getDriver()}-connected` : `${getDriver()}-offline`
  });
});

app.get('/api/rag/sops', async (req, res) => {
  if (!dbAvailable) return res.json({ sops: sopDocuments });
  try {
    const rows = await listSopsFromDb();
    res.json({ sops: rows });
  } catch (e) {
    res.json({ sops: sopDocuments });
  }
});

app.post('/api/rag/ingest', async (req, res) => {
  const { title, filename, category, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required.' });
  }

  const newDoc = {
    id: `sop_custom_${Date.now()}`,
    title: title.trim(),
    filename: (filename || `${title.replace(/\s+/g, '_')}.txt`).trim(),
    category: category || 'Custom Policy',
    content: content.trim()
  };

  sopDocuments.push(newDoc);
  if (dbAvailable) {
    try {
      await insertSopToDb(newDoc);
    } catch (e) {
      console.warn(`${getDriver()} insert failed, keeping in memory.`);
    }
  }
  res.json({ message: 'SOP successfully ingested and chunked.', sop: newDoc });
});

app.delete('/api/rag/sops', async (_req, res) => {
  sopDocuments = [];
  if (dbAvailable) {
    try {
      await clearAllSopsFromDb();
    } catch (e: any) {
      console.warn('Failed to clear SOPs from DB:', e?.message);
    }
  }
  res.json({ message: 'All SOPs removed from database and memory.', remaining: 0 });
});

app.delete('/api/rag/sops/:id', async (req, res) => {
  const { id } = req.params;
  sopDocuments = sopDocuments.filter(d => d.id !== id);
  if (dbAvailable) {
    try {
      await deleteSopFromDb(id);
    } catch (e) {
      console.warn(`${getDriver()} delete failed, kept in memory.`);
    }
  }
  res.json({ message: 'SOP removed from index.', remaining: sopDocuments.length });
});

app.post('/api/rag/ingest-file', async (req, res) => {
  const { filename, category, base64 } = req.body;
  if (!filename || !base64) {
    return res.status(400).json({ error: 'filename and base64 fields are required.' });
  }
  try {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) {
      return res.status(400).json({ error: 'Uploaded file is empty.' });
    }
    const fd = new FormData();
    fd.append('file', new Blob([buf]), filename);
    fd.append('category', category || 'Custom Policy');

    const ragRes = await fetch(`${RAG_SERVICE_URL}/ingest`, {
      method: 'POST',
      body: fd,
      headers: { 'Connection': 'close' },
      signal: AbortSignal.timeout(600000)
    });
    const data = await ragRes.json();
    if (!ragRes.ok) {
      return res.status(ragRes.status).json({ error: data.detail || data.message || 'RAG ingestion failed.' });
    }
    if (dbAvailable) {
      try {
        const cat = category || data.category || 'Custom Policy';
        await upsertUploadedDoc(data.filename || filename, cat, data.chunks || 0, data.bytes || buf.length);
      } catch (e) {
        console.warn('Failed to persist upload record to DB:', (e as any)?.message);
      }
    }
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ error: `RAG service unreachable at ${RAG_SERVICE_URL}: ${e.message}` });
  }
});

app.get('/api/rag/documents', async (_req, res) => {
  try {
    const r = await fetch(`${RAG_SERVICE_URL}/documents`, {
      headers: { 'Connection': 'close' },
      signal: AbortSignal.timeout(30000)
    });
    const data = await r.json();
    if (dbAvailable && data.documents) {
      try {
        for (const d of data.documents) {
          await upsertUploadedDoc(d.filename, d.category || 'Custom Policy', d.chunks || 0, 0).catch(() => {});
        }
      } catch {}
    }
    res.json(data);
  } catch (e: any) {
    if (dbAvailable) {
      try {
        const rows = await listUploadedDocs();
        return res.json({
          documents: rows.map((r: any) => ({
            id: r.filename,
            filename: r.filename,
            category: r.category,
            title: r.filename.replace(/_/g, ' ').replace(/\.[^.]+$/, ''),
            content: '',
            chunks: r.chunks,
          })),
          fallback: true,
          persistent: true,
        });
      } catch {}
    }
    res.status(502).json({ error: `RAG service unreachable at ${RAG_SERVICE_URL}: ${e.message}` });
  }
});

app.get('/api/rag/uploads', async (_req, res) => {
  if (!dbAvailable) return res.json({ documents: [] });
  try {
    const rows = await listUploadedDocs();
    res.json({
      documents: rows.map((r: any) => ({
        id: r.filename,
        filename: r.filename,
        category: r.category,
        title: r.filename.replace(/_/g, ' ').replace(/\.[^.]+$/, ''),
        content: '',
        chunks: r.chunks,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/rag/chunks', async (_req, res) => {
  try {
    const r = await fetch(`${RAG_SERVICE_URL}/chunks`, {
      headers: { 'Connection': 'close' },
      signal: AbortSignal.timeout(30000)
    });
    const data = await r.json();
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ error: `RAG service unreachable at ${RAG_SERVICE_URL}: ${e.message}` });
  }
});

app.delete('/api/rag/documents', async (_req, res) => {
  let ragData: any = {};
  try {
    const r = await fetch(`${RAG_SERVICE_URL}/documents`, {
      method: 'DELETE',
      headers: { 'Connection': 'close' },
      signal: AbortSignal.timeout(60000)
    });
    ragData = await r.json().catch(() => ({}));
  } catch (e: any) {
    console.warn(`RAG service clear failed: ${e.message}`);
  }

  sopDocuments = [];
  if (dbAvailable) {
    try {
      await clearAllSopsFromDb();
    } catch (e: any) {
      console.warn('Failed to clear DB tables:', e?.message);
    }
  }

  res.json({
    message: 'All SOPs and documents deleted successfully.',
    rag: ragData
  });
});

app.delete('/api/rag/documents/:filename', async (req, res) => {
  try {
    const r = await fetch(`${RAG_SERVICE_URL}/documents/${encodeURIComponent(req.params.filename)}`, {
      method: 'DELETE',
      headers: { 'Connection': 'close' },
      signal: AbortSignal.timeout(60000)
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data.detail || data.message || 'Delete failed.' });
    }
    if (dbAvailable) {
      try {
        await deleteSopByFilename(req.params.filename);
      } catch (e) {
        console.warn('Failed to clean DB upload record:', (e as any)?.message);
      }
    }
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ error: `RAG service unreachable at ${RAG_SERVICE_URL}: ${e.message}` });
  }
});

app.post('/api/rag/ask', async (req, res) => {
  const { question, image, confidence_threshold = 0.62, session_id, history } = req.body;
  const sessionId = session_id || 'default_session';

  if (!question && !image) {
    return res.status(400).json({ error: 'Question string or image required.' });
  }

  let conversationHistory: HistoryMessage[] = Array.isArray(history) ? history.slice(-HISTORY_LIMIT) : [];
  if (dbAvailable) {
    try {
      const dbHistory = await getRecentMessages(sessionId, HISTORY_LIMIT);
      if (dbHistory.length > 0) conversationHistory = dbHistory;
    } catch (e) {
      console.warn('Failed to load chat history, falling back to client-provided history.');
    }
    try {
      await ensureSession(sessionId);
      await logMessage(sessionId, 'user', question || '(Image only)', image);
    } catch (e) {
      console.warn('Failed to log user message.');
    }
  }

  try {
    const ragRes = await fetch(`${RAG_SERVICE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
      body: JSON.stringify({ question, image, confidence_threshold, history: conversationHistory }),
      signal: AbortSignal.timeout(300000)
    });
    const data = await ragRes.json();
    if (!ragRes.ok) {
      return res.status(ragRes.status).json({
        error: data.detail || data.message || 'RAG service returned an error.',
        status: ragRes.status
      });
    }
    if (dbAvailable) {
      try {
        await logMessage(sessionId, 'assistant', data.answer, null, data.confidence_score, data.model_used);
      } catch (e) {
        console.warn('Failed to log assistant message.');
      }
      try {
        const sources = (data.chunks_retrieved || []).map((c: any) => c.source_file).join(', ');
        const feedbackId = await logAnswerFeedback({
          session_id: sessionId,
          question: question || '(Image)',
          answer: data.answer || '',
          confidence_score: data.confidence_score ?? null,
          passed_threshold: data.passed_threshold ?? false,
          grounding_passed: !data.model_used?.includes('grounding-failed'),
          model_used: data.model_used || null,
          sources,
        });
        data.feedback_id = feedbackId;
      } catch (e) {
        console.warn('Failed to log answer feedback entry.');
      }
    }
    return res.json(data);
  } catch (e: any) {
    console.error(`RAG service unreachable at ${RAG_SERVICE_URL}: ${e.message}`);
    return res.status(502).json({
      error: `RAG service unreachable at ${RAG_SERVICE_URL}. Ensure the Python RAG service and Ollama are running.`,
      degraded: true
    });
  }
});

async function startServer() {
  try {
    dbAvailable = await isDbAvailable();
    if (dbAvailable) {
      await seedSopsIfEmpty(sopDocuments);
      try {
        const dbSops = await listSopsFromDb();
        if (dbSops && dbSops.length > 0) {
          sopDocuments = dbSops.map((r: any) => ({
            id: r.id,
            title: r.title,
            filename: r.filename,
            category: r.category,
            content: r.content || '',
          }));
        }
      } catch (e) {
        console.warn('Failed to load SOPs from DB into memory.');
      }
      console.log(`${getDriver()} connected. ${sopDocuments.length} SOP(s) synced from database.`);
    } else {
      console.warn(`${getDriver()} unavailable. Running in-memory mode (SOPs lost on restart).`);
    }
  } catch (e: any) {
    dbAvailable = false;
    console.warn(`${getDriver()} connection failed: ${e.message}. Running in-memory mode.`);
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Local SOP RAG App Server running on http://localhost:${PORT}`);
  });
}

startServer();


app.patch('/api/rag/feedback/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { feedback, note } = req.body;
  if (!feedback || !['positive', 'negative'].includes(feedback)) {
    return res.status(400).json({ error: "feedback must be 'positive' or 'negative'." });
  }
  if (!dbAvailable) return res.status(503).json({ error: 'Database not available.' });
  try {
    const ok = await updateFeedback(id, feedback, note);
    if (!ok) return res.status(404).json({ error: 'Feedback entry not found.' });
    res.json({ message: 'Feedback updated.', id, feedback });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/rag/feedback/stats', async (_req, res) => {
  if (!dbAvailable) return res.status(503).json({ error: 'Database not available.' });
  try {
    const stats = await getFeedbackStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/rag/feedback/recent', async (req, res) => {
  if (!dbAvailable) return res.status(503).json({ error: 'Database not available.' });
  try {
    const limit = Number(req.query.limit) || 50;
    const rows = await getRecentFeedback(limit);
    res.json({ feedback: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});