import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Image as ImageIcon, 
  X, 
  Bot, 
  User, 
  ShieldCheck, 
  AlertTriangle, 
  FileText, 
  Sliders, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';

export interface RetrievedChunk {
  id: string;
  source_file: string;
  heading: string;
  text: string;
  similarity_score: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  imagePreview?: string | null;
  confidenceScore?: number;
  passedThreshold?: boolean;
  chunksRetrieved?: RetrievedChunk[];
  modelUsed?: string;
  isLoading?: boolean;
}

export function ChatSimulator() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome_1',
      sender: 'assistant',
      text: 'Welcome to the Company Internal SOP Assistant. I provide answers strictly grounded in official company procedures using our local vector engine.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      confidenceScore: 1.0,
      passedThreshold: true,
      modelUsed: 'qwen2.5vl:7b (Ollama Local)'
    }
  ]);

  const [inputQuestion, setInputQuestion] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageName, setSelectedImageName] = useState<string | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.60);
  const [isSending, setIsSending] = useState(false);
  const [openCitations, setOpenCitations] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file (PNG, JPEG, WebP)');
        return;
      }
      setSelectedImageName(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
    setSelectedImageName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSendMessage = async (customQuestion?: string) => {
    const questionToSubmit = (customQuestion || inputQuestion).trim();
    if (!questionToSubmit && !selectedImage) return;
    if (isSending) return;

    const userMsgId = `usr_${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text: questionToSubmit || '(Uploaded Screenshot for Analysis)',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      imagePreview: selectedImage
    };

    setMessages(prev => [...prev, userMessage]);

    const botMsgId = `bot_${Date.now()}`;
    const botPlaceholder: ChatMessage = {
      id: botMsgId,
      sender: 'assistant',
      text: 'Searching ChromaDB vector store and querying local Qwen2-VL model...',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isLoading: true
    };

    setMessages(prev => [...prev, botPlaceholder]);
    setInputQuestion('');
    const currentImg = selectedImage;
    removeImage();
    setIsSending(true);

    try {
      const response = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: questionToSubmit,
          image: currentImg,
          confidence_threshold: confidenceThreshold
        })
      });

      const data = await response.json();

      setMessages(prev => prev.map(m => {
        if (m.id === botMsgId) {
          return {
            id: botMsgId,
            sender: 'assistant',
            text: data.answer || "This isn't covered in our SOPs — please contact the concerned department.",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            confidenceScore: data.confidence_score,
            passedThreshold: data.passed_threshold,
            chunksRetrieved: data.chunks_retrieved || [],
            modelUsed: data.model_used || 'qwen2.5vl',
            isLoading: false
          };
        }
        return m;
      }));
    } catch (err) {
      setMessages(prev => prev.map(m => {
        if (m.id === botMsgId) {
          return {
            id: botMsgId,
            sender: 'assistant',
            text: "This isn't covered in our SOPs — please contact the concerned department.",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            confidenceScore: 0.0,
            passedThreshold: false,
            chunksRetrieved: [],
            modelUsed: 'offline-fallback',
            isLoading: false
          };
        }
        return m;
      }));
    } finally {
      setIsSending(false);
    }
  };

  const toggleCitations = (id: string) => {
    setOpenCitations(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const samplePrompts = [
    { label: '🔐 Password Reset Policy', query: 'How do I reset my corporate password remotely?' },
    { label: '⚠️ Equipment Error 402', query: 'What is the required safety procedure for Error Code 402 on the hydraulic press?' },
    { label: '🏖️ Sick Leave Rules', query: 'What are the rules regarding consecutive sick leave and medical certificates?' },
    { label: '🛑 Unrelated Query (Test Fallback)', query: 'What is our company secret recipe for chocolate chip cookies?' }
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] max-w-5xl mx-auto bg-slate-50 border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-white px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 text-lg">Angular Chat UI Preview</h2>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Local Ollama Engine
              </span>
            </div>
            <p className="text-xs text-slate-500">Connected via Laravel Proxy Controller & Python RAG Microservice</p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-slate-100/80 px-3 py-2 rounded-xl border border-slate-200">
          <Sliders className="w-4 h-4 text-slate-600" />
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-700">
              Confidence Threshold: <span className="text-blue-600 font-bold">{Math.round(confidenceThreshold * 100)}%</span>
            </span>
            <input 
              type="range" 
              min="0.30" 
              max="0.90" 
              step="0.05" 
              value={confidenceThreshold} 
              onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
              className="w-32 h-1.5 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        </div>
      </div>

      <div className="bg-slate-100/60 px-6 py-2.5 border-b border-slate-200 flex items-center gap-2 overflow-x-auto text-xs">
        <span className="font-semibold text-slate-500 shrink-0">Test Scenarios:</span>
        {samplePrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(p.query)}
            disabled={isSending}
            className="px-3 py-1 bg-white hover:bg-slate-200 border border-slate-200 rounded-lg font-medium text-slate-700 transition shrink-0 disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex gap-3 max-w-3xl ${msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm ${
              msg.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-white'
            }`}>
              {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div className={`rounded-2xl p-4 text-sm leading-relaxed ${
              msg.sender === 'user' 
                ? 'bg-blue-600 text-white rounded-tr-none' 
                : 'bg-white text-slate-800 border border-slate-200 shadow-sm rounded-tl-none'
            }`}>
              {msg.imagePreview && (
                <div className="mb-3 rounded-lg overflow-hidden border border-white/20">
                  <img src={msg.imagePreview} alt="User Upload" className="max-h-52 object-contain" />
                </div>
              )}

              {msg.isLoading ? (
                <div className="flex items-center gap-2 text-slate-500 italic py-1">
                  <Sparkles className="w-4 h-4 text-blue-500 animate-spin" />
                  <span>Searching ChromaDB & running local Qwen2-VL model...</span>
                </div>
              ) : (
                <div className="whitespace-pre-line">{msg.text}</div>
              )}

              {msg.sender === 'assistant' && !msg.isLoading && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      {msg.passedThreshold ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Match Score: {Math.round((msg.confidenceScore || 0) * 100)}% (Passed Threshold)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" />
                          Match Score: {Math.round((msg.confidenceScore || 0) * 100)}% (Below {Math.round(confidenceThreshold * 100)}% Threshold)
                        </span>
                      )}
                    </div>

                    <span className="text-slate-400 font-mono text-[11px]">{msg.modelUsed} • {msg.timestamp}</span>
                  </div>

                  {!msg.passedThreshold && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-2.5 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-semibold">RAG Confidence Protection Activated:</strong> Query similarity match score ({Math.round((msg.confidenceScore || 0) * 100)}%) was below the strict security threshold ({Math.round(confidenceThreshold * 100)}%). LLM was skipped to prevent hallucinations.
                      </div>
                    </div>
                  )}

                  {msg.chunksRetrieved && msg.chunksRetrieved.length > 0 && (
                    <div className="mt-1">
                      <button
                        onClick={() => toggleCitations(msg.id)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{openCitations[msg.id] ? 'Hide' : 'Inspect'} {msg.chunksRetrieved.length} Retrieved SOP Chunk(s)</span>
                        {openCitations[msg.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {openCitations[msg.id] && (
                        <div className="mt-2 space-y-2 text-xs">
                          {msg.chunksRetrieved.map((chunk, cIdx) => (
                            <div key={cIdx} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                              <div className="flex items-center justify-between text-slate-700 font-semibold border-b border-slate-200/80 pb-1">
                                <span className="text-blue-700">📄 {chunk.source_file}</span>
                                <span className="text-slate-500 font-mono">Similarity: {Math.round(chunk.similarity_score * 100)}%</span>
                              </div>
                              <div className="text-slate-600 font-medium">📌 Section: {chunk.heading}</div>
                              <div className="text-slate-500 font-mono text-[11px] bg-white p-2 rounded border border-slate-100 whitespace-pre-line">
                                {chunk.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={chatBottomRef} />
      </div>

      <div className="p-4 bg-white border-t border-slate-200 space-y-3">
        {selectedImage && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-2 px-3 text-xs text-blue-900">
            <img src={selectedImage} alt="Selected Thumbnail" className="w-9 h-9 object-cover rounded-lg" />
            <div className="flex-1 truncate">
              <span className="font-semibold block truncate">{selectedImageName}</span>
              <span className="text-blue-600 text-[11px]">Ready for Qwen2-VL Multimodal Vision Input</span>
            </div>
            <button onClick={removeImage} className="p-1 hover:bg-blue-100 rounded-full text-slate-500 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            title="Upload equipment photo or error code screenshot for Qwen2-VL"
            className="p-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition disabled:opacity-50 flex items-center justify-center"
          >
            <ImageIcon className="w-5 h-5 text-slate-600" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageSelect} 
            accept="image/*" 
            className="hidden" 
          />

          <input
            type="text"
            value={inputQuestion}
            onChange={(e) => setInputQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask a question regarding company SOPs or procedures..."
            disabled={isSending}
            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition disabled:opacity-50"
          />

          <button
            onClick={() => handleSendMessage()}
            disabled={isSending || (!inputQuestion.trim() && !selectedImage)}
            className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <span>Send</span>
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
