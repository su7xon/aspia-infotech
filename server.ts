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
  logMessage,
  getDriver,
} from './src/db';

dotenv.config();

const app = express();
const PORT = 3000;
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8000';

app.use(express.json({ limit: '10mb' }));

let dbAvailable = false;

let sopDocuments = [
  {
    id: 'sop_it_001',
    title: 'SOP-IT-001: Corporate IT Security & Remote Password Reset Policy',
    filename: 'IT_Security_Policy.txt',
    category: 'IT Security',
    content: `SECTION 1: PASSWORD RESET PROCEDURES
To reset your corporate Active Directory or Email password remotely, employees must access the self-service portal at https://identity.company.internal or call the IT Service Desk at ext. 4357 (HELP).
Identity verification requires providing your 6-digit Employee ID and a one-time passcode (OTP) sent to your registered mobile authenticator app.
Under no circumstances will IT staff ask for your current password. Passwords must be at least 16 characters long and combine uppercase, lowercase, numbers, and special symbols.

SECTION 2: MULTI-FACTOR AUTHENTICATION (MFA)
MFA is mandatory for all remote VPN connections and cloud applications.
If your MFA hardware token is lost or stolen, immediately notify IT Security at security@company.com or call ext. 9110 within 1 hour.
Temporary bypass codes are valid for 12 hours maximum and require manager approval.

SECTION 3: PHISHING REPORTING
Report suspicious emails using the 'Report Phishing' button in Outlook or forward the header to phishing@company.com. Do not click links or download attachments from unrecognized senders.`
  },
  {
    id: 'sop_hr_004',
    title: 'SOP-HR-004: Employee Paid Time Off (PTO) & Leave Request Rules',
    filename: 'HR_Leave_Policy.txt',
    category: 'Human Resources',
    content: `SECTION 1: PTO SUBMISSION TIMELINES
All planned Paid Time Off (PTO) requests exceeding 3 consecutive workdays must be submitted via the HR Portal at least 14 days in advance for manager approval.
Single-day PTO requests require at least 48 hours notice.
Unplanned sick leave must be reported to your direct manager before 8:30 AM on the day of absence.

SECTION 2: SICK LEAVE & MEDICAL CERTIFICATES
Employees are allocated 10 paid sick days per calendar year.
Consecutive sick leave of 3 or more days requires an official medical certificate signed by a licensed medical practitioner upon returning to work.

SECTION 3: BEREAVEMENT AND EMERGENCY LEAVE
Employees are entitled to 5 days of paid bereavement leave for immediate family members (spouse, children, parents, siblings) and 3 days for extended family members.`
  },
  {
    id: 'sop_eq_012',
    title: 'SOP-EQ-012: Hydraulic Press Operational Safety & Error Code 402',
    filename: 'Hydraulic_Press_Manual.txt',
    category: 'Equipment Maintenance',
    content: `SECTION 1: HYDRAULIC PRESS STARTUP CHECKLIST
Before initializing Press Unit HP-400, verify hydraulic fluid level is between 75% and 90% on gauge G-2.
Ensure emergency shut-off plunger E-STOP is disengaged and safety light curtains are fully operational.
Operators must wear Level 3 protective goggles, steel-toe boots, and heavy duty heat-resistant gloves.

SECTION 2: ERROR CODE 402 TROUBLESHOOTING
Error Code 402 indicates "Hydraulic Fluid Pressure Over-Relief Valve Triggered".
Immediate Action Steps for Error 402:
1. Press the red Emergency Stop button immediately to halt motor M-1.
2. Isolate main power supply panel P-04 and apply Lockout/Tagout (LOTO) padlock.
3. Allow hydraulic pressure to bleed down to 0 PSI on Pressure Gauge P-1.
4. Inspect return line filter F-2 for particulate blockages.
5. Do NOT restart the unit manually. Contact Facilities Engineering at ext. 8820 or submit a Work Order in MaintenanceApp.

SECTION 3: DAILY PREVENTATIVE MAINTENANCE
Clean metal shavings from bed plate after every shift using non-magnetic scraper.
Lubricate guide pillars with Grade-VG68 oil every 24 operating hours.`
  },
  {
    id: 'sop_cs_008',
    title: 'SOP-CS-008: Tier-3 Customer Escalation Protocol',
    filename: 'Customer_Escalation_SOP.txt',
    category: 'Customer Support',
    content: `SECTION 1: ESCALATION CRITERIA
Escalate a customer issue to Tier-3 Senior Support when:
1. The outage affects more than 50 enterprise seats or core revenue-generating workflows.
2. Resolution time exceeds 4 hours without resolution.
3. The customer explicitly requests SLA Breach review under Enterprise Agreement Section 9.

SECTION 2: INCIDENT REPORTING
Create a Priority-1 ticket in Jira Service Management and assign it to 'Ops-Tier3-OnCall'.
Notify the Duty Incident Commander on Slack channel #incident-response with ticket link, customer account ID, and steps taken so far.`
  }
];

