# 내보내기: 목차 · 그림 목차 · 표 목차 + 원고 각주

2026-10-17 · 제품 책임자 요청("기능들 전부 추가해줘") 중 ② 내보내기. 관련: [doc-formats.md](doc-formats.md)(양식 · 표지 · 쪽 번호),
[writing-figures-tables.md](writing-figures-tables.md)(그림 · 표 캡션 번호).

## 1. 범위

| 기능 | 워드 (.docx) | 한글 (.hwpx) | 마크다운 · 미리보기 |
|---|---|---|---|
| 목차 "목 차" | 진짜 TOC 필드 + 어림 쪽 번호 결과, 열 때 필드 업데이트 | 정적 목록(점선 탭 + 어림 쪽 번호) | 넣지 않음 |
| 그림 목차 · 표 목차 | TOC 필드 `\t "Figure Caption,1"` · `"Table Caption,1"` | 정적 목록 | 넣지 않음 |
| 원고 각주 `[^1]` · `[^1]: 내용` | `word/footnotes.xml` 실제 각주(있던 코드) | `hp:footNote` 실제 각주(있던 코드) | `[^n]` 그대로 · 미리보기 끝 목록 |
| [각주] 버튼 · Ctrl+Alt+F | — | — | 편집기 |

목록은 **표지 있는 양식**(cover.kind = thesis · report, 학교 양식과 그 복사본)에만 넣는다. 기본 (A4) 경로 · APA · 표지 '없음'에는 넣지 않는다.

## 2. 위치 · 모양 (인하대 제조혁신전문대학원 안내: 앞표지 → 속표지 → 인준서 → **목차** → 본문)

- 표지류 구역 바로 뒤, 첫 장 앞 부분(국문초록 등)보다 앞. 쪽 번호가 "첫 장부터"면 목록은 첫 장 앞 구역(쪽 번호 없음)에 함께 들어간다
  (구역 수는 그대로 — 원고가 첫 장으로 시작하면 목록만의 번호 없는 구역이 생긴다). "문서 처음부터"면 본문 구역 맨 앞.
- 순서: 목 차 → 그림 목차 → 표 목차, 각각 새 쪽. 마지막 목록 뒤 본문도 새 쪽. 항목이 없는 목록은 통째로 빠진다.
- 제목: 가운데, 제목 1수준 글자 모양(크기 · 굵게 · 글꼴), 뒤 12pt 이상. **제목 스타일(Heading 1)은 쓰지 않는다** — 워드가 목차를 다시 만들 때 '목 차'가 항목이 되지 않게.
- 항목: 본문 글자 · 줄간격, 왼쪽 정렬, 위아래 간격 0, 오른쪽 끝(본문 폭) 오른쪽 탭 + 점선 채움, 단계마다 2글자 들여쓰기.
- 목차 항목 = heading 1(`##` 장) · 2(`###` 절) + 참고문헌 제목(bib_heading). *목차에 항까지*를 켜면 heading 3(`####`)까지.
  제목 안 각주 번호는 빼고 글만. 그림 · 표 목차 항목 = 캡션 글 전체("그림 1. 실험 장치").

## 3. 쪽 번호 — 워드와 한글을 다르게 한 이유

- **워드**: `TOC \o "1-N" \h \z \u` 필드(제목 1~N수준 = 개요 수준), 그림 · 표 목차는 캡션 문단 스타일 *Figure Caption* · *Table Caption*을
  모으는 `TOC \h \z \t "스타일,1"`. 결과 칸에는 어림 쪽 번호로 채운 항목(스타일 `toc 1~3` · `table of figures`, 오른쪽 점선 탭)을 넣고,
  `settings.xml`에 `<w:updateFields w:val="true"/>`(CT_Settings 순서대로 `w:compat` 앞)를 넣어 **워드가 열 때 필드 업데이트를 묻게** 한다 — [예]면 워드의 실제 쪽 번호.
  LibreOffice · 한컴오피스는 이 설정을 따르지 않고 저장된 결과(어림값)를 보여 준다(LibreOffice 26.2로 확인).
- **한글**: python-hwpx 6.8의 `hwpx.tools.toc_author.add_native_toc`(한컴 실측 계약)를 검토했지만 쓰지 않았다.
  한컴은 `dirty=1` 차례를 열 때 다시 만들고, 이때 **개요 스타일 문단 + 바탕글(스타일 0) 문단을 모은다**(ContentsStyles:0 — python-hwpx 문서의 실측).
  이 내보내기는 모든 문단이 스타일 0 + 직접 문단 모양이라, 다시 만들면 본문 · 표지 줄이 차례 항목이 되고 장 · 절 제목은 빠진다.
  쪽 상호 참조(CROSSREF)도 대상이 개요 문단(TARGET_OUTLINE)인 실측뿐이라 일반 문단 대상은 확인할 길이 없다(이 PC에 한컴오피스 자동화 없음).
  그래서 **정적 목록**(한컴 차례와 같은 모양: `hp:t` 안 `hp:tab leader="3" type="2"` + 꼬리 글 쪽 번호, 문단 모양의 RIGHT 탭 · DASH 채움)으로 넣고,
  단계 들여쓰기는 문단 여백이 아니라 전각 공백(탭 위치가 들여쓰기와 무관하게 오른쪽 끝)으로 둔다. 쪽 번호는 어림값 — 내보낸 뒤 알림으로 안내한다.
