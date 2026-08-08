import React from 'react';
import { ShieldCheck, Server, Cpu, Database, ArrowRight, Lock, EyeOff, Bot, CheckCircle2 } from 'lucide-react';

export function ArchitectureDiagram() {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" />
          <h2 className="text-xl font-bold text-slate-900">Zero-Cloud On-Premise RAG System Architecture</h2>
        </div>
        <p className="text-sm text-slate-600">
          Complete air-gapped data pipeline. No company SOPs or user questions leave the internal network.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 relative">
          <div className="flex items-center justify-between">
            <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 font-bold flex items-center justify-center text-sm border border-rose-200">
              1
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg">Frontend</span>
          </div>

          <div>
            <h3 className="font-bold text-slate-900 text-base">Angular Chat Application</h3>
            <p className="text-xs text-slate-500 mt-1">Existing Angular Web Application</p>
          </div>

          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Reactive Chat Interface & Message Bubbles</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Camera / Base64 Screenshot Image Uploader</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Displays RAG Confidence Badges & Source SOPs</span>
            </li>
          </ul>

          <div className="pt-2 text-xs font-mono text-slate-400">
            POST /api/v1/chatbot/ask
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 relative">
          <div className="flex items-center justify-between">
            <span className="w-8 h-8 rounded-xl bg-red-50 text-red-600 font-bold flex items-center justify-center text-sm border border-red-200">
              2
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg">REST API Proxy</span>
          </div>

          <div>
            <h3 className="font-bold text-slate-900 text-base">PHP Laravel Backend</h3>
            <p className="text-xs text-slate-500 mt-1">Existing Application Backend & MySQL</p>
          </div>

          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Handles Session Auth & User Permissions</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Thin Pass-Through Controller (<code className="font-mono">ChatbotController</code>)</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Zero LLM/Embedding code in Laravel</span>
            </li>
          </ul>

          <div className="pt-2 text-xs font-mono text-slate-400">
            POST http://127.0.0.1:8000/ask
          </div>
        </div>

        <div className="bg-white border border-blue-200 bg-blue-50/20 rounded-2xl p-6 shadow-sm space-y-4 relative">
          <div className="flex items-center justify-between">
            <span className="w-8 h-8 rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center text-sm">
              3
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 bg-blue-100 text-blue-800 rounded-lg">RAG Service</span>
          </div>

          <div>
            <h3 className="font-bold text-slate-900 text-base">Python FastAPI Microservice</h3>
            <p className="text-xs text-slate-500 mt-1"><code className="font-mono">rag-service/main.py</code></p>
          </div>

          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>Queries local ChromaDB vector collection</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>Enforces strict confidence threshold (&gt;= 0.60)</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>Calls local Ollama API (Qwen2-VL &amp; nomic-embed)</span>
            </li>
          </ul>

          <div className="pt-2 text-xs font-mono text-blue-600">
            Internal Port 8000
          </div>
        </div>
      </div>

      <div className="bg-slate-900 text-white rounded-2xl p-6 space-y-4">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Lock className="w-5 h-5 text-emerald-400" />
          <span>Non-Negotiable Production Rules & Constraints</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80 space-y-1">
            <div className="font-bold text-emerald-400 text-sm">1. Zero Full-Library Exposure</div>
            <p className="text-slate-300">
              The LLM never receives the full SOP library. It receives ONLY the top 2-3 matched section chunks for the specific user prompt.
            </p>
          </div>

          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80 space-y-1">
            <div className="font-bold text-emerald-400 text-sm">2. Automatic Fallback Protection</div>
            <p className="text-slate-300">
              If the vector search similarity score is below confidence threshold (0.60), the LLM is skipped entirely, returning:
              <br />
              <em className="text-amber-300 font-serif">"This isn't covered in our SOPs — please contact the concerned department."</em>
            </p>
          </div>

          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80 space-y-1">
            <div className="font-bold text-emerald-400 text-sm">3. Completely Air-Gapped & Offline</div>
            <p className="text-slate-300">
              All embeddings (nomic-embed-text) and vision-language responses (Qwen2-VL) run on local server GPU/CPU via Ollama. No OpenAI, Anthropic, or external API calls exist.
            </p>
          </div>

          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80 space-y-1">
            <div className="font-bold text-emerald-400 text-sm">4. Standalone Ingestion Script</div>
            <p className="text-slate-300">
              <code className="text-blue-300 font-mono">rag-service/add_data.py</code> can re-index single modified SOP files without wiping or reprocessing the rest of ChromaDB.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
