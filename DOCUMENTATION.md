# Local SOP RAG Chatbot — Technical Documentation

System architecture, data flow, timings, model choices, and databases for the Local SOP RAG Chatbot. Use this as the reference before starting any development work.

---

## 1. System Overview

A fully **offline / local** RAG (Retrieval-Augmented Generation) chatbot that answers questions about company SOP (Standard Operating Procedure) documents. No external cloud AI APIs are used — everything runs on the local machine via Ollama.

### Components

| Component | Tech | Port | Role |
|---|---|---|---|
| Web Server | Node.js + Express + Vite (TypeScript, `server.ts`) | 3000 | Serves React frontend + REST API gateway |
| Frontend | React 19 + Tailwind CSS 4 (`src/`) | — | Chat UI, SOP manager, architecture view |
| RAG Microservice | Python + FastAPI (`rag-service/main.py`) | 8000 | Ingestion, search, retrieval, LLM orchestration |
| Vector DB | ChromaDB (local, file-based, `chroma_db/`) | — | Stores chunk text + embeddings |
| Embedding Model | `nomic-embed-text` (via Ollama) | 11434 | Converts text → vectors |
| LLM | `qwen2.5vl:7b` (via Ollama) | 11434 | Generates final answers (vision capable) |
| Metadata DB | SQLite (default) or MySQL | — | Stores SOPs, chat sessions, messages, uploads |

> `angular-app/` and `laravel-app/` are legacy/leftover folders — the active frontend is React in `src/`.

### Architecture (data flow at a glance)

```
React UI (browser)
   │  HTTP :3000
   ▼
Express Server (server.ts)  ──► SQLite/MySQL  (SOPs, chat history)
   │  HTTP :8000
   ▼
FastAPI RAG Service (main.py)
   │                     │
   ├── ChromaDB (vectors) │── Ollama :11434
   │                      │   ├── nomic-embed-text  (embedding)
   │                      │   └── qwen2.5vl:7b      (LLM / image captioning)
   ▼
Answer + confidence + retrieved chunks → back to UI
```

---

## 2. Data Ingestion Pipeline (SOP → Vector DB)

This is the **offline/upload path**: how a raw SOP file becomes searchable chunks.

```
SOP file (.txt / .md / .pdf / .docx)
   │  upload via UI → POST /api/rag/ingest-file → POST /ingest (FastAPI)
   ▼
1. Save copy → rag-service/sops/
   ▼
2. Text extraction  (extract_text_from_file)
   - .txt/.md → read raw text
   - .pdf     → pypdf (per page)
   - .docx    → python-docx (per paragraph)
   ▼
3. Chunking  (chunk_sop_text → two levels)
   a. Heading-based split (regex):
      SECTION / TOPIC / POLICY / PROCEDURE / SOP-xxx / ## headings
      → each section keeps its heading as metadata
   b. Semantic split inside big sections
      (only when section > ~1500 chars):
      - sentences grouped in windows of 3
      - each window embedded (nomic-embed-text)
      - cosine similarity < 0.55 between adjacent windows → split point
      - chunks capped at 1500 chars, 180-char overlap with previous chunk
   ▼
4. Image handling (PDF/DOCX only, up to 10 images)
   - extract embedded images
   - caption each with qwen2.5vl:7b (vision)
   - caption saved as text chunk: "[SOP IMAGE #n] <caption>"
   ▼
5. Embedding  (nomic-embed-text, 768-dim vectors)
   - batch of 25 chunks per request → POST /api/embed
   ▼
6. Store in ChromaDB
   - collection: sop_documents
   - space: cosine (HNSW index)
   - document payload: "Document: <file> | Section: <heading>\n\n<chunk text>"
   - metadata: source_file, heading, chunk_index, char_length, chunk_type, category
```

**Important:** re-ingesting the same filename first deletes its old chunks from ChromaDB, then inserts fresh ones (no duplicates).

### What is stored per chunk

```json
{
  "id": "HR_Leave_Policy.txt_chunk_3",
  "document": "Document: HR_Leave_Policy.txt | Section: SECTION 2: SICK LEAVE...\n\n<chunk text>",
  "metadata": {
    "source_file": "HR_Leave_Policy.txt",
    "heading": "SECTION 2: SICK LEAVE & MEDICAL CERTIFICATES",
    "chunk_index": 3,
    "char_length": 812,
    "category": "Human Resources"
  },
  "embedding": [0.0312, -0.0087, ... 768 values]
}
```

### Ingestion timing estimates (local machine)

| Step | Time |
|---|---|
| Text extraction (txt/md/docx) | < 0.5 s |
| Text extraction (PDF) | 1–3 s |
| Heading + semantic chunking | < 1 s |
| Embedding per batch of 25 chunks | 2–5 s (CPU) / < 1 s (GPU) |
| Image captioning per image | 5–15 s (CPU) / 2–5 s (GPU) |
| **Typical SOP (10–30 chunks, no images)** | **3–8 s total** |
| SOP with 3–5 images | +15–60 s |

Embedding and captioning are the only slow steps — they are done once at upload, never during chat.