- **어림 (doc_lists.estimate_pages)**: 양식 값(용지 · 여백 · 머리말/꼬리말 · 글자 크기 · 줄간격 · 문단 위아래 · 들여쓰기 · '새 쪽에서 시작')으로
  블록을 위에서부터 쌓는다. 줄 수는 영문 · 숫자는 단어 단위, 한글 · 한자는 글자 단위로 채운다(내보내는 한글 문단 = 영문 KEEP_WORD · 한글 BREAK_WORD,
  LibreOffice도 같음). 글자 폭 한글 1.0 · 영문 0.55 · 공백 0.3(글자 크기 배). 그림(96dpi, 본문 폭 · 높이 80%에 맞춤) + 캡션은 나누지 않고,
  제목은 다음 것(글은 첫 줄, 그림은 통째)과 함께 들어가야 하며, 각주는 그 쪽 아래를 차지(쪽마다 구분선 16pt), 저절로 넘어간 쪽 첫 문단의 '문단 위'는 0,
  표 칸 줄간격 130%까지 + 줄마다 1.5pt. 쪽 번호 있는 구역은 1쪽부터, 번호 없는 구역의 항목은 쪽 번호 없이(빈칸) 둔다.
- 확인(LibreOffice로 docx → PDF, `tests/test_export_lists.py::test_estimated_pages_match_libreoffice` · 개발 중 무작위 원고 16개):
  그림 · 각주 · 표 · 목록 · 인용문이 섞인 원고에서 항목의 대부분이 실제 쪽과 같고 어긋나도 ±1쪽. 글꼴이 없으면(휴먼명조 → 대체 글꼴) 더 어긋날 수 있다.

## 4. 원고 각주 (편집기 · 미리보기)

- 정의 줄: 줄 맨 앞(공백 3칸까지) `[^이름]: 내용`, 바로 아래 2칸 이상 들여쓴 줄은 이어지는 글. 같은 이름 두 번째 정의는 버린다.
- 본문 `[^이름]`마다 각주 하나(Pandoc처럼 같은 이름을 두 번 쓰면 같은 내용 각주 두 개), 번호는 본문 순서. 정의 없는 `[^이름]`은 글자 그대로.
  코드 블록 · `` `코드` `` · `\[^1]`은 각주가 아님. 각주 글 안의 `[^…]`은 글자 그대로(각주 안 각주 없음).
- 흐름(writing.js `buildDocument`): 인용 자리표시(`[@…]` → U+E100 n U+E101)를 **먼저** 매겨 인용 순번 = 원고 글 순서(인용 검증 marker_index와 같음),
  그다음 `writenotes.extractFootnotes`가 정의 줄을 빼고 `[^이름]` → U+E102 n U+E103. 블록 런에서 `{footnote: [런…]}`(각주 글은 marked 인라인 —
  굵게 · 기울임 · 인용 가능, 각주식 인용 스타일의 각주는 글로 펼침). 그 뒤는 각주식 인용과 같은 길(미리보기 `.doc-notes`, writer 각주, 마크다운 `[^n]`).
- 표 칸 · 캡션 안의 각주는 writer가 지금처럼 글자로 넣는다(바꾸지 않음).
- **[각주] 버튼 · Ctrl+Alt+F**(`writenotes.footnoteInsert`): 선택 끝에 `[^N]`(N = 원고의 숫자 이름 최댓값 + 1), 지금 장 · 절 끝(다음 `#` 제목 줄 앞,
  코드 블록 안 `#`은 제목 아님, 끝이 `[참고문헌]` 자리면 그 앞)의 마지막 글 줄 뒤에 빈 줄 + `[^N]: `(바로 앞이 정의 줄이면 빈 줄 없이),
  커서는 정의 줄 끝. 한 번의 편집(diffEdit)이라 Ctrl+Z 한 번. 코드 블록 · 정의 줄 안에서는 넣지 않고 알림.
  도구 막대는 `[표]` 뒤 한 줄(`data-footnote`, 글자 "각주"), 단축키 도움말(writeedit `shortcutHelp`)에 키 · 문법 줄.

## 5. 설정 (DB 바뀜 없음)

