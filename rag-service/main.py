import os
os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")
import re
import base64
import logging
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import requests
import chromadb

from add_data import extract_text_from_file, chunk_sop_text, build_image_chunks
from rank_bm25 import BM25Okapi

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("rag-service")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5vl:7b")
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", os.path.join(_BASE_DIR, "chroma_db"))
SOP_DIR = os.getenv("SOP_DIR", os.path.join(_BASE_DIR, "sops"))
ALLOWED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx"}
COLLECTION_NAME = "sop_documents"
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.62"))
MIN_GROUNDING_OVERLAP = float(os.getenv("MIN_GROUNDING_OVERLAP", "0.65"))
COMPANY_NAME = os.getenv("COMPANY_NAME", "Acme Enterprise")

FALLBACK_MESSAGE = "This isn't covered in our SOPs — please contact the concerned department."

SYSTEM_PROMPT = f"""You are a FORMATTER for {COMPANY_NAME}'s internal SOP system. You are NOT an assistant. You do NOT generate answers. You ONLY restructure the RAW SOP TEXT provided in the context.

YOUR ONLY JOB:
Take the relevant parts of the RETRIEVED SOP CONTEXT and present them in a clean, structured format. The MEANING, FACTS, and WORDS must remain IDENTICAL to the original SOP text.

STRICT RULES:
1. USE ONLY the exact words, sentences, and facts from the SOP context. Copy them — do NOT paraphrase, rephrase, or use synonyms.
2. You may REORGANIZE the text into:
   - Numbered steps (1. 2. 3.) for procedures
   - Bullet points for lists
   - Remove irrelevant parts that don't answer the question
   But NEVER change the wording or meaning.
3. Every number, name, date, extension, URL, role, deadline MUST be copied VERBATIM from the SOP context. If it's not in the context, do NOT write it.
4. Do NOT add any word, phrase, explanation, or interpretation that does not exist in the SOP context. Zero additions.
5. Do NOT paraphrase. "Submit the form within 3 business days" must stay exactly that — NOT "You need to submit within three working days."
6. At the end, on its own line, cite the source:
   "Source: <filename> (Section: <heading>)"
7. If the SOP context does NOT contain information to answer the question, reply ONLY with:
   "This isn't covered in our SOPs — please contact the concerned department."
   Nothing else. No guesses. No explanations.
8. No greetings, no intros, no conclusions, no "Sure!", no "Here's what I found". Just the formatted SOP text and source.
9. Answer in the same language as the USER QUESTION. Source line stays in English.
10. Use CONVERSATION HISTORY only to understand what "it", "that", "step 2" refers to. Never pull facts from history."""

app = FastAPI(
    title="Local SOP RAG Microservice",
    description="Offline Python microservice using ChromaDB & Ollama Qwen2-VL for SOP querying",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

chroma_client = chromadb.PersistentClient(path=CHROMA_DB_DIR)
collection = chroma_client.get_or_create_collection(name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"})

FAST_MODE = os.getenv("FAST_MODE", "0") == "1"
ENABLE_RERANKER = os.getenv("ENABLE_RERANKER", "0" if FAST_MODE else "1") == "1"
HYBRID_VECTOR_CANDIDATES = int(os.getenv("HYBRID_VECTOR_CANDIDATES", "8" if FAST_MODE else "15"))
BM25_CANDIDATES = int(os.getenv("BM25_CANDIDATES", "8" if FAST_MODE else "15"))
RRF_K = int(os.getenv("RRF_K", "60"))
RERANK_CANDIDATES = int(os.getenv("RERANK_CANDIDATES", "5" if FAST_MODE else "10"))
NUM_PREDICT = int(os.getenv("NUM_PREDICT", "256" if FAST_MODE else "512"))
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "60"))

MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_CHARS = 800

ABBREVIATION_MAP = {
    "sop": "standard operating procedure",
    "pto": "paid time off leave",
    "mfa": "multi factor authentication",
    "vpn": "virtual private network",
    "otp": "one time passcode",
    "loto": "lockout tagout",
    "hr": "human resources",
    "it": "information technology",
    "kpi": "key performance indicator",
    "ram": "memory",
    "gpu": "graphics processing unit hardware",
    "llm": "large language model ai",
    "rag": "retrieval augmented generation",
    "db": "database",
    "api": "application programming interface",
    "ext": "extension",
    "laptop": "computer hardware",
}

_reranker = None
_reranker_tried = False