---

## 3. Query / Answer Pipeline (Question → Answer)

Flow when a user asks a question in the chat:

```
User question
   ▼
POST /api/rag/ask (Express) → POST /ask (FastAPI)
   ▼
1. Query expansion (expand_query)
   - abbreviation dictionary: "PTO" → "paid time off leave",
     "MFA" → "multi factor authentication", etc.
   - produces [original, original+expansions] query variants
   ▼
2. Query embedding → nomic-embed-text
   ▼
3. Vector search (ChromaDB) → top 15 candidates
   (cosine distance over HNSW index)
   ▼
4. Lexical search (BM25, in-memory) → top 15 candidates
   (keyword overlap — catches exact terms like "402", "ext. 4357")
   ▼
5. Fusion: Reciprocal Rank Fusion (RRF, k=60)
   merges both ranked lists → top 10
   ▼
6. Optional rerank: cross-encoder
   (cross-encoder/ms-marco-MiniLM-L-6-v2, lazy-loaded, fallback = RRF order)
   ▼
7. Take top 3 chunks
   ▼
8. Confidence score = 1 − cosine distance (best of top-3)
   ▼
9. Threshold check (default 0.45, overridable per request)
   ├── below threshold → immediate fallback message:
   │    "This isn't covered in our SOPs — please contact the concerned department."
   │    (LLM is NOT called — fast response)
   └── above threshold → build prompt, call LLM (next section)
   ▼
10. Response to UI:
    { answer, confidence_score, passed_threshold,
      chunks_retrieved[3], model_used }
```

### How the SOP context reaches the LLM

The retrieved chunks are assembled into a strict prompt:

```
SYSTEM (fixed):
"You are an internal assistant for Acme Enterprise. You are an EXTRACTOR...
1. Extract facts strictly from the SOP context. Never add outside knowledge.
2. Use numbered steps for procedures, bullets for rules, quote exact values.
3. End with: Source: <filename> (Section: <heading>)
4. If context has no answer, reply ONLY with the fallback message.
5. No greetings, no intro, no conclusions."

USER:
RETRIEVED COMPANY SOP CONTEXT:
[Source File: HR_Leave_Policy.txt | Heading: SECTION 2: SICK LEAVE...]
<chunk text>

---

[Source File: ... | Heading: ...]
<chunk text>

USER QUESTION:
How many sick days do I get?

(optional: base64 image added to payload → qwen2.5vl vision)
```

LLM generation settings: temperature 0.2, top_p 0.9, max 512 tokens, `stream: false`, model kept alive 1 h.

### Answer latency estimates

| Stage | Time |
|---|---|
| Query embedding (nomic-embed-text) | 0.1–0.3 s |
| ChromaDB vector search | 10–50 ms |
| BM25 search | < 10 ms |
| RRF fusion + rerank | 0.1–0.4 s |
| **Subtotal (retrieval)** | **~0.3–0.8 s** |
| LLM generation (qwen2.5vl:7b) | GPU: 2–6 s · CPU-only: 10–40 s |
| **Total answer time** | **GPU: ~2.5–7 s · CPU: ~10–40 s** |
| Fallback path (below threshold, no LLM) | **~0.3–0.5 s** |

> First call after idle is slower (model must load into memory, ~10–30 s). With `keep_alive: 1h` subsequent calls are fast.

---

## 4. Model Choices & Why

### LLM: `qwen2.5vl:7b` (Ollama)

- **Vision-language model** — needed because the system also ingests/captions images from PDF/DOCX and can answer questions about attached images.
- **7B size** — best accuracy/speed balance that runs on a single consumer GPU (or even CPU, slowly). Larger models (13B/32B) are too slow for chat latency; smaller ones (3B) degrade fact-extraction quality.
- **Fully local via Ollama** — zero cost, zero data leakage, works offline. This is a core project requirement.
- Used with `temperature: 0.2` because the role is **fact extraction** from provided context, not creative writing.

### Embedding: `nomic-embed-text` (Ollama)

- **768-dimension** embedding model, good retrieval quality for its size.
- **Runs locally on the same Ollama instance** — no separate model server, no external API.
- Same model for ingestion and query embedding (required for correct vector similarity).

### Reranker (optional): `cross-encoder/ms-marco-MiniLM-L-6-v2`

- Cross-encoder scores query↔chunk pairs more accurately than bi-encoder cosine distance.
- **Lazy-loaded** — if `sentence-transformers` is missing or load fails, the system silently falls back to RRF ordering.
- The model downloads from HuggingFace on first use (requires internet once).

---

## 5. Databases

### Vector database — ChromaDB (primary search index)

| Property | Value |
|---|---|
| Client | `chromadb.PersistentClient` (file-based, no server process) |
| Location | `rag-service/chroma_db/` (root `chroma_db/` is a copy) |
| Collection | `sop_documents` |
| Distance | cosine (`"hnsw:space": "cosine"`) |
| Index | HNSW |
| Purpose | chunk text + embeddings, similarity search |
| Lifetime | persists across restarts; rebuilt on re-ingestion |

