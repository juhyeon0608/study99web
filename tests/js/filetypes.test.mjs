// 서재에 넣을 수 있는 파일 형식 · 형식 배지 (2026-10-16 문서 · 이미지 넣기) — 순수 함수만
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const F = await import("../../paperlab/static/js/filetypes.js");

describe("받는 파일", () => {
  test("확장자 (대소문자 · 점 여러 개)", () => {
    assert.equal(F.extOf("보고서 v1.2.DOCX"), ".docx");
    assert.equal(F.extOf("README"), "");
    assert.equal(F.extOf("a/b.c/파일"), "");
  });
  test("PDF · 워드 · 한글 · PPT · 엑셀 · 사진은 받고 그 밖은 거름", () => {
    for (const n of ["a.pdf", "a.doc", "a.docx", "a.hwp", "a.hwpx", "a.ppt", "a.pptx", "a.xls", "a.xlsx", "a.odt", "a.rtf",
      "a.jpg", "a.JPEG", "a.png", "a.gif", "a.bmp", "a.tif", "a.tiff", "a.webp"]) {
      assert.ok(F.isLibFile({ name: n, type: "" }), n);
    }
    for (const n of ["a.exe", "a.zip", "a.txt", "a.html", "a.svg", "a"]) assert.ok(!F.isLibFile({ name: n, type: "" }), n);
    assert.ok(F.isLibFile({ name: "다운로드", type: "application/pdf" })); // 확장자 없는 PDF
    assert.ok(!F.isLibFile(null));
  });
  test("PDF인지 (처리 중 문구 · 변환 여부)", () => {
    assert.ok(F.isPdfFile({ name: "x.PDF", type: "" }));
    assert.ok(!F.isPdfFile({ name: "x.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  });
  test("파일 선택 창 accept 값", () => {
    assert.ok(F.LIB_ACCEPT.split(",").includes(".hwpx") && F.LIB_ACCEPT.includes("application/pdf"));
    assert.equal(F.LIB_EXTS[0], ".pdf");
  });
});

describe("형식 배지", () => {
  test("문서는 확장자, 사진은 이미지", () => {
    assert.equal(F.formatBadge("보고서.docx"), "DOCX");
    assert.equal(F.formatBadge("옛 문서.HWP"), "HWP");
    assert.equal(F.formatBadge("발표.pptx"), "PPTX");
    assert.equal(F.formatBadge("표.xlsx"), "XLSX");
    assert.equal(F.formatBadge("칠판.jpeg"), "이미지");
    assert.equal(F.formatBadge(""), "원본");
    assert.equal(F.formatBadge("이상한.exe"), "원본");
  });
});
