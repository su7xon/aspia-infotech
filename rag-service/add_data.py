import os
import sys
import re
import argparse
import logging
from typing import List, Dict, Any, Optional
import requests
import chromadb
from chromadb.config import Settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("sop-ingest")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", os.path.join(_BASE_DIR, "chroma_db"))
DEFAULT_SOP_DIR = os.getenv("SOP_DIR", os.path.join(_BASE_DIR, "sops"))
COLLECTION_NAME = "sop_documents"


def get_chroma_client() -> chromadb.PersistentClient:
    os.makedirs(CHROMA_DB_DIR, exist_ok=True)
    return chromadb.PersistentClient(path=CHROMA_DB_DIR)


def get_embedding(text: str) -> List[float]:
    url = f"{OLLAMA_HOST}/api/embeddings"
    payload = {
        "model": EMBEDDING_MODEL,
        "prompt": text,
        "keep_alive": "1h"
    }
    try:
        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        return data["embedding"]
    except Exception as e:
        logger.error(f"Failed to generate embedding for text snippet: {e}")
        raise RuntimeError(f"Ollama embedding error: {e}. Ensure Ollama is running and '{EMBEDDING_MODEL}' is pulled.")


def get_embeddings_batch(texts: List[str]) -> List[List[float]]:
    url = f"{OLLAMA_HOST}/api/embed"
    payload = {
        "model": EMBEDDING_MODEL,
        "input": texts,
        "keep_alive": "1h"
    }
    try:
        response = requests.post(url, json=payload, timeout=180)
        response.raise_for_status()
        return response.json()["embeddings"]
    except Exception as e:
        logger.error(f"Failed to generate batch embeddings: {e}")
        raise RuntimeError(f"Ollama embedding error: {e}. Ensure Ollama is running and '{EMBEDDING_MODEL}' is pulled.")


