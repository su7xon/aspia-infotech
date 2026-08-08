"""
FastAPI Microservice for Local RAG SOP Chatbot
rag-service/main.py

Receives HTTP POST requests from Laravel backend controller (/ask), queries local ChromaDB vector database,
applies confidence thresholding, formats strict system prompt, and calls local Ollama Qwen2-VL model.
"""

import os
import re
import base64
import logging
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import requests
import chromadb

from add_data import extract_text_from_file, chunk_sop_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("rag-service")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5vl:7b")
CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")
SOP_DIR = os.getenv("SOP_DIR", "./sops")
ALLOWED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx"}
COLLECTION_NAME = "sop_documents"
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.45"))
COMPANY_NAME = os.getenv("COMPANY_NAME", "Acme Enterprise")

FALLBACK_MESSAGE = "This isn't covered in our SOPs — please contact the concerned department."

SYSTEM_PROMPT = f"""You are an internal assistant for {COMPANY_NAME}. You are an EXTRACTOR, not a general assistant. You answer ONLY from the RETRIEVED COMPANY SOP CONTEXT provided in the prompt.

RULES:
1. Extract facts strictly from the SOP context. Never add outside knowledge, assumptions, or training-data answers.
2. Answer in a clear structured format:
   - Use numbered steps (1. 2. 3.) for procedures.
   - Use short bullet points for lists of rules/requirements.
   - Quote exact values verbatim: phone extensions, URLs, deadlines, roles.
3. At the end, on its own line, add a source line per SOP used:
   "Source: <filename> (Section: <heading>)"
4. If the SOP context does NOT contain the answer, reply ONLY with:
   "This isn't covered in our SOPs — please contact the concerned department."
   Do not add explanations or guesses.
5. No greetings, no intro sentences, no conclusions. Just the structured answer and sources."""

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


class AskRequest(BaseModel):
    question: str = Field(..., description="The user's question regarding company SOPs")
    image: Optional[str] = Field(None, description="Optional base64 encoded image string (PNG/JPEG)")
    confidence_threshold: Optional[float] = Field(None, description="Override default confidence threshold score (0.0 to 1.0)")


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


def get_embedding(text: str) -> List[float]:
    """Fetch vector embedding from Ollama nomic-embed-text API."""
    url = f"{OLLAMA_HOST}/api/embeddings"
    payload = {"model": EMBEDDING_MODEL, "prompt": text}
    try:
        response = requests.post(url, json=payload, timeout=15)
        response.raise_for_status()
        return response.json()["embedding"]
    except Exception as e:
        logger.error(f"Ollama embedding request failed: {e}")
        raise HTTPException(status_code=503, detail=f"Ollama embedding model '{EMBEDDING_MODEL}' unavailable. Ensure Ollama is running.")


def calculate_similarity_score(distance: float) -> float:
    """
    Convert ChromaDB distance (cosine or L2) into a normalized similarity score (0.0 to 1.0).
    Chroma default distance is cosine distance (range 0 to 2, where 0 is identical).
    Similarity = max(0.0, 1.0 - distance)
    """
    score = 1.0 - distance
    return max(0.0, min(1.0, score))


@app.get("/health")
def health_check():
    """Health check endpoint to verify ChromaDB and Ollama connection status."""
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
        }
    }


@app.post("/ingest")
async def ingest_sop_document(file: UploadFile = File(...), category: str = Form("Custom Policy")):
    """Upload a .txt/.md/.pdf/.docx SOP file: save locally, chunk, embed, and index into ChromaDB."""
    filename = file.filename or "untitled"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}")

    safe_name = re.sub(r'[^\w\-. ]+', '_', os.path.basename(filename)).strip()
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    os.makedirs(SOP_DIR, exist_ok=True)
    dest = os.path.join(SOP_DIR, safe_name)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    with open(dest, "wb") as f:
        f.write(raw)

    try:
        text = extract_text_from_file(dest)
    except Exception as e:
        logger.error(f"Text extraction failed for '{safe_name}': {e}")
        raise HTTPException(status_code=422, detail=f"Could not extract text from '{safe_name}'. Is it a valid {ext} file?")

    if not text.strip():
        raise HTTPException(status_code=422, detail=f"File '{safe_name}' contains no extractable text (scanned image PDF? try OCR).")

    try:
        existing = collection.get(where={"source_file": safe_name})
        if existing and existing.get("ids"):
            collection.delete(ids=existing["ids"])
            logger.info(f"Cleared {len(existing['ids'])} previous chunks for '{safe_name}'.")

        chunks = chunk_sop_text(text, safe_name)
        ids, embeddings, documents, metadatas = [], [], [], []
        for chunk in chunks:
            ids.append(chunk["id"])
            documents.append(f"Document: {safe_name} | Section: {chunk['metadata']['heading']}\n\n{chunk['text']}")
            meta = dict(chunk["metadata"])
            meta["category"] = category
            metadatas.append(meta)
            embeddings.append(get_embedding(chunk["text"]))

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
    """List all indexed SOP documents grouped by source file."""
    data = collection.get(include=["documents", "metadatas"])
    grouped: Dict[str, dict] = {}
    for i, doc_id in enumerate(data["ids"]):
        meta = data["metadatas"][i] if data.get("metadatas") else {}
        meta = meta or {}
        src = meta.get("source_file", "Unknown")
        entry = grouped.get(src)
        if entry is None:
            title = os.path.splitext(src)[0].replace("_", " ").strip()
            entry = {
                "id": src,
                "filename": src,
                "category": meta.get("category", "Custom Policy"),
                "title": title or src,
                "content": "",
                "chunks": 0
            }
            grouped[src] = entry
        entry["content"] += data["documents"][i] + "\n\n"
        entry["chunks"] += 1
    return {"documents": list(grouped.values())}