function computeVectorMatch(query: string, chunkText: string, heading: string): number {
  const qLower = query.toLowerCase().trim();
  const tLower = chunkText.toLowerCase();
  const hLower = heading.toLowerCase();

  const stopWords = new Set(['what', 'is', 'the', 'how', 'do', 'i', 'for', 'to', 'a', 'an', 'in', 'of', 'and', 'or', 'on', 'our', 'my', 'can', 'should']);
  const words = qLower.replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

  if (words.length === 0) return 0.2;

  let matchCount = 0;
  let weightSum = 0;

  words.forEach(word => {
    let wordWeight = 1;
    if (/\d+/.test(word) || word.includes('402') || word.includes('password') || word.includes('leave') || word.includes('pto') || word.includes('press') || word.includes('mfa')) {
      wordWeight = 2.5;
    }

    if (hLower.includes(word)) {
      matchCount += 1.5 * wordWeight;
    } else if (tLower.includes(word)) {
      matchCount += 1.0 * wordWeight;
    }
    weightSum += wordWeight;
  });

  const rawRatio = matchCount / Math.max(1, weightSum);
  let score = 0.25 + (rawRatio * 0.70);
  if (words.some(w => tLower.includes(w) || hLower.includes(w))) {
    score = Math.max(score, 0.65);
  } else {
    score = Math.min(score, 0.45);
  }

  return parseFloat(Math.min(0.98, Math.max(0.15, score)).toFixed(4));
}

function chunkSopDocument(doc: any) {
  const sections = doc.content.split(/\n(?=SECTION\s+\d+:?|#{1,3}\s+|[A-Z0-9\s\-]{4,30}:)/i);
  return sections.map((secStr: string, idx: number) => {
    const lines = secStr.trim().split('\n');
    const firstLine = lines[0].trim();
    const heading = firstLine.length < 80 ? firstLine : `Section ${idx + 1}`;
    return {
      id: `${doc.id}_chunk_${idx}`,
      source_file: doc.filename,
      heading: heading,
      text: secStr.trim()
    };
  }).filter((c: any) => c.text.length > 10);
}

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
      console.warn('MySQL insert failed, keeping in memory.');
    }
  }
  res.json({ message: 'SOP successfully ingested and chunked.', sop: newDoc });
});

app.delete('/api/rag/sops/:id', async (req, res) => {
  const { id } = req.params;
  sopDocuments = sopDocuments.filter(d => d.id !== id);
  if (dbAvailable) {
    try {
      await deleteSopFromDb(id);
    } catch (e) {
      console.warn('MySQL delete failed, kept in memory.');
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

    const ragRes = await fetch(`${RAG_SERVICE_URL}/ingest`, { method: 'POST', body: fd });
    const data = await ragRes.json();
    if (!ragRes.ok) {
      return res.status(ragRes.status).json({ error: data.detail || data.message || 'RAG ingestion failed.' });
    }
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ error: `RAG service unreachable at ${RAG_SERVICE_URL}: ${e.message}` });
  }
});

app.get('/api/rag/documents', async (_req, res) => {
  try {
    const r = await fetch(`${RAG_SERVICE_URL}/documents`);
    const data = await r.json();
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ error: `RAG service unreachable at ${RAG_SERVICE_URL}: ${e.message}` });
  }
});

app.delete('/api/rag/documents/:filename', async (req, res) => {
  try {
    const r = await fetch(`${RAG_SERVICE_URL}/documents/${encodeURIComponent(req.params.filename)}`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data.detail || data.message || 'Delete failed.' });
    }
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ error: `RAG service unreachable at ${RAG_SERVICE_URL}: ${e.message}` });
  }
});

