// 로컬 PDF 본문 추출 (명세 selective-sync.md 9.4절, D-6) — 숨은 샌드박스 창(app://ui/extract.html, 별도 세션 · 네트워크 차단)에서 돈다.
// main 이 바이트만 보냄(window.paperlabExtract.onJob) → PDF.js(앱에 함께 넣은 서버 static/vendor/pdfjs 사본, isEvalSupported: false)로
// 쪽마다 getTextContent → 글 배열을 done 으로 돌려줌. 상한 2,000쪽 · 글 합계 8MB(넘으면 그 자리에서 멈춤). 글은 화면에 그리지 않는다.
import * as pdfjsLib from './vendor/pdf.min.mjs';

const MAX_PAGES = 2000;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const enc = new TextEncoder();

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

async function extract(data) {
  const task = pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, stopAtErrors: false });
  const doc = await task.promise;
  try {
    const pages = [];
    let bytes = 0;
    const n = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map((it) => (typeof it.str === 'string' ? it.str : '') + (it.hasEOL ? '\n' : '')).join('');
      page.cleanup();
      const b = enc.encode(text).length;
      if (bytes + b > MAX_TEXT_BYTES) break;
      bytes += b;
      pages.push(text);
    }
    return pages;
  } finally {
    doc.destroy();
  }
}

const bridge = window.paperlabExtract;
if (bridge) {
  bridge.onJob(async (job) => {
    const id = job && job.id;
    try {
      const pages = await extract(job.data);
      bridge.done(id, pages, pages.some((p) => p.trim()) ? '' : 'local_no_text');
    } catch {
      bridge.done(id, [], 'local_unreadable'); // 손상 · 암호(PasswordException) · 너무 큼
    }
  });
  bridge.ready();
}