@app.delete("/documents/{filename}")
def delete_document(filename: str):
    """Remove all indexed chunks for a source file from ChromaDB (keeps the copy in ./sops)."""
    safe_name = os.path.basename(filename)
    existing = collection.get(where={"source_file": safe_name})
    if existing and existing.get("ids"):
        collection.delete(ids=existing["ids"])
        return {"message": f"Removed {len(existing['ids'])} chunk(s) for '{safe_name}'.", "removed": len(existing["ids"])}
    raise HTTPException(status_code=404, detail=f"No indexed chunks found for '{safe_name}'.")


@app.post("/ask", response_model=AskResponse)
def ask_sop_question(request_data: AskRequest):
    """
    Main RAG Chatbot Endpoint.
    1. Embeds question using nomic-embed-text
    2. Searches ChromaDB for top 2-3 matching chunks
    3. Evaluates confidence score against threshold (e.g. 0.60)
    4. If confidence < threshold: returns fallback message immediately WITHOUT calling LLM
    5. If confidence >= threshold: builds context prompt & calls Qwen2-VL via Ollama API
    """
    question = request_data.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question string cannot be empty.")
        
    threshold = request_data.confidence_threshold if request_data.confidence_threshold is not None else CONFIDENCE_THRESHOLD
    logger.info(f"Received question: '{question}' | Image included: {bool(request_data.image)} | Threshold: {threshold}")
    
    query_vector = get_embedding(question)
    
    try:
        results = collection.query(
            query_embeddings=[query_vector],
            n_results=3,
            include=["documents", "metadatas", "distances"]
        )
    except Exception as e:
        logger.error(f"ChromaDB search error: {e}")
        best_score = 0.0
        results = None

    retrieved_chunks: List[RetrievedChunk] = []
    best_score = 0.0

    if results and results.get("documents") and results["documents"][0]:
        documents = results["documents"][0]
        metadatas = results["metadatas"][0] if results.get("metadatas") else []
        distances = results["distances"][0] if results.get("distances") else []
        ids = results["ids"][0] if results.get("ids") else []

        for i in range(len(documents)):
            dist = distances[i] if i < len(distances) else 1.0
            score = calculate_similarity_score(dist)
            
            meta = metadatas[i] if i < len(metadatas) else {}
            chunk_obj = RetrievedChunk(
                id=ids[i] if i < len(ids) else f"chunk_{i}",
                source_file=meta.get("source_file", "Unknown SOP"),
                heading=meta.get("heading", "General"),
                text=documents[i],
                similarity_score=round(score, 4)
            )
            retrieved_chunks.append(chunk_obj)
            
            if score > best_score:
                best_score = score

    logger.info(f"Vector search retrieved {len(retrieved_chunks)} chunk(s). Best match score: {best_score:.4f}")

    passed_threshold = best_score >= threshold and bool(retrieved_chunks)

    if not passed_threshold:
        logger.info(f"Best match {best_score:.4f} below threshold {threshold} - returning fallback without calling LLM.")
        return AskResponse(
            answer=FALLBACK_MESSAGE,
            confidence_score=round(best_score, 4),
            passed_threshold=False,
            chunks_retrieved=retrieved_chunks,
            model_used=LLM_MODEL
        )

    if retrieved_chunks:
        context_text = "\n\n---\n\n".join([
            f"[Source File: {chunk.source_file} | Heading: {chunk.heading}]\n{chunk.text}"
            for chunk in retrieved_chunks[:3]
        ])
    else:
        context_text = "(No SOP context retrieved for this question.)"

    user_prompt_content = f"""RETRIEVED COMPANY SOP CONTEXT:
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
        "options": {
            "temperature": 0.2,
            "top_p": 0.9
        }
    }

    if request_data.image:
        raw_b64 = re.sub(r'^data:image\/[a-zA-Z]+;base64,', '', request_data.image.strip())
        payload["images"] = [raw_b64]
        logger.info("Image attached to Ollama Qwen2-VL prompt payload.")

    try:
        logger.info(f"Calling Ollama LLM model '{LLM_MODEL}'...")
        ollama_res = requests.post(ollama_url, json=payload, timeout=60)
        ollama_res.raise_for_status()
        res_json = ollama_res.json()
        generated_answer = res_json.get("response", "").strip()

        if not generated_answer:
            generated_answer = FALLBACK_MESSAGE

        return AskResponse(
            answer=generated_answer,
            confidence_score=round(best_score, 4),
            passed_threshold=passed_threshold,
            chunks_retrieved=retrieved_chunks,
            model_used=LLM_MODEL
        )

    except Exception as e:
        logger.error(f"Error calling Ollama Qwen2-VL API: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Error reaching local LLM model '{LLM_MODEL}' via Ollama. Details: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    logger.info(f"Starting Python RAG Microservice on port {port}...")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
