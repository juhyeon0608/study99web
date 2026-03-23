'use client';
import { useState, useRef, useEffect } from 'react';
import { getServerUrl } from '../lib/firebase';

export default function UploadModal({ onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [serverUrl, setServerUrl] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    getServerUrl().then(url => {
      setServerUrl(url);
      if (!url) setError('서버가 오프라인입니다. PC에서 서버를 실행해주세요.');
    });
  }, []);

  const handleFile = (f) => {
    if (f?.type !== 'application/pdf') {
      setError('PDF 파일만 업로드 가능합니다');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('파일 크기가 50MB를 초과합니다');
      return;
    }
    setError('');
    setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      if (!serverUrl) throw new Error('서버가 오프라인입니다');
      const res = await fetch(`${serverUrl}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || '업로드 실패');
      onSuccess(data.id);
    } catch (err) {
      setError(err.message.includes('fetch')
        ? 'PC 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.'
        : err.message);
      setUploading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="animate-fadeIn"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          padding: 32,
          width: '100%',
          maxWidth: 480,
        }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'white' }}>PDF 업로드</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Claude AI가 4가지 수준으로 자동 요약합니다
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, padding: 4 }}
          >✕</button>
        </div>

        {/* 드래그 앤 드롭 영역 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--border)'}`,
            borderRadius: 12,
            padding: '40px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: dragOver ? 'rgba(99,102,241,0.08)' : 'transparent',
            marginBottom: 20,
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
          <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
          {file ? (
            <div>
              <p style={{ color: 'var(--primary)', fontWeight: 600, marginBottom: 4 }}>{file.name}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
          ) : (
            <div>
              <p style={{ color: 'var(--text)', fontWeight: 500, marginBottom: 4 }}>
                파일을 끌어다 놓거나 클릭하여 선택
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>PDF • 최대 50MB</p>
            </div>
          )}
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 14,
            color: '#fca5a5',
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* 버튼 */}
        <button
          onClick={handleUpload}
          disabled={!file || uploading || !serverUrl}
          style={{
            width: '100%',
            padding: '14px 0',
            background: !file || uploading ? 'var(--border)' : 'linear-gradient(135deg, var(--primary), var(--secondary))',
            color: !file || uploading ? 'var(--text-muted)' : 'white',
            border: 'none',
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 700,
            cursor: !file || uploading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {uploading ? (
            <>
              <div className="spinner" />
              요약 처리 중...
            </>
          ) : (
            '🚀 요약 시작'
          )}
        </button>

        {uploading && (
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>
            Claude AI가 열심히 요약하고 있어요. 문서 길이에 따라 1~3분 정도 걸릴 수 있어요.
          </p>
        )}
      </div>
    </div>
  );
}
