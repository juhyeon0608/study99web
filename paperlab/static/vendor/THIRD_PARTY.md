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
| [supabase-js](https://github.com/supabase/supabase-js) (`@supabase/supabase-js`) | 2.117.2 | MIT | `supabase/supabase.js` (npm 배포본 `dist/umd/supabase.js` 그대로, `window.supabase`), `supabase/LICENSE` |
| [d3-force](https://github.com/d3/d3-force) | 3.0.0 | ISC | `d3/d3-force.min.js` (npm 배포본 `dist/d3-force.min.js` 그대로, `window.d3`), `d3/d3-force.LICENSE` |
| [d3-dispatch](https://github.com/d3/d3-dispatch) | 3.0.1 | ISC | `d3/d3-dispatch.min.js`, `d3/d3-dispatch.LICENSE` (d3-force 의존) |
| [d3-quadtree](https://github.com/d3/d3-quadtree) | 3.0.1 | ISC | `d3/d3-quadtree.min.js`, `d3/d3-quadtree.LICENSE` (d3-force 의존) |
| [d3-timer](https://github.com/d3/d3-timer) | 3.0.1 | ISC | `d3/d3-timer.min.js`, `d3/d3-timer.LICENSE` (d3-force 의존) |

- supabase-js: `npm pack @supabase/supabase-js@2.117.2`(npm 공식 레지스트리, 무결성 sha512 확인)로 받은 파일을 고치지 않고 넣었어요. `supabase.js` SHA-256 `59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd`. UMD 묶음 안의 `@supabase/auth-js` · `postgrest-js` · `realtime-js` · `storage-js` · `functions-js`(모두 2.117.2)도 같은 저장소 · 같은 MIT 라이선스예요.
- d3-force · d3-dispatch · d3-quadtree · d3-timer(인용 그래프 배치 계산 — 그래프 화면에 들어올 때만 불러요): npm 공식 레지스트리 tarball(`https://registry.npmjs.org/<이름>/-/<이름>-<버전>.tgz`)을 받아 레지스트리의 무결성 값(`dist.integrity` sha512)이 맞는 것을 확인하고, `package/dist/<이름>.min.js`와 `package/LICENSE`를 고치지 않고 넣었어요(2026-10-07). 화면(`js/graph.js`)은 `<script integrity>`(SRI)로 불러요.

| 파일 | 바이트 | SHA-256 | SRI (sha384) | npm 무결성 (tarball sha512) |
|---|---|---|---|---|
| `d3/d3-dispatch.min.js` | 1901 | `94b3bbdb6b98dc1325a15762b051013e8253999b0e0436b27d1da17b952ba0af` | `sha384-oGUk7ZMuIJXyjegrWZrjUkxuWZHJoUPTeaUNKzjcEhND8HzfagI4EnXVspF2mP60` | `sha512-rzUyPU/S7rwUflMyLc1ETDeBj0NRuHKKAcvukozwhshr6g6c5d8zh4c2gQjY2bZ0dXeGLWc1PF174P2tVvKhfg==` |
| `d3/d3-quadtree.min.js` | 5279 | `57e2ad12824ed82893ba447523f2a2fb9beeb9222aafb2c778a9f5b313348b0e` | `sha384-JzQQZeN94rbeGRpksNSu8TCkRWLlzTHev53JZngDT0faxrmd9bApgXS5pZWShqJb` | `sha512-04xDrxQTDTCFwP5H6hRhsRcb9xxv2RzkcsygFzmkSIOJy3PeRJP7sNk3VRIbKXcog561P9oU0/rVH6vDROAgUw==` |
| `d3/d3-timer.min.js` | 1947 | `911ceda305f014b6b53ca68d5c896a9a387da120cfd56a421a2c60cca2fc9b36` | `sha384-brChTSJXF1bpEGi+e8fNotmiEQtehLbv5EWt3njlDFlYjl/SwmXs4xofe0gvWd7E` | `sha512-ndfJ/JxxMd3nw31uyKoY2naivF+r29V+Lc0svZxe1JvvIRmi8hUsrMvdOwgS1o6uBHmiz91geQ0ylPP0aj1VUA==` |
| `d3/d3-force.min.js` | 8300 | `1e07b473241328795d5ea9ad479a7bbabd765012fa2ef95633c83b69868dff6b` | `sha384-RM+ykRJc5/xPC56TVMOAYbZeVThoKXqcRlmRHZZc3YDHDCvFJrsEH2dpLMqL50K8` | `sha512-zxV/SsA+U4yte8051P4ECydjD/S+qeYtnaIyAs9tgHCqfguma/aAQDjo85A9Z6EKhBirHRJHXIgJUlffT4wdLg==` |