def _get_reranker():
    global _reranker, _reranker_tried
    if not ENABLE_RERANKER:
        return None
    if _reranker is None and not _reranker_tried:
        _reranker_tried = True
        try:
            from sentence_transformers import CrossEncoder
            _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            logger.info("Cross-encoder reranker loaded.")
        except Exception as e:
            _reranker = None
            logger.warning(f"Reranker load failed, falling back to RRF only: {e}")
    return _reranker


def expand_query(question: str, history: Optional[List[Dict[str, str]]] = None) -> List[str]:
    variants = [question]

    tokens = re.findall(r"[a-z0-9]+", question.lower())
    expansions = [ABBREVIATION_MAP[t] for t in tokens if t in ABBREVIATION_MAP]
    if expansions:
        variants.append(f"{question} {' '.join(sorted(set(expansions)))}".strip())

    last_user_msg = next(
        (m.get("content", "").strip() for m in reversed(history or [])
         if m.get("role") == "user" and m.get("content", "").strip()),
        None
    )
    if last_user_msg:
        condensed = last_user_msg[:MAX_HISTORY_CHARS]
        enriched = f"{condensed} {question}".strip()
        if enriched not in variants:
            variants.append(enriched)

    return variants

_bm25_index: Optional[BM25Okapi] = None
_bm25_doc_ids: List[str] = []
_bm25_cache_key: Optional[int] = None