def extract_text_from_file(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext in ['.txt', '.md']:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
            
    elif ext == '.pdf':
        try:
            import pypdf
            reader = pypdf.PdfReader(file_path)
            text = []
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text.append(extracted)
            return "\n\n".join(text)
        except ImportError:
            logger.warning("pypdf not installed. Falling back to plain text reading if available.")
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read()
                
    elif ext == '.docx':
        try:
            import docx
            doc = docx.Document(file_path)
            fullText = []
            for para in doc.paragraphs:
                if para.text:
                    fullText.append(para.text)
            return "\n\n".join(fullText)
        except ImportError:
            logger.warning("python-docx not installed. Reading file raw.")
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read()
    else:
        logger.warning(f"Unsupported extension '{ext}'. Attempting text read.")
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()


def _split_sentences(text: str) -> List[str]:
    parts = re.split(r'(?<=[.!?。])\s+|\n+', text)
    sentences = [p.strip() for p in parts if p and p.strip()]
    return sentences


def _semantic_split_block(block_text: str, filename: str, heading: str, chunk_index: int):
    sentences = _split_sentences(block_text)

    if len(sentences) <= 2:
        chunk = {
            "id": f"{filename}_chunk_{chunk_index}",
            "text": " ".join(sentences) if sentences else block_text,
            "metadata": {
                "source_file": filename,
                "heading": heading,
                "chunk_index": chunk_index,
                "char_length": len(block_text)
            }
        }
        return [chunk], chunk_index

    try:
        window_size = 3
        windows = []
        window_starts = []
        for i in range(0, len(sentences), window_size):
            windows.append(" ".join(sentences[i:i + window_size]))
            window_starts.append(i)
        window_embs = get_embeddings_batch(windows)
        window_embeddings = {}
        for start, emb in zip(window_starts, window_embs):
            window_embeddings[start] = emb
        embeddings = list(window_embeddings.values())
    except Exception as e:
        logger.warning(f"Semantic split unavailable ({e}); using size-based split.")
        return _size_split_block(block_text, filename, heading, chunk_index)

    split_points = [0]
    SIM_THRESHOLD = float(os.getenv("SEMANTIC_SPLIT_SIM", "0.55"))
    for i in range(0, len(sentences) - window_size, window_size):
        if i + window_size >= len(sentences):
            break
        sim = _cosine_similarity(window_embeddings[i], window_embeddings[i + window_size])
        if sim < SIM_THRESHOLD:
            split_points.append(i + window_size)

    OVERLAP_CHARS = int(os.getenv("CHUNK_OVERLAP_CHARS", "180"))
    chunks, chunk_index = [], chunk_index
    for j, start in enumerate(split_points):
        end = split_points[j + 1] if j + 1 < len(split_points) else len(sentences)
        chunk_text = " ".join(sentences[start:end])[:1500]
        if j > 0:
            prev_text = " ".join(sentences[split_points[j - 1]:start])
            overlap = prev_text[-OVERLAP_CHARS:] if len(prev_text) > OVERLAP_CHARS else prev_text
            if overlap:
                chunk_text = f"{overlap}\n\n{chunk_text}"
        if not chunk_text.strip():
            continue
        chunks.append({
            "id": f"{filename}_chunk_{chunk_index}",
            "text": chunk_text,
            "metadata": {
                "source_file": filename,
                "heading": heading,
                "chunk_index": chunk_index,
                "char_length": len(chunk_text)
            }
        })
        chunk_index += 1

    if not chunks:
        chunks = [{
            "id": f"{filename}_chunk_{chunk_index}",
            "text": block_text[:1500],
            "metadata": {
                "source_file": filename,
                "heading": heading,
                "chunk_index": chunk_index,
                "char_length": len(block_text[:1500])
            }
        }]
        chunk_index += 1

    return chunks, chunk_index


def _size_split_block(block_text: str, filename: str, heading: str, chunk_index: int):
    OVERLAP_CHARS = int(os.getenv("CHUNK_OVERLAP_CHARS", "180"))
    chunks = []
    if len(block_text) <= 1500:
        chunks.append({
            "id": f"{filename}_chunk_{chunk_index}",
            "text": block_text,
            "metadata": {
                "source_file": filename,
                "heading": heading,
                "chunk_index": chunk_index,
                "char_length": len(block_text)
            }
        })
        return chunks, chunk_index
    start = 0
    while start < len(block_text):
        end = min(start + 1500, len(block_text))
        piece_start = max(0, start - OVERLAP_CHARS) if start > 0 else 0
        piece = block_text[piece_start:end]
        chunks.append({
            "id": f"{filename}_chunk_{chunk_index}",
            "text": piece,
            "metadata": {
                "source_file": filename,
                "heading": heading,
                "chunk_index": chunk_index,
                "char_length": len(piece)
            }
        })
        chunk_index += 1
        start = end
    return chunks, chunk_index


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    import math
    if len(a) != len(b):
        return 1.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a)) or 1.0
    norm_b = math.sqrt(sum(x * x for x in b)) or 1.0
    return dot / (norm_a * norm_b)


def extract_images_from_file(file_path: str, max_images: int = 10) -> List[Dict[str, Any]]:
    import io
    ext = os.path.splitext(file_path)[1].lower()
    images: List[Dict[str, Any]] = []

    if ext == '.pdf':
        try:
            from pypdf import PdfReader
            reader = PdfReader(file_path)
            for page_no, page in enumerate(reader.pages):
                for img in getattr(page, "images", []) or []:
                    data = getattr(img, "data", None)
                    if not data or len(data) < 2048:
                        continue
                    if len(images) >= max_images:
                        return images
                    images.append({
                        "index": len(images),
                        "mime": getattr(img, "name", "").split(".")[-1].lower() or "png",
                        "data": data
                    })
        except Exception as e:
            logger.warning(f"PDF image extraction failed: {e}")

    elif ext == '.docx':
        try:
            import zipfile
            with zipfile.ZipFile(file_path) as zf:
                media_names = sorted(
                    n for n in zf.namelist()
                    if n.startswith("word/media/") and not n.endswith("/")
                )
                for name in media_names:
                    data = zf.read(name)
                    if not data or len(data) < 2048:
                        continue
                    if len(images) >= max_images:
                        return images
                    mime = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
                    images.append({
                        "index": len(images),
                        "mime": mime,
                        "data": data
                    })
        except Exception as e:
            logger.warning(f"DOCX image extraction failed: {e}")

    return images


