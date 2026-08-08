"""
Data Ingestion Script for Local RAG SOP Chatbot
rag-service/add_data.py

Reads company SOP documents (.txt, .docx, .pdf, .md), chunks them logically by sections/headings,
generates embeddings using Ollama's `nomic-embed-text` model, and stores chunk text, vector embeddings,
and metadata into a local file-based ChromaDB instance.
"""

import os
import sys
import re
import argparse
import logging
from typing import List, Dict, Any
import requests
import chromadb
from chromadb.config import Settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("sop-ingest")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")
COLLECTION_NAME = "sop_documents"


def get_chroma_client() -> chromadb.PersistentClient:
    """Initialize and return a persistent local ChromaDB client."""
    os.makedirs(CHROMA_DB_DIR, exist_ok=True)
    return chromadb.PersistentClient(path=CHROMA_DB_DIR)


def get_embedding(text: str) -> List[float]:
    """
    Generate vector embedding using Ollama nomic-embed-text API.
    Calls local Ollama endpoint: POST /api/embeddings
    """
    url = f"{OLLAMA_HOST}/api/embeddings"
    payload = {
        "model": EMBEDDING_MODEL,
        "prompt": text
    }
    try:
        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        return data["embedding"]
    except Exception as e:
        logger.error(f"Failed to generate embedding for text snippet: {e}")
        raise RuntimeError(f"Ollama embedding error: {e}. Ensure Ollama is running and '{EMBEDDING_MODEL}' is pulled.")


def extract_text_from_file(file_path: str) -> str:
    """Extract plain text from .txt, .md, .docx, or .pdf files."""
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


def chunk_sop_text(text: str, filename: str) -> List[Dict[str, Any]]:
    """
    Splits SOP document into logical chunks based on headings, sections, or paragraph groups.
    Each chunk retains its parent section title/heading for high semantic precision.
    """
    
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
            chunks.append({
                "id": f"{filename}_chunk_{chunk_index}",
                "text": current_buffer.strip(),
                "metadata": {
                    "source_file": filename,
                    "heading": current_heading,
                    "chunk_index": chunk_index,
                    "char_length": len(current_buffer.strip())
                }
            })
            chunk_index += 1
            current_buffer = block
        else:
            current_buffer += "\n\n" + block if current_buffer else block
            
    if current_buffer.strip():
        chunks.append({
            "id": f"{filename}_chunk_{chunk_index}",
            "text": current_buffer.strip(),
            "metadata": {
                "source_file": filename,
                "heading": current_heading,
                "chunk_index": chunk_index,
                "char_length": len(current_buffer.strip())
            }
        })
        
    logger.info(f"Document '{filename}' split into {len(chunks)} chunk(s).")
    return chunks


def ingest_file(file_path: str, collection, reset_file_first: bool = True):
    """Process a single file and store its chunks & embeddings into ChromaDB."""
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
    if not content.strip():
        logger.warning(f"File '{filename}' is empty. Skipping.")
        return
        
    chunks = chunk_sop_text(content, filename)
    
    ids = []
    embeddings = []
    documents = []
    metadatas = []
    
    for chunk in chunks:
        ids.append(chunk["id"])
        documents.append(f"Document: {filename} | Section: {chunk['metadata']['heading']}\n\n{chunk['text']}")
        metadatas.append(chunk["metadata"])
        
        emb = get_embedding(chunk["text"])
        embeddings.append(emb)
        
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
    parser.add_argument("--dir", type=str, default="./sops", help="Directory containing SOP files (default: ./sops)")
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