원고 `cover`(jsonb, 이미 있음)의 `include`에 키를 더했다 — 마이그레이션 없음.

| 키 | 기본 | 뜻 |
|---|---|---|
| `include.toc` | true | 목차 |
| `include.lof` | true | 그림 목차 |
| `include.lot` | true | 표 목차 |
| `include.toc_h4` | false | 목차에 항(`####`)까지 |

- 서버 `doc_formats.validate_cover`가 bool만 받는다(`cover.include.toc` 등 경로로 400). `cover_with_defaults` · 화면 `coverWithDefaults`가 기본값을 채운다.
- 화면: 표지 정보 창 *넣을 쪽*에 체크 4개(목차 · 그림 목차 · 표 목차 · 목차에 항까지) + 안내 한 줄.
- 내보낸 뒤 알림(formats.js `listsNotice`): 워드 "필드를 업데이트할지 물으면 [예]…", 한글 "목차 쪽 번호는 어림값이에요…", 모두 끄면 예전 안내.

## 6. 코드

| 파일 | 바뀐 것 |
|---|---|
| `paperlab/doc_lists.py` (새) | 항목 모으기 `entries` · 목록 블록 `build` · 쪽 어림 `estimate_pages` · `fill_pages` |
| `paperlab/writer.py` | `_render_formatted`가 목록을 넣고 쪽을 채움, `_FormattedBuilder.contents` · `entry_spec`, docx `list_title` · `list_entries`(TOC 필드) · 캡션 스타일 · `_docx_update_fields_on_open`, hwpx `list_title` · `list_entries` · 문단 모양 탭(`tab_right_mm`) |
| `paperlab/doc_formats.py` | `COVER_DEFAULTS.include` · `INCLUDE_KEYS` |
| `paperlab/static/js/writenotes.js` (새) | 각주 읽기 · 넣기 순수 함수 |
| `paperlab/static/js/writing.js` | 각주 자리표시 · 런, [각주] 버튼 한 줄 · Ctrl+Alt+F, 내보내기 알림, `stripWarn`이 각주 안 런도 정리 |
| `paperlab/static/js/formats.js` | 표지 정보 창 체크 · `listsNotice` |
| `paperlab/static/js/writeedit.js` | 단축키 도움말 줄 |

## 7. 수용 기준 (자동 확인)

`tests/test_export_lists.py` · `tests/js/writenotes.test.mjs` · 골든 `tests/golden/lists_docx.xml` · `lists_hwpx.xml`(목록 부분만, 다시 만들기: `PAPERLAB_UPDATE_GOLDEN=1`).

- 학위논문 docx: '목 차' · '그림 목차' · '표 목차' 순서, 항목 스타일 · 글 · 쪽 번호가 늘어나는 순서, 필드 begin/end 3쌍, 명령 글, 캡션 스타일, 제목은 Normal + 다음과 함께, 점선 탭 위치 = 본문 폭
- `updateFields`가 `w:compat` 앞, 목록을 끄면 없음
- 대체 보고서 구역: 구역 5개 그대로, 목록은 첫 장 앞 구역(쪽 번호 없음), 목록마다 새 쪽, 본문 1쪽부터
- 켜고 끄기 · 항까지 · 그림/표 없음 · 표지 없는 양식 · 기본 경로 · cover 없음(기본 켬)
- hwpx: 문서 검증 통과, 항목 글(전각 들여쓰기) · `hp:tab leader=3 type=2` · 쪽 번호 = 워드와 같은 어림값, 문단 모양 RIGHT · DASH 탭 위치 = 본문 폭, 각주 `hp:footNote`
- API: include 반영 · bool 아니면 400 · 마크다운엔 목록 없음 · 각주 유지
- LibreOffice가 있으면: 어림 쪽 = LibreOffice 쪽(모두 ±1, 80% 이상 같음)
- 각주(Node): 읽기 규칙 · 코드 안 · 이어지는 줄 · 없는 이름 · 넣기 자리(다음 제목 앞 · 정의 묶음 · 문서 끝 · [참고문헌] 앞 · 코드 블록 `#`) · 넣지 않는 곳 · 넣고 다시 읽기 · 도구 막대 한 줄 · 단축키 도움말

## 8. 하지 않은 것 · 남은 일

- 한컴 네이티브 차례(TABLEOFCONTENTS 필드) — 3장 이유. 제목 문단에 개요 스타일을 입히는 일과 함께 한컴에서 실측한 뒤 다시 본다.
- 목차 쪽 로마 숫자 쪽 번호(i, ii) — doc-formats Q4 답 대기.
- 미리보기에 목차 쪽 그리기 · 목차 제목 글자('목 차' 띄어쓰기) 설정.
- 표 칸 · 캡션 안 실제 각주.
