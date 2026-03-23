'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { subscribeSummary } from '../../../lib/firebase';

const TABS = [
  { key: 'elementary', label: '🌱 초등', emoji: '🌱', color: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
  { key: 'middle',     label: '📖 중등', emoji: '📖', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.3)' },
  { key: 'high',       label: '🔬 고등', emoji: '🔬', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' },
  { key: 'graduate',   label: '🎓 대학원', emoji: '🎓', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)' },
  { key: 'formulas',   label: '🧮 수식',   emoji: '🧮', color: '#ec4899', bg: 'rgba(236,72,153,0.1)', border: 'rgba(236,72,153,0.3)' },
];

export default function SummaryPage() {
  const { id } = useParams();
  const router = useRouter();
  const [summary, setSummary] = useState(null);
  const [activeTab, setActiveTab] = useState('elementary');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeSummary(id, (data) => {
      setSummary(data);
    });
    return () => unsubscribe();
  }, [id]);

  const copyText = () => {
    const text = summary[activeTab];
    if (typeof text === 'string') {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!summary) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ width: 40, height: 40, margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (summary.status === 'processing') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 24 }}>⏳</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, color: 'white' }}>요약 중...</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
            Claude AI가 문서를 분석하고 있어요. 잠시만 기다려주세요.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{summary.filename}</p>
          <div style={{ marginTop: 32 }}>
            <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto' }} />
          </div>
        </div>
      </div>
    );
  }

  const activeTabInfo = TABS.find(t => t.key === activeTab);

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* 헤더 */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        background: 'rgba(15,15,26,0.8)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{
          maxWidth: 900, margin: '0 auto', padding: '0 24px',
          height: 64, display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <button
            onClick={() => router.push('/')}
            style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', borderRadius: 8, padding: '6px 12px',
              cursor: 'pointer', fontSize: 14,
            }}
          >
            ← 목록
          </button>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {summary.title || summary.filename}
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {summary.pages}페이지 • {summary.filename}
            </p>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {/* 키워드 */}
        {summary.keywords?.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
            {summary.keywords.map(kw => (
              <span key={kw} style={{
                fontSize: 12, color: 'var(--text-muted)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                borderRadius: 6, padding: '4px 10px',
              }}>
                #{kw}
              </span>
            ))}
          </div>
        )}

        {/* 탭 */}
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4,
          marginBottom: 28,
          scrollbarWidth: 'none',
        }}>
          {TABS.map(tab => {
            // 수식 탭: 수식이 없으면 표시하지 않음
            if (tab.key === 'formulas' && (!summary.formulas || summary.formulas.length === 0)) return null;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: `1px solid ${activeTab === tab.key ? tab.border : 'var(--border)'}`,
                  background: activeTab === tab.key ? tab.bg : 'transparent',
                  color: activeTab === tab.key ? tab.color : 'var(--text-muted)',
                  fontSize: 14, fontWeight: activeTab === tab.key ? 700 : 400,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
                {tab.key === 'formulas' && summary.formulas?.length > 0 && (
                  <span style={{
                    marginLeft: 6, fontSize: 11,
                    background: activeTab === 'formulas' ? 'rgba(236,72,153,0.3)' : 'rgba(255,255,255,0.1)',
                    borderRadius: 999, padding: '1px 6px',
                  }}>
                    {summary.formulas.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 콘텐츠 카드 */}
        <div
          className="animate-fadeIn"
          key={activeTab}
          style={{
            background: 'var(--card)',
            border: `1px solid ${activeTabInfo?.border || 'var(--border)'}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {/* 카드 헤더 */}
          <div style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: activeTabInfo ? `${activeTabInfo.bg}` : 'transparent',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>{activeTabInfo?.emoji}</span>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: activeTabInfo?.color }}>
                  {activeTab === 'elementary' ? '초등학생 수준' :
                   activeTab === 'middle' ? '중학생 수준' :
                   activeTab === 'high' ? '고등학생 수준' :
                   activeTab === 'graduate' ? '대학원생 수준' : '수식 정리'}
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {activeTab === 'elementary' ? '쉬운 단어와 비유로 설명' :
                   activeTab === 'middle' ? '기본 개념과 원리 포함' :
                   activeTab === 'high' ? '구체적 내용과 연결 개념' :
                   activeTab === 'graduate' ? '전문 용어와 심층 분석' : 'LaTeX 형식의 수식 모음'}
                </p>
              </div>
            </div>
            {activeTab !== 'formulas' && (
              <button
                onClick={copyText}
                style={{
                  background: copied ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'var(--border)'}`,
                  color: copied ? '#6ee7b7' : 'var(--text-muted)',
                  borderRadius: 8, padding: '6px 12px',
                  cursor: 'pointer', fontSize: 13,
                  transition: 'all 0.2s',
                }}
              >
                {copied ? '✓ 복사됨' : '📋 복사'}
              </button>
            )}
          </div>

          {/* 카드 바디 */}
          <div style={{ padding: '28px 32px' }}>
            {activeTab === 'formulas' ? (
              <FormulasView formulas={summary.formulas} />
            ) : (
              <div style={{
                color: 'var(--text)',
                lineHeight: 1.9,
                fontSize: 16,
                whiteSpace: 'pre-wrap',
                wordBreak: 'keep-all',
              }}>
                {summary[activeTab]}
              </div>
            )}
          </div>
        </div>

        {/* 수식이 있고 다른 탭을 보고 있을 때 힌트 */}
        {activeTab !== 'formulas' && summary.formulas?.length > 0 && (
          <div
            onClick={() => setActiveTab('formulas')}
            style={{
              marginTop: 16,
              padding: '12px 20px',
              background: 'rgba(236,72,153,0.08)',
              border: '1px solid rgba(236,72,153,0.2)',
              borderRadius: 10,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              color: '#f9a8d4', fontSize: 14,
            }}
          >
            <span style={{ fontSize: 18 }}>🧮</span>
            이 문서에서 <strong>{summary.formulas.length}개</strong>의 수식을 발견했습니다. 클릭하여 확인하세요 →
          </div>
        )}
      </main>
    </div>
  );
}

function FormulasView({ formulas }) {
  if (!formulas || formulas.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
        이 문서에서 수식을 찾지 못했습니다
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {formulas.map((formula, i) => (
        <div
          key={i}
          style={{
            borderLeft: '3px solid var(--primary)',
            paddingLeft: 20,
          }}
        >
          {formula.name && (
            <h4 style={{ fontSize: 15, fontWeight: 700, color: 'white', marginBottom: 12 }}>
              {formula.name}
            </h4>
          )}
          <div className="formula-block" style={{ marginBottom: 12 }}>
            <code style={{ fontSize: 18, color: '#c9d1d9', fontFamily: 'monospace', display: 'block', textAlign: 'center' }}>
              {formula.latex}
            </code>
          </div>
          {formula.description && (
            <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              {formula.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
