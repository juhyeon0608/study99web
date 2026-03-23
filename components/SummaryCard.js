'use client';
import Link from 'next/link';

const LEVEL_COLORS = {
  초등: { bg: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: 'rgba(16,185,129,0.3)' },
  중등: { bg: 'rgba(59,130,246,0.15)', color: '#93c5fd', border: 'rgba(59,130,246,0.3)' },
  고등: { bg: 'rgba(245,158,11,0.15)', color: '#fcd34d', border: 'rgba(245,158,11,0.3)' },
  대학원: { bg: 'rgba(139,92,246,0.15)', color: '#c4b5fd', border: 'rgba(139,92,246,0.3)' },
};

const STATUS_INFO = {
  processing: { icon: '⏳', text: '요약 중...', color: '#f59e0b' },
  done: { icon: '✅', text: '완료', color: '#10b981' },
  error: { icon: '❌', text: '오류', color: '#ef4444' },
};

export default function SummaryCard({ summary }) {
  const status = STATUS_INFO[summary.status] || STATUS_INFO.processing;
  const date = summary.createdAt instanceof Date
    ? summary.createdAt
    : new Date(summary.createdAt?.seconds * 1000 || Date.now());

  const timeAgo = (date) => {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
  };

  const CardContent = () => (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 24,
        transition: 'all 0.2s',
        cursor: summary.status === 'done' ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
      className={summary.status === 'done' ? 'card-hover' : ''}
      onMouseEnter={(e) => {
        if (summary.status === 'done') {
          e.currentTarget.style.borderColor = 'var(--primary)';
          e.currentTarget.style.background = 'var(--card-hover)';
          e.currentTarget.style.transform = 'translateY(-2px)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background = 'var(--card)';
        e.currentTarget.style.transform = 'none';
      }}
    >
      {/* 상단 라인 */}
      {summary.status === 'done' && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: 2,
          background: 'linear-gradient(90deg, var(--primary), var(--secondary))',
        }} />
      )}

      {/* 파일명 & 상태 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: 1, marginRight: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>📄</span>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'white', lineHeight: 1.4 }}>
              {summary.title || summary.filename}
            </h3>
          </div>
          {summary.title && summary.title !== summary.filename && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 26 }}>
              {summary.filename}
            </p>
          )}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: `${status.color}20`,
          border: `1px solid ${status.color}40`,
          borderRadius: 999, padding: '3px 10px', flexShrink: 0,
        }}>
          <span style={{ fontSize: 11 }}>{status.icon}</span>
          <span style={{ fontSize: 11, color: status.color, fontWeight: 600 }}>{status.text}</span>
          {summary.status === 'processing' && (
            <div className="spinner" style={{ width: 12, height: 12 }} />
          )}
        </div>
      </div>

      {/* 수준 뱃지 */}
      {summary.status === 'done' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {Object.entries(LEVEL_COLORS).map(([level, colors]) => (
            <span
              key={level}
              className="level-badge"
              style={{ background: colors.bg, color: colors.color, border: `1px solid ${colors.border}` }}
            >
              {level}
            </span>
          ))}
          {summary.formulas?.length > 0 && (
            <span
              className="level-badge"
              style={{
                background: 'rgba(236,72,153,0.15)',
                color: '#f9a8d4',
                border: '1px solid rgba(236,72,153,0.3)'
              }}
            >
              수식 {summary.formulas.length}개
            </span>
          )}
        </div>
      )}

      {/* 오류 메시지 */}
      {summary.status === 'error' && summary.error && (
        <p style={{ fontSize: 13, color: '#fca5a5', marginBottom: 12 }}>
          {summary.error}
        </p>
      )}

      {/* 키워드 */}
      {summary.keywords?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {summary.keywords.slice(0, 5).map(kw => (
            <span key={kw} style={{
              fontSize: 11, color: 'var(--text-muted)',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 4, padding: '2px 8px',
            }}>
              #{kw}
            </span>
          ))}
        </div>
      )}

      {/* 메타 정보 */}
      <div style={{ display: 'flex', gap: 16, marginTop: 'auto' }}>
        {summary.pages > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            📑 {summary.pages}페이지
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          🕐 {timeAgo(date)}
        </span>
        {summary.status === 'done' && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
            자세히 보기 →
          </span>
        )}
      </div>
    </div>
  );

  if (summary.status === 'done') {
    return (
      <Link href={`/summary/${summary.id}`} style={{ textDecoration: 'none' }}>
        <CardContent />
      </Link>
    );
  }

  return <CardContent />;
}