def caption_image(image_data: bytes, mime: str, index: int, filename: str) -> Optional[str]:
    import base64
    try:
        b64 = base64.b64encode(image_data).decode("ascii")
        payload = {
            "model": os.getenv("LLM_MODEL", "qwen2.5vl:7b"),
            "prompt": (
                "Describe this image from the SOP document in detail: what it shows, "
                "any text/numbers/labels/flowchart steps visible. Be factual and concise."
            ),
            "images": [b64],
            "stream": False,
            "keep_alive": "1h",
            "options": {"temperature": 0.2, "num_predict": 300}
        }
        resp = requests.post(f"{os.getenv('OLLAMA_HOST', 'http://localhost:11434')}/api/generate", json=payload, timeout=120)
        resp.raise_for_status()
        caption = resp.json().get("response", "").strip()
        if caption:
            logger.info(f"Captioned image #{index} of '{filename}' ({mime}, {len(image_data)} bytes).")
            return caption
    except Exception as e:
        logger.warning(f"Image captioning failed for #{index} of '{filename}': {e}")
    return None


def build_image_chunks(file_path: str, filename: str, category: str, max_images: int = 10) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    images = extract_images_from_file(file_path, max_images=max_images)
    if not images:
        return chunks

    logger.info(f"Extracted {len(images)} image(s) from '{filename}'. Captioning with Qwen2-VL...")
    for idx, img in enumerate(images):
        caption = caption_image(img["data"], img["mime"], idx, filename)
        if not caption:
            continue
        chunks.append({
            "id": f"{filename}_img_{idx}",
            "text": f"[SOP IMAGE #{idx}] {caption}",
            "metadata": {
                "source_file": filename,
                "heading": f"[IMAGE #{idx}]",
                "chunk_index": idx,
                "char_length": len(caption) + 20,
                "chunk_type": "image",
                "category": category
            }
        })
    return chunks


def chunk_sop_text(text: str, filename: str) -> List[Dict[str, Any]]:

    heading_pattern = r'(\n(?=#{1,4}\s|\bSECTION\b|\bTOPIC\b|\bPOLICY\b|\bPROCEDURE\b|\bSOP-\d+|\b[A-Z0-9\.\s\-]{4,40}:\n|\d+\.\d+\s+[A-Z]))'
    raw_sections = re.split(heading_pattern, text, flags=re.IGNORECASE)

    chunks = []
    current_heading = "General SOP Overview"

    raw_blocks = [block.strip() for block in raw_sections if block and block.strip()]

    current_buffer = ""
    chunk_index = 0

    for block in raw_blocks:
        first_line = block.split('\n')[0].strip()
        if re.match(r'^(#{1,4}\s|\bSECTION\b|\bTOPIC\b|\bPOLICY\b|\bPROCEDURE\b|\bSOP-|\d+\.\d+\s)', first_line, re.I):
            current_heading = first_line.lstrip('#').strip()

        if len(current_buffer) + len(block) > 1500 and current_buffer:
            block_chunks, chunk_index = _semantic_split_block(current_buffer.strip(), filename, current_heading, chunk_index)
            chunks.extend(block_chunks)
            current_buffer = block
        else:
            current_buffer += "\n\n" + block if current_buffer else block

    if current_buffer.strip():
        block_chunks, _ = _semantic_split_block(current_buffer.strip(), filename, current_heading, chunk_index)
        chunks.extend(block_chunks)

    logger.info(f"Document '{filename}' split into {len(chunks)} chunk(s).")
    return chunks


