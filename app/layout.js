import './globals.css';

export const metadata = {
  title: 'PDF 요약기 — Claude AI',
  description: 'PDF 문서를 업로드하면 초등/중등/고등/대학원 수준으로 자동 요약해드립니다',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* 배경 그라디언트 장식 */}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(99,102,241,0.15), transparent)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
      </body>
    </html>
  );
}