### Metadata database — SQLite (default) / MySQL (optional)

Config via `.env`: `DB_DRIVER=sqlite` (default) or `mysql`.

| Table | Purpose |
|---|---|
| `sops` | SOP documents (id, title, filename, category, content) |
| `chat_sessions` | chat session list |
| `chat_messages` | message history (sender, content, optional image, confidence_score, model_used) |
| `uploaded_docs` | file upload log (filename, category, chunk count, bytes) |

- SQLite: `node:sqlite` built-in driver, file at `data/sop_chatbot.db` — zero setup.
- MySQL: `mysql2` connection pool, schema auto-created via `src/db.ts`.
- If DB is unavailable → server falls back to **in-memory mode** (SOPs lost on restart, chat logging skipped) — app keeps working.

> Note: SQLite/MySQL stores the raw SOP content; ChromaDB stores the chunked/embedded version. Both are needed.

---

## 6. API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server + DB status |
| GET | `/api/rag/sops` | List SOPs (DB or fallback) |
| POST | `/api/rag/ingest` | Add SOP via JSON body (raw text) |
| POST | `/api/rag/ingest-file` | Upload file (base64) → rag-service `/ingest` |
| GET | `/api/rag/documents` | List indexed documents from ChromaDB |
| GET | `/api/rag/chunks` | List all chunks |
| DELETE | `/api/rag/documents/:filename` | Remove doc from vector index |
| DELETE | `/api/rag/sops/:id` | Remove SOP from metadata DB |
| POST | `/api/rag/ask` | Ask question (text + optional image) |

FastAPI service (`rag-service/main.py`): `/health`, `/ingest`, `/documents`, `/chunks`, `/documents/{filename}` (DELETE), `/ask`.

### Failure behavior (important to know)

No fake answers are ever generated. Failure modes:

| Failure | Behavior |
|---|---|
| Ollama fully down | FastAPI returns **503** (`Ollama embedding model unavailable`) — Express passes it through |
| Ollama up, LLM generation fails (e.g. model not pulled) | FastAPI returns **200 with `degraded: true`** — answer contains the raw retrieved SOP sections verbatim + `model_used: "<model> (unavailable)"` |
| FastAPI service down | Express returns **502** `RAG service unreachable... Ensure the Python RAG service and Ollama are running.` |
| Confidence below threshold | Normal fallback message; `model_used: "none (below confidence threshold)"`, LLM never called |

Clients should check the `degraded` flag on successful responses to detect degraded answers.

---

## 7. Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DB_DRIVER` | `sqlite` | `sqlite` or `mysql` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | localhost:3306 root | MySQL connection (used only when `mysql`) |
| `SQLITE_DB_FILE` | `./data/sop_chatbot.db` | SQLite file path |
| `RAG_SERVICE_URL` | `http://127.0.0.1:8000` | FastAPI base URL |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server |
| `EMBEDDING_MODEL` | `nomic-embed-text` | embedding model name |
| `LLM_MODEL` | `qwen2.5vl:7b` | generation model name |
| `CHROMA_DB_DIR` | `./chroma_db` | vector DB folder |
| `SOP_DIR` | `./sops` | uploaded files folder |
| `CONFIDENCE_THRESHOLD` | `0.45` | min confidence to call LLM |
| `COMPANY_NAME` | `Acme Enterprise` | used in system prompt |
| `SEMANTIC_SPLIT_SIM` | `0.55` | semantic chunk split threshold |
| `CHUNK_OVERLAP_CHARS` | `180` | chunk overlap size |
| `PORT` | `8000` | FastAPI port |

---

## 8. How to Run

1. Install & start **Ollama**, pull models:
   ```
   ollama pull nomic-embed-text
   ollama pull qwen2.5vl:7b
   ```
2. Start **RAG service** (Python, in `rag-service/` with venv):
   ```
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
3. (Optional) Pre-ingest all files in `rag-service/sops/`:
   ```
   python add_data.py --dir ./sops
   ```
4. Start **Node server** (repo root): `npm run dev` → http://localhost:3000
5. Upload SOPs from the UI (Document Manager) — they are auto-chunked, embedded, and indexed. Chat is ready to use.

---

## 9. Key Numbers (Quick Reference)

| Item | Value |
|---|---|
| Embedding dimensions | 768 |
| Chunk size | ≤ 1500 chars, 180-char overlap |
| Chunk strategy | heading-based → semantic (sim < 0.55) |
| Retrieval | hybrid: vector (top 15) + BM25 (top 15) → RRF → top 3 |
| Confidence threshold | 0.45 |
| LLM temp / top_p / max tokens | 0.2 / 0.9 / 512 |
| Retrieval latency | ~0.3–0.8 s |
| Total answer latency | GPU: 2.5–7 s · CPU: 10–40 s · fallback: 0.3–0.5 s |
| Ingest latency (typical SOP) | 3–8 s (+5–15 s per image) |
| DB files | `data/sop_chatbot.db` (SQLite), `chroma_db/` (vectors) |
| Supported upload types | .txt, .md, .pdf, .docx |
