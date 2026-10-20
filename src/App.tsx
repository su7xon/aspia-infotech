import React, { useState, useRef, useEffect } from 'react';

interface SavedDoc {
  id: string;
  filename: string;
  category: string;
  title: string;
  chunks: number;
}

interface SavedSop {
  id: string;
  title: string;
  filename: string;
  category: string;
}

interface Chunk {
  id: string;
  source_file: string;
  heading: string;
  chunk_index: number;
  chunk_type: string;
  char_length: number;
  category: string;
  text: string;
}

export default function App() {
  const [question, setQuestion] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [answerMeta, setAnswerMeta] = useState<{
    confidence_score: number;
    passed_threshold: boolean;
    grounding_passed: boolean;
    model_used: string;
    feedback_id: number | null;
    quality_scores: any;
    sources: string[];
  } | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<'positive' | 'negative' | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  const [showSaved, setShowSaved] = useState(false);
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [savedSops, setSavedSops] = useState<SavedSop[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [showChunks, setShowChunks] = useState(false);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());
  const [docFilter, setDocFilter] = useState<'all' | 'pdf' | 'docx' | 'txt'>('all');
  const [docSearch, setDocSearch] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);

  const isPdf = (filename: string) => (filename || '').toLowerCase().endsWith('.pdf');
  const isDocx = (filename: string) => {
    const f = (filename || '').toLowerCase();
    return f.endsWith('.docx') || f.endsWith('.doc');
  };
  const isTxt = (filename: string) => {
    const f = (filename || '').toLowerCase();
    return f.endsWith('.txt') || f.endsWith('.md');
  };

  const getFileBadge = (filename: string) => {
    if (isPdf(filename)) {
      return (
        <span style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', fontWeight: 'bold', padding: '2px 7px', borderRadius: 4, fontSize: 11, marginRight: 6 }}>
          📄 PDF
        </span>
      );
    }
    if (isDocx(filename)) {
      return (
        <span style={{ background: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe', fontWeight: 'bold', padding: '2px 7px', borderRadius: 4, fontSize: 11, marginRight: 6 }}>
          📝 DOCX
        </span>
      );
    }
    return (
      <span style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', fontWeight: 'bold', padding: '2px 7px', borderRadius: 4, fontSize: 11, marginRight: 6 }}>
        📑 TXT
      </span>
    );
  };

  const handleDeleteAll = async () => {
    const totalDocs = savedDocs.length + savedSops.length;
    if (totalDocs === 0) {
      alert('No SOPs or documents to delete.');
      return;
    }
    const confirmed = window.confirm(
      `⚠️ DELETE ALL SOPS & DOCUMENTS?\n\nThis will permanently delete:\n- ${savedDocs.length} document(s) from ChromaDB vector index\n- ${savedSops.length} SOP(s) from the database\n- All associated chunks and vector search embeddings\n\nAre you sure you want to proceed?`
    );
    if (!confirmed) return;

    setDeletingAll(true);
    try {
      const res = await fetch('/api/rag/documents', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete all documents.');

      await fetch('/api/rag/sops', { method: 'DELETE' }).catch(() => {});

      setSavedDocs([]);
      setSavedSops([]);
      setChunks([]);
      setUploadMsg('All SOP documents and indexes have been deleted.');
      await fetchSaved();
    } catch (e: any) {
      alert(`Delete all failed: ${e.message}`);
    } finally {
      setDeletingAll(false);
    }
  };

  const fetchSaved = async () => {
    setSavedLoading(true);
    try {
      const [docsRes, sopsRes] = await Promise.all([
        fetch('/api/rag/documents'),
        fetch('/api/rag/sops')
      ]);
      if (docsRes.ok) {
        const docsData = await docsRes.json().catch(() => ({ documents: null }));
        if (Array.isArray(docsData.documents)) setSavedDocs(docsData.documents);
      } else {
        try {
          const upRes = await fetch('/api/rag/uploads');
          if (upRes.ok) {
            const upData = await upRes.json().catch(() => ({}));
            if (Array.isArray(upData.documents) && upData.documents.length > 0) setSavedDocs(upData.documents);
          }
        } catch {}
      }
      if (sopsRes.ok) {
        const sopsData = await sopsRes.json().catch(() => ({ sops: null }));
        if (Array.isArray(sopsData.sops)) setSavedSops(sopsData.sops);
      }
    } catch (e) {
      console.error('Failed to load saved documents:', e);
    } finally {
      setSavedLoading(false);
    }
  };

  const handleDeleteDoc = async (filename: string) => {
    if (!window.confirm(`Remove '${filename}' from ChromaDB index?`)) return;
    try {
      const res = await fetch(`/api/rag/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed.');
      }
      await fetchSaved();
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  const handleDeleteSop = async (id: string) => {
    if (!window.confirm('Delete this SOP?')) return;
    try {
      await fetch(`/api/rag/sops/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await fetchSaved();
    } catch (e) {
      alert('Delete failed.');
    }
  };

  const fetchChunks = async () => {
    setChunksLoading(true);
    try {
      const res = await fetch('/api/rag/chunks');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setChunks(data.chunks || []);
    } catch (e: any) {
      console.error('Failed to load chunks:', e);
      alert(`Failed to load chunks: ${e.message}`);
    } finally {
      setChunksLoading(false);
    }
  };

  const toggleChunk = (id: string) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    fetchSaved();
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageName(f.name);
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleAsk = async () => {
    if (!question.trim() && !image) return;
    setLoading(true);
    setAnswer('');
    setAnswerMeta(null);
    setFeedbackGiven(null);
    try {
      const res = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), image, confidence_threshold: 0.50 })
      });
      const data = await res.json();
      setAnswer(data.answer || "This isn't covered in our SOPs.");
      setAnswerMeta({
        confidence_score: data.confidence_score || 0,
        passed_threshold: data.passed_threshold ?? false,
        grounding_passed: data.grounding_passed ?? true,
        model_used: data.model_used || 'unknown',
        feedback_id: data.feedback_id || null,
        quality_scores: data.quality_scores || null,
        sources: (data.chunks_retrieved || []).map((c: any) => c.source_file),
      });
    } catch {
      setAnswer('Error: RAG service unreachable.');
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (type: 'positive' | 'negative') => {
    if (!answerMeta?.feedback_id) return;
    try {
      await fetch(`/api/rag/feedback/${answerMeta.feedback_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: type }),
      });
      setFeedbackGiven(type);
    } catch (e) {
      console.error('Feedback submit failed:', e);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;
    setUploading(true);
    setUploadMsg('');
    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setUploadMsg(`Uploading & indexing (${i + 1}/${files.length}): ${f.name}...`);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
          reader.onerror = () => reject(new Error('read error'));
          reader.readAsDataURL(f as Blob);
        });
        const res = await fetch('/api/rag/ingest-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: f.name, base64 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'upload failed');
        successCount++;
      } catch (err: any) {
        errors.push(`${f.name}: ${err.message}`);
      }
    }

    if (errors.length === 0) {
      setUploadMsg(`All ${successCount} file(s) uploaded & indexed successfully!`);
    } else {
      setUploadMsg(`${successCount}/${files.length} uploaded. Errors: ${errors.join(', ')}`);
    }
    setFiles([]);
    await fetchSaved();
    setUploading(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px',
    border: '1px solid #999',
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box'
  };
  const btnStyle: React.CSSProperties = {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer'
  };
  const sectionStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px'
  };

  return (
    <div style={{ margin: '0 auto', maxWidth: 720, padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ textAlign: 'center' }}>SOP Chatbot (Testing)</h1>

      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0 }}>Ask a Question</h3>
        <textarea
          rows={3}
          placeholder="Type your question here..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={inputStyle}
        />
        <div style={{ marginTop: 8 }}>
          <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageSelect} style={{ display: 'none' }} />
          <button style={{ ...btnStyle, background: '#eee' }} onClick={() => fileInputRef.current?.click()}>
            {image ? 'Image: ' + imageName : 'Attach Image'}
          </button>
          {image && (
            <button style={{ ...btnStyle, background: '#eee', marginLeft: 8 }} onClick={() => { setImage(null); setImageName(''); }}>
              Remove
            </button>
          )}
          <button
            style={{ ...btnStyle, background: '#333', color: '#fff', fontWeight: 'bold', float: 'right' }}
            onClick={handleAsk}
            disabled={loading}
          >
            {loading ? 'Searching...' : 'Send'}
          </button>
        </div>
        {answer && (
          <div style={{ marginTop: 14, background: '#f5f5f5', padding: '12px', borderRadius: '6px', fontSize: 14 }}>
            {answerMeta && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{
                  background: answerMeta.confidence_score >= 0.7 ? '#dcfce7' : answerMeta.confidence_score >= 0.5 ? '#fef9c3' : '#fee2e2',
                  color: answerMeta.confidence_score >= 0.7 ? '#166534' : answerMeta.confidence_score >= 0.5 ? '#854d0e' : '#991b1b',
                  borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 'bold',
                }}>Confidence: {(answerMeta.confidence_score * 100).toFixed(1)}%</span>
                <span style={{
                  background: answerMeta.grounding_passed ? '#dcfce7' : '#fee2e2',
                  color: answerMeta.grounding_passed ? '#166534' : '#991b1b',
                  borderRadius: 4, padding: '2px 8px', fontSize: 11,
                }}>{answerMeta.grounding_passed ? '✓ Grounded' : '✗ Grounding Failed'}</span>
                <span style={{
                  background: answerMeta.passed_threshold ? '#dbeafe' : '#f3e8ff',
                  color: answerMeta.passed_threshold ? '#1e40af' : '#6b21a8',
                  borderRadius: 4, padding: '2px 8px', fontSize: 11,
                }}>{answerMeta.passed_threshold ? '✓ Threshold Passed' : '↓ Below Threshold'}</span>
                <span style={{ color: '#666', fontSize: 11 }}>Model: {answerMeta.model_used}</span>
              </div>
            )}
            <div style={{ whiteSpace: 'pre-line' }}>
              <strong>Answer:</strong>
              <div style={{ marginTop: 4 }}>{answer}</div>
            </div>
            {answerMeta?.sources && answerMeta.sources.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#666', borderTop: '1px solid #ddd', paddingTop: 6 }}>
                Sources: {[...new Set(answerMeta.sources)].join(', ')}
              </div>
            )}
            {answerMeta?.feedback_id && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#666' }}>Was this helpful?</span>
                <button
                  onClick={() => handleFeedback('positive')}
                  disabled={feedbackGiven !== null}
                  style={{
                    padding: '4px 12px', borderRadius: 4, fontSize: 16, cursor: feedbackGiven ? 'default' : 'pointer',
                    border: feedbackGiven === 'positive' ? '2px solid #16a34a' : '1px solid #ccc',
                    background: feedbackGiven === 'positive' ? '#dcfce7' : '#fff',
                  }}>👍</button>
                <button
                  onClick={() => handleFeedback('negative')}
                  disabled={feedbackGiven !== null}
                  style={{
                    padding: '4px 12px', borderRadius: 4, fontSize: 16, cursor: feedbackGiven ? 'default' : 'pointer',
                    border: feedbackGiven === 'negative' ? '2px solid #dc2626' : '1px solid #ccc',
                    background: feedbackGiven === 'negative' ? '#fee2e2' : '#fff',
                  }}>👎</button>
                {feedbackGiven && <span style={{ fontSize: 12, color: '#16a34a' }}>Thanks for feedback!</span>}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0 }}>Upload SOP Document(s)</h3>
        <form onSubmit={handleFileUpload}>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            style={inputStyle}
          />
          {files.length > 0 && (
            <div style={{ fontSize: 12, color: '#444', marginTop: 6 }}>
              <strong>{files.length} file(s) selected:</strong> {files.map(f => f.name).join(', ')}
            </div>
          )}
          <button
            style={{ ...btnStyle, background: '#333', color: '#fff', marginTop: 8 }}
            type="submit"
            disabled={uploading || files.length === 0}
          >
            {uploading ? 'Uploading...' : files.length > 1 ? `Upload & Index (${files.length} files)` : 'Upload & Index'}
          </button>
        </form>
      </div>

      {uploadMsg && <p style={{ textAlign: 'center', fontSize: 14 }}>{uploadMsg}</p>}

      <div style={{ ...sectionStyle, marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              Saved SOPs / Documents ({savedDocs.length} indexed + {savedSops.length} in DB)
            </h3>
            <div style={{ marginTop: 4, display: 'flex', gap: 8, fontSize: 12, color: '#666', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ cursor: 'pointer', color: docFilter === 'pdf' ? '#b91c1c' : '#b91c1c', fontWeight: 'bold' }} onClick={() => { setShowSaved(true); setDocFilter('pdf'); }}>
                📄 {savedDocs.filter(d => isPdf(d.filename)).length + savedSops.filter(s => isPdf(s.filename) && !savedDocs.some(d => d.filename === s.filename)).length} PDF(s) Uploaded
              </span>
              <span>·</span>
              <span>📝 {savedDocs.filter(d => isDocx(d.filename)).length + savedSops.filter(s => isDocx(s.filename) && !savedDocs.some(d => d.filename === s.filename)).length} Word DOCX</span>
              <span>·</span>
              <span>📑 {savedDocs.filter(d => isTxt(d.filename)).length + savedSops.filter(s => isTxt(s.filename) && !savedDocs.some(d => d.filename === s.filename)).length} Text/MD</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              style={{ ...btnStyle, background: '#eee', fontSize: 12, padding: '6px 12px' }}
              onClick={fetchSaved}
              disabled={savedLoading}
            >
              🔄 Refresh
            </button>
            <button
              style={{ ...btnStyle, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', fontSize: 12, padding: '6px 12px', fontWeight: 'bold' }}
              onClick={handleDeleteAll}
              disabled={deletingAll || (savedDocs.length === 0 && savedSops.length === 0)}
              title="Permanently remove all SOPs and reset index"
            >
              {deletingAll ? 'Deleting All...' : '🗑️ Delete All SOPs'}
            </button>
            <button
              style={{ ...btnStyle, background: '#333', color: '#fff', fontSize: 12, padding: '6px 12px' }}
              onClick={() => setShowSaved(!showSaved)}
            >
              {showSaved ? 'Hide List' : 'Show List'}
            </button>
          </div>
        </div>

        {showSaved && (
          <div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setDocFilter('all')}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: docFilter === 'all' ? 'bold' : 'normal',
                      border: docFilter === 'all' ? '2px solid #333' : '1px solid #cbd5e1',
                      background: docFilter === 'all' ? '#333' : '#fff',
                      color: docFilter === 'all' ? '#fff' : '#334155',
                      cursor: 'pointer'
                    }}
                  >
                    All Documents ({savedDocs.length + savedSops.length})
                  </button>
                  <button
                    onClick={() => setDocFilter('pdf')}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 'bold',
                      border: docFilter === 'pdf' ? '2px solid #dc2626' : '1px solid #fca5a5',
                      background: docFilter === 'pdf' ? '#dc2626' : '#fef2f2',
                      color: docFilter === 'pdf' ? '#fff' : '#b91c1c',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <span>📄</span>
                    <span>Uploaded PDFs Only ({savedDocs.filter(d => isPdf(d.filename)).length + savedSops.filter(s => isPdf(s.filename) && !savedDocs.some(d => d.filename === s.filename)).length})</span>
                  </button>
                  <button
                    onClick={() => setDocFilter('docx')}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: docFilter === 'docx' ? 'bold' : 'normal',
                      border: docFilter === 'docx' ? '2px solid #2563eb' : '1px solid #bfdbfe',
                      background: docFilter === 'docx' ? '#2563eb' : '#eff6ff',
                      color: docFilter === 'docx' ? '#fff' : '#1d4ed8',
                      cursor: 'pointer'
                    }}
                  >
                    📝 DOCX ({savedDocs.filter(d => isDocx(d.filename)).length + savedSops.filter(s => isDocx(s.filename) && !savedDocs.some(d => d.filename === s.filename)).length})
                  </button>
                  <button
                    onClick={() => setDocFilter('txt')}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: docFilter === 'txt' ? 'bold' : 'normal',
                      border: docFilter === 'txt' ? '2px solid #4b5563' : '1px solid #cbd5e1',
                      background: docFilter === 'txt' ? '#4b5563' : '#fff',
                      color: docFilter === 'txt' ? '#fff' : '#4b5563',
                      cursor: 'pointer'
                    }}
                  >
                    📑 TXT / MD ({savedDocs.filter(d => isTxt(d.filename)).length + savedSops.filter(s => isTxt(s.filename) && !savedDocs.some(d => d.filename === s.filename)).length})
                  </button>
                </div>

                {docFilter === 'pdf' && (
                  <span style={{ fontSize: 12, background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: 4, fontWeight: 'bold' }}>
                    🔍 Filter: Sirf PDF Documents dikh rahe hain
                  </span>
                )}
              </div>

              <input
                type="text"
                placeholder="Search documents by filename or title..."
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                style={{ ...inputStyle, padding: '7px 10px', fontSize: 13, background: '#fff' }}
              />
            </div>

            {savedLoading ? (
              <p style={{ fontSize: 13, color: '#666' }}>Loading saved documents...</p>
            ) : (() => {
              const matchesFilter = (filename: string) => {
                if (docFilter === 'pdf') return isPdf(filename);
                if (docFilter === 'docx') return isDocx(filename);
                if (docFilter === 'txt') return isTxt(filename);
                return true;
              };
              const matchesSearch = (item: { filename: string; title: string }) => {
                if (!docSearch.trim()) return true;
                const q = docSearch.toLowerCase();
                return item.filename.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
              };

              const filteredDocs = savedDocs.filter(d => matchesFilter(d.filename) && matchesSearch(d));
              const filteredSops = savedSops.filter(s => matchesFilter(s.filename) && matchesSearch(s));

              if (savedDocs.length === 0 && savedSops.length === 0) {
                return <p style={{ fontSize: 13, color: '#999' }}>No SOPs saved yet. Upload a file above to index it.</p>;
              }

              if (filteredDocs.length === 0 && filteredSops.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '24px 12px', background: docFilter === 'pdf' ? '#fef2f2' : '#f8fafc', border: `1px dashed ${docFilter === 'pdf' ? '#fca5a5' : '#cbd5e1'}`, borderRadius: 8, color: docFilter === 'pdf' ? '#991b1b' : '#64748b' }}>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>{docFilter === 'pdf' ? '📄' : '🔍'}</div>
                    <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                      {docFilter === 'pdf' ? 'Koi bhi PDF document nahi mila' : 'No documents match your filter'}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      {docFilter === 'pdf' 
                        ? 'Filhal koi bhi PDF document upload nahi hua hai. Upar se .pdf file upload karein.' 
                        : 'Try clearing the search query or changing the filter.'}
                    </div>
                    {docFilter !== 'all' && (
                      <button
                        onClick={() => { setDocFilter('all'); setDocSearch(''); }}
                        style={{ ...btnStyle, background: '#eee', fontSize: 11, padding: '4px 10px', marginTop: 10 }}
                      >
                        Show All Documents
                      </button>
                    )}
                  </div>
                );
              }

              return (
                <div>
                  {filteredDocs.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>ChromaDB Vector Index ({filteredDocs.length} file{filteredDocs.length > 1 ? 's' : ''}):</span>
                        {docFilter === 'pdf' && (
                          <span style={{ fontSize: 11, color: '#b91c1c', background: '#fee2e2', padding: '2px 8px', borderRadius: 4 }}>
                            {filteredDocs.length} PDF(s) ready for chat
                          </span>
                        )}
                      </div>
                      {filteredDocs.map((doc) => {
                        const isDocPdf = isPdf(doc.filename);
                        return (
                          <div
                            key={doc.id}
                            style={{
                              border: isDocPdf ? '1px solid #fca5a5' : '1px solid #ddd',
                              borderRadius: 6,
                              padding: '10px 12px',
                              marginBottom: 8,
                              fontSize: 13,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              background: isDocPdf ? '#fff8f8' : '#fafafa'
                            }}
                          >
                            <div style={{ overflow: 'hidden', paddingRight: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                                {getFileBadge(doc.filename)}
                                <span style={{ fontWeight: 'bold', color: isDocPdf ? '#991b1b' : '#1e293b' }}>{doc.title}</span>
                              </div>
                              <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 12, marginTop: 2 }}>
                                {doc.filename} · <span style={{ color: '#166534', fontWeight: 'bold' }}>{doc.chunks} chunk(s)</span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              <span style={{ background: '#e0f2e0', color: '#1a7f37', borderRadius: 4, padding: '2px 8px', fontSize: 12, whiteSpace: 'nowrap' }}>
                                {doc.category}
                              </span>
                              <button
                                onClick={() => handleDeleteDoc(doc.filename)}
                                style={{ background: '#fde8e8', color: '#c62828', border: '1px solid #f5c2c2', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                title={`Delete ${doc.filename}`}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {filteredSops.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 8 }}>
                        Database SOP Records ({filteredSops.length} SOP{filteredSops.length > 1 ? 's' : ''}):
                      </div>
                      {filteredSops.map((sop) => {
                        const isSopPdf = isPdf(sop.filename);
                        return (
                          <div
                            key={sop.id}
                            style={{
                              border: isSopPdf ? '1px solid #fca5a5' : '1px solid #ddd',
                              borderRadius: 6,
                              padding: '10px 12px',
                              marginBottom: 8,
                              fontSize: 13,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              background: isSopPdf ? '#fff8f8' : '#fafafa'
                            }}
                          >
                            <div style={{ overflow: 'hidden', paddingRight: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                                {getFileBadge(sop.filename)}
                                <span style={{ fontWeight: 'bold' }}>{sop.title}</span>
                              </div>
                              <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 12, marginTop: 2 }}>
                                {sop.filename}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              <span style={{ background: '#e0ebf5', color: '#1a4d8f', borderRadius: 4, padding: '2px 8px', fontSize: 12, whiteSpace: 'nowrap' }}>
                                {sop.category}
                              </span>
                              <button
                                onClick={() => handleDeleteSop(sop.id)}
                                style={{ background: '#fde8e8', color: '#c62828', border: '1px solid #f5c2c2', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <div style={{ ...sectionStyle, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Chunk Viewer ({chunks.length} chunks)</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={{ ...btnStyle, background: '#eee', fontSize: 12, padding: '6px 12px' }}
              onClick={fetchChunks}
            >
              Refresh
            </button>
            <button
              style={{ ...btnStyle, background: '#333', color: '#fff', fontSize: 12, padding: '6px 12px' }}
              onClick={() => { setShowChunks(!showChunks); if (!showChunks && chunks.length === 0) fetchChunks(); }}
            >
              {showChunks ? 'Hide Chunks' : 'Show Chunks'}
            </button>
          </div>
        </div>

        {showChunks && (
          chunksLoading ? (
            <p style={{ fontSize: 13, color: '#666' }}>Loading chunks from ChromaDB...</p>
          ) : chunks.length === 0 ? (
            <p style={{ fontSize: 13, color: '#999' }}>No chunks indexed yet. Upload a file first.</p>
          ) : (
            <div>
              {chunks.map((chunk) => {
                const isImage = chunk.chunk_type === 'image';
                const expanded = expandedChunks.has(chunk.id);
                return (
                  <div
                    key={chunk.id}
                    style={{
                      border: isImage ? '1px solid #e6c96a' : '1px solid #ddd',
                      borderRadius: 6,
                      marginBottom: 6,
                      background: isImage ? '#fffdf3' : '#fafafa',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      onClick={() => toggleChunk(chunk.id)}
                      style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 'bold', fontSize: 12 }}>{isImage ? '🖼️ ' : ''}{chunk.source_file}</span>
                        <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>{chunk.heading}</span>
                        <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>#{chunk.chunk_index} · {chunk.char_length} chars</span>
                      </div>
                      <span style={{ color: '#666', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {isImage ? 'image' : 'text'} {expanded ? '▾' : '▸'}
                      </span>
                    </div>
                    {expanded && (
                      <div style={{ padding: '8px 12px 10px', borderTop: '1px solid #eee', fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: '#fff', maxHeight: 300, overflowY: 'auto', lineHeight: 1.5 }}>
                        {chunk.text}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

    </div>
  );
}