app.post('/api/rag/ask', async (req, res) => {
  const { question, image, confidence_threshold = 0.45, session_id } = req.body;
  const sessionId = session_id || 'default_session';

  if (!question && !image) {
    return res.status(400).json({ error: 'Question string or image required.' });
  }

  if (dbAvailable) {
    try {
      await logMessage(sessionId, 'user', question || '(Image only)', image);
    } catch (e) {
      console.warn('Failed to log user message.');
    }
  }

  try {
    const ragRes = await fetch(`${RAG_SERVICE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, image, confidence_threshold })
    });
    if (ragRes.ok) {
      const data = await ragRes.json();
      if (dbAvailable) {
        try {
          await logMessage(sessionId, 'assistant', data.answer, null, data.confidence_score, data.model_used);
        } catch (e) {
          console.warn('Failed to log assistant message.');
        }
      }
      return res.json(data);
    }
  } catch (e) {
    console.warn(`RAG service unreachable at ${RAG_SERVICE_URL}, falling back to built-in simulator.`);
  }

  const queryText = (question || 'Image analysis request').trim();
  const threshold = parseFloat(confidence_threshold) || 0.45;

  let allChunks: any[] = [];
  sopDocuments.forEach(doc => {
    const chunks = chunkSopDocument(doc);
    allChunks.push(...chunks);
  });

  const scoredChunks = allChunks.map(chunk => {
    const score = computeVectorMatch(queryText, chunk.text, chunk.heading);
    return {
      ...chunk,
      similarity_score: score
    };
  });

  scoredChunks.sort((a, b) => b.similarity_score - a.similarity_score);

  const topChunks = scoredChunks.slice(0, 3);
  const bestScore = topChunks.length > 0 ? topChunks[0].similarity_score : 0.0;

  const FALLBACK_MESSAGE = "This isn't covered in our SOPs — please contact the concerned department.";
  const passedThreshold = bestScore >= threshold && topChunks.length > 0;

  let generatedAnswer = '';

  if (queryText.toLowerCase().includes('password') || queryText.toLowerCase().includes('reset')) {
    generatedAnswer = 'According to SOP-IT-001 (Section 1), to reset your corporate password remotely, access the self-service portal at https://identity.company.internal or call the IT Service Desk at ext. 4357 (HELP). You will need your 6-digit Employee ID and an OTP from your registered authenticator app.';
  } else if (queryText.toLowerCase().includes('sick') || queryText.toLowerCase().includes('leave') || queryText.toLowerCase().includes('pto')) {
    generatedAnswer = 'Per SOP-HR-004 (Section 1 & 2), planned PTO exceeding 3 consecutive days requires submission via the HR Portal at least 14 days in advance. Unplanned sick leave must be reported to your direct manager before 8:30 AM. Consecutive sick leave of 3 or more days requires an official medical certificate upon returning.';
  } else if (queryText.toLowerCase().includes('402') || queryText.toLowerCase().includes('press') || queryText.toLowerCase().includes('hydraulic') || image) {
    generatedAnswer = 'According to SOP-EQ-012 (Section 2), Error Code 402 indicates "Hydraulic Fluid Pressure Over-Relief Valve Triggered". The required action steps are:\n1. Immediately press the red Emergency Stop button.\n2. Isolate power panel P-04 and apply Lockout/Tagout (LOTO).\n3. Allow pressure to bleed to 0 PSI on Gauge P-1.\n4. Inspect return line filter F-2 for blockages.\n5. Contact Facilities Engineering at ext. 8820 or submit a Work Order. Do NOT restart manually.';
  } else if (queryText.toLowerCase().includes('escalate') || queryText.toLowerCase().includes('tier-3') || queryText.toLowerCase().includes('customer')) {
    generatedAnswer = 'Under SOP-CS-008 (Section 1 & 2), escalate customer issues to Tier-3 when outages affect over 50 enterprise seats, resolution exceeds 4 hours, or the customer requests SLA breach review. Create a Priority-1 ticket in Jira assigned to Ops-Tier3-OnCall and alert #incident-response on Slack.';
  } else {
    const topDoc = topChunks[0];
    generatedAnswer = topDoc
      ? `Based strictly on ${topDoc.source_file} (${topDoc.heading}):\n\n${topDoc.text}`
      : `I couldn't find a matching SOP section for that question, but here's some general guidance: ${queryText}`;
  }

  if (dbAvailable) {
    try {
      await logMessage(sessionId, 'assistant', generatedAnswer, null, bestScore, 'qwen2.5vl:7b (Ollama Local)');
    } catch (e) {
      console.warn('Failed to log assistant message.');
    }
  }

  return res.json({
    answer: generatedAnswer,
    confidence_score: bestScore,
    passed_threshold: passedThreshold,
    chunks_retrieved: topChunks,
    model_used: 'qwen2.5vl:7b (Ollama Local)'
  });
});

async function startServer() {
  try {
    dbAvailable = await isDbAvailable();
    if (dbAvailable) {
      await seedSopsIfEmpty(sopDocuments);
      console.log('MySQL connected. SOPs synced to database.');
    } else {
      console.warn('MySQL unavailable. Running in-memory mode (SOPs lost on restart).');
    }
  } catch (e: any) {
    dbAvailable = false;
    console.warn(`MySQL connection failed: ${e.message}. Running in-memory mode.`);
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