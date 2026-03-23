'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeSummaries } from '../lib/firebase';
import SummaryCard from '../components/SummaryCard';
import UploadModal from '../components/UploadModal';

export default function HomePage() {
  const [summaries, setSummaries] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | done | processing
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = subscribeSummaries((data) => {
      setSummaries(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filtered = summaries.filter(s => {
    if (filter === 'all') return true;
    return s.status === filter;
  });

  const handleUploadSuccess = (id) => {
    setShowUpload(false);
    // 처리 중인 카드가 목록에 자동으로 나타남 (Firebase 실시간 구독)
  };

  const counts = {
    all: summaries.length,
    done: summaries.filter(s => s.status === 'done').length,
    processing: summaries.filter(s => s.status === 'processing').length,
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* 헤더 */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        background: 'rgba(15,15,26,0.8)',
        backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto', padding: '0 24px',
          height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 28 }}>🧠</span>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 800, color: 'white' }}>PDF 요약기</h1>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Powered by Claude AI</p>
            </div>
          </div>
          <button
            onClick={() => setShowUpload(true)}
            style={{
              background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
              color: 'white', border: 'none', borderRadius: 10,
              padding: '10px 20px', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span>+</span> PDF 업로드
          </button>
        </div>
      </header>

      {/* 메인 */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>

        {/* 히어로 섹션 */}
        {summaries.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 80, marginBottom: 24 }}>📚</div>
            <h2 className="gradient-text" style={{ fontSize: 36, fontWeight: 800, marginBottom: 16 }}>
              문서를 모두를 위한 언어로
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 18, marginBottom: 40, lineHeight: 1.8 }}>
              PDF를 업로드하면 Claude AI가 초등생부터 대학원생까지<br />
              4가지 수준으로 자동 요약해드립니다
            </p>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 48 }}>
              {[
                { emoji: '🌱', level: '초등', desc: '쉬운 단어와 비유' },
                { emoji: '📖', level: '중등', desc: '기본 개념과 원리' },
                { emoji: '🔬', level: '고등', desc: '구체적인 내용' },
                { emoji: '🎓', level: '대학원', desc: '전문적 심층 분석' },
              ].map(item => (
                <div key={item.level} style={{
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: '20px 24px', textAlign: 'center', minWidth: 130,
                }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{item.emoji}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'white', marginBottom: 4 }}>{item.level}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.desc}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowUpload(true)}
              style={{
                background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                color: 'white', border: 'none', borderRadius: 14,
                padding: '16px 48px', fontSize: 18, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              첫 번째 PDF 업로드하기
            </button>
          </div>
        )}

        {/* 목록 */}
        {(summaries.length > 0 || loading) && (
          <>
            {/* 필터 탭 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
              {[
                { key: 'all', label: '전체' },
                { key: 'done', label: '완료' },
                { key: 'processing', label: '처리 중' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 999,
                    border: `1px solid ${filter === key ? 'var(--primary)' : 'var(--border)'}`,
                    background: filter === key ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: filter === key ? 'var(--primary)' : 'var(--text-muted)',
                    fontSize: 14, fontWeight: filter === key ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                  <span style={{
                    marginLeft: 6, fontSize: 12,
                    background: filter === key ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.1)',
                    borderRadius: 999, padding: '1px 7px',
                    color: filter === key ? 'var(--primary)' : 'var(--text-muted)',
                  }}>
                    {counts[key]}
                  </span>
                </button>
              ))}
            </div>

            {/* 로딩 */}
            {loading && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 16, padding: 24, height: 160,
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }} />
                ))}
              </div>
            )}

            {/* 카드 그리드 */}
            {!loading && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: 16,
              }}>
                {filtered.map(summary => (
                  <div key={summary.id} className="animate-fadeIn">
                    <SummaryCard summary={summary} />
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
                    해당하는 요약이 없습니다
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* 업로드 모달 */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}
