// 서재에 넣을 수 있는 파일 형식 (2026-10-16 — PDF 말고도 워드 · 한글 · PPT · 엑셀 · 이미지). 순수 함수만(DOM 없음).
// 서버 paperlab/convert.py ACCEPT_EXTS와 같아야 한다(tests/test_convert.py가 확인). PDF가 아닌 파일은 서버가 PDF
// 변환본을 만들어 읽기 · 형광펜 · AI가 그대로 돌고, 올린 원본은 [원본 받기]로 받는다.

export const DOC_EXTS = [".doc", ".docx", ".hwp", ".hwpx", ".ppt", ".pptx", ".xls", ".xlsx", ".odt", ".odp", ".ods", ".rtf"];
export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp"];
export const LIB_EXTS = [".pdf", ...DOC_EXTS, ...IMAGE_EXTS];
// 파일 선택 창 accept 값 (MIME도 넣어 둬야 일부 브라우저가 PDF를 바로 보여 줌)
export const LIB_ACCEPT = [...LIB_EXTS, "application/pdf"].join(",");
export const LIB_KINDS_TEXT = "PDF · 워드 · 한글 · PPT · 엑셀 · 사진";

// "보고서.v2.DOCX" → ".docx" (확장자 없으면 "")
export function extOf(name) {
  const m = /\.([^.\\/]+)$/.exec(String(name || ""));
  return m ? `.${m[1].toLowerCase()}` : "";
}

// 브라우저 File(또는 {name, type}) — 서재에 올릴 수 있는지
export function isLibFile(f) {
  return !!f && (LIB_EXTS.includes(extOf(f.name)) || f.type === "application/pdf");
}

export function isPdfFile(f) {
  return !!f && (extOf(f.name) === ".pdf" || f.type === "application/pdf");
}

// 원본 파일 이름 → 형식 배지 글자 ("DOCX" · "HWP" · "PPTX" · "이미지"). 모르는 형식이면 "원본"
export function formatBadge(sourceName) {
  const ext = extOf(sourceName);
  if (IMAGE_EXTS.includes(ext)) return "이미지";
  if (DOC_EXTS.includes(ext)) return ext.slice(1).toUpperCase();
  return "원본";
}
