import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Plus, 
  Trash2, 
  Layers, 
  RefreshCw, 
  CheckCircle, 
  Database, 
  FolderPlus,
  BookOpen,
  Sparkles,
  UploadCloud
} from 'lucide-react';

export function DocumentManager() {
  const [sops, setSops] = useState<any[]>([]);
  const [uploadedDocs, setUploadedDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [docsLoading, setDocsLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newFilename, setNewFilename] = useState('');
  const [newCategory, setNewCategory] = useState('IT Security');
  const [newContent, setNewContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState('IT Security');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    fetchSops();
    fetchUploadedDocs();
  }, []);

  const fetchUploadedDocs = async () => {
    setDocsLoading(true);
    try {
      const res = await fetch('/api/rag/documents');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploadedDocs(data.documents || []);
    } catch (e) {
      console.error('Failed to load rag-service documents:', e);
      setUploadedDocs([]);
    } finally {
      setDocsLoading(false);
    }
  };

  const fetchSops = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rag/sops');
      const data = await res.json();
      setSops(data.sops || []);
    } catch (e) {
      console.error('Failed to load SOPs:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this SOP from ChromaDB index?')) return;
    try {
      await fetch(`/api/rag/sops/${id}`, { method: 'DELETE' });
      fetchSops();
    } catch (e) {
      alert('Failed to delete SOP.');
    }
  };

  const handleDeleteUploaded = async (filename: string) => {
    if (!confirm(`Remove '${filename}' from the ChromaDB index?`)) return;
    try {
      const res = await fetch(`/api/rag/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed.');
      }
      fetchUploadedDocs();
    } catch (e: any) {
      alert(`Failed to delete document: ${e.message}`);
    }
  };

  const handleUploadFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    setUploadError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          resolve(result.split(',')[1] || result);
        };
        reader.onerror = () => reject(new Error('Could not read file.'));
        reader.readAsDataURL(uploadFile as Blob);
      });

      const res = await fetch('/api/rag/ingest-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: uploadFile.name,
          category: uploadCategory,
          base64
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setShowUploadModal(false);
      setUploadFile(null);
      fetchUploadedDocs();
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed. Is the RAG service running on port 8000?');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateSop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/rag/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          filename: newFilename || `${newTitle.replace(/\s+/g, '_')}.txt`,
          category: newCategory,
          content: newContent
        })
      });

      if (res.ok) {
        setShowAddModal(false);
        setNewTitle('');
        setNewFilename('');
        setNewContent('');
        fetchSops();
      }
    } catch (e) {
      alert('Error ingesting SOP.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            <h2 className="text-xl font-bold text-slate-900">Company SOP Knowledge Store (ChromaDB)</h2>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Documents stored locally, chunked by section headings, and embedded using <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">nomic-embed-text</code>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchSops}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition flex items-center gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Re-Index All</span>
          </button>

          <button
            onClick={() => setShowUploadModal(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-xs transition flex items-center gap-1.5 shadow-sm"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload PDF / DOCX</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs transition flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Ingest New SOP</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-500">
          <Sparkles className="w-6 h-6 text-blue-500 animate-spin mx-auto mb-2" />
          <span>Loading ChromaDB collection documents...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sops.map((sop) => (
            <div key={sop.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition">
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold border border-blue-100">
                    {sop.category}
                  </span>
                  <button
                    onClick={() => handleDelete(sop.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    title="Delete SOP"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <h3 className="font-bold text-slate-900 text-base mb-1">{sop.title}</h3>
                <div className="text-xs text-slate-500 font-mono mb-3">📄 {sop.filename}</div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-600 font-mono max-h-36 overflow-y-auto whitespace-pre-line leading-relaxed">
                  {sop.content}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1 font-semibold text-slate-600">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  Status: Indexed in ChromaDB
                </span>
                <span className="font-mono text-slate-400">{sop.content.length} chars</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-bold text-slate-900">Uploaded Documents (ChromaDB Index)</h3>
          </div>
          <button
            onClick={fetchUploadedDocs}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {docsLoading ? (
          <div className="text-center text-slate-500 text-sm py-6">
            <Sparkles className="w-5 h-5 text-emerald-500 animate-spin mx-auto mb-2" />
            Loading indexed documents from RAG service...
          </div>
        ) : uploadedDocs.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">
            No documents indexed yet. Upload a PDF, DOCX, TXT or MD file to chunk & embed it into ChromaDB.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {uploadedDocs.map((doc) => (
              <div key={doc.id} className="border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-100">
                      {doc.category}
                    </span>
                    <button
                      onClick={() => handleDeleteUploaded(doc.filename)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                      title="Remove from index"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <h3 className="font-bold text-slate-900 text-base mb-1">{doc.title}</h3>
                  <div className="text-xs text-slate-500 font-mono mb-3">📄 {doc.filename}</div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-600 font-mono max-h-36 overflow-y-auto whitespace-pre-line leading-relaxed">
                    {doc.content}
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1 font-semibold text-slate-600">
                    <Layers className="w-3.5 h-3.5 text-emerald-600" />
                    {doc.chunks} chunk(s) embedded & indexed
                  </span>
                  <span className="font-mono text-slate-400">{doc.content.length} chars</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-blue-600" />
                <span>Ingest New Company SOP Document</span>
              </h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSop} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">SOP Document Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SOP-HR-009: Work From Home & Remote Access Guidelines"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Filename</label>
                  <input
                    type="text"
                    placeholder="e.g. Remote_Work_Policy.txt"
                    value={newFilename}
                    onChange={(e) => setNewFilename(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                  >
                    <option value="IT Security">IT Security</option>
                    <option value="Human Resources">Human Resources</option>
                    <option value="Equipment Maintenance">Equipment Maintenance</option>
                    <option value="Customer Support">Customer Support</option>
                    <option value="Finance & Compliance">Finance & Compliance</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SOP Document Body (Include SECTION or heading headers)
                </label>
                <textarea
                  required
                  rows={8}
                  placeholder={`SECTION 1: REMOTE ELIGIBILITY\nFull-time employees with 6+ months tenure may work remotely up to 2 days per week.\n\nSECTION 2: HARDWARE SECURITY\nCompany laptops must be kept encrypted with BitLocker.`}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50"
                >
                  {submitting ? 'Chunking & Embedding...' : 'Ingest & Index'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-emerald-600" />
                <span>Upload SOP Document</span>
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUploadFile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Document File</label>
                <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-emerald-400 rounded-xl p-8 cursor-pointer transition bg-slate-50">
                  <FileText className="w-8 h-8 text-emerald-500" />
                  <span className="text-sm font-semibold text-slate-700">
                    {uploadFile ? uploadFile.name : 'Click to choose a file'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {uploadFile
                      ? `${(uploadFile.size / 1024).toFixed(1)} KB`
                      : 'Supports .pdf, .docx, .txt, .md — chunked by headings & embedded via nomic-embed-text'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    required
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                >
                  <option value="IT Security">IT Security</option>
                  <option value="Human Resources">Human Resources</option>
                  <option value="Equipment Maintenance">Equipment Maintenance</option>
                  <option value="Customer Support">Customer Support</option>
                  <option value="Finance & Compliance">Finance & Compliance</option>
                  <option value="Custom Policy">Custom Policy</option>
                </select>
              </div>

              {uploadError && (
                <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                  {uploadError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFile}
                  className="px-5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50"
                >
                  {uploading ? 'Chunking & Embedding...' : 'Upload & Index'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