def ingest_file(file_path: str, collection, reset_file_first: bool = True):
    filename = os.path.basename(file_path)
    logger.info(f"Processing file: {filename}")
    
    if reset_file_first:
        try:
            existing = collection.get(where={"source_file": filename})
            if existing and existing["ids"]:
                collection.delete(ids=existing["ids"])
                logger.info(f"Cleared {len(existing['ids'])} existing chunks for '{filename}'.")
        except Exception as e:
            logger.debug(f"No previous chunks found for '{filename}': {e}")
            
    content = extract_text_from_file(file_path)
    chunks = chunk_sop_text(content, filename) if content.strip() else []
    image_chunks = build_image_chunks(file_path, filename, "Custom Policy")
    chunks.extend(image_chunks)

    if not chunks:
        logger.warning(f"File '{filename}' contains no extractable text or images. Skipping.")
        return
        
    ids = []
    documents = []
    metadatas = []
    
    for chunk in chunks:
        ids.append(chunk["id"])
        documents.append(f"Document: {filename} | Section: {chunk['metadata']['heading']}\n\n{chunk['text']}")
        metadatas.append(chunk["metadata"])
    
    embeddings = []
    for i in range(0, len(chunks), 25):
        batch_texts = [c["text"] for c in chunks[i:i + 25]]
        embeddings.extend(get_embeddings_batch(batch_texts))
        logger.info(f"Embedded {min(i + 25, len(chunks))}/{len(chunks)} chunks for '{filename}'.")
        
    if ids:
        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas
        )
        logger.info(f"Successfully added {len(ids)} chunks to ChromaDB collection '{COLLECTION_NAME}' for file '{filename}'.")


def main():
    parser = argparse.ArgumentParser(description="Ingest company SOP files into ChromaDB vector database using Ollama embeddings.")
    parser.add_argument("--file", type=str, help="Path to a single SOP file to ingest or update")
    parser.add_argument("--dir", type=str, default=DEFAULT_SOP_DIR, help=f"Directory containing SOP files (default: {DEFAULT_SOP_DIR})")
    parser.add_argument("--reset", action="store_true", help="Reset and clear the entire ChromaDB collection before ingestion")
    
    args = parser.parse_args()
    
    chroma_client = get_chroma_client()
    collection = chroma_client.get_or_create_collection(name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"})
    
    if args.reset:
        logger.warning(f"Resetting collection '{COLLECTION_NAME}'...")
        chroma_client.delete_collection(name=COLLECTION_NAME)
        collection = chroma_client.create_collection(name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"})
        logger.info("Collection reset complete.")
        
    if args.file:
        if os.path.exists(args.file):
            ingest_file(args.file, collection, reset_file_first=True)
        else:
            logger.error(f"Specified file does not exist: {args.file}")
            sys.exit(1)
    else:
        sop_dir = args.dir
        if not os.path.exists(sop_dir):
            os.makedirs(sop_dir, exist_ok=True)
            logger.info(f"Created directory '{sop_dir}'. Place SOP files (.txt, .pdf, .docx, .md) inside and re-run.")
            sys.exit(0)
            
        files = [os.path.join(sop_dir, f) for f in os.listdir(sop_dir) if os.path.isfile(os.path.join(sop_dir, f))]
        if not files:
            logger.warning(f"No files found in '{sop_dir}'. Place SOP documents here.")
            sys.exit(0)
            
        logger.info(f"Found {len(files)} file(s) in '{sop_dir}'. Starting batch ingestion...")
        for file_path in files:
            try:
                ingest_file(file_path, collection, reset_file_first=True)
            except Exception as e:
                logger.error(f"Error ingesting file {file_path}: {e}")
                
    logger.info("SOP Ingestion Process Completed Successfully.")


if __name__ == "__main__":
    main()
