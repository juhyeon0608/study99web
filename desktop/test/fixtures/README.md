# desktop/test/fixtures — 시험 견본

저장소에 개인 문서를 넣지 않습니다(선택 동기화 명세 9.5.5절). 여기 있는 것은 모두 시험용으로 직접 만든 것입니다.

| 파일 | 무엇 | 출처 |
|---|---|---|
| `fake-cli.js` | 가짜 claude · codex · gemini CLI (`agy`는 `fake-agy.js`로 넘김) | 2단계 시험 |
| `fake-agy.js` | 가짜 Antigravity CLI(`agy` 1.4.0 흉내 — Go flag 인자 · `agy models` · NDJSON 이벤트, ERROR 결과 · 허락 요청 · 질문 · 모르는 이벤트 · 멈춤) | 팀장 실측(2026-10-17)을 보고 직접 만듦 — `test/agy.test.js` |
| `fake-sync-api.js` | 가짜 동기화 서버(메모리) — 6단계 v1 + 선택 동기화 v2(`protocol: 2`, 계약 C-1) | 6단계 · 선택 동기화 |
| `sync-sim.js` · `roundtrip-worker.js` | 여러 PC 시험용 엔진 · 왕복 워커(로컬 개발 서버 전용) | 6단계 |
| `make-office.js` | `.docx` · `.hwpx` · `.pptx` · `.xlsx` · `.odt` · `.odp` · `.ods` 최소 문서와 거부 시험용 ZIP(머리 값을 속일 수 있음)을 시험이 직접 만듦 | 선택 동기화 9.5.5 |
| `make-hwp.js` | HWP 5.0 최소 문서(정상 · 암호 · 배포용 · 버전 4 · HWP 3.x 머리)를 만듦 | 선택 동기화 9.5.5 |
| `sample.hwp` | "PaperLab 시험 문서 가나다 ABC" 한 문단(3KB) | `node test/fixtures/make-hwp.js` 로 만듦 — 아래 |
| `sample.doc` | "PaperLab 시험 문서 가나다 ABC" 한 문단(Word 97-2003, 24KB) | 개발자 D가 2026-10-17 개발 PC의 Microsoft Word(Office 16)에서 새 문서로 저장(COM 자동화 `SaveAs2`, 형식 0 = `wdFormatDocument97`) |

## sample.hwp 를 스크립트로 만든 이유

명세는 한컴오피스에서 새로 저장한 견본을 원했지만, 개발 PC에는 저장할 수 없는 **한컴오피스 뷰어**만 있어(2026-10-17 확인) 한글 문서 형식 공개 문서(HWP 5.0 —
`FileHeader` 256바이트 · `DocInfo` · `BodyText/Section0`, 레코드 머리 = tag 10비트 · level 10비트 · size 12비트, 본문은 raw deflate)대로 가장 작은 문서를
`make-hwp.js` 가 짭니다(OLE 컨테이너는 `cfb` — hwp.js 의 의존성). 실제 한컴오피스로 저장한 파일과 같은 경로(`hwp.js` `parse`)로 읽히는 것은 시험이 확인하지만,
**한컴오피스가 저장한 실제 파일로 한 번 더 확인하는 것은 [수동] 남은 일**입니다(R-8 — 품질팀 또는 한컴오피스가 있는 PC에서 `sample.hwp` 를 바꿔 넣고 `npm test`).
배포용 · 암호 견본도 같은 스크립트가 시험 때 만듭니다(`hwp({distribution: true})` · `hwp({password: true})` — 커밋하지 않음).
