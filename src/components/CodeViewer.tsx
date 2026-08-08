import React, { useState } from 'react';
import { CODE_FILES, CodeFile } from '../data/codeFiles';
import { FileCode, Copy, Check, Download, Info, Terminal, FolderGit2 } from 'lucide-react';

export function CodeViewer() {
  const [selectedFile, setSelectedFile] = useState<CodeFile>(CODE_FILES[0]);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([selectedFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-blue-600" />
            <h2 className="text-xl font-bold text-slate-900">Deliverable Codebase & Scripts Explorer</h2>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Exact production scripts for <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">rag-service</code>, Laravel proxy controller, Angular standalone components, and deployment documentation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-semibold text-xs transition flex items-center gap-2 border border-slate-200"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </button>

          <button
            onClick={handleDownload}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs transition flex items-center gap-2 shadow-sm"
          >
            <Download className="w-4 h-4" />
            <span>Download {selectedFile.filename}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1 space-y-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2">Project Deliverables</h3>
          <div className="space-y-1">
            {CODE_FILES.map((file) => (
              <button
                key={file.id}
                onClick={() => setSelectedFile(file)}
                className={`w-full text-left p-3 rounded-xl text-xs font-semibold transition flex items-center gap-2.5 ${
                  selectedFile.id === file.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                <FileCode className={`w-4 h-4 shrink-0 ${selectedFile.id === file.id ? 'text-white' : 'text-blue-600'}`} />
                <div className="truncate">
                  <div className="truncate">{file.filename}</div>
                  <div className={`text-[10px] truncate ${selectedFile.id === file.id ? 'text-blue-100' : 'text-slate-400'}`}>
                    {file.path}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="md:col-span-3 space-y-3">
          <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-lg">
            <div className="bg-slate-800/80 px-4 py-3 border-b border-slate-700/80 flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-xs text-slate-300">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-white">{selectedFile.path}</span>
              </div>
              <span className="text-[11px] font-mono uppercase bg-slate-700 px-2 py-0.5 rounded text-slate-300">
                {selectedFile.language}
              </span>
            </div>

            <div className="bg-slate-800/40 px-4 py-2 border-b border-slate-800 text-xs text-slate-400">
              {selectedFile.description}
            </div>

            <div className="p-4 max-h-[600px] overflow-auto">
              <pre className="font-mono text-xs text-slate-100 leading-relaxed whitespace-pre-wrap select-text">
                {selectedFile.content}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
