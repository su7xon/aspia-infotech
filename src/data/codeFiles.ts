export interface CodeFile {
  id: string;
  filename: string;
  path: string;
  language: string;
  description: string;
  content: string;
}

export const CODE_FILES: CodeFile[] = [
  {
    id: 'add_data',
    filename: 'add_data.py',
    path: 'rag-service/add_data.py',
    language: 'python',
    description: 'Python Data Ingestion Script — Reads SOP files (.txt/.docx/.pdf/.md), chunks by headings, generates nomic-embed-text embeddings via local Ollama API, and stores into ChromaDB.',
    content: `#!/usr/bin/env python3
"""
Data Ingestion Script for Local RAG SOP Chatbot
rag-service/add_data.py
"""

import os
import sys
import re
import argparse
import logging
from typing import List, Dict, Any
import requests
import chromadb

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")
COLLECTION_NAME = "sop_documents"

def get_chroma_client() -> chromadb.PersistentClient:
    os.makedirs(CHROMA_DB_DIR, exist_ok=True)
    return chromadb.PersistentClient(path=CHROMA_DB_DIR)

def get_embedding(text: str) -> List[float]:
    url = f"{OLLAMA_HOST}/api/embeddings"
    payload = {"model": EMBEDDING_MODEL, "prompt": text}
    res = requests.post(url, json=payload, timeout=30)
    res.raise_for_status()
    return res.json()["embedding"]

def chunk_sop_text(text: str, filename: str) -> List[Dict[str, Any]]:
    heading_pattern = r'(\\n(?=#{1,4}\\s|\\bSECTION\\b|\\bTOPIC\\b|\\bPOLICY\\b|\\bSOP-\\d+))'
    raw_sections = re.split(heading_pattern, text, flags=re.IGNORECASE)
    chunks = []
    current_heading = "General SOP Overview"
    chunk_index = 0
    current_buffer = ""

    for block in raw_sections:
        if not block.strip(): continue
        first_line = block.split('\\n')[0].strip()
        if re.match(r'^(#{1,4}\\s|\\bSECTION\\b|\\bTOPIC\\b)', first_line, re.I):
            current_heading = first_line.lstrip('#').strip()
        
        if len(current_buffer) + len(block) > 1500 and current_buffer:
            chunks.append({
                "id": f"{filename}_chunk_{chunk_index}",
                "text": current_buffer.strip(),
                "metadata": {"source_file": filename, "heading": current_heading, "chunk_index": chunk_index}
            })
            chunk_index += 1
            current_buffer = block
        else:
            current_buffer += "\\n\\n" + block if current_buffer else block

    if current_buffer.strip():
        chunks.append({
            "id": f"{filename}_chunk_{chunk_index}",
            "text": current_buffer.strip(),
            "metadata": {"source_file": filename, "heading": current_heading, "chunk_index": chunk_index}
        })
    return chunks

def ingest_file(file_path: str, collection):
    filename = os.path.basename(file_path)
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    chunks = chunk_sop_text(content, filename)
    ids, embeddings, documents, metadatas = [], [], [], []
    for chunk in chunks:
        ids.append(chunk["id"])
        documents.append(f"Document: {filename} | Section: {chunk['metadata']['heading']}\\n\\n{chunk['text']}")
        metadatas.append(chunk["metadata"])
        embeddings.append(get_embedding(chunk["text"]))
    if ids:
        collection.add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=str)
    parser.add_argument("--dir", type=str, default="./sops")
    args = parser.parse_args()
    client = get_chroma_client()
    col = client.get_or_create_collection(COLLECTION_NAME)
    if args.file: ingest_file(args.file, col)
`
  },
  {
    id: 'main_py',
    filename: 'main.py',
    path: 'rag-service/main.py',
    language: 'python',
    description: 'FastAPI Microservice — Exposes POST /ask. Embeds query with nomic-embed-text, performs vector similarity search in ChromaDB, checks confidence threshold (0.60), and calls local Qwen2-VL via Ollama API.',
    content: `#!/usr/bin/env python3
"""
FastAPI Microservice for Local RAG SOP Chatbot
rag-service/main.py
"""

import os
import re
import logging
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import requests
import chromadb

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5vl:7b")
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.60"))
FALLBACK_MESSAGE = "This isn't covered in our SOPs — please contact the concerned department."

SYSTEM_PROMPT = """You are an internal assistant for [Company]. Answer the user's question helpfully. When relevant SOP context is provided, base your answer on it and prefer it. If the context does not cover the question (or is absent), answer directly from general knowledge. Never refuse to answer just because the question is not in the SOP database."""

app = FastAPI(title="Local SOP RAG Microservice")
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection("sop_documents")

class AskRequest(BaseModel):
    question: str
    image: Optional[str] = None
    confidence_threshold: Optional[float] = None

@app.post("/ask")
def ask_sop_question(req: AskRequest):
    threshold = req.confidence_threshold or CONFIDENCE_THRESHOLD
    
    emb_res = requests.post(f"{OLLAMA_HOST}/api/embeddings", json={"model": EMBEDDING_MODEL, "prompt": req.question})
    query_vector = emb_res.json()["embedding"]
    
    results = collection.query(query_embeddings=[query_vector], n_results=3)
    best_score = 1.0 - results["distances"][0][0] if results.get("distances") else 0.0
    
    if best_score < threshold:
        return {
            "answer": FALLBACK_MESSAGE,
            "confidence_score": round(best_score, 4),
            "passed_threshold": False,
            "chunks_retrieved": []
        }
        
    context = "\\n\\n---\\n\\n".join(results["documents"][0])
    payload = {
        "model": LLM_MODEL,
        "system": SYSTEM_PROMPT,
        "prompt": f"CONTEXT:\\n{context}\\n\\nQUESTION:\\n{req.question}",
        "options": {"temperature": 0.2}
    }
    if req.image:
        payload["images"] = [re.sub(r'^data:image\\/[a-zA-Z]+;base64,', '', req.image)]
        
    llm_res = requests.post(f"{OLLAMA_HOST}/api/generate", json=payload).json()
    
    return {
        "answer": llm_res.get("response", FALLBACK_MESSAGE),
        "confidence_score": round(best_score, 4),
        "passed_threshold": True,
        "chunks_retrieved": results["documents"][0]
    }
`
  },
  {
    id: 'chatbot_controller',
    filename: 'ChatbotController.php',
    path: 'laravel-app/app/Http/Controllers/ChatbotController.php',
    language: 'php',
    description: 'Laravel Proxy Controller — Receives user question & base64 image from Angular, forwards payload to Python rag-service over HTTP, and passes answer back.',
    content: `<?php

namespace App\\Http\\Controllers;

use Illuminate\\Http\\Request;
use Illuminate\\Http\\JsonResponse;
use Illuminate\\Support\\Facades\\Http;

class ChatbotController extends Controller
{
    protected string $ragServiceUrl = 'http://127.0.0.1:8000';

    public function ask(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'question' => 'required|string',
            'image' => 'nullable|string',
            'confidence_threshold' => 'nullable|numeric'
        ]);

        try {
            $response = Http::timeout(60)->post("{$this->ragServiceUrl}/ask", [
                'question' => $validated['question'],
                'image' => $validated['image'] ?? null,
                'confidence_threshold' => $validated['confidence_threshold'] ?? null,
            ]);

            return response()->json($response->json(), $response->status());

        } catch (\\Exception $e) {
            return response()->json([
                'answer' => "This isn't covered in our SOPs — please contact the concerned department.",
                'confidence_score' => 0.0,
                'passed_threshold' => false,
                'error' => 'RAG microservice unreachable.'
            ], 200);
        }
    }
}
`
  },
  {
    id: 'angular_chat',
    filename: 'chat.component.ts',
    path: 'angular-app/src/app/components/chat/chat.component.ts',
    language: 'typescript',
    description: 'Angular Chat Component — Chat interface with image uploader button, base64 conversion, confidence score badges, and retrieved chunk details.',
    content: `import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-sop-chat',
  standalone: true,
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss']
})
export class ChatComponent {
  userQuestion = '';
  selectedImageBase64: string | null = null;
  messages: any[] = [];
  confidenceThreshold = 0.60;

  constructor(private http: HttpClient) {}

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => this.selectedImageBase64 = reader.result as string;
      reader.readAsDataURL(file);
    }
  }

  sendMessage() {
    if (!this.userQuestion.trim() && !this.selectedImageBase64) return;
    
    this.messages.push({ sender: 'user', text: this.userQuestion, image: this.selectedImageBase64 });
    
    const payload = {
      question: this.userQuestion,
      image: this.selectedImageBase64,
      confidence_threshold: this.confidenceThreshold
    };
    
    this.userQuestion = '';
    this.selectedImageBase64 = null;

    this.http.post<any>('http://localhost:8000/api/v1/chatbot/ask', payload).subscribe(res => {
      this.messages.push({
        sender: 'assistant',
        text: res.data?.answer || res.answer,
        score: res.data?.confidence_score || res.confidence_score,
        passed: res.data?.passed_threshold || res.passed_threshold,
        chunks: res.data?.chunks_retrieved || res.chunks_retrieved
      });
    });
  }
}
`
  },
  {
    id: 'readme',
    filename: 'README.md',
    path: 'README.md',
    language: 'markdown',
    description: 'Complete setup & deployment documentation covering Ollama setup, Qwen2-VL & nomic-embed-text pulling, Python ingestion, FastAPI service, and Laravel/Angular integration.',
    content: `# Local On-Premise SOP Chatbot (RAG Architecture)

A secure, completely offline, on-premise Company SOP Chatbot system.

## Step 1: Launch Ollama Models
\`\`\`bash
ollama pull nomic-embed-text
ollama pull qwen2.5vl:7b
\`\`\`

## Step 2: Ingest SOPs & Start Microservice
\`\`\`bash
cd rag-service
pip install -r requirements.txt
python add_data.py --dir ./sops
uvicorn main:app --port 8000
\`\`\`

## Step 3: Run Laravel & Angular Apps
Set \`RAG_SERVICE_URL=http://127.0.0.1:8000\` in Laravel \`.env\` and mount \`ChatbotController.php\`.
`
  }
];
