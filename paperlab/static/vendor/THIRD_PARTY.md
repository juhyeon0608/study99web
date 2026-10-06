# 포함된 외부 라이브러리

오프라인에서도 동작하도록 아래 라이브러리를 그대로 포함했습니다.

| 라이브러리 | 버전 | 라이선스 | 파일 |
|---|---|---|---|
| [PDF.js](https://github.com/mozilla/pdf.js) (pdfjs-dist) | 4.10.38 | Apache-2.0 | `pdfjs/` |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19.0 | MIT | `katex/` (woff2 글꼴만) |
| [marked](https://github.com/markedjs/marked) | 18.1.0 | MIT | `marked.min.js` (UMD 빌드) |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | Apache-2.0 / MPL-2.0 | `purify.min.js` |
| [citeproc-js](https://github.com/Juris-M/citeproc-js) | 2.4.63 | CPAL-1.0 / AGPL-1.0 | `citeproc.js` (CommonJS 빌드를 `window.CSL`로 감쌈), `csl/CITEPROC-LICENSE` |
| [CSL 스타일](https://github.com/citation-style-language/styles) | 2026-10 | CC BY-SA 3.0 | `csl/styles/*.csl` |
| [CSL 로케일](https://github.com/citation-style-language/locales) | 2026-10 | CC BY-SA 3.0 | `csl/locales/*.xml` (en-US, en-GB, ko-KR) |