def _tokenize(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _rebuild_bm25() -> None:
    global _bm25_index, _bm25_doc_ids
    try:
        data = collection.get(include=["documents"])
    except Exception as e:
        logger.error(f"BM25 corpus load failed: {e}")
        _bm25_index = None
        _bm25_doc_ids = []
        return
    doc_ids = data.get("ids") or []
    docs = data.get("documents") or []
    _bm25_index = BM25Okapi([_tokenize(d) for d in docs]) if docs else None
    _bm25_doc_ids = doc_ids


def _ensure_bm25() -> None:
    global _bm25_cache_key
    doc_count = collection.count()
    if _bm25_cache_key != doc_count:
        _rebuild_bm25()
        _bm25_cache_key = doc_count


def _rrf_fuse(vector_ids: List[str], bm25_ids: List[str]) -> List[str]:
    fused: Dict[str, float] = {}
    for rank, doc_id in enumerate(vector_ids):
        fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (RRF_K + rank + 1)
    for rank, doc_id in enumerate(bm25_ids):
        fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (RRF_K + rank + 1)
    return [doc_id for doc_id, _ in sorted(fused.items(), key=lambda kv: kv[1], reverse=True)]


class AskRequest(BaseModel):
    question: str = Field(..., description="The user's question regarding company SOPs")
    image: Optional[str] = Field(None, description="Optional base64 encoded image string (PNG/JPEG)")
    confidence_threshold: Optional[float] = Field(None, description="Override default confidence threshold score (0.0 to 1.0)")
    history: Optional[List[Dict[str, str]]] = Field(
        None,
        description="Prior conversation turns as [{'role': 'user'|'assistant', 'content': '...'}], oldest first"
    )


class RetrievedChunk(BaseModel):
    id: str
    source_file: str
    heading: str
    text: str
    similarity_score: float


class AskResponse(BaseModel):
    answer: str
    confidence_score: float
    passed_threshold: bool
    chunks_retrieved: List[RetrievedChunk]
    model_used: str
    degraded: bool = Field(False, description="True when retrieval succeeded but LLM generation failed")
    grounding_passed: bool = Field(True, description="True when post-LLM grounding check passed")
    quality_scores: Optional[Dict[str, Any]] = Field(None, description="Detailed quality breakdown")


def get_embedding(text: str) -> List[float]:
    url = f"{OLLAMA_HOST}/api/embeddings"
    payload = {"model": EMBEDDING_MODEL, "prompt": text, "keep_alive": "1h"}
    try:
        response = requests.post(url, json=payload, timeout=15)
        response.raise_for_status()
        return response.json()["embedding"]
    except Exception as e:
        logger.error(f"Ollama embedding request failed: {e}")
        raise HTTPException(status_code=503, detail=f"Ollama embedding model '{EMBEDDING_MODEL}' unavailable. Ensure Ollama is running.")


def get_embeddings_batch(texts: List[str]) -> List[List[float]]:
    url = f"{OLLAMA_HOST}/api/embed"
    payload = {"model": EMBEDDING_MODEL, "input": texts, "keep_alive": "1h"}
    try:
        response = requests.post(url, json=payload, timeout=180)
        response.raise_for_status()
        return response.json()["embeddings"]
    except Exception as e:
        logger.error(f"Ollama batch embedding request failed: {e}")
        raise HTTPException(status_code=503, detail=f"Ollama embedding model '{EMBEDDING_MODEL}' unavailable. Ensure Ollama is running.")


def calculate_similarity_score(distance: float) -> float:
    score = 1.0 - distance
    return max(0.0, min(1.0, score))


def sanitize_history(raw_history: Optional[List[Dict[str, str]]]) -> List[Dict[str, str]]:
    if not raw_history:
        return []
    clean: List[Dict[str, str]] = []
    for msg in raw_history[-MAX_HISTORY_MESSAGES:]:
        role = str(msg.get("role", "")).lower()
        content = str(msg.get("content", "")).strip()
        if role not in ("user", "assistant") or not content:
            continue
        clean.append({"role": role, "content": content[:MAX_HISTORY_CHARS]})
    return clean


def format_history_block(history: List[Dict[str, str]]) -> str:
    lines = [f"{'USER' if m['role'] == 'user' else 'ASSISTANT'}: {m['content']}" for m in history]
    return "\n\n".join(lines)


def _content_tokens(text: str) -> set:
    toks = set(_tokenize(text))
    return {t for t in toks if len(t) > 2}


def is_grounded(answer: str, context: str) -> Dict[str, Any]:
    result = {
        "passed": True,
        "number_check": True,
        "overlap_check": True,
        "overlap_score": 0.0,
        "hallucinated_numbers": [],
        "source_cited": False,
        "details": "",
    }

    nums = set(re.findall(r"\d[\d.,]*", answer))
    ctx_nums = set(re.findall(r"\d[\d.,]*", context))
    hallucinated = []
    for n in nums:
        if n not in ctx_nums and n.strip(".,") not in {c.strip(".,") for c in ctx_nums}:
            hallucinated.append(n)
    if hallucinated:
        result["number_check"] = False
        result["hallucinated_numbers"] = hallucinated
        result["passed"] = False
        result["details"] = f"Hallucinated number(s): {', '.join(hallucinated)}"
        logger.warning(f"Grounding FAIL: hallucinated number(s) {hallucinated} not in SOP context.")
        return result

    a, c = _content_tokens(answer), _content_tokens(context)
    if not a:
        result["passed"] = False
        result["overlap_check"] = False
        result["details"] = "Answer has no meaningful tokens."
        return result
    overlap = len(a & c) / max(1, len(a))
    result["overlap_score"] = round(overlap, 4)
    if overlap < MIN_GROUNDING_OVERLAP:
        result["overlap_check"] = False
        result["passed"] = False
        result["details"] = f"Keyword overlap {overlap:.2f} < threshold {MIN_GROUNDING_OVERLAP}"
        logger.warning(f"Grounding FAIL: overlap {overlap:.2f} < {MIN_GROUNDING_OVERLAP}.")
        return result

    result["source_cited"] = bool(re.search(r"(?i)source:\s*\S+", answer))

    result["details"] = f"Overlap {overlap:.2f}, numbers OK, grounded."
    return result


@app.get("/health")
def health_check():
    ollama_ok = False
    try:
        res = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=3)
        if res.status_code == 200:
            ollama_ok = True
    except Exception:
        pass
        
    return {
        "status": "healthy",
        "chroma_db": "connected",
        "doc_count": collection.count(),
        "ollama_host": OLLAMA_HOST,
        "ollama_connected": ollama_ok,
        "models": {
            "embedding": EMBEDDING_MODEL,
            "llm": LLM_MODEL
        },
        "fast_mode": FAST_MODE,
        "reranker_enabled": ENABLE_RERANKER,
        "num_predict": NUM_PREDICT
    }


