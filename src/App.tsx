import React, { useState, useRef } from 'react';

export default function App() {
  const [question, setQuestion] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('Custom Policy');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');


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
    try {
      const res = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), image })
      });
      const data = await res.json();
      setAnswer(data.answer || "This isn't covered in our SOPs.");
    } catch {
      setAnswer('Error: RAG service unreachable.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('read error'));
        reader.readAsDataURL(file as Blob);
      });
      const res = await fetch('/api/rag/ingest-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, category, base64 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'upload failed');
      setUploadMsg('Uploaded & indexed successfully.');
      setFile(null);
    } catch (err: any) {
      setUploadMsg('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
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
  const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 'bold', marginBottom: '6px', fontSize: '14px' };

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
          <div style={{ marginTop: 14, background: '#f5f5f5', padding: '12px', borderRadius: '6px', whiteSpace: 'pre-line', fontSize: 14 }}>
            <strong>Answer:</strong>
            <div style={{ marginTop: 4 }}>{answer}</div>
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0 }}>Upload SOP Document</h3>
        <form onSubmit={handleFileUpload}>
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] || null)} style={inputStyle} />
          <div style={{ marginTop: 8 }}>
            <label style={labelStyle}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              {['Custom Policy', 'IT Security', 'Human Resources', 'Equipment Maintenance', 'Customer Support'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <button style={{ ...btnStyle, background: '#333', color: '#fff', marginTop: 8 }} type="submit" disabled={uploading || !file}>
            {uploading ? 'Uploading...' : 'Upload & Index'}
          </button>
        </form>
      </div>

      {uploadMsg && <p style={{ textAlign: 'center', fontSize: 14 }}>{uploadMsg}</p>}
    </div>
  );
}