@app.post("/ingest")
def ingest_sop_document(file: UploadFile = File(...), category: str = Form("Custom Policy")):
    filename = file.filename or "untitled"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}")

    safe_name = re.sub(r'[^\w\-. ]+', '_', os.path.basename(filename)).strip()
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    os.makedirs(SOP_DIR, exist_ok=True)
    dest = os.path.join(SOP_DIR, safe_name)

    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    with open(dest, "wb") as f:
        f.write(raw)

    try:
        text = extract_text_from_file(dest)
    except Exception as e:
        logger.warning(f"Text extraction failed for '{safe_name}': {e}")
        text = ""

    chunks = chunk_sop_text(text, safe_name) if text.strip() else []
    image_chunks = build_image_chunks(dest, safe_name, category)
    chunks.extend(image_chunks)

    if not chunks:
        raise HTTPException(status_code=422, detail=f"File '{safe_name}' contains no extractable text or images.")

    try:
        existing = collection.get(where={"source_file": safe_name})
        if existing and existing.get("ids"):
            collection.delete(ids=existing["ids"])
            logger.info(f"Cleared {len(existing['ids'])} previous chunks for '{safe_name}'.")

        if image_chunks:
            logger.info(f"Included {len(image_chunks)} image caption chunk(s) for '{safe_name}'.")
        ids, documents, metadatas = [], [], []
        for chunk in chunks:
            ids.append(chunk["id"])
            documents.append(f"Document: {safe_name} | Section: {chunk['metadata']['heading']}\n\n{chunk['text']}")
            meta = dict(chunk["metadata"])
            meta["category"] = category
            metadatas.append(meta)

        embeddings = []
        for i in range(0, len(chunks), 25):
            batch_texts = [c["text"] for c in chunks[i:i + 25]]
            embeddings.extend(get_embeddings_batch(batch_texts))
            logger.info(f"Embedded {min(i + 25, len(chunks))}/{len(chunks)} chunks for '{safe_name}'.")

        collection.add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Indexing failed for '{safe_name}': {e}")
        raise HTTPException(status_code=500, detail=f"Indexing failed: {e}")

    logger.info(f"Ingested {len(ids)} chunk(s) from '{safe_name}' into collection '{COLLECTION_NAME}'.")
    return {
        "message": f"Successfully ingested '{safe_name}' ({category}).",
        "filename": safe_name,
        "category": category,
        "chunks": len(ids),
        "bytes": len(raw)
    }


@app.get("/documents")
def list_documents():
    data = collection.get(include=["documents", "metadatas"])
    grouped: Dict[str, dict] = {}
    for i, doc_id in enumerate(data["ids"]):
        meta = data["metadatas"][i] if data.get("metadatas") else {}
        meta = meta or {}
        src = meta.get("source_file", "Unknown")
        entry = grouped.get(src)
        if entry is None:
            title = os.path.splitext(src)[0].replace("_", " ").strip()
            ext = os.path.splitext(src)[1].lower().lstrip(".")
            entry = {
                "id": src,
                "filename": src,
                "category": meta.get("category", "Custom Policy"),
                "title": title or src,
                "file_type": ext or "unknown",
                "content": "",
                "chunks": 0
            }
            grouped[src] = entry
        entry["content"] += data["documents"][i] + "\n\n"
        entry["chunks"] += 1
    return {"documents": list(grouped.values())}


@app.get("/chunks")
def list_chunks():
    data = collection.get(include=["documents", "metadatas"])
    chunks = []
    for i, doc_id in enumerate(data["ids"]):
        meta = data["metadatas"][i] if data.get("metadatas") else {}
        meta = meta or {}
        text = data["documents"][i] if data.get("documents") else ""
        chunks.append({
            "id": doc_id,
            "source_file": meta.get("source_file", "Unknown"),
            "heading": meta.get("heading", "General"),
            "chunk_index": meta.get("chunk_index"),
            "chunk_type": meta.get("chunk_type", "text"),
            "char_length": meta.get("char_length"),
            "category": meta.get("category", "Custom Policy"),
            "text": text
        })
    chunks.sort(key=lambda c: (c["source_file"], c["chunk_index"] or 0))
    return {"chunks": chunks, "count": len(chunks)}


@app.delete("/documents")
def delete_all_documents():
    global _bm25_index, _bm25_doc_ids, _bm25_cache_key, collection
    try:
        all_data = collection.get()
        ids = all_data.get("ids") or []
        count = len(ids)
        if count > 0:
            collection.delete(ids=ids)
        _bm25_index = None
        _bm25_doc_ids = []
        _bm25_cache_key = None
        logger.info(f"Cleared all {count} indexed chunk(s) from collection '{COLLECTION_NAME}'.")
        return {"message": f"Successfully deleted all {count} indexed chunk(s).", "deleted_chunks": count}
    except Exception as e:
        logger.error(f"Failed to clear all documents: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear documents: {e}")


@app.delete("/documents/{filename}")
def delete_document(filename: str):
    safe_name = os.path.basename(filename)
    existing = collection.get(where={"source_file": safe_name})
    if existing and existing.get("ids"):
        collection.delete(ids=existing["ids"])
        return {"message": f"Removed {len(existing['ids'])} chunk(s) for '{safe_name}'.", "removed": len(existing["ids"])}
    raise HTTPException(status_code=404, detail=f"No indexed chunks found for '{safe_name}'.")


@app.post("/ask", response_model=AskResponse)
def ask_sop_question(request_data: AskRequest):
    question = request_data.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question string cannot be empty.")
        
    threshold = request_data.confidence_threshold if request_data.confidence_threshold is not None else CONFIDENCE_THRESHOLD
    history = sanitize_history(request_data.history)
    logger.info(f"Received question: '{question}' | Image included: {bool(request_data.image)} | Threshold: {threshold} | History turns: {len(history)}")

    query_variants = expand_query(question, history)

    vector_hits: Dict[str, dict] = {}
    vector_rank: List[str] = []

    for variant in query_variants:
        try:
            query_vector = get_embedding(variant)
            results = collection.query(
                query_embeddings=[query_vector],
                n_results=HYBRID_VECTOR_CANDIDATES,
                include=["documents", "metadatas", "distances"]
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"ChromaDB search error: {e}")
            results = None

        if results and results.get("documents") and results["documents"][0]:
            documents = results["documents"][0]
            metadatas = results["metadatas"][0] if results.get("metadatas") else []
            distances = results["distances"][0] if results.get("distances") else []
            ids = results["ids"][0] if results.get("ids") else []

            for i in range(len(documents)):
                doc_id = ids[i] if i < len(ids) else f"chunk_{i}"
                if doc_id not in vector_hits:
                    vector_hits[doc_id] = {
                        "text": documents[i],
                        "metadata": metadatas[i] if i < len(metadatas) else {},
                        "distance": distances[i] if i < len(distances) else 1.0
                    }
                    vector_rank.append(doc_id)

    bm25_rank: List[str] = []
    try:
        _ensure_bm25()
        if _bm25_index and _bm25_doc_ids:
            query_tokens = _tokenize(question)
            bm25_scores = _bm25_index.get_scores(query_tokens)
            bm25_rank = [
                doc_id for _, doc_id in sorted(
                    zip(bm25_scores, _bm25_doc_ids), key=lambda kv: kv[0], reverse=True
                )
            ][:BM25_CANDIDATES]
    except Exception as e:
        logger.error(f"BM25 search error: {e}")

    fused_ids = [doc_id for doc_id in _rrf_fuse(vector_rank, bm25_rank) if doc_id in vector_hits][:RERANK_CANDIDATES]
    if not fused_ids:
        fused_ids = vector_rank[:RERANK_CANDIDATES]

    reranker = _get_reranker()
    if reranker is not None and len(fused_ids) >= 2:
        try:
            pairs = [(question, vector_hits[did]["text"]) for did in fused_ids]
            rerank_scores = reranker.predict(pairs)
            fused_ids = [did for _, did in sorted(zip(rerank_scores, fused_ids), key=lambda kv: kv[0], reverse=True)]
            logger.info("Cross-encoder reranker applied over %d candidate(s).", len(fused_ids))
        except Exception as e:
            logger.warning(f"Rerank failed, using RRF order: {e}")
    fused_ids = fused_ids[:3]

    retrieved_chunks: List[RetrievedChunk] = []
    best_score = 0.0

    for doc_id in fused_ids:
        hit = vector_hits.get(doc_id)
        if not hit:
            continue
        score = calculate_similarity_score(hit["distance"])
        meta = hit["metadata"]
        retrieved_chunks.append(RetrievedChunk(
            id=doc_id,
            source_file=meta.get("source_file", "Unknown SOP"),
            heading=meta.get("heading", "General"),
            text=hit["text"],
            similarity_score=round(score, 4)
        ))
        if score > best_score:
            best_score = score

    logger.info(f"Hybrid search retrieved {len(retrieved_chunks)} chunk(s) (vector {len(vector_rank)} + bm25 {len(bm25_rank)}). Best match score: {best_score:.4f}")

    passed_threshold = best_score >= threshold and bool(retrieved_chunks)

    if not passed_threshold:
        logger.info(f"Best match {best_score:.4f} below threshold {threshold} - returning fallback without calling LLM.")
        return AskResponse(
            answer=FALLBACK_MESSAGE,
            confidence_score=round(best_score, 4),
            passed_threshold=False,
            chunks_retrieved=retrieved_chunks,
            model_used="none (below confidence threshold)",
            grounding_passed=False,
            quality_scores={
                "retrieval_confidence": round(best_score, 4),
                "grounding": {"passed": False, "details": "Skipped — below confidence threshold"},
                "chunks_used": len(retrieved_chunks),
                "threshold_used": threshold,
            },
        )

    if retrieved_chunks:
        context_text = "\n\n---\n\n".join([
            f"[Source File: {chunk.source_file} | Heading: {chunk.heading}]\n{chunk.text}"
            for chunk in retrieved_chunks[:3]
        ])
    else:
        context_text = "(No SOP context retrieved for this question.)"

    history_block = ""
    if history:
        history_block = f"""CONVERSATION HISTORY (for reference resolution only):
{format_history_block(history)}

"""

    user_prompt_content = f"""{history_block}RETRIEVED COMPANY SOP CONTEXT:
{context_text}

USER QUESTION:
{question}
"""

    ollama_url = f"{OLLAMA_HOST}/api/generate"
    
    payload = {
        "model": LLM_MODEL,
        "system": SYSTEM_PROMPT,
        "prompt": user_prompt_content,
        "stream": False,
        "keep_alive": "1h",
        "options": {
            "temperature": 0.0,
            "top_p": 0.9,
            "num_predict": NUM_PREDICT
        }
    }

    if request_data.image:
        raw_b64 = re.sub(r'^data:image\/[a-zA-Z]+;base64,', '', request_data.image.strip())
        payload["images"] = [raw_b64]
        logger.info("Image attached to Ollama Qwen2-VL prompt payload.")

    try:
        logger.info(f"Calling Ollama LLM model '{LLM_MODEL}'...")
        ollama_res = requests.post(ollama_url, json=payload, timeout=OLLAMA_TIMEOUT)
        ollama_res.raise_for_status()
        res_json = ollama_res.json()
        generated_answer = res_json.get("response", "").strip()

        if not generated_answer:
            generated_answer = FALLBACK_MESSAGE

        grounding = {"passed": True, "details": "Fallback or skipped"}
        if generated_answer != FALLBACK_MESSAGE:
            grounding = is_grounded(generated_answer, context_text)

        quality_scores = {
            "retrieval_confidence": round(best_score, 4),
            "grounding": grounding,
            "chunks_used": len(retrieved_chunks),
            "threshold_used": threshold,
        }

        if not grounding["passed"]:
            logger.warning(f"LLM answer failed grounding — returning fallback. Details: {grounding.get('details')}")
            return AskResponse(
                answer=FALLBACK_MESSAGE,
                confidence_score=round(best_score, 4),
                passed_threshold=passed_threshold,
                chunks_retrieved=retrieved_chunks,
                model_used=f"{LLM_MODEL} (grounding-failed)",
                grounding_passed=False,
                quality_scores=quality_scores,
            )

        return AskResponse(
            answer=generated_answer,
            confidence_score=round(best_score, 4),
            passed_threshold=passed_threshold,
            chunks_retrieved=retrieved_chunks,
            model_used=LLM_MODEL,
            grounding_passed=True,
            quality_scores=quality_scores,
        )

    except Exception as e:
        logger.error(f"Error calling Ollama Qwen2-VL API: {e}")
        sources_block = "\n\n".join([
            f"[{chunk.source_file} | {chunk.heading}]\n{chunk.text}"
            for chunk in retrieved_chunks[:3]
        ])
        degraded_answer = (
            "The answer generator (local LLM) is temporarily unavailable, so no generated answer can be provided. "
            f"However, {len(retrieved_chunks[:3])} matching SOP section(s) were found:\n\n"
            f"{sources_block}"
        )
        return AskResponse(
            answer=degraded_answer,
            confidence_score=round(best_score, 4),
            passed_threshold=passed_threshold,
            chunks_retrieved=retrieved_chunks,
            model_used=f"{LLM_MODEL} (unavailable)",
            degraded=True,
            grounding_passed=False,
            quality_scores={
                "retrieval_confidence": round(best_score, 4),
                "grounding": {"passed": False, "details": "LLM unavailable — grounding skipped"},
                "chunks_used": len(retrieved_chunks),
                "threshold_used": threshold,
            },
        )


@app.on_event("startup")
def _startup_preload():
    try:
        _get_reranker()
    except Exception as e:
        logger.warning(f"Reranker pre-load failed (non-fatal): {e}")
    try:
        _ensure_bm25()
    except Exception as e:
        logger.warning(f"BM25 pre-build failed (non-fatal): {e}")
    logger.info("Startup pre-loading complete.")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    logger.info(f"Starting Python RAG Microservice on port {port}...")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
