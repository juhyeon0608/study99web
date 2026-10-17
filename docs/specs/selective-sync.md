# 기능 명세 — 선택 동기화(폴더 · 파일별 켜고 끄기) + PC 동기화 문서 원본

- 작성: 설계(아키텍트) · 2026-10-17 (작업 트리 `D:\PaperLab\dev` — 6단계 커밋 `853c81e` 위 + **커밋 전 "서재 문서" 작업**(`paperlab/convert.py` · `server.prepare_upload` · `attach_from_incoming` · 마이그레이션 `20261016000001_source_files.sql` · `docs/specs/library-documents.md`) 기준)
- 상태: **설계 — 팀장 검토 대기**. 코드는 고치지 않았음(읽기만). 줄 번호는 위 작업 트리 기준.
- 근거: 제품 책임자 결정(2026-10-16/17 — 아래 P-1~P-8), [6단계 명세](phase6-folder-sync.md)(동기화 모델 · 저널 · 세 갈래 비교 · 안전 규칙 12장 · 워커 동기화 API 14.1절), [서재 문서 명세](library-documents.md)(원본 `sources/` · 변환본 `papers/`), [2단계 명세](phase2-worker-electron.md)(기기 토큰 · 워커 · preload 보안), PLAN "AI는 내 PC CLI 또는 내 API 키로만"(`jobs.AI_RUNNERS` — `paperlab/jobs.py:289`).
- 원칙: 6단계의 **"어떤 경우에도 파일이 소리 없이 사라지지 않음"**(6단계 12.1절)이 이 명세의 모든 규칙보다 앞섬. 기존 모듈 재사용, 마이그레이션은 **새 파일 하나 추가만**. 새 의존성은 **PC 앱의 로컬 본문 추출용 npm 2개만**(`hwp.js@0.0.3` · `word-extractor@1.0.4` — 팀장 결정 2026-10-17, 9.5절). 서버(pip) · 웹은 새 의존성 없음.
- 갱신: 2026-10-17 제품 책임자 답(Q-1~Q-5) · 팀장 결정(로컬 문서 본문은 PC 앱이 직접 추출 — LibreOffice 불필요) 반영 — 17장.
- 표기: **P-n** = 제품 책임자 결정(확정), **D-n** = 이 명세의 설계 결정(팀장 확인 필요), **Q-n** = 남은 질문, **확인됨** = 코드로 확인, **가정** = 상수 한 곳의 임시 값.

---

## 1. 목적

| 기능 | 사용자가 얻는 것 |
|---|---|
| 폴더 · 파일별 동기화 켜고 끄기 | PC 동기화 폴더 안의 폴더 · 파일마다 **"서버에도 저장(켬)"** 또는 **"이 PC에만(끔)"** 을 고릅니다. 끈 항목은 파일 · 본문이 그 PC에만 남고 서버에는 **정보만**(제목 · 저자 · 노트 · 하이라이트 · 태그 · 폴더 · 컬렉션) 올라갑니다. Supabase DB(500MB) · R2 공간을 아끼고 개인 파일을 PC에만 둘 수 있습니다. |
| 끈 항목 보기 | 다른 PC · 웹은 **"이 PC에만 있음 (집 PC)"** 으로 보이고 정보 · 노트는 쓸 수 있지만 읽기는 못 합니다. 파일을 가진 PC의 앱에서는 로컬 디스크에서 바로 엽니다(PDF · 사진은 앱 안 읽기 화면, 문서는 PC 기본 앱). 하이라이트는 지금처럼 서버에 저장됩니다. |
| 끈 항목의 AI | 그 PC의 내 CLI(Claude · Codex · Gemini) 워커가 **로컬 파일을 읽어서**만 실행합니다. 서버 API 키 AI · 서버 검색(본문) · 서재 질문은 끈 항목을 뺍니다. |
| 문서도 PC 동기화 | 워드 · 한글 · PPT · 엑셀 · 사진도 PC 폴더에서 맞춥니다. 켠 파일은 **원본**이 올라가고 서버가 PDF 변환본을 만들며(웹 업로드와 같은 경로), 다른 PC에는 **원본이 원래 이름 · 확장자 그대로** 내려갑니다. |

## 2. 결정과 원칙

### 2.1 제품 책임자 결정 (확정 2026-10-16/17)

| # | 내용 |
|---|---|
| P-1 | PC 앱의 동기화 서재에서 **폴더 · 파일 단위로 동기화 켜고 끄기**. |
| P-2 | **켬** = 지금 동작(R2에 파일 · `page_texts` 본문 · 검색 · 서버 AI · 웹/다른 PC에서 열기). **끔** = "정보만 서버에": 제목 · 저자 · 노트 · 하이라이트/주석 · 태그 · 폴더 · 컬렉션만 서버. **R2 객체 · `page_texts` · RAG 벡터 · 번역 없음**. |
| P-3 | 새 파일은 **들어 있는 폴더의 설정을 따름**, 최상위(루트)는 **켬**이 기본 → 아무것도 끄지 않으면 지금과 같음. |
| P-4 | 켠 항목을 끄면: (UI 확인 뒤) 서버의 R2 파일 · 원본 · 벡터 · 번역 · `page_texts`를 지우고 정보 · 주석은 남김, PC는 파일을 그대로 가짐. 끈 항목을 켜면: PC가 파일을 올리고 서버가 지금처럼 처리. |
| P-5 | 다른 PC · 웹은 끈 항목을 "이 PC에만 있음 (<PC 이름>)"으로 보임, 정보 · 노트는 보이고 읽기는 안 됨. 파일을 가진 PC는 앱 읽기 화면에서 로컬 디스크로 엶(PDF는 안전한 preload/IPC 다리로 바이트를 넘김). 로컬 전용 PDF의 하이라이트는 지금처럼 서버에(쪽 + 사각형). |
| P-6 | 끈 항목의 AI는 **그 PC의 내 CLI 워커가 로컬 파일을 읽어서만**. 서버 PC의 CLI는 절대 쓰지 않음. 서버 API 키 AI · 서버 검색은 끈 항목을 빼고 한국어로 분명히 안내. |
| P-7 | PC 폴더 동기화가 비PDF 문서(`convert.ACCEPT_EXTS`와 같은 목록)도 다룸. 켠 파일은 원본으로 올리고 서버가 변환(웹 업로드 경로 재사용: 원본 `sources/`, 변환본 `papers/`), 다른 PC에는 **원본**을 원래 이름 · 확장자로. 0.3.1 앱은 아무것도 망가뜨리거나 지우면 안 됨 — 새 기능에 0.4.0을 요구해도 됨(동기화 API 최소 버전 문). |
| P-8 | 켜고 끄기 화면: PC 앱(폴더 트리 · 파일 목록 메뉴, 폴더 스위치)과 웹 서재(웹은 요청만, 파일을 가진 PC가 동기화 피드로 실행). 상태 배지. |

### 2.2 설계 결정 (D-n — 팀장 확인 필요)

| # | 결정 | 이유 |
|---|---|---|
| D-1 | **설정은 서버 한 곳(논문 · 폴더 단위)이고 PC마다 다르지 않다.** 끈 논문은 **보관 PC(holder) 하나**만 가짐(`papers.local_device_id`). | PC마다 다르면 "같은 논문이 어떤 PC에는 있고 어떤 PC에는 없음"의 조합이 폭발하고, 서재 폴더 = PC 폴더 모양(6단계 6.1절)이 깨짐. "한 PC에만"이 P-2의 뜻. |
| D-2 | **끄기(켬→끔)는 두 단계**: 요청(`mode_pending = 'to_local'`) → 보관 PC가 **같은 해시의 파일을 가졌음을 확인(`mode.ack`)** → 그때 서버가 R2 · 본문을 지움. 서버가 먼저 지우지 않음. | 웹에서 끄는데 보관 PC의 사본이 없거나 다르면 서버 삭제 = 유일한 사본 손실. 6단계 12.1-3 "삭제는 명시적 신호로만"과 같은 결. |
| D-3 | **저장 위치가 바뀌는 때는 ① 명시적 켜고 끄기 ② 새 파일이 생길 때뿐.** 옮기기(PC · 웹) · 웹 업로드 · 되살리기는 저장 위치를 바꾸지 않고, 폴더 설정과 다르면 **"폴더 설정과 다름"** 표시 + [폴더 설정대로 맞추기]. | 탐색기에서 옮겼을 뿐인데 서버 파일이 지워지거나(끔 폴더로) 올라가는(켬 폴더로) 일이 없게 — 부작용이 큰 전환은 언제나 사람이 누름. |
| D-4 | 끄기가 끝나면 **보관 PC가 아닌 PC의 사본은 Windows 휴지통으로**(6단계 대량 삭제 기준 · 확인 창 그대로). 그 PC에서 고친 사본이면 지우지 않고 새 항목으로 올림. | "그 PC에만"(P-2)을 지키면서 6단계 U-2(PC 삭제 = Windows 휴지통)로 잃지 않음. |
| D-5 | 로컬 전용 항목 열기: **PDF · 사진 = 앱 읽기 화면(로컬 바이트)**, **워드 · 한글 · PPT · 엑셀 = PC 기본 앱으로 열기**(`shell.openPath`). 앱 안 변환은 하지 않음(PC에 LibreOffice를 요구하지 않음 — 확정 Q-3). | 한글 변환은 LibreOffice + H2Orestart + Java가 있어야 해 일반 PC에 거의 없음. 사용자의 Word/한컴이 가장 정확. 로컬 변환본에 하이라이트를 달면 서버 변환본이 없어 좌표 기준이 흔들림. 사진은 웹 CSP `img-src blob:`(`server.py:85` — 확인됨)로 앱 안에서 바로 보임. |
| D-6 | 로컬 AI 본문: 서버는 **본문 자리 표지(marker)만 든 프롬프트**를 만들고, 보관 PC의 워커가 로컬 파일에서 글을 뽑아 표지를 채움. PDF는 **앱에 함께 넣은 PDF.js**(서버 `paperlab/static/vendor/pdfjs` 복사본 — `copy-css.js`와 같은 빌드 복사)를 **숨은 샌드박스 창**에서, 문서는 D-14. | 본문이 서버를 지나가지도 않음(P-2 "본문은 그 PC에만"). 서버의 프롬프트 모양(`ai.tagged_text` · `fence`)은 그대로 쓰고 JS 쪽은 같은 `fence` 하나만 옮김. |
| D-14 | **로컬 문서 본문은 PC 앱이 직접 글만 뽑음(LibreOffice 없음 — 팀장 결정 2026-10-17, 확정 Q-3)**: `.docx` · `.hwpx` · `.pptx` · `.xlsx`(+ 같은 구조의 `.odt` · `.odp` · `.ods`)는 **직접 만든 ZIP · XML 읽기**(Node 내장 `zlib`만 — 압축 폭탄 · 크기 상한), 옛 `.hwp`는 **`hwp.js@0.0.3`**, 옛 `.doc`는 **`word-extractor@1.0.4`**. 옛 `.ppt` · `.xls` · `.rtf`는 **지원 안 함**(동기화를 켜라는 안내). 추출은 **경로를 모르는 별도 utilityProcess**에서 시간 · 메모리 · 크기 상한을 걸고(9.5절). | 사용자 PC에 아무것도 설치하게 하지 않음. OOXML · OWPML(hwpx) · ODF는 ZIP + XML이라 글만 뽑기는 수백 줄로 충분. 옛 바이너리 형식 중 사용자가 실제로 많이 가진 `.hwp` · `.doc`만 검증된 공개 라이브러리로, 나머지는 범위 밖. 라이선스 · 유지 상태는 9.5.4절. |
| D-7 | **0.3.1 차단**: 동기화 API가 요청 머리글 **`X-PaperLab-Sync: 2`** 를 요구, 없으면 **426 `update_required`**(`min_app_version: "0.4.0"`). 0.4.0 앱은 서버가 `sync/start` 응답에 `protocol: 2`를 주지 않으면(옛 서버) **v1 모드(PDF만 · 켜고 끄기 없음)** 로 동작. → **앱 먼저 배포, 서버 나중**(13장). | 0.3.1이 새 서버와 맞추면 로컬 전용 논문(`pdf_key = ''`)이 스냅숏에서 빠져 6.4절 마지막 줄(K-23 "서버에 아예 없음 → 다시 올림")로 **중복 논문을 만듦**(`reconcile.js:153-156`). 426은 0.3.1이 이미 안전하게 처리(`engine.js:550` — 30분 뒤 다시, `main.js:94` 업데이트 확인). 머리글 문은 `devices.app_version`(워커 `hello`가 쓰는 값)을 기다리지 않아 업데이트 직후에도 막히지 않음. |
| D-8 | **PC 파일 표현 = 원본이 있으면 원본**(이름 · 확장자 · 해시 모두 원본 기준). 이미 웹에서 올린 문서 항목(PC에 `원래 이름.pdf` 변환본으로 내려가 있던 것)은 백필 명령 뒤 원본으로 바뀌고, PC의 옛 변환본은 **Windows 휴지통**으로. | P-7. 원본 해시를 아는 행만 원본 표현으로 — 모르는 행은 변환본 표현 그대로(중간 상태에서도 피드가 일관). |
| D-9 | 같은 해시: **다른 PC가 보관하는 로컬 항목과 같은 파일**을 넣으면 연결하지 않고 문제 목록("다른 PC에만 두기로 한 파일과 같아요"). **보관 PC가 해지됐거나 없어졌으면 넘겨받음**(`adopted`). | 보관 PC 하나(D-1) 유지 + 재설치 · PC 교체 때 메타데이터를 살려 다시 연결하는 길. |
| D-10 | 웹에서 끄기: **보관 PC를 고름**(이 사용자의, 해지 안 됨, 동기화 켬, 프로토콜 2). 하나뿐이면 자동, 없으면 끌 수 없음. PC 앱 창에서 끄면 **이 PC**가 기본. | P-8 "웹은 요청, 파일을 가진 PC가 실행". |
| D-11 | 루트(폴더 없음 자리)는 **언제나 켬**(설정 없음). 끄려면 최상위 폴더마다 또는 파일마다. **확정(Q-4 — 이번 판에서 뺌)**. | P-3 기본값 그대로, 상속 계산 · 화면 단순. |
| D-12 | 끌 때 **AI 요약 · 대화 기록 · 선택 설명 기록(확정 Q-1)과 하이라이트의 글 `annotations.text`(확정 Q-2)는 지우지 않음**. 확인 창에 한 줄 안내. | P-4 "정보 · 주석은 남김" + 제품 책임자 답(2026-10-17). |
| D-13 | 끈 항목은 **선택 설명 · 번역 · 서재 질문(범위 질문) · 인용 검증 근거 · 무료 PDF 받기 · 웹 [파일 첨부/바꾸기]** 에서 빠짐(분명한 문구). 요약 · 논문 대화만 보관 PC CLI로. | 번역 결과 파일은 R2에 저장되는 구조라 P-2 위반, 설명 · 범위 질문 · 검증은 서버 `page_texts`/벡터가 전제. |

## 3. 범위

### 하는 것
1. 데이터: `papers` · `folders` · `sync_devices` · `jobs` 열 추가, 파일 이름 규칙 넓힘, 변경 로그 트리거 넓힘, `page_texts` 안전장치(6장).
2. 서버: 워커 동기화 API v2(프로토콜 문 · 원본 전송 · 로컬 항목 · 전환 실행), 사용자 API(켜고 끄기 · 미리보기 · 배지 필드), AI 경로(보관 PC 고정 CLI), 기존 경로의 로컬 항목 처리(7장).
3. PC 앱: 엔진(비PDF 대상 · 로컬 항목 · 전환 · 원본 표현), 로컬 파일 다리(preload/IPC), 로컬 AI 본문 추출(8 · 9장).
4. 화면: 웹 서재(배지 · 폴더/파일 메뉴 · 확인 창 · 읽기 화면 · AI 안내 · 연결된 PC), PC 앱 이 PC 상태 창(10장).

### 안 하는 것
| 항목 | 이유 · 나중에 |
|---|---|
| PC마다 다른 설정(같은 논문이 A에는 있고 B에는 없음 — 끈 것 말고) | D-1 |
| 보관 PC 옮기기(끈 항목을 다른 PC로 넘기기) | 켰다가(올림) 다시 끄며 다른 PC를 고르면 됨. 해지된 PC의 것은 넘겨받기(D-9) |
| 루트 전체 끄기 | D-11 · 확정 Q-4 |
| 로컬 문서(워드 · 한글 …)를 앱 안에서 읽기 · 하이라이트 | D-5 — 기본 앱으로 열기 |
| 로컬 항목 AI 중 옛 `.ppt` · `.xls` · `.rtf` 본문 읽기 | D-14 — 안내 문구로 [동기화 켜기] 또는 새 형식 저장을 권함 |
| 로컬 문서의 표 · 그림 · 각주 구조 보존 | 글만 뽑음(쪽 구분 없이 문단 · 슬라이드 · 시트 단위 — 9.5.2절) |
| PC에 LibreOffice 요구 · 사용 | 확정 Q-3 — 쓰지 않음 |
| 로컬 항목의 선택 설명 · 전체 번역 · 서재 질문 · 인용 검증 | D-13 |
| 로컬 항목의 서지 정보 자동 찾기(본문의 DOI 읽기) | 서버가 본문을 받지 않음. 제목 = 파일 이름, 유형 `document`. 사용자가 [정보 수정] · [온라인 정보로 채우기](DOI 입력)로. 후속: 보관 PC 워커가 첫 쪽에서 DOI만 뽑아 보내는 작업 |
| 0.3.1 앱이 새 서버와 계속 맞추기 | D-7 — 426으로 멈추고 자동 업데이트 |
| 옮기기로 저장 위치 자동 전환 | D-3 |

## 4. 지금 코드 (바뀌는 지점 · 재사용)

| 위치 (확인됨) | 지금 | 이 명세 |
|---|---|---|
| `supabase/migrations/20261015000001_folder_sync.sql:17-21` `papers_file_name_check` | `''` 또는 `\.[pP][dD][fF]$` | 새 마이그레이션이 같은 이름 제약을 **확장자 목록**으로 다시 만듦(6장) |
| 같은 파일 `:70-80` `sync_bump_paper` · `:82-91` `sync_bump_folder` | 관계 열 `(folder_id, file_name, pdf_key, pdf_sha256, deleted_at)` · `(name, parent_id)` | `create or replace`로 `source_sha256 · storage · local_device_id · mode_pending` · 폴더 `sync_mode` 추가 |
| `20261016000001_source_files.sql` | `source_key` · `source_name` · `source_size` — **원본 해시 열 없음** | `source_sha256` 추가(원본 표현의 해시) |
| `paperlab/db.py:87-93` `file_name_problem` | `.pdf`로 끝나야 함 | `convert.ACCEPT_EXTS` 중 하나로 끝남 |
| `db.py:110-141` `clean_file_name` · `numbered_name` · `copy_name` | `name[:-4]` · `name[-4:]`로 `.pdf`(4자) 가정 | 확장자를 `os.path.splitext`로 나눠 `.docx` · `.jpeg` 등도 |
| `db.py:532-549` `set_pdf` · `:551-556` `set_source` | PDF · 원본 키 기록 | `set_source`에 `sha256` 인자, 새 `demote_to_local` · `promote_to_cloud` · `mode_map` · `sync_view` |
| `db.py:352-367` `_paper_view` · `:51` `_HIDDEN_PAPER_COLS` | `has_pdf` · `has_source` | 응답에 `sync` 객체(10.1절), 새 내부 열은 숨김 목록에 |
| `db.py:887-901` `ensure_file_name` · `name_all_files` | `pdf_key <> ''`인 논문에만 이름 | 로컬 항목(`storage = 'local'`)도 이름 대상 |
| `paperlab/sync.py:37` `MIN_SYNC_VERSION = "0.3.0"` · `:311-329` `device_ctx` | `devices.app_version`로 426 | 머리글 `X-PaperLab-Sync: 2` 문 추가(D-7) |
| `sync.py:167-193` `_FEED` · `:245-279` `snapshot_page` · `:516-527` `lookup` | 논문은 `p.pdf_key <> ''`만, 해시 = `pdf_sha256` | 대상 = "PC 표현이 있는 논문"(5.5절), 해시 = 표현 해시, `storage` · `holder` · `pending` · `kind` 추가 |
| `sync.py:551-564` `download` | `pdf_key` 서명 GET | 원본 표현이면 `source_key` 서명 GET, 로컬이면 `local_only` |
| `sync.py:566-580` `read_upload` | `read_incoming(ctx, upload_id)` **이름 없이**(PDF만) → `pdf.extract(raw)` | 이름을 넘기고 `prepare_upload`(변환) 경유 — 해시 확인은 **변환 전 원본**으로(지금 순서 그대로) |
| `sync.py:607-651` `add_file` (`:621` `name[:-4]`) | 업로드 필수 · PDF | `storage: "local"` 경로(업로드 없음), 원본 보관, 제목 = 확장자 뗀 이름 |
| `sync.py:673-738` `content` · `conflict` | base/sha를 `pdf_sha256`과 비교, 사본은 PDF · `page_texts`만 복사 | 표현 해시로 비교, 로컬 항목은 메타데이터만 갱신, 사본은 원본도 복사 |
| `sync.py:860` `OPS` | `folder.*` · `file.move` · `file.delete` | `mode.ack` · `mode.fail` 추가, 새 경로 `files/{id}/promote` |
| `paperlab/server.py:501-517` `prepare_upload` | 원본 → `{incoming, name, size}` | `sha256`(원본 해시) 추가 |
| `server.py:519-551` `attach_from_incoming` (`:543` 이름을 `.pdf`로, `:544-547` 동기화면 원본 유지) | PC 파일 이름 = `원래 이름.pdf` | **원래 이름 그대로**(D-8), PC에서 온 내용은 언제나 표현대로 기록(5.5절) |
| `server.py:1002-1026` `read_incoming` (`:1021-1024`) | 이름이 없으면 PDF만 | 동기화가 이름을 넘김 — 같은 판정 재사용 |
| `server.py:1200-1220` `pdf_url` · `source_url` · `:1222-1246` `pdf/upload` · `pdf/complete` · `:1248` `fetch-pdf` | 키가 없으면 404 | 로컬 항목은 **409 `local_only`**(보관 PC 이름 포함), 보관 PC가 해지됐으면 첨부 허용 → 켬 |
| `server.py:815-828` `route_for` · `new_job`, `jobs.py:292-303` `build_route` · `:344-377` `create_job` · `:763-775` `claim_cli` | 경로 = 내 키(API) + 광고한 기기(CLI), 아무 기기나 잡음 | 로컬 항목은 **보관 PC의 CLI 칸만**, 작업에 `pinned_device_id`, 잡기 SQL이 고정 기기만 |
| `jobs.py:783-789` `paper_source` · `:811-834` `text_request` · `:837-875` `cli_task` | 서버가 `page_texts`로 프롬프트 | 로컬 항목은 표지 프롬프트 + `local` 필드(7.4절) |
| `paperlab/api_runner.py:184` `_run` · `:502-508` | API 칸 실행 | 로컬 항목이면 실행하지 않고 `local_only`로 실패(방어 — 경로에 API 칸이 없어 정상이면 오지 않음) |
| `paperlab/rag.py:607-629` `ensure_index_job` · `:580` | `pdf_key <> ''`만 색인 | 그대로(로컬은 `pdf_key = ''`라 자동 제외) — 시험으로 확인 |
| `server.py:921-926` `revoke_device` · `jobs.py:150-192` 기기 보기 | — | `local_count` · `local_bytes` · `sync.protocol` 추가, 해지 확인 문구 |
| `desktop/sync/paths.js:24-34` | `nameProblem({file})`가 `.pdf`만, `isPdfName` | 동기화 확장자 목록(`filekind.js`) |
| `desktop/sync/scanner.js:35` · `:52` · `:77-90` | `.pdf`만 걷고 `hashFile`이 `%PDF`만 봄 | 목록 확장자 전부, 첫 8바이트로 형식 판정 |
| `desktop/sync/reconcile.js:101-220` `planFiles` | 서버 논문 = 받을 수 있는 파일 | 로컬 항목 · 전환 · 표현 바뀜 줄 추가(8.3절) |
| `desktop/sync/engine.js:616-673` `fetchSnapshot` · `applyChange`(`:624` · `:665` `sha256` 없으면 지움) · `:725` `not_pdf` · `:1174` 보관함 이름 `(\.pdf)$` · `:1187-1279` 올리기 · `:1313-1380` 받기 | PDF 전제 | 새 필드 · 형식 판정 · 일반 확장자 · 로컬/전환 실행 |
| `desktop/sync/transfer.js:34` | 받기 키 접두어 `users/{uid}/papers/`만 | `users/{uid}/sources/`도 |
| `desktop/worker/api-client.js:19` | 머리글 `X-PaperLab: 1` | 동기화 호출에 `X-PaperLab-Sync: 2`(옵션 머리글), 긴 시간 제한 옵션 |
| `desktop/preload/preload.js:20-32` · `desktop/main/ipc.js:25-34` | 클라우드 화면 함수 7개, 프레임 출처 검사 | `localFile` · `openLocal` · `localHas` 추가(같은 출처 검사) |
| `desktop/main/window.js:15-16` `LOCAL_CSP` · `:28-35` `uiFile` | 평평한 `app://ui/이름.(html|js|css|svg)`만 | 추출 창용 `vendor/pdf.min.mjs` · `vendor/pdf.worker.min.mjs` 두 파일만 더(허용 목록) |
| `desktop/main/sync-host.js:37-58` `trashInRoot` · `:261` | 루트 안 · 링크 아님 검사(휴지통용), 폴더 열기 `.pdf` 가정 | 검사 부분을 `checkInRoot`로 떼어 로컬 열기 · 읽기에도 씀, 확장자 일반화 |
| `paperlab/static/js/reader.js:283-301` `loadPdf` | `pdf-url` 서명 주소 → 바이트 → PDF.js | 로컬 항목이면 `paperlabDesktop.localFile(pid)` 바이트 → 같은 PDF.js |
| `static/js/library.js:176-197` `paperRow` · `:329-482` `renderDetail` · `static/js/app.js:694-765` `renderFolders`(`:729-737` 폴더 메뉴) | PDF · 원본 배지, 메뉴 | 동기화 배지 · 켜고 끄기 메뉴 · 확인 창 |

---

## 5. 개념 · 상태 모델

### 5.1 용어

| 용어 | 어디에 | 값 | 뜻 |
|---|---|---|---|
| **설정** `sync_mode` | `papers` · `folders` | `inherit` · `cloud` · `local` | 사용자가 정한 것. `inherit` = 위 폴더를 따름(새 행 기본) |
| **실효 모드** | 계산 | `cloud` · `local` | 설정을 따라 올라가 처음 만나는 `inherit` 아닌 값, 끝까지 없으면 `cloud`(루트 — D-11) |
| **저장 위치** `storage` | `papers` | `cloud` · `local` | 실제 상태. `cloud` + `pdf_key = ''` = 지금의 "파일 없는 논문"(검색으로 넣은 서지 등) |
| **보관 PC** `local_device_id` | `papers` | 기기 id · null | `local`의 파일을 가진 PC(끄는 중이면 가질 PC) |
| **전환 대기** `mode_pending` | `papers` | `''` · `to_local` · `to_cloud` | 5.3절 |
| **PC 표현** | 계산 | `pdf` · `source` · `local` · 없음 | PC 파일이 무엇인가(5.5절) |
| **폴더 설정과 다름** | 계산 | bool | 실효 모드 ≠ 저장 위치(파일이 있는 논문, 전환 대기 아님) — D-3 |

### 5.2 실효 모드 계산 (상속)

```
effective(paper) = paper.sync_mode                      if paper.sync_mode != 'inherit'
                 = folder_effective(paper.folder_id)     otherwise
folder_effective(null) = 'cloud'                         -- 루트 (D-11)
folder_effective(f)    = f.sync_mode if f.sync_mode != 'inherit' else folder_effective(f.parent_id)
```
- 서버: `Library.mode_map() -> {folder_id: 'cloud'|'local'}`(폴더 전체를 한 질의로 읽어 계산 — 폴더 수는 수백 개 이하), 논문은 위 식. 순환은 6단계 폴더 규칙상 없지만 방문 집합으로 막음.
- PC 엔진: 스냅숏 · 피드의 폴더 `sync_mode`로 같은 계산(`reconcile.effectiveMode(S, folderId)`) — **새 파일을 올릴지 정할 때만** 씀. 서버가 다시 판정(7.1절 `files/add`).

### 5.3 전환 상태 기계

```
                 [켜기 요청] (sync_mode → cloud 또는 inherit+폴더 켬)
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              ▼
 cloud ── [끄기 요청] ──▶ cloud + to_local(holder=H) ── H의 mode.ack(해시 일치) ──▶ local(holder=H)
   ▲            ▲                 │  [켜기 요청] = 대기 취소(cloud 그대로)                │
   │            └─────────────────┘                                                   │
   │                                                                                  │
   └── H의 promote(업로드 · 변환 · 추출) ◀── local + to_cloud ◀── [켜기 요청] ─────────┘
                                              │  [끄기 요청] = 대기 취소(local 그대로)
```
- **끄기 (to_local)**: 요청 트랜잭션은 `mode_pending = 'to_local'`, `local_device_id = H`, `mode_requested_at/by`만 씀. **R2 · 본문은 그대로**(아직 켬). H의 엔진이 피드로 받고 자기 파일 해시가 서버 표현 해시와 같으면 `mode.ack` → 서버가 한 트랜잭션에서 `demote_to_local`(6.3절) → 커밋 뒤 R2 PDF · 원본 · 벡터 · 번역 파일 삭제. 해시가 다르면(그 사이 다른 PC가 내용을 바꿈) 엔진은 먼저 받기(6단계 흐름)로 맞춘 뒤 다시 확인.
- **켜기 (to_cloud)**: 요청은 `mode_pending = 'to_cloud'`만. H의 엔진이 업로드 자리를 받아 올리고 `files/{id}/promote` → 서버가 웹 업로드와 같은 처리(변환 · 추출 · `page_texts` · 색인 작업) → `storage = 'cloud'`, `local_device_id = null`. 다른 PC는 피드로 새 파일을 받음.
- **반대 방향 요청은 대기를 취소**(아무것도 지우거나 올리지 않음). 같은 방향 다시 요청은 그대로(보관 PC를 바꾸는 요청은 `to_local` 대기 중에만 받음).
- **대기에 시간 제한 없음**: H가 꺼져 있으면 기다림. 화면은 "끄는 중 — ‘집 PC’가 켜지면 마쳐요" · [취소]. H가 확인하지 못하면(파일 없음 등) `mode.fail`로 이유를 남김(`mode_error` — 화면 표시, 대기는 유지).
- 휴지통으로 가도 `mode_pending`은 남음(되살리면 이어짐). 영구 삭제면 행과 함께 사라짐.

### 5.4 저장 위치가 바뀌는 때 (D-3)

| 사건 | 저장 위치 | 비고 |
|---|---|---|
| 파일 · 폴더 [동기화 끄기/켜기] · [위 폴더 설정 따르기] | 영향받는 논문마다 5.3절 전환 | 폴더 설정을 바꾸면 그 아래 **설정이 `inherit`인 논문**만. 파일마다 따로 정한 것은 그대로(확인 창의 "하위 항목도 이 설정으로" 를 고르면 그 아래 설정을 모두 `inherit`로 되돌린 뒤 계산) |
| PC에 새 파일(`files/add`) | 그 위치의 실효 모드 | 끔 폴더면 업로드 없이 로컬 항목, 보관 PC = 그 PC |
| 웹 업로드 · [파일 첨부] · 무료 PDF 받기 | 언제나 `cloud` | 끔 폴더에 올리면 "폴더 설정과 다름" + 토스트 "‘개인’ 폴더는 PC에만 두는 폴더예요. 웹에서 올린 파일은 서버에 저장했어요 — [PC에만 두기…]" |
| 옮기기(PC `file.move` · 웹 이동 · 폴더 이동 · 폴더 삭제의 부모 올리기) | 그대로 | 실효 모드가 달라지면 "폴더 설정과 다름". 웹 이동 토스트에 [폴더 설정대로 맞추기] |
| 휴지통 · 되살리기 | 그대로 | 6단계 그대로 |
| 충돌 사본(6단계 10장) | 원래 논문과 같은 저장 위치(켬 항목만 충돌이 생김) | |

### 5.5 PC 표현 (D-8 — 피드 · 스냅숏 · 받기의 기준)

| 조건 (위에서부터) | 표현 `kind` | PC 파일 이름 | 해시 `sha256` | 크기 `size` | 받는 R2 객체 |
|---|---|---|---|---|---|
| `storage = 'local'` | `local` | `file_name` | `coalesce(nullif(source_sha256,''), pdf_sha256)` | `source_size` 또는 `pdf_size` | 없음(보관 PC에만) |
| `source_key <> ''` 그리고 `source_sha256 <> ''` | `source` | `file_name`(원래 확장자) | `source_sha256` | `source_size` | `source_key` |
| `pdf_key <> ''` | `pdf` | `file_name`(`.pdf`) | `pdf_sha256` | `pdf_size` | `pdf_key` |
| 그 밖 | 없음 — 동기화 대상 아님 | | | | |

- 로컬 PDF 항목은 `pdf_sha256` · `pdf_size`에 PC 파일 값(`pdf_key = ''`), 로컬 문서 · 사진 항목은 `source_sha256` · `source_size` · `source_name`에 PC 파일 값(`source_key = ''`). 그래서 **표현 해시 = `coalesce(nullif(source_sha256,''), pdf_sha256)`** 한 식으로 모든 경우를 덮음.
- **PC에서 온 파일은 이름의 확장자가 `.pdf`가 아니면 언제나 원본으로 보관**(내용이 PDF여도 — 받는 PC가 똑같은 바이트를 받게). `.pdf` 이름인데 PDF가 아니면 지금처럼 `bad_pdf`.
- `source_sha256 = ''`인 옛 원본 행(서재 문서 기능이 이 명세보다 먼저 운영에 나간 경우)은 백필 전까지 `pdf` 표현 그대로 → 백필 명령(7.3절)이 해시를 채우며 `file_name`을 원래 확장자로 바꿈 → 트리거가 피드에 올림 → PC는 8.3절 "표현 바뀜"으로 원본을 받고 옛 변환본은 Windows 휴지통.

---

## 6. 데이터 — 마이그레이션 `supabase/migrations/20261017000001_selective_sync.sql` (새 파일)

1단계 규칙 그대로(`paperlab` 스키마 · 공통 `user_id` + 복합 외래 키 · 다시 돌려도 안전). 기존 파일은 고치지 않음 — 6단계 트리거 함수는 이 파일에서 `create or replace`로 넓힘(6단계 마이그레이션이 같은 방식으로 제약을 다시 만들었음).

```sql
-- 선택 동기화(폴더 · 파일별 켜고 끄기) + PC 동기화 문서 원본 (docs/specs/selective-sync.md 6장).
-- 추가만 한다 — 새 열은 기존 행에 안전한 기본값('inherit' · 'cloud' · '' · null). 다시 돌려도 안전.

-- ------------------------------------------------------------------ papers
alter table paperlab.papers
    add column if not exists sync_mode text not null default 'inherit',
    add column if not exists storage text not null default 'cloud',
    add column if not exists local_device_id bigint,
    add column if not exists mode_pending text not null default '',
    add column if not exists mode_requested_at timestamptz,
    add column if not exists mode_requested_by text not null default '',
    add column if not exists mode_error text not null default '',
    add column if not exists source_sha256 text not null default '';

alter table paperlab.papers drop constraint if exists papers_sync_mode_check;
alter table paperlab.papers add constraint papers_sync_mode_check check (sync_mode in ('inherit', 'cloud', 'local'));
alter table paperlab.papers drop constraint if exists papers_storage_check;
alter table paperlab.papers add constraint papers_storage_check check (storage in ('cloud', 'local'));
-- 로컬 항목은 R2 키 · 벡터가 없다 (P-2 — 코드가 빠뜨려도 DB가 막음)
alter table paperlab.papers drop constraint if exists papers_local_no_keys_check;
alter table paperlab.papers add constraint papers_local_no_keys_check check (
    storage = 'cloud' or (pdf_key = '' and source_key = '' and rag_key = ''));
alter table paperlab.papers drop constraint if exists papers_mode_pending_check;
alter table paperlab.papers add constraint papers_mode_pending_check check (
    mode_pending = '' or (mode_pending = 'to_local' and storage = 'cloud') or (mode_pending = 'to_cloud' and storage = 'local'));
alter table paperlab.papers drop constraint if exists papers_mode_requested_by_check;
alter table paperlab.papers add constraint papers_mode_requested_by_check check (mode_requested_by ~ '^(|web|device:[1-9][0-9]{0,18})$');
alter table paperlab.papers drop constraint if exists papers_mode_error_check;
alter table paperlab.papers add constraint papers_mode_error_check check (char_length(mode_error) <= 40 and mode_error ~ '^[a-z_]*$');
alter table paperlab.papers drop constraint if exists papers_source_sha256_check;
alter table paperlab.papers add constraint papers_source_sha256_check check (source_sha256 ~ '^([0-9a-f]{64})?$');
alter table paperlab.papers drop constraint if exists papers_local_device_fk;
alter table paperlab.papers add constraint papers_local_device_fk foreign key (local_device_id, user_id)
    references paperlab.devices (id, user_id) on delete set null (local_device_id);

-- PC 파일 이름: 6단계 규칙 + 확장자 목록(convert.ACCEPT_EXTS와 같음 — tests/test_selective_sync_contract.py가 맞춰 봄)
alter table paperlab.papers drop constraint if exists papers_file_name_check;
alter table paperlab.papers add constraint papers_file_name_check check (
    file_name = '' or (char_length(file_name) <= 200 and file_name !~ '[/\\:*?"<>|[:cntrl:]]'
                       and file_name ~* '\.(pdf|doc|docx|hwp|hwpx|ppt|pptx|xls|xlsx|odt|odp|ods|rtf|jpg|jpeg|png|gif|bmp|tif|tiff|webp)$'));

create index if not exists papers_user_local on paperlab.papers (user_id, local_device_id) where storage = 'local';
create index if not exists papers_user_pending on paperlab.papers (user_id) where mode_pending <> '';
create index if not exists papers_user_source_sha on paperlab.papers (user_id, source_sha256) where source_sha256 <> '';

-- ----------------------------------------------------------------- folders
alter table paperlab.folders add column if not exists sync_mode text not null default 'inherit';
alter table paperlab.folders drop constraint if exists folders_sync_mode_check;
alter table paperlab.folders add constraint folders_sync_mode_check check (sync_mode in ('inherit', 'cloud', 'local'));

-- ------------------------------------------------------------ sync_devices · jobs
alter table paperlab.sync_devices add column if not exists protocol smallint not null default 1;
alter table paperlab.sync_devices drop constraint if exists sync_devices_protocol_check;
alter table paperlab.sync_devices add constraint sync_devices_protocol_check check (protocol between 1 and 99);

-- 로컬 항목 AI(P-6): 그 작업은 보관 PC만 잡는다
alter table paperlab.jobs add column if not exists pinned_device_id bigint;
alter table paperlab.jobs drop constraint if exists jobs_pinned_device_fk;
alter table paperlab.jobs add constraint jobs_pinned_device_fk foreign key (pinned_device_id, user_id)
    references paperlab.devices (id, user_id) on delete set null (pinned_device_id);

-- ------------------------------------------------------------ 변경 로그 트리거 넓히기 (6단계 6.2절)
create or replace function paperlab.sync_bump_paper() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.folder_id, new.file_name, new.pdf_key, new.pdf_sha256, new.source_sha256, new.deleted_at,
                          new.storage, new.local_device_id, new.mode_pending)
       is distinct from (old.folder_id, old.file_name, old.pdf_key, old.pdf_sha256, old.source_sha256, old.deleted_at,
                         old.storage, old.local_device_id, old.mode_pending) then
    new.sync_rev := pg_catalog.nextval('paperlab.sync_rev_seq');
    new.sync_xid := pg_catalog.pg_current_xact_id();
  end if;
  return new;
end
$$;

create or replace function paperlab.sync_bump_folder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.name, new.parent_id, new.sync_mode) is distinct from (old.name, old.parent_id, old.sync_mode) then
    new.sync_rev := pg_catalog.nextval('paperlab.sync_rev_seq');
    new.sync_xid := pg_catalog.pg_current_xact_id();
  end if;
  return new;
end
$$;
revoke execute on function paperlab.sync_bump_paper(), paperlab.sync_bump_folder() from public, anon, authenticated;

-- ------------------------------------------------------------ 이중 방어: 로컬 항목에는 본문을 쓰지 않는다 (P-2)
create or replace function paperlab.page_texts_local_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from paperlab.papers p where p.id = new.paper_id and p.storage = 'local') then
    raise exception 'local-only paper has no page text' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function paperlab.page_texts_local_guard() from public, anon, authenticated;
drop trigger if exists local_guard on paperlab.page_texts;
create trigger local_guard before insert on paperlab.page_texts
    for each row execute function paperlab.page_texts_local_guard();
```

- 메모: `sync_mode`(논문 설정)는 트리거 관계 열에 넣지 않음 — 엔진에는 실효 모드 변화가 `mode_pending`으로 오고, 논문 설정만 바뀌는 일(이미 같은 저장 위치)은 PC가 할 일이 없음(피드 줄이기, 6단계 AC-604 취지).
- `page_texts_local_guard`는 invoker 권한(사용자 RLS로 `papers`를 읽음 — 자기 논문만). 휴지통 논문은 RLS로 안 보여 검사를 통과하지만 휴지통 논문 하위 표 `insert`는 이미 6단계 `hide_trashed_children`가 42501로 막음.
- 데이터 이동은 SQL에 넣지 않음: `source_sha256` · 원래 확장자 이름은 **관리 명령**(7.3절 `admin sync-originals`)이 R2 원본을 읽어 채움(해시는 바이트가 있어야 계산 가능).
- 예상 크기: 논문당 열 몇 개(수십 바이트). 로컬 항목은 `page_texts` · PGroonga 색인이 없어 **편당 약 0.26MB → 수 KB**(6단계 17장 K-46 실측 기준) — 이 기능의 목적.

---

## 7. 서버 API

### 7.1 워커 동기화 API v2 — `/api/worker/sync/*` (기기 토큰)

**프로토콜 문(D-7)** — `sync.device_ctx`(`sync.py:311-329`)에서 기기 확인 뒤:
- 머리글 `X-PaperLab-Sync`가 정수 2 이상이 아니면 **426** `{"detail": "폴더 동기화를 쓰려면 PaperLab 앱을 0.4.0 이상으로 업데이트해 주세요", "code": "update_required", "min_app_version": "0.4.0", "min_sync_protocol": 2}`.
- 문은 **머리글만** 봄. `MIN_SYNC_VERSION`은 `"0.3.0"` 그대로(`devices.app_version`이 알려진 값이고 0.3.0보다 낮으면 같은 426 — 지금과 같은 바닥). 0.4.0으로 올리지 않는 이유: 업데이트 직후 동기화 엔진의 `start`가 워커 `hello`(= `app_version` 0.4.0 기록)보다 먼저 올 수 있어, 0.4.0으로 막으면 갓 업데이트한 PC가 30분 동안 멈춤 — D-7 "머리글 문은 `app_version`을 기다리지 않음"과 맞지 않음(구현 보고 C-1 차이, 팀장 승인 대상). 426 본문의 `min_app_version`은 `"0.4.0"`.
- 모든 성공 응답에 지금처럼 `server_time`. 오류 본문 모양 그대로.

**바뀌는 응답 · 요청**

| 경로 | 바뀌는 것 |
|---|---|
| `POST …/sync/start` | 응답에 **`protocol: 2`**, `limits.max_file_bytes`(100MB 그대로), **`exts`**(동기화 확장자 목록 = `convert.ACCEPT_EXTS`), **`device_id`**. `sync_devices.protocol = 2` 기록(`status`도 같은 머리글이면 기록) |
| `POST …/sync/snapshot` | 폴더 항목 `{id, name, parent_id, **sync_mode**}`. 논문 항목 = **5.5절 표현이 있는 살아 있는 논문 전부**(로컬 항목 포함): `{id, folder_id, file_name, sha256(표현 해시), size, content_at, **kind**: "pdf"\|"source"\|"local", **storage**: "cloud"\|"local", **holder**: 기기 id\|null, **holder_gone**: bool(보관 PC 해지 · 없어짐), **pending**: ""\|"to_local"\|"to_cloud"}`. `trashed` 항목의 `sha256`도 표현 해시. 첫 쪽에 **`local_budget`** 없음(로컬은 R2 · 사용자 상한을 쓰지 않음) — `upload_budget_*`는 그대로(켬 파일만 셈). 첫 쪽에서 `name_all_files`가 로컬 항목도 이름을 정함 |
| `POST …/sync/changes` | 폴더 `upsert`의 `data`에 `sync_mode`, 논문 `upsert`의 `data`는 스냅숏 논문 항목과 같은 모양. 대상 조건 `p.pdf_key <> ''`(`sync.py:183`) → **`(p.pdf_key <> '' or p.storage = 'local')`**, 해시 열 → 표현 해시. `trash` `data.sha256`도 표현 해시 |
| `POST …/sync/lookup` | 대상 · 해시를 표현 기준으로(`pdf_sha256 = any(...)` → `coalesce(nullif(source_sha256,''), pdf_sha256) = any(...)` + 위 대상 조건). 항목에 `storage` · `holder` · `holder_gone` |
| `POST …/sync/download` | 항목 `{id, url, expires_at, sha256, size, **kind**: "pdf"\|"source"}` — `source`면 `source_key` 서명 GET. 로컬 항목은 `{id, status: 409, code: "local_only"}`(그 항목만 실패) |
| `POST …/sync/files/add` | 요청에 **`storage`**: `"cloud"`(기본 — 업로드 필수) · `"local"`(업로드 없음, `upload_id`를 주면 400). `file_name`은 확장자 목록 규칙. 처리 순서: ① 같은 표현 해시가 있으면 아래 "해시 일치 표" ② 서버가 그 위치의 실효 모드를 계산 — 요청이 `local`인데 실효가 `cloud`면 **409 `upload_required`**(앱은 올려서 다시), 요청이 `cloud`(올림)인데 실효가 `local`이면 **올린 임시 파일을 지우고 로컬 항목으로 만듦**(응답 `paper.storage = "local"`) ③ 켬: 지금 경로 + **원본이면 변환**(`prepare_upload`) ④ 끔: `add_paper({title: 확장자 뗀 이름, item_type: "document"})` → `place_paper` → `storage = 'local'`, `local_device_id = 이 기기`, 해시 · 크기 · `content_at` 기록(PDF면 `pdf_*`, 아니면 `source_*` + `source_name`) — **용량 검사 없음, DB 검사(`db_full`)는 편당 로컬 추정치(가정 8KB)로** |
| `POST …/sync/files/{id}/content` | `base_sha256` · 비교를 **표현 해시**로. 원본 표현이면 새 원본을 변환해 PDF · 원본 둘 다 교체(옛 원본은 커밋 뒤 삭제). **로컬 항목**: 보관 PC만(아니면 409 `not_holder`), `upload_id` 없이 `{op_id, base_sha256, sha256, size, mtime_ms, clock_offset_ms}` → 해시 · 크기 · `content_at`만 갱신 → `replaced`(충돌 없음 — 보관 PC 하나). `to_local` 대기 중인 켬 항목에 내용이 오면 지금 규칙대로 교체(보관 PC는 바뀐 해시로 다시 확인) |

**`files/add` 해시 일치 표** (같은 표현 해시의 논문이 있을 때 — 살아 있는 것 · 작은 id 먼저, `sync.py:154-158` 그대로)

| 찾은 논문 | 결과 |
|---|---|
| 살아 있는 켬 논문 | 지금 그대로 `linked`(위치가 다르면 나중 것 위치로 — 저장 위치는 그대로, D-3) |
| 살아 있는 로컬 논문, 보관 PC = 이 기기 | `linked`(Windows 휴지통에서 되살린 파일 · 동기화를 다시 켬) |
| 살아 있는 로컬 논문, 보관 PC가 **해지됨 · 없음** | **`adopted`** — `local_device_id = 이 기기`, 위치는 보낸 곳(겹치면 K-8). `to_cloud` 대기였으면 대기 유지(이 기기가 이어서 올림) |
| 살아 있는 로컬 논문, 보관 PC = **다른 활성 기기** | **`{result: "local_elsewhere", paper, holder_name}`**(멱등 기록 안 함 — 나중에 다시 보내면 다른 결과일 수 있음). 엔진은 연결하지 않고 문제 목록(D-9) |
| 휴지통 논문 | 지금 그대로 `restored`(K-32). 로컬 항목이면 보관 PC = 이 기기 |

**새 경로 · 작업**

| 경로 | 요청 | 응답 · 규칙 |
|---|---|---|
| `POST …/sync/files/{id}/promote` | `{op_id, upload_id, sha256, size, mtime_ms, clock_offset_ms}` | 켜기 실행(5.3절). 조건: `storage = 'local'` · 보관 PC = 이 기기 · `mode_pending = 'to_cloud'`(아니면 409 `not_pending`) · `sha256` = 서버 표현 해시(아니면 409 `changed` + `paper` — 앱은 `content`로 먼저 맞춤). 처리: `read_incoming(name=file_name)` → `prepare_upload` → 용량 검사(`storage_full` · `sync_quota` · **`db_full`** — 본문이 늘어나므로 새 논문과 같은 기준) → `promote_to_cloud`(아래) + `attach_from_incoming`(원본이면 `source`) → `{result: "promoted", paper}`. 멱등(`op_id`). `files/add`와 같은 사용자당 동시 1(429 `sync_busy`) |
| `ops` `mode.ack` | `{op_id, type: "mode.ack", id, sha256}` | 끄기 실행. 조건: `mode_pending = 'to_local'` · 보관 PC = 이 기기 · 휴지통 아님(아니면 `{ok: false, result: "not_pending"}`), `sha256` = 표현 해시(아니면 `{ok: false, result: "changed", paper}`). 처리: `demote_paper(ctx, pid)`(아래) → `{result: "applied", paper}` |
| `ops` `mode.fail` | `{op_id, type: "mode.fail", id, reason}` — `reason` ∈ `missing` · `changed_here` · `too_long` · `unreadable` | 보관 PC가 끄기를 확인할 수 없음 → `mode_error = reason`(대기 유지 — 화면이 이유와 [취소]를 보임). 다음 `mode.ack`가 성공하면 비움 |

**서버 도우미 (sync.register의 `H`에 추가 — `server.py:3044-3049`)**

- `demote_paper(ctx, pid) -> None` — 한 트랜잭션: 행 잠금(`for update`) → `Library.demote_to_local(pid)`이 옛 키 `{pdf_key, source_key, rag_key, tr_key}`를 돌려주고 `update papers set storage='local', pdf_key='', source_key='', rag_key='', rag_version='', mode_pending='', mode_error='' …`, `delete from page_texts where paper_id = …`, 번역 행 삭제(`translate.delete_row`), 그 논문의 `queued` 작업 중 `translate_paper` · `explain` · `translate`(선택 번역) · `index` 및 **API 칸 작업**을 `cancelled`(`error_code = 'local_only'`). `pdf_sha256` · `pdf_size` · `source_sha256` · `source_size` · `source_name`은 **그대로**(PC 파일 기술값으로 남음 — 5.5절). 커밋 뒤: R2 `pdf_key` · `source_key` · 번역 파일 삭제(`delete_quietly`), `rg.forget(uid, pid, rag_key)`. `paper_search.meta`(제목 · 노트 · 주석 메모 — 메타데이터 검색)는 그대로.
- `promote_to_cloud`: `storage='cloud'`, `local_device_id=null`, `mode_pending=''` 뒤 `attach_from_incoming`이 키 · 본문 · 색인 작업을 씀(체크 제약 순서상 storage를 먼저 `cloud`로).
- `Library.mode_map()`, `Library.effective_mode(paper_row, mode_map)`, `Library.sync_view(row, mode_map) -> dict`(10.1절 `sync` 객체), `Library.set_sync_mode(ids|folder, mode, holder, reset_children) -> 전환 목록`(7.2절이 부름).

**오류 코드 추가**(6단계 14.1절 표에 더함)

| 상태 | `code` | 언제 | 추가 필드 |
|---|---|---|---|
| 409 | `upload_required` | `files/add` `storage: "local"`인데 서버 실효 모드가 켬 | `paper_folder_mode: "cloud"` |
| 409 | `local_only` | 로컬 항목의 `download` 항목 · 받을 수 없는 요청 | `holder_name` |
| 409 | `not_holder` | 보관 PC가 아닌 기기가 로컬 항목의 `content` · `promote` | |
| 409 | `not_pending` | `promote`인데 `to_cloud` 대기가 아님 | |
| 409 | `changed` | `promote`의 해시가 서버 표현과 다름 | `paper` |
| 400 | `bad_format` | 확장자와 내용이 맞지 않음(`convert.kind`가 빈 값) · 받지 않는 형식 | |
| 400 | `convert_failed` · `no_converter` | 서버 변환 실패 · 서버에 LibreOffice 없음(`convert.ConvertError` 문구 그대로 `detail`) | |
| 426 | `update_required` | 머리글 `X-PaperLab-Sync` < 2 · 앱 0.4.0 미만 | `min_app_version`, `min_sync_protocol` |

### 7.2 사용자 API (Supabase JWT — 웹 화면 · PC 앱 창의 웹 화면)

| 경로 | 요청 | 응답 · 규칙 |
|---|---|---|
| `POST /api/papers/sync-mode` | `{ids: [1~200], mode: "cloud"\|"local"\|"inherit", holder_device_id?: int, dry_run?: bool}` | 아래 "켜고 끄기 응답". `ids`는 내 살아 있는 논문만(`paper_ids`), 남의 · 휴지통 id는 `blocked` |
| `POST /api/folders/{fid}/sync-mode` | `{mode: "cloud"\|"local"\|"inherit", reset_children?: bool, holder_device_id?: int, dry_run?: bool}` | 폴더 설정을 바꾸고 그 아래(하위 폴더 포함) 설정이 `inherit`인 논문(`reset_children`이면 아래 모든 논문 · 폴더 설정을 `inherit`로 먼저)의 실효 모드를 다시 계산해 전환. 없는 폴더 404 |
| `GET /api/sync/holders` | — | `{holders: [{id, name, online, last_seen_at, this_device?: false}]}` — 끌 때 고를 수 있는 PC(해지 안 됨 · `sync_devices.enabled` · `protocol >= 2`) |

**켜고 끄기 응답** (`dry_run`이면 바꾸지 않고 같은 모양을 돌려줌 — 확인 창이 숫자를 보임)

```json
{
  "dry_run": true,
  "to_local": 12, "to_cloud": 0, "cancelled": 1, "unchanged": 3, "no_file": 2,
  "freed_bytes": 48211234,
  "holder": {"id": 7, "name": "집 PC"},
  "other_pcs": [{"id": 9, "name": "연구실 PC", "files": 12}],
  "blocked": [{"id": 42, "code": "trashed"}]
}
```
- `to_local`: 이번에 `to_local` 대기가 될 편수(이미 로컬인 것은 `unchanged`). `to_cloud`: `to_cloud` 대기. `cancelled`: 반대 방향 대기를 취소한 편수. `no_file`: 파일 없는 논문(설정만 바뀜). `freed_bytes`: 끄면 서버에서 지워질 R2 크기(PDF + 원본). `other_pcs`: 끄면 사본이 Windows 휴지통으로 갈 PC와 개수(동기화 켠 다른 PC — D-4).
- `blocked` 코드: `trashed` · `not_found`(논문 설정 요청의 남의 · 휴지통 id) · **`needs_originals`**(원본 해시를 모르는 옛 문서 행 — `source_key <> '' and source_sha256 = ''`. PC에는 PDF 변환본만 있어 끄면 원본이 어디에도 남지 않으므로 끄지 않고 숫자에서 뺌, 논문 설정도 그대로. 7.3절 `sync-originals` 뒤에는 끌 수 있음. `mode.ack`도 이런 행이면 `not_pending`으로 지우지 않음 — 이중 방어. 웹(10.5절): `blocked`에 이 코드가 있으면 창 없이 바로 적용하지 않고 확인 창 · 토스트에 “원본 정리 전인 문서 n개는 아직 PC에만으로 바꿀 수 없어요 (관리자가 원본 정리를 마치면 돼요)”, 논문 요청이 모두 막혔으면 [확인] 없이 그 안내만).
- 오류: 400 `bad_mode` · 400 **`holder_required`** `{choices: [{id, name}]}`(끄기 대상이 있고 PC가 둘 이상인데 `holder_device_id` 없음. **끄는 중인데 고른 보관 PC가 해지 · 동기화 끔으로 자격을 잃은 항목**도 끄기 대상 — 12장 [다른 PC 고르기]가 웹에서도 PC를 고르게 됨) · 400 **`no_sync_pc`** "폴더 동기화를 켠 PC(0.4.0 이상)가 없어 ‘PC에만’으로 바꿀 수 없어요. PC 앱에서 폴더 동기화를 먼저 켜 주세요." · 400 **`holder_not_eligible`** · 404.
- 한 요청 안에서 모두 한 트랜잭션. 전환은 5.3절대로 **대기만 씀**(R2 삭제는 `mode.ack` 때) — 그래서 이 경로는 빠르고 실패해도 잃는 것이 없음.

**바뀌는 기존 응답**

| 경로 | 추가 · 변경 |
|---|---|
| `GET /api/papers` · `GET /api/papers/{pid}` | 항목마다 **`sync`** 객체(10.1절). `has_pdf`는 지금 뜻 그대로(R2에 변환본/PDF가 있음 — 로컬이면 false) |
| `GET /api/folders` | 항목마다 `sync_mode` · `effective_mode` · `local_count`(그 폴더 바로 아래 로컬 논문 수) |
| `GET /api/devices` | 항목마다 `local_count` · `local_bytes`(보관 중인 로컬 항목) · `sync.protocol` |
| `GET /api/stats` | `local_only`(로컬 편수) · `mode_pending`(대기 편수) |
| `GET /api/storage/usage` | 그대로(로컬 항목은 `pdf_key = ''`라 합계에 안 들어감 — `db.py:699-709` 확인됨) + `local_bytes`(참고용 — PC에만 있는 크기) |
| `GET /api/papers/{pid}/pdf-url` · `source-url` | 로컬 항목이면 **409** `{"detail": "이 파일은 ‘집 PC’에만 있어요. 그 PC의 PaperLab 앱에서 열 수 있어요", "code": "local_only", "holder_device_id", "holder_name"}` |
| `POST /api/papers/{pid}/pdf/upload` · `pdf/complete` · `fetch-pdf` | 로컬 항목 + 보관 PC 활성 → 409 `local_only`("이 파일은 ‘집 PC’에만 있어요. 바꾸려면 그 PC의 동기화 폴더에서 파일을 바꿔 주세요"). 보관 PC가 해지됨 · 없음 → **허용**: 붙이면 `storage = 'cloud'`, `sync_mode = 'cloud'`(명시), `local_device_id = null` |
| `POST /api/papers/{pid}/explain` · `translation*` | 로컬 항목이면 409 `local_only` "이 PC에만 있는 파일은 선택 설명 · 번역을 쓸 수 없어요. [동기화 켜기]로 서버에 올리면 쓸 수 있어요" |
| `POST /api/papers/{pid}/summary` · `chat` | 7.4절 경로(보관 PC CLI만). 경로가 없으면 400 `no_route_local` "이 파일은 ‘집 PC’에만 있어서 그 PC의 AI(Claude · Codex · Gemini CLI)로만 요약할 수 있어요. 그 PC의 PaperLab 앱에서 AI 도구를 연결해 주세요" |
| `POST /api/ask` · 인용 검증 | 그대로(색인 · 본문이 없어 자동 제외). 응답에 `excluded_local`(범위 안의 로컬 편수)을 더해 화면이 "이 PC에만 있는 n편은 빠졌어요"를 보임 |
| `GET /api/papers?q=` | 그대로 — 로컬 항목은 `paper_search.meta`(제목 · 저자 · 초록 · 태그 · 노트 · 주석 메모)로만 찾아지고 본문으로는 안 찾아짐 |
| `POST /api/uploads/{id}/complete` | 대상 폴더 실효 모드가 `local`이면 응답 항목에 `note_local_folder: true`(화면 토스트 — 5.4절) |
| `DELETE /api/devices/{id}` | 응답에 `local_orphaned`(이 해지로 보관 PC가 없어진 로컬 편수) |

### 7.3 기존 경로 · 관리 명령이 해야 할 일

- **`prepare_upload`**(`server.py:501-517`): 원본 정보에 `sha256 = hashlib.sha256(raw)`. **`attach_from_incoming`**(`:519-551`): `source`면 `set_source(pid, skey, name, size, sha256)`, PC 파일 이름은 **원래 이름 그대로**(`:543`의 `.pdf` 바꾸기 삭제 — `clean_file_name`이 확장자 목록을 받게 됨). `:544-547`의 "동기화면 원본 유지" 분기는 **v2에서는 표현대로**: PC가 보낸 것이 `.pdf` 이름이면 원본을 지우고(웹 PDF 교체와 같음), 원본 이름이면 원본을 바꿈. **단 원본 해시를 모르는 옛 문서 행**(`sync-originals` 전)이면 PC의 `.pdf`는 변환본이므로 원본을 지우지 않음(옛 동작 — 원본은 서버에만 있음). `name`(올린 이름)이 받는 문서 · 사진 확장자(`ACCEPT_EXTS`, `.pdf` 제외)면 내용이 PDF여도 `source`로 보관(5.5절 — `prepare_upload`가 `raw.startswith(b"%PDF")`에서 바로 돌려주는 `:505-506`을 "이름이 `.pdf` · 확장자 없음 · 모르는 확장자일 때"로 — `x.download` 같은 이름의 PDF를 두 번 저장하지 않음).
- **웹 업로드**(`complete_upload` · `save_upload`): 끔 폴더라도 `cloud`(5.4절) + `note_local_folder`.
- **AI**: 7.4절. **`api_runner._run`**(`:184`): 시작할 때 논문 `storage = 'local'`이면 `local_only`로 실패(정상이면 경로에 API 칸이 없어 오지 않음 — 방어).
- **`jobs.WORKER_CODES`**(`jobs.py:68`) · `DEFAULT_ERRORS`(`:71`)에 `local_file` · `local_unsupported` · `local_unreadable` · `local_no_text` 추가(문구 10.9절). 네 코드 모두 **다시 시도 · 다른 칸 넘김 없음**(`RELOCATE_CODES` · `FALLBACK_CODES`에 넣지 않음).
- **`purge_papers`**(`server.py:566-581`): 그대로(로컬은 키가 비어 있음).
- **`list_trash`** 크기: 로컬은 0(`has_pdf` false라 이미 0 — `db.py:999` 확인됨).
- **관리 명령 `python -m paperlab.admin sync-originals [--dry-run]`**(`admin.py`): 모든 사용자의 `source_key <> '' and source_sha256 = ''` 행마다 R2 원본을 받아 해시 → `source_sha256` 기록, `file_name`을 `source_name`의 확장자로(`free_name`으로 겹침 처리 — 6단계 K-8의 ` (2)`). 사용자 권한 트랜잭션(관리 주소 `system_tx`로 id만 모으고 사용자별 `actor_claims("admin")`) · 멱등 · 진행 수만 출력(이름 · 경로 없음). **단 원본을 적은 뒤 PC가 변환본을 바꾼 행**(`content_device_id is not null` — 해시 없는 원본을 PDF와 함께 적은 길은 옛 웹 업로드뿐이라 기기 없음, 위 옛 문서 분기의 `set_pdf`가 올린 PC를 적음 · 충돌 사본은 그 값을 복사)은 원본이 PC 내용보다 옛것이므로 해시를 채우지 않고 **원본을 떼어 냄**(`set_source(pid)` · R2 원본은 커밋 뒤 삭제 — PC의 `.pdf`가 원본을 지우는 v2 규칙과 같음). 해시를 받는 사이에 PC가 바꿨으면(잠근 뒤 다시 봄) 건너뛰고 다음 실행이 떼어 냄. 출력: 채움 · 이름 바꿈 · 떼어 냄 · 건너뜀(`--dry-run`은 대상 수와 떼어 낼 수). 한계: 그 PC 기기 행이 해지 뒤 정리돼(`REVOKED_KEEP_DAYS`) `content_device_id`가 비면 구별할 수 없음. **서재 문서 기능과 이 명세가 같이 배포되면 운영에 해당 행이 없어 할 일 0**.

### 7.4 AI 작업 (P-6 · D-6)

**경로**: `route_for(ctx, kind, paper)`(`server.py:815`) — 논문이 `storage = 'local'`이면:
1. 보관 PC가 활성이 아니면 400 `no_route_local`(문구 위, 해지면 "연결이 해지된 PC에만 있던 파일이라 AI를 쓸 수 없어요").
2. `build_route`(`jobs.py:292-303`)를 **보관 PC 한 대의 행만** 넘겨 부르고 **API 칸을 모두 뺌** → CLI 칸만. 비면 400 `no_route_local`.
3. `create_job(..., pinned_device_id = holder)`(`jobs.py:344` — 인자 추가, `insert`에 열 추가).
- 종류: `summary` · `chat`(논문 대화)만. `explain` · `translate*` · 범위 `chat`/`ask` · `verify`는 7.2절대로 막거나 제외.
- `fail_or_fallback`은 경로가 CLI 칸뿐이라 API로 넘어가지 않음(시험으로 확인 — AC-S52).

**잡기**: `claim_cli`(`jobs.py:763-775`) 조건에 `and (pinned_device_id is null or pinned_device_id = %(dev)s)`. 잡기 요청 본문 `caps`(새 — `["local_text"]`)에 `local_text`가 없으면 고정 작업도 `pinned_device_id is null` 조건으로 걸러 줌(옛 워커 방어). 고정 작업의 대기 이유(`waiting_reason` `:391`)에 "‘집 PC’가 켜지면 실행돼요".

**작업 내용** (`cli_task` `:837-875`, `text_request` `:811-834`):
- 로컬 논문이면 `ai.PaperContext(..., local_text=True)` → `tagged_text()`가 본문 대신 **표지 문자열 `LOCAL_TEXT_MARKER = "\u2063PAPERLAB_LOCAL_PAPER_TEXT\u2063"`** 한 번을 돌려주고(`text_pages()`가 비어도 `summary_request`의 "읽을 본문 없음" 오류를 내지 않음). 프롬프트의 다른 부분(제목 · 초록 · 대화 · 질문)에서는 `\u2063`을 지움(표지를 흉내 낼 수 없게).
- 응답 작업에 **`local: {"paper_id": pid, "sha256": 표현 해시, "ext": ".hwp" 등 소문자 확장자}`** 추가. 그 밖(`system` · `prompt` · `json_schema` · `timeout_s`)은 그대로.
- **작업을 만들기 전에 거절**(작업 0 · 400 `local_unsupported`): 로컬 항목의 확장자가 `.ppt` · `.xls` · `.rtf` · 사진이면 요약 · 대화 요청을 바로 거절하고 문구(10.9절)를 돌려줌 — PC까지 갔다가 실패하지 않게. 서버 상수 `LOCAL_TEXT_EXTS = (".pdf", ".docx", ".hwpx", ".pptx", ".xlsx", ".odt", ".odp", ".ods", ".hwp", ".doc")`(PC `desktop/extract/kinds.js`와 같음 — 계약 시험).
- 결과(`worker_result`)는 지금 그대로 저장(요약 · 대화 답 = 서버에 남음 — 원문 본문은 아님, D-12와 같은 결).

**워커 쪽 계약 (D 팀)**: `local`이 있는 작업은 ① main에 `local-text {paper_id, sha256}` 요청 ② 글 조각 배열(PDF = 쪽, 문서 = 9.5.2절의 단위)을 받아 `pages.map((t, i) => '<page number="' + (i + 1) + '">\n' + fence(t.trim()) + '\n</page>').join('\n\n')`(Python `ai.PaperContext.tagged_text` · `ai.fence`와 같은 결과 — `fence` 정규식 `<(/?)(paper|page|context|selection|abstract|sources?|evidence|claim|conversation|text)\b`(대소문자 무시) → `‹$1$2`) ③ 프롬프트 안 표지가 **정확히 한 번**이 아니면 실패(`bad_input`) ④ 바꾼 프롬프트가 4MB(`PROMPT_MAX`)를 넘으면 `input_too_large` ⑤ 글이 비면 `local_no_text`. 실패 결과 코드: `local_file`(파일 없음 · 해시 다름 · 루트 문제) · `local_unsupported`(형식 밖 · HWP 3.x 등) · `local_unreadable`(손상 · 암호 · 배포용 문서 · 상한 초과 · 시간 초과) · `local_no_text`. (문서의 "쪽 번호"는 PDF 쪽이 아니라 조각 순서 — 요약 · 대화의 쪽 인용이 문서에서는 "n번째 부분"을 뜻함. 프롬프트 문구는 바꾸지 않음 — 수용.)

---

## 8. PC 앱 — 동기화 엔진 (`desktop/sync/*`)

### 8.1 대상 파일 넓히기

- **새 `desktop/sync/filekind.js`**(순수): `SYNC_EXTS`(= `convert.ACCEPT_EXTS`, 순서 그대로), `extOf(name)`, `isSyncName(name)`, `kindOf(head8, name) -> 'pdf' | 'doc' | 'image' | ''` — `convert.kind`(`convert.py:47`)와 같은 판정: 첫 바이트 `%PDF`면 이름과 관계없이 `pdf`, 아니면 확장자 + 매직(ZIP `PK\x03\x04` · OLE `D0CF11E0A1B11AE1` · `{\rtf` · 그림 매직)이 함께 맞아야. 서버와 같은 목록인지 `tests/test_selective_sync_contract.py`가 파일을 읽어 확인.
- `paths.js`: `nameProblem(name, {file})`(`:24-32`)의 `.pdf` 규칙 → `isSyncName`, 예약 이름 검사는 확장자 앞부분으로(`:29`), `isPdfName` → `isSyncName`(옛 이름은 지움), `MAX_PDF_BYTES` → `MAX_FILE_BYTES`(값 그대로 100MB). `safeJoin`(`:58-69`) 그대로(이름 검사가 넓어짐).
- `scanner.js`: `:35` · `:52` `isPdfName` → `isSyncName`. `hashFile`(`:77-90`)이 첫 8바이트 `head`를 돌려줌(`pdf` 대신). **v1 모드(8.6절)에서는 `.pdf`만**(`scanTree(root, {exts})` 인자).
- `engine.js:725` `if (!h.pdf)` → `kindOf(h.head, name)`가 빈 값이면 문제 `not_pdf`(이름이 `.pdf`) 또는 **`bad_format`**(그 밖) — 올리지 않음.
- `engine.js:1174` 보관함 같은 이름 `(\.pdf)$` → 아무 확장자(`/(\.[^.\\]+)$/`).
- `main/sync-host.js:261` 폴더 열기의 `{file: /\.pdf$/i.test(rel)}` → `isSyncName`.

### 8.2 서버 상태 S 넓히기

- `S.papers` 항목: `{id, folder_id, file_name, sha256, size, content_at, kind, storage, holder, holderGone, pending}`(`normPaper` `engine.js:1466`). `storage`가 없으면(옛 서버 — v1) `'cloud'`.
- `S.folders` 항목에 `sync_mode`(없으면 `'inherit'`).
- `fetchSnapshot`(`:624`) · `applyChange`(`:665`): 지금 "`sha256`이 없으면 지운다"는 그대로(표현 해시는 대상 논문이면 늘 있음).
- `this.deviceId`: 토큰(`parseToken`)의 기기 id — `holder === this.deviceId`로 "내가 보관 PC".

### 8.3 세 갈래 비교에 더하는 줄 (`reconcile.planFiles` — `reconcile.js:101-220`)

표기는 6단계 6.4절 그대로(J = 저널, L = PC 지금, S = 서버). **나** = 이 PC, **남** = 다른 활성 PC.

| S | J · L | 동작(새 `t`) |
|---|---|---|
| `local` · 보관 = 나 | J · L 있음, L 내용 바뀜 | `upload_content`에 `local: true`(업로드 없음 — `content` 메타데이터만) |
| `local` · 보관 = 나 | J 있음 · L 사라짐 | 지금 그대로 `srv_delete`(대량 검사) |
| `local` · 보관 = 나 | J 없음 · L 없음(새로 되살림 · 동기화 다시 켬) | 문제 `local_missing`(받을 곳이 없음 — 아무것도 안 함) |
| `local` · 보관 = 나 | J 없음 · L에 같은 해시 파일 | 지금의 `link`(서버 `linked`) |
| `local` · 보관 = 남 | J 있음 · L 해시 = J = S | **`trash_local`** `reason: "moved_local"`, `label: holder 이름`(대량 검사 · 확인 창 — D-4) |
| `local` · 보관 = 남 | J 있음 · L 내용 바뀜(여기서 고침) | **`upload_new`** + `dropPid`(새 항목으로 — 그 위치 실효 모드대로) + 알림 "다른 PC에만 두기로 한 파일을 이 PC에서 고쳐서 새 항목으로 남겼어요" |
| `local` · 보관 = 남 | J 없음 · L에 같은 해시 | 문제 **`local_elsewhere`**(아무것도 안 함 — D-9). 서버가 `adopted`를 줄 수 있는 경우(`holderGone`)는 `upload_new` 대신 **`add_local`/`link`** |
| `local` · 보관 = 남 | J 없음 · L 없음 | 없음(받지 않음 — 6단계 "새 논문 → 받기" 줄에서 **로컬 항목은 빼기**, `:198-205`) |
| `cloud` + `to_local` · 보관 = 나 | J · L 해시 = S | **`mode_ack`** `{pid, sha256}`(`ops` `mode.ack`, 한 묶음 최대 20) |
| `cloud` + `to_local` · 보관 = 나 | L 없음 · 이름 · 길이 문제로 못 받음 | **`mode_fail`** `{pid, reason}`(한 번만 — 같은 이유 반복 보고 안 함) |
| `cloud` + `to_local` · 보관 = 나 | L ≠ S(받기 · 올리기 진행 중) | 지금 흐름 먼저, 다음 바퀴에 확인 |
| `cloud` + `to_local` · 보관 = 남 | (무엇이든) | 지금 켬 규칙 그대로(아직 켬) |
| `local` + `to_cloud` · 보관 = 나 | J · L 해시 = S | **`promote`** `{pid, rel, sha256, size, mtime_ms}`(업로드 자리 → PUT → `files/{id}/promote`) |
| `local` + `to_cloud` · 보관 = 나 | L 내용 바뀜 | `upload_content(local)` 먼저 → 다음 바퀴 `promote` |
| `cloud`(표현 `source`/`pdf`) | J.rel의 확장자 ≠ S 이름의 확장자 **그리고** S 해시 ≠ J 해시(**표현 바뀜** — D-8) | **`swap_rep`** `{pid, from: J.rel, to: S.rel, sha256, size}` — 새 이름으로 받기(임시 → 해시 확인 → 넣기) → 성공하면 옛 파일 `trash_local`(대량 검사 대상 아님 — 내용이 새 파일로 대체됨, 알림 "문서를 원본 파일로 바꿨어요: {이름}") → 저널. L이 J와 다르면(옛 변환본을 고쳤음) 옛 파일은 `upload_new`로 남기고 새 원본만 받음 |
| — | J 없음 · L 새 파일(서버에 같은 해시 없음) | 그 위치 `effectiveMode(S, folderId)`가 `local`이면 **`add_local`**(`files/add` `storage: "local"`, 업로드 없음), 아니면 지금의 `upload_new`. 서버가 `upload_required`를 주면 그 파일만 다음 바퀴에 `upload_new` |

- **대량 삭제 검사**(`engine.massExceeded` · `hold` — `engine.js:1025-1043`): `moved_local`도 서버 → PC 방향 묶음에 넣음. 확인 창 kind `moved_local`(문구 10.9절). 버튼: **[이 PC에서 지우기(Windows 휴지통으로)]** · **[나중에]** + 보조 링크 [동기화 끄기]. ([서재에 되살리기] 없음 — 서재 정보는 그대로이고 파일은 보관 PC에 있음.)
- 순서(6단계 6.5절 끝): 폴더 → 이동 · 이름 → **`mode_ack`/`mode_fail`(ops 묶음)** → 받기(`swap_rep` 포함) · 올리기(`promote` 포함) · `add_local` → 파일 삭제(대량 검사 뒤) → 폴더 삭제.
- 로컬 항목은 **받기 대상이 아니므로** 첫 연결 미리보기(`previewPlan` `engine.js:303-338`)에 새 줄: "이 PC에만 둘 파일 n개(서버에 올리지 않음 · 합계)" · "다른 PC에만 있는 파일 n개(받지 않음)". 올리기 예산 · DB 예산 계산에서 `add_local`은 빼고 DB 예산에는 편당 로컬 추정치(서버가 `db.per_local_bytes`로 줌 — 가정 8KB)만.

### 8.4 실행 (`engine.js` · `transfer.js`)

- **API 머리글**: `createApi`(`worker/api-client.js:16`)에 `headers` 옵션 → 동기화 엔진은 `{'X-PaperLab-Sync': '2'}`(v1 모드에서도 보냄 — 옛 서버는 무시). `files/add` · `content` · `promote`는 **시간 제한 240초**(서버 변환 최대 180초 + 여유 — `convert.TIMEOUT`), 나머지는 30초 그대로.
- **올리기**(`uploads` `:1187` · `finishUpload` `:1254-1279`): `files/add` 본문에 `storage`, 이름은 실제 확장자. `promote`는 같은 업로드 자리 흐름을 쓰고 마지막 호출만 `files/{id}/promote`. 응답의 `paper.storage = "local"`(서버가 로컬로 만듦)이면 저널에 그대로.
- **로컬 메타데이터 올리기**: `upload_content(local)`은 업로드 자리 없이 `content` 한 번.
- **`add_local`**: `files/add`만(업로드 없음). `local_elsewhere` 결과면 문제 목록, 저널에 넣지 않음.
- **`mode_ack` · `mode_fail`**: `ops` 묶음(`ops()` `:808`). `changed`면 S를 그 `paper`로 고치고 다음 바퀴. `applied`면 S의 그 논문 `storage = 'local'` · `pending = ''`.
- **받기**(`downloads` `:1313-1380`): 응답 항목 `kind`에 관계없이 같은 흐름(임시 → 해시 → 넣기). `local_only` 항목은 그 파일만 건너뜀(문제 목록 아님 — 다음 피드가 고침).
- **`transfer.checkUrl`**(`:29-47`) 받기 접두어: `users/{uid}/papers/` **또는** `users/{uid}/sources/`(둘 중 하나로 시작해야 — 같은 검사, 개발 저장소 경로 포함). 올리기 접두어 `incoming/{uid}/` 그대로.
- **새 IPC — `resolve`**(main → sync, 9.2절): `{type: 'resolve', id, paper_id}` → `{type: 'resolve-result', id, ok, abs, rel, sha256, size, ext, code}`. 조건: `S.papers.get(pid)`가 `storage = 'local'` · `holder = 나`(또는 `cloud`인데 L에 파일이 있음 — 9.1절 `localFile`은 로컬 항목만 쓰지만 AI는 아님) · `J.files[pid]` 있음 · 지금 `lstat`의 크기 · 수정 시각 · `ino`가 J와 같음(다르면 `code: 'changed'` — 쓰는 중). `abs = safeJoin(root, J.rel, {file: true})`가 null이면 `code: 'path'`.

### 8.5 저널 v2

- `journal.js`: 머리 `version: 2`. 파일 항목에 `kind`(`pdf`·`source`·`local`)만 추가(없으면 `pdf`). 다른 모양은 그대로.
- **v1 → v2 이전**: 0.4.0이 처음 v1 저널을 읽으면 `version = 2`로 쓰고 **전체 다시 맞추기**(`needFull`). 이때 표현이 바뀐 항목(옛 변환본)은 8.3절 `swap_rep`로, 끔 항목은 해당 줄대로 — **삭제를 추론하지 않음**(6단계 K-23 그대로: 로컬 항목도 스냅숏에 나오므로 "서버에 아예 없음"이 생기지 않음).

### 8.6 v1 호환 모드 (옛 서버 — D-7)

- `sync/start` 응답에 `protocol`이 없거나 1이면 `this.proto = 1`: 대상 `.pdf`만, `storage` · `pending` · `kind` 무시(전부 `cloud`), 새 동작(`add_local` · `mode_*` · `promote` · `swap_rep`) 만들지 않음, `resolve`는 `code: 'unsupported'`. **0.3.1과 똑같이 동작**.
- `this.proto`는 `start`마다 다시 정함(서버가 배포되면 다음 시작 · 6시간 전체 맞추기 때 v2로 — 바뀌는 순간 전체 다시 맞추기).

---

## 9. PC 앱 — 로컬 파일 다리 · 읽기 · 로컬 AI

### 9.1 preload API (`desktop/preload/preload.js` — 클라우드 화면 `window.paperlabDesktop`에 추가)

| 함수 | 돌려주는 것 | 비고 |
|---|---|---|
| `localFile(paperId)` | `Promise<{ok: true, data: ArrayBuffer, name, ext, sha256, size} \| {ok: false, code}>` | **논문 id(양의 정수)만** 받음 — 경로는 받지도 돌려주지도 않음. `code` ∈ `not_local`(이 PC 보관 로컬 항목 아님) · `missing` · `changed`(쓰는 중) · `too_big` · `path` · `sync_off` · `unsupported`(옛 서버) · `busy`(동시 요청 초과) |
| `openLocal(paperId)` | `Promise<{ok, code}>` | 기본 앱으로 열기(`shell.openPath`) — 문서 · 사진 · PDF 모두 가능(사용자가 고르면) |
| `localHas(paperIds)` | `Promise<{[id]: "here" \| "missing"}>` | 최대 500개, **이 PC가 보관하는** 로컬 항목만 키로(그 밖은 빠짐) — 배지 "이 PC에만"과 "이 PC에 파일 없음" 구분 |
| `info()` | 지금 값 + `syncProtocol`(엔진의 `proto`) · `syncOn` | 웹 화면이 "이 PC" 판단에 `deviceId`(이미 있음 — `main.js:347-350`)를 씀 |

### 9.2 main 처리 (`desktop/main/ipc.js` · `sync-host.js`)

- `ipc.js`: `cloud('pl:local-file', (id) => ctl.localFile(id))` · `cloud('pl:open-local', …)` · `cloud('pl:local-has', …)` — **`isCloudSender`(최상위 프레임 · 서버 출처만 — `ipc.js:7-9`)** 그대로. 인자는 `Number.isSafeInteger(id) && id > 0`만, 배열은 500개까지.
- `sync-host.js` 새 함수 `localFile(pid)`:
  1. 동기화가 켜져 있고 루트가 정상이 아니면 `sync_off`.
  2. 엔진에 `resolve` 요청(id 짝, 10초 제한).
  3. **main이 다시 확인**(엔진을 믿지 않음): `checkInRoot(abs, root)` — 지금 `trashInRoot`(`:37-47`)의 검사(절대 경로 · `\\` 시작 아님 · `isInside(root, abs)` · 대상 `lstat`이 일반 파일 · 루트까지 위로 올라가며 **어느 조각도 심볼릭 링크 · 정션 아님**)를 떼어낸 함수 + `realpath`가 루트 `realpath` 안 + 확장자가 `SYNC_EXTS` 안 + 크기 ≤ 100MB.
  4. `fs.promises.readFile` → **해시를 다시 계산해 `resolve`의 `sha256`과 같을 때만** 돌려줌(검사와 읽기 사이 바뀜 방지).
  5. 동시 2개 · 분당 30개 제한(`busy`). 로그에는 결과 코드만(이름 · 경로 없음 — 6단계 12.6절).
- `openLocal(pid)`: 1~3 같음 → `shell.openPath(abs)`(빈 문자열이면 성공). 확장자 허용 목록이 실행 파일 · 바로 가기(`.exe` · `.lnk` · `.url` · `.bat` …)를 원천 차단.
- `localText(pid, sha)` (워커용 — 9.4절): 1~4 같음(해시가 작업의 `sha256`과 다르면 `local_file` — "파일이 바뀌는 중").

### 9.3 읽기 화면 (D-5 — 웹 `reader.js`가 PC 앱 창 안에서)

| 항목 · 위치 | PC 앱(보관 PC) | 다른 PC 앱 · 웹 |
|---|---|---|
| 로컬 PDF | `loadPdf`(`reader.js:283-301`)가 `pdf-url` 대신 `paperlabDesktop.localFile(pid)` → 같은 `getDocument({data})` → 하이라이트 · 노트 그대로(서버에 쪽 + 사각형 + 글) | 읽기 영역에 안내(10.5절), 오른쪽 패널(노트 · 하이라이트 목록 · 정보 · AI 요약 보기)은 그대로 |
| 로컬 사진 | `localFile` → `Blob` → `<img>`(웹 CSP `img-src blob:` — 확인됨). 하이라이트 없음 | 같은 안내 |
| 로컬 문서(워드 · 한글 · PPT · 엑셀) | 읽기 영역에 "이 문서는 PC의 기본 앱으로 열어요" + **[기본 앱으로 열기]**(`openLocal`) | 같은 안내 |

### 9.4 로컬 AI 본문 추출 (D-6)

- **워커**(`desktop/worker/worker.js` · 새 `desktop/worker/local-text.js`): 7.4절 계약. 잡기 본문에 `caps: ["local_text"]`. main과는 지금 워커 메시지 길(`main.js:126` utilityProcess)로 `{type: 'local-text', id, paper_id, sha256}` → `{type: 'local-text-result', id, ok, pages, code}`(120초 제한).
- **main**: `localText` → 형식별:
  - **PDF**: 숨은 추출 창 `app://ui/extract.html`(`BrowserWindow({show: false})`, `WEB_PREFS` 그대로 — sandbox · contextIsolation, **별도 세션 `paperlab-extract`**: `webRequest`로 `app:` 밖 요청 전부 취소, 권한 전부 거부). 창의 `extract.js`가 `app://ui/vendor/pdf.min.mjs`로 `getDocument({data, isEvalSupported: false})` → 쪽마다 `getTextContent()` → 글 배열. preload에 이 창 전용 `paperlabExtract`(`location.href === 'app://ui/extract.html'`일 때만 노출): `onJob(fn)` · `done(id, pages)`; main 처리기는 `isLocalSender` + 경로가 `/extract.html`인 프레임만. 바이트는 `webContents.send`(ArrayBuffer). 상한: 2,000쪽 · 글 합계 8MB(넘으면 자름 + 프롬프트 상한에서 `input_too_large`). 창은 한 번에 하나, 60초 제한, 끝나면 닫음.
  - **문서**(`.docx` · `.hwpx` · `.pptx` · `.xlsx` · `.odt` · `.odp` · `.ods` · `.hwp` · `.doc`): **추출 프로세스**(9.5절)에 바이트만 넘김 → 글 조각 배열.
  - **`.ppt` · `.xls` · `.rtf`**: `local_unsupported`(서버가 작업을 만들기 전에 거절하므로 정상이면 오지 않음 — 방어). **사진**: `local_no_text`.
- **빌드**: 새 `desktop/scripts/copy-vendor.js`(`copy-css.js`와 같은 방식)가 `paperlab/static/vendor/pdfjs/pdf.min.mjs` · `pdf.worker.min.mjs`를 `desktop/ui/vendor/`로 복사(`.gitignore` — 생성물). `package.json` `start` · `pack` · `dist` 앞에 실행. npm 의존성은 9.5.4절 둘뿐.
- **`window.js`**: `uiFile`(`:28-35`) 허용을 지금 규칙 + 정확히 두 경로 `vendor/pdf.min.mjs` · `vendor/pdf.worker.min.mjs`(형식 `text/javascript`). `extract.html` 응답의 CSP만 `LOCAL_CSP` + `worker-src 'self'`(PDF.js 작업자).

### 9.5 로컬 문서 본문 추출 (D-14 — LibreOffice 없이)

#### 9.5.1 형식별 처리

| 확장자 | 판정(첫 바이트 — `filekind.kindOf`) | 방법 | 조각 단위 |
|---|---|---|---|
| `.docx` | ZIP | 직접 ZIP · XML(9.5.2): `word/document.xml`의 `w:t`(글) · `w:tab`(탭) · `w:br` · `w:p` 끝(줄바꿈). 각주 · 머리글은 읽지 않음 | 문단을 이어 약 3,000자마다(문단 경계에서) 자름 |
| `.hwpx` | ZIP | 직접: `Contents/content.hpf`의 `spine` 순서로 `Contents/section*.xml`의 `hp:t` · `hp:p` 끝 | 위와 같음 |
| `.pptx` | ZIP | 직접: `ppt/slides/slide{N}.xml`(N 숫자 순 — `presentation.xml` 순서는 읽지 않음, 수용)의 `a:t` · `a:p` 끝 | 슬라이드 하나 = 조각 하나 |
| `.xlsx` | ZIP | 직접: `xl/sharedStrings.xml`(`si`의 `t` 이어 붙임) + `xl/worksheets/sheet{N}.xml`의 `c`(`t="s"` → 공유 문자열 번호, `t="inlineStr"` → `is/t`, 그 밖은 `v` 그대로) — 행은 줄, 칸은 탭. 시트당 2만 칸까지 | 시트 하나 = 조각 하나 |
| `.odt` · `.odp` · `.ods` | ZIP | 직접: `content.xml`의 `text:p` · `text:h`(+ 안의 `text:span` · `text:s` → 공백 · `text:tab` → 탭) — 표 칸(`table:table-cell`)은 탭 | `.odp` 그리기 페이지 · `.ods` 표 하나 = 조각 하나, `.odt`는 3,000자 |
| `.hwp`(HWP 5.0) | OLE | **`hwp.js@0.0.3`** `parse(bytes, {type: "buffer"})` → `sections[].content[]`(문단) `.content[]`(글자) 중 글자 종류만 이어 붙임. `header.version.major < 5`(HWP 3.x)는 `local_unsupported`, 배포용 · 암호 문서 · 예외는 `local_unreadable` | 3,000자 |
| `.doc`(Word 97-2003) | OLE | **`word-extractor@1.0.4`** `new WordExtractor().extract(buffer)` → `getBody()`(각주 · 머리글 안 읽음). **버퍼만 넘김**(파일 이름을 주지 않아 라이브러리가 디스크를 읽지 않음) | 3,000자 |
| `.ppt` · `.xls` · `.rtf` | — | 지원 안 함 → `local_unsupported`(서버가 먼저 거절 — 7.4절) | |

- 판정이 확장자와 어긋나면(예: `.docx`인데 OLE) `local_unreadable`. 같은 판정 함수를 동기화 스캐너와 함께 씀(8.1절).
- 조각 상한 2,000개 · 글 합계 8MB(넘으면 그 자리에서 멈추고 잘린 표시 없이 돌려줌 — 프롬프트 4MB 상한에서 `input_too_large`).

#### 9.5.2 직접 ZIP · XML 읽기 (`desktop/extract/zip.js` · `xmltext.js` — 새 의존성 없음)

- **ZIP**(Node 내장 `zlib.inflateRawSync`만): 끝 64KB + 22바이트에서 EOCD를 찾고 중앙 디렉터리로 항목을 읽음.
  - **거부**: ZIP64(크기 · 위치 `0xFFFFFFFF` · 항목 수 `0xFFFF`), 여러 디스크, 암호(일반 플래그 bit 0), 압축 방법 0(저장) · 8(deflate) 밖, 항목 위치 · 길이가 파일 밖, 로컬 머리의 이름 길이가 중앙 디렉터리와 다름, 항목 수 > **5,000**.
  - **필요한 항목만** 이름으로 골라 풂(위 표의 정해진 경로 패턴 — 이름은 비교에만 쓰고 디스크에 쓰지 않음). 안의 ZIP은 풀지 않음.
  - **압축 폭탄 상한**: 항목당 선언 크기 ≤ **64MB** 그리고 선언 크기 / 압축 크기 ≤ **200배**, 실제 풀기도 `inflateRawSync(buf, {maxOutputLength: min(선언 크기, 64MB)})`(넘으면 `RangeError` → `local_unreadable`) — 선언을 속여도 실제 출력이 상한을 못 넘음. 푼 항목 합계 ≤ **256MB**. 실제 풀린 크기 ≠ 선언 크기면 거부. CRC-32 확인(`zlib.crc32` — Node 22.2+ 내장, Electron 44 = Node 24 확인됨).
- **XML**(직접 만든 토큰 읽기 — DOM · 외부 파서 없음):
  - `<!DOCTYPE` · `<!ENTITY`가 나오면 **거부**(외부 엔터티 · 엔터티 폭증 공격 원천 차단 — OOXML · OWPML · ODF 본문에는 DTD가 없음).
  - 정해진 요소 이름의 글만 모음, 미리 정한 5개 엔터티(`&lt;` `&gt;` `&amp;` `&quot;` `&apos;`)와 숫자 참조(`&#…;` · `&#x…;` — 유효 코드 포인트만)만 풂, 그 밖 `&이름;`은 그대로.
  - 태그 중첩 깊이 ≤ 256, 한 태그 길이 ≤ 64KB, 문서 하나 ≤ 64MB(위 상한과 같음).

#### 9.5.3 추출 프로세스 — 샌드박스 · 상한

- **별도 utilityProcess** `desktop/extract/entry.js`(서비스 이름 `PaperLab Extract`) — main이 필요할 때 띄우고 5분 쉬면 끝냄. 동기화 · 워커 프로세스와 분리(파서가 죽어도 동기화 · 워커는 계속).
- 받는 것은 **`{id, ext, bytes(ArrayBuffer)}`뿐** — 경로 · 루트 · 토큰을 모름. 돌려주는 것은 `{id, ok, pages: string[], code}`뿐.
- 작업마다 **`worker_threads` Worker**를 새로 만들어 그 안에서 파싱: `resourceLimits: {maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4}`(넘으면 Worker가 `ERR_WORKER_OUT_OF_MEMORY`로 끝남 → `local_unreadable`), **30초**에 `worker.terminate()`(→ `local_unreadable`), 한 번에 하나(대기 2개 — 넘으면 `local_unreadable` 대신 워커가 잠시 뒤 다시). 작업이 끝나면 Worker를 버림(파서 상태가 다음 파일에 남지 않음).
- 추가 방어(**스파이크 SX-1 — 확인 필요**): utilityProcess를 `execArgv: ["--permission"]`(Node 24 권한 모델 — 파일 시스템 · 자식 프로세스 · 작업자 외 허용 없음, 자기 스크립트 폴더 읽기만 `--allow-fs-read`)로 띄울 수 있는지 Electron 44에서 실측. 되면 씀, 안 되면 위(바이트만 받음 · 시간 · 메모리 상한)로 충분하다고 보고 수용 위험에 기록.
- **스파이크 SX-2 — 확인 필요**: `hwp.js` `build/cjs.js`(받아서 내용만 확인함 — 실행하지 않음)는 `Viewer`(DOM 사용)와 파서를 한 파일에 묶고 `require('fs')`만 부름. DOM이 없는 Worker 안에서 `require` · `parse`가 되는지 실측. 안 되면 패키지의 파서 부분만 감싸는 얇은 진입 파일(`desktop/extract/hwp.js`)에서 `build/parser`를 직접 부름(어느 쪽이든 패키지 파일은 고치지 않음).
- 결과 글은 main → 워커로만 가고 디스크 · 로그에 남지 않음(로그는 결과 코드 · 조각 수 · 걸린 시간만).

#### 9.5.4 의존성 (확인 2026-10-17 — npm 레지스트리 · GitHub API, 패키지 tar를 받아 내용만 확인)

`desktop/package.json` `dependencies`에 **정확한 버전으로 고정**(범위 기호 없음), `package-lock.json`의 `integrity` 그대로 커밋. 둘 다 순수 JS(네이티브 모듈 없음 — Electron 다시 빌드 불필요).

| 패키지 | 버전 | 라이선스 | 유지 상태 | 쓰는 곳 |
|---|---|---|---|---|
| `hwp.js` | **0.0.3** | **Apache-2.0** (지시의 "MIT"와 다름 — 패키지 `LICENSE` · GitHub 모두 Apache-2.0. 비공개 배포 앱에 써도 되고, **라이선스 전문 · 저작권 표시 동봉**이 의무 — 아래 고지 파일) | npm 마지막 배포 **2020-10-01**(0.0.x — 그 뒤 배포 없음). 저장소 `hahnlee/hwp.js`는 보관(archived) 아님, 마지막 push 2025-01-10, 별 약 1.3천, 열린 이슈 34. **배포는 멈췄고 저장소만 가끔 움직임** → 고정 · 어댑터로 감쌈(R-8) | `.hwp`만 |
| `word-extractor` | **1.0.4** | **MIT** | npm 마지막 배포 **2021-07-26**, 저장소 `morungos/node-word-extractor` 보관 아님, 마지막 push 2024-06-18, 열린 이슈 11. 안정 · 활동 적음 | `.doc`만 |

전이 의존성(잠금 파일에 고정될 버전 — 2026-10-17 해석): `cfb@1.2.2`(Apache-2.0) · `adler-32@1.3.1`(Apache-2.0) · `crc-32@1.2.2`(Apache-2.0) · `pako@1.0.11`(MIT AND Zlib) — `hwp.js`; `yauzl@2.10.0`(MIT) · `fd-slicer@1.1.0`(MIT) · `pend@1.2.0`(MIT) · `buffer-crc32@0.2.13`(MIT) · `saxes@5.0.1`(ISC) · `xmlchars@2.2.0`(MIT) — `word-extractor`(`yauzl` · `saxes`는 그 패키지의 `.docx` 경로용 — 우리는 `.docx`를 직접 읽으므로 실행되지 않음). 허용 라이선스 목록 = MIT · ISC · Apache-2.0 · Zlib · BSD-2/3-Clause.

- **고지 파일**: `desktop/build/THIRD_PARTY_NOTICES.txt`(새 — 위 12개 패키지 이름 · 버전 · 라이선스 전문)를 `electron-builder.config.js`의 `extraResources`로 설치본에 넣고 이 PC 상태 창 아래 "오픈 소스 고지" 링크로 엶.
- **검사 스크립트** `desktop/scripts/check-licenses.js`(새 — `npm test` 앞): `node_modules/*/package.json`의 `license`가 허용 목록 밖이거나 `package.json` 버전이 고정이 아니면 실패.
- **배포 전**: `npm audit --omit=dev` 결과 0건(품질팀), 0건이 아니면 팀장 판단.
- **6단계 K-1("새 의존성 없음")과의 관계**: K-1은 동기화 감시(chokidar)에 대한 결정이었음. 이번 둘은 팀장 결정(2026-10-17)으로 추가하며 **추출 프로세스 안에서만** `require`(동기화 · 워커 · main은 불러오지 않음 — 코드 검사 시험 AC-S49).

#### 9.5.5 시험 견본

- 저장소에 개인 문서를 넣지 않음. `.docx` · `.pptx` · `.xlsx` · `.hwpx` · `.odt`는 **시험이 직접 만든 ZIP**(작은 XML 몇 개 — `desktop/test/fixtures/make-office.js`), 압축 폭탄 · ZIP64 · 암호 · DTD 견본도 시험이 만듦.
- `.hwp` · `.doc`는 만들 수 없으므로 **우리가 직접 작성한 짧은 견본**(각 1개, "PaperLab 시험 문서 가나다 ABC" 한 문단, 수 KB)을 `desktop/test/fixtures/sample.hwp` · `sample.doc`로 커밋(한컴오피스 · Word에서 새로 저장 — 개발자 D가 만들고 출처를 `fixtures/README.md`에 적음). 배포용 · 암호 `.hwp` 견본도 같은 방식.

---

## 10. 화면 (웹 · PC 앱 — 같은 웹 코드가 PC 앱 창에서도 돎)

### 10.1 서버가 주는 `sync` 객체 (논문 목록 · 상세)

```json
"sync": {
  "mode": "inherit",            // 논문 설정
  "effective": "local",         // 실효 모드
  "storage": "cloud",           // 저장 위치
  "pending": "to_local",        // '' | to_local | to_cloud
  "pending_error": "",          // mode_error
  "holder": {"id": 7, "name": "집 PC", "online": true, "gone": false},
  "mismatch": false,            // 폴더 설정과 다름 (파일 있음 · 대기 아님 · effective != storage)
  "has_file": true,             // 동기화 대상 표현이 있음(5.5절)
  "local_ai": "ok"              // 로컬 항목만: "ok" | "unsupported"(확장자가 LOCAL_TEXT_EXTS 밖 — 7.4절). 켬 항목은 null
}
```
- 화면은 `local_ai = "unsupported"`면 AI 요약 · 질문 버튼을 비활성으로 두고 10.9절 `local_unsupported` 문구(확장자별 — 화면이 `file_name` 확장자로 고름)를 보임. 확장자 목록을 웹에 따로 두지 않음.

### 10.2 배지 (`library.js` `paperRow` `:193-196` 옆 · 상세 패널 제목 아래)

| 상태 | PC 앱(보관 PC 안) | 웹 · 다른 PC | 모양 |
|---|---|---|---|
| 켬(지금과 같음) | 없음(지금 `PDF` · 형식 배지 그대로) | 같음 | — |
| 로컬 · 보관 PC = 이 PC · 파일 있음 | **`이 PC에만`** | **`집 PC에만`** | 회색 바탕 + PC 아이콘, 제목 툴팁 "서버에는 정보만 있어요 — 본문 검색 · 서버 AI에서 빠져요" |
| 로컬 · 이 PC 보관인데 파일 없음(`localHas` = missing) | **`이 PC에 파일 없음`**(경고색) | `집 PC에만` | |
| 로컬 · 보관 PC 해지 · 없음 | `파일 없음 (연결 해지된 PC)` | 같음 | 경고색 |
| `to_local` 대기 | `PC에만으로 바꾸는 중` | `PC에만으로 바꾸는 중 (집 PC 대기)` | 점선 테두리 |
| `to_cloud` 대기 | `서버에 올리는 중` | `서버에 올리는 중 (집 PC 대기)` | 점선 |
| 대기 + `pending_error` | `확인 필요` | 같음 | 경고색, 상세에 이유 |
| 폴더 설정과 다름 | `폴더 설정과 다름` | 같음 | 작은 글씨 |

폴더 트리(`app.js:709-713`): 실효 모드가 `local`인 폴더 이름 뒤 작은 **`PC`** 표(설정이 이 폴더에 있으면 진하게, 위에서 물려받았으면 흐리게). 툴팁 "이 폴더의 새 파일은 PC에만 둬요".

### 10.3 폴더 메뉴 · 스위치 (`app.js:729-737` 메뉴에 추가, 폴더 동기화를 켠 PC가 하나라도 있을 때만 — `/api/stats`의 `sync_on`)

- 메뉴 항목(구분선 뒤):
  - 실효 `cloud`일 때: **"동기화 끄기 — PC에만 두기…"**
  - 실효 `local`일 때: **"동기화 켜기 — 서버에도 저장…"**
  - 이 폴더에 설정이 있을 때: **"위 폴더 설정 따르기"**
- **폴더 스위치**: 폴더를 고르면 서재 목록 머리 줄(폴더 이름 옆)에 토글 **"서버에도 저장 [● 켬]"** — 누르면 위와 같은 확인 창.

### 10.4 파일 메뉴 · 상세 패널 (`library.js:470-481` ⋯ 메뉴 · `:362-367` 버튼 줄)

- ⋯ 메뉴: **"동기화 끄기 — PC에만 두기…"** / **"동기화 켜기 — 서버에도 저장…"** / (설정이 있을 때) **"폴더 설정 따르기"**. 대기 중이면 **"바꾸기 취소"**. 여러 개 선택 막대(`bulkBar` `:282`)에도 같은 두 항목.
- 상세 패널 "폴더" 줄 아래 **"저장 위치"** 줄: "서버 · 모든 PC(동기화 켬)" / "집 PC에만 — 서버에는 정보만 있어요" / "집 PC에만으로 바꾸는 중 — 집 PC가 켜지면 서버의 파일을 지워요 [취소]" / "서버에 올리는 중 — 집 PC가 켜지면 올려요 [취소]" / "폴더 설정(PC에만)과 달라요 [폴더 설정대로 맞추기]".
- 로컬 항목의 상세 버튼 줄: `has_pdf`가 false라 지금은 [무료 PDF 찾기] · [파일 첨부]가 나옴(`:363`) → **로컬이면 대신**: 보관 PC 앱 안 = [읽기](PDF · 사진) 또는 [기본 앱으로 열기](문서) + [AI 요약], 다른 곳 = 안내 한 줄 "‘집 PC’에만 있어요 — 그 PC의 PaperLab 앱에서 열 수 있어요". 보관 PC가 해지됐으면 [파일 다시 올리기](= 지금 [파일 첨부]).

### 10.5 확인 창 문구 (`dialogs.js` — `confirmDialog` 재사용, 처음 초점 = [취소] — 6단계 K-35 인자)

**끄기(켬 → PC에만)** — `dry_run` 결과로:
> **‘개인 자료’ 폴더를 PC에만 둘까요?**
> 이 폴더의 파일 12개(48MB)를 서버에서 지우고 **‘집 PC’에만** 둬요. 제목 · 저자 · 노트 · 하이라이트 · 태그는 서버에 남아요.
> - 서버 본문 검색 · 서재 질문 · 선택 설명 · 번역에서 빠지고, AI 요약 · 질문은 ‘집 PC’의 AI로만 돼요.
> - ‘연구실 PC’에 있는 이 파일 12개는 Windows 휴지통으로 옮겨져요.
> - 지금까지 만든 AI 요약 · 대화 · 설명 기록과 하이라이트한 글은 그대로 남아요.
> - 서버 파일은 ‘집 PC’가 파일을 가지고 있는지 확인한 뒤에 지워요.
>
> ⚠ **‘집 PC’가 고장 나거나 그 PC에서 파일이 지워지면 서재에서 이 파일을 되살릴 수 없어요.** 서재에는 정보 · 노트 · 하이라이트만 남아요. 중요한 파일은 따로 백업해 두세요.
> [취소] [PC에만 두기]

- 경고 문단(확정 Q-5)은 **언제나** 보임(파일 하나 · 여러 개 · 폴더 모두), 강조 · 경고색(`notice` `data-tone="warn"`), 처음 초점은 [취소]. 파일 하나일 때 첫 줄은 "**‘보고서.hwp’를 PC에만 둘까요?**", 본문 첫 문장은 "이 파일(2.1MB)을 서버에서 지우고 **‘집 PC’에만** 둬요."
- 같은 경고를 PC 앱 `desktop/README.md` 도움말과 웹 도움말(설정 → 연결된 PC "PC에만 두기란?")에도 한 줄: "PC에만 둔 파일은 그 PC에만 있어요. PC가 고장 나면 서재에서 되살릴 수 없으니 따로 백업해 주세요."

보관 PC가 둘 이상(웹 · `holder_required`): 창 안에 라디오 "어느 PC에 둘까요?" (`이름 · 켜짐/마지막 접속`), PC 앱 창이면 이 PC가 미리 골라짐. `no_sync_pc`면 창 대신 안내 토스트(7.2절 문구).

**켜기(PC에만 → 서버에도)**:
> **‘개인 자료’ 폴더를 서버에도 저장할까요?**
> ‘집 PC’가 파일 12개(48MB)를 서버에 올려요. 올리면 본문 검색 · 서버 AI · 다른 PC와 웹에서 읽기를 쓸 수 있어요. 다른 PC에도 파일이 내려가요.
> (‘집 PC’가 꺼져 있으면 켜질 때 올려요.)
> [취소] [서버에도 저장]

**하위 항목 설정**(폴더에 따로 정한 하위 항목이 있을 때 확인 창 아래 체크 상자): "안에서 따로 정한 폴더 · 파일 n개도 이 설정으로 바꾸기".

**토스트**: 끄기 요청 뒤 "12개를 PC에만으로 바꾸는 중이에요. ‘집 PC’가 확인하면 서버에서 지워요." / 끝남(대기가 사라진 것을 다음 새로 고침이 볼 때) "12개를 ‘집 PC’에만 두었어요. 서버 공간 48MB를 비웠어요." / 켜기 "‘집 PC’가 12개를 서버에 올리고 있어요."

**연결된 PC 해지**(`DELETE /api/devices/{id}` 전 — 지금 확인 창에 한 줄): "이 PC에만 있는 파일 n개(정보 · 노트는 남아요)는 해지하면 서재에서 열 수 없어요. 그 PC에서 [동기화 켜기]로 먼저 서버에 올리거나, 나중에 다른 PC의 동기화 폴더에 같은 파일을 넣으면 다시 연결돼요."

### 10.6 읽기 · AI 안내 (`reader.js`)

- 다른 PC · 웹에서 연 로컬 항목, 읽기 영역: **"이 파일은 ‘집 PC’에만 있어요"** / "PC에만 두기로 해서 서버에는 파일이 없어요. ‘집 PC’의 PaperLab 앱에서 열 수 있어요. 노트 · 하이라이트 · 정보는 여기서도 볼 수 있어요." (보관 PC 해지: "연결이 해지된 PC에만 있던 파일이라 열 수 없어요. 파일이 있으면 [파일 다시 올리기]로 올려 주세요.")
- **AI 요약 · 질문하기 탭**(로컬 항목): 시작 버튼 위 한 줄 "이 파일은 ‘집 PC’에만 있어서 ‘집 PC’의 AI(CLI)로 실행해요. 서버 AI 키는 쓰지 않아요." ‘집 PC’가 꺼져 있으면 "‘집 PC’가 켜지면 실행돼요". 경로 없음(`no_route_local`)은 서버 문구 그대로.
- **설명·번역 탭**: 비활성 + "이 PC에만 있는 파일은 선택 설명 · 번역을 쓸 수 없어요. [동기화 켜기]로 서버에 올리면 쓸 수 있어요."
- **서재 질문**(`ask.js`): 응답 `excluded_local > 0`이면 출처 아래 "이 PC에만 있는 n편은 서재 질문에서 빠졌어요".
- **검색 결과 빈 상태**: 로컬 항목이 하나라도 있으면 "PC에만 둔 파일은 본문으로 찾지 않아요(제목 · 노트로는 찾아요)".

### 10.7 연결된 PC (설정 화면 — 6단계 SW-3 줄에 덧붙임)

"폴더 동기화: 켜짐 · 최신(2분 전) · 루트 이름 · **이 PC에만 둔 파일 n개(m MB)**". 프로토콜 1(0.3.x)이면 "앱을 업데이트해야 동기화가 이어져요 — PC에만 두기를 쓰려면 0.4.0 이상".

### 10.8 PC 앱 이 PC 상태 창 (`desktop/ui/status-sync.js` · `sync-look.js`)

- 동기화 구역 개수 줄에 "이 PC에만: n개" · "바꾸는 중: n개"(엔진 `state` 메시지 `counts.local` · `counts.pending_mode` — 서버 `sync_devices.counts` 허용 키에도 추가: `COUNT_KEYS` `sync.py:49`).
- 설명 문구(`status-sync.js:126`) "PDF만 맞추고" → "PDF · 워드 · 한글 · PPT · 엑셀 · 사진을 맞추고, 폴더 · 파일마다 ‘PC에만 두기’를 고를 수 있어요(서재 화면의 폴더 · 파일 메뉴)".
- 올리기 멈춤 문구의 "PDF"(`sync-look.js:50-52` · `:79-81` · `:134-136`) → "파일".

### 10.9 문제 목록 · 알림 · 오류 문구 (`sync-look.js` 이유 표 `:161` 근처에 추가)

| 코드 | 문구 |
|---|---|
| `bad_format` | "확장자와 파일 내용이 맞지 않아요 — 올리지 않았어요." |
| `local_elsewhere` | "‘{PC}’에만 두기로 한 파일과 같은 파일이라 맞추지 않았어요. 그 PC에서 [동기화 켜기]를 하면 여기에도 내려와요." |
| `local_missing` | "이 PC에만 두기로 한 파일을 찾지 못했어요 — Windows 휴지통에서 되살리거나 같은 파일을 다시 넣어 주세요." |
| `mode_fail` (`missing`) | "‘PC에만 두기’를 마치지 못했어요 — 이 PC에 파일이 없어요. 서재에서 [바꾸기 취소]를 누르거나 파일을 다시 받은 뒤 기다려 주세요." |
| `convert_failed` · `no_converter` | 서버 문구 그대로(`convert.CONVERT_FAILED` · `NO_CONVERTER`) |
| 알림 `moved_local` 확인 창 | **"다른 PC에만 두기로 한 파일 n개가 이 PC에 있어요"** / "‘{PC}’에만 두기로 바꿔서 이 PC의 사본은 필요 없어요. Windows 휴지통으로 옮길까요?" [이 PC에서 지우기(Windows 휴지통으로)] [나중에] · [동기화 끄기] |
| 알림 `swap_rep` | "문서를 원본 파일로 바꿨어요: {이름} — 전에 받은 PDF 변환본은 Windows 휴지통에 있어요." |
| 워커 `local_file` | "이 PC에서 파일을 찾지 못했어요(옮겼거나 고치는 중일 수 있어요). 잠시 뒤 다시 해 주세요." |
| `local_unsupported` (`.ppt` · `.xls` · `.rtf` — 서버 400 · 워커 결과 같은 문구) | "옛 파워포인트(.ppt) · 엑셀(.xls) · RTF 파일은 이 PC에서 내용을 읽지 못해 AI를 쓸 수 없어요. [동기화 켜기]로 서버에도 저장하면 AI를 쓸 수 있어요. (.pptx · .xlsx · .docx로 다시 저장해도 돼요.)" |
| `local_unsupported` (HWP 3.x 등 옛 한글) | "아주 옛 한글 파일(HWP 3.0 이하)은 이 PC에서 내용을 읽지 못해요. [동기화 켜기]로 서버에도 저장하거나 한글에서 새 형식으로 저장해 주세요." |
| `local_unsupported` (사진) | "사진(이미지)은 글자를 읽지 않아요. AI 요약 · 질문은 쓸 수 없어요." |
| 워커 `local_unreadable` | "이 파일의 내용을 읽지 못했어요(손상 · 암호 · 배포용 문서이거나 너무 커요). [동기화 켜기]로 서버에 올리면 서버에서 다시 읽어 볼 수 있어요." |
| 워커 `local_no_text` | "이 파일에서 글자를 읽지 못했어요(사진 · 스캔본)." |

---

## 11. 보안

1. **경로는 렌더러가 정하지 않음**: 화면은 논문 id만 보냄. 경로는 엔진 저널(`J.rel`) → `safeJoin`(조각마다 이름 규칙 · `..` · 드라이브 · 예약 이름 · `.paperlab-sync` 거부, `paths.js:58-69`) → main이 **다시** `checkInRoot`(루트 `realpath` 안 · 대상과 모든 상위 조각이 링크/정션 아님 · 일반 파일 · `\\?\` · UNC 아님) → 읽은 바이트의 해시 = 저널 해시. 검사와 읽기 사이 바뀜은 해시로 잡음(6단계 12.4절의 TOCTOU 수용 위험보다 좁힘).
2. **IPC 출처 검사**: `pl:local-*`는 `isCloudSender`(최상위 프레임 · 서버 출처 — 하위 프레임 · 다른 출처 거부, `ipc.js:7-9` · `:25`). `extract:*`는 `isLocalSender` + 경로 `/extract.html`. 앱 창은 서버 출처 밖으로 가지 않음(`window.js:103-119` 그대로). 거부는 로그 한 줄(채널 이름만).
3. **무엇을 읽을 수 있나**: 이 PC가 보관하는 **로컬 항목 파일만**(`localFile`은 `storage = 'local'` · `holder = 나` 조건 — 켬 항목은 웹 경로로 읽으므로 다리가 필요 없음). 서버가 탈취돼도 다리로 읽을 수 있는 것은 사용자가 이미 서재에 등록한 동기화 루트 안 파일뿐이고, 임의 경로 · 루트 밖 · 동기화 대상이 아닌 확장자는 불가.
4. **열기**: `shell.openPath`는 확장자 허용 목록(`SYNC_EXTS`)만 — 실행 파일 · 바로 가기 · 스크립트 확장자는 동기화 대상이 아니라 저널에 들어올 수 없고 main도 다시 확인. 문서 매크로는 사용자 자기 파일을 자기 앱으로 여는 것(수용).
5. **추출 창**: 샌드박스 · 별도 세션 · 네트워크 차단 · 권한 거부 · `app://ui`의 정해진 파일만 · CSP `default-src 'none'`(+ `script-src 'self'` · `worker-src 'self'`). PDF.js `isEvalSupported: false`(웹 읽기와 같음).
5a. **문서 추출 프로세스**(9.5.3절): 별도 utilityProcess + 작업마다 새 `worker_threads` Worker(메모리 512MB · 30초 · 한 번에 하나), **바이트만 받고 경로 · 토큰 · 네트워크 쓸 일 없음**(파서가 하는 일은 메모리 안 해석뿐 — 외부 요청 · 매크로 실행 · 디스크 쓰기 경로 자체가 없음, LibreOffice를 쓰지 않으므로 서버 변환에서 막았던 외부 링크 그림 받기 같은 동작이 없음). ZIP: ZIP64 · 암호 · 낯선 압축 거부, 항목 5,000개 · 항목 64MB · 비율 200배 · 합계 256MB, `maxOutputLength`로 실제 출력도 상한(압축 폭탄). XML: DTD · 엔터티 선언 거부(외부 엔터티 · 엔터티 폭증), 깊이 · 태그 길이 상한. 옛 형식 파서(`hwp.js` · `word-extractor`)는 고정 버전 · 잠금 파일 무결성 · 라이선스 검사 · 배포 전 `npm audit`, 추출 프로세스 밖에서는 불러오지 않음(AC-S49). Node 권한 모델(`--permission`)은 스파이크 SX-1.
6. **IPC 크기 · 횟수**: `localFile` 100MB 상한 · 동시 2 · 분당 30. `localHas` 500개. 추출 결과 8MB.
7. **본문이 서버로 가지 않음**: 로컬 AI 프롬프트는 PC에서만 완성되고 사용자의 CLI 공급자로만 감(그 CLI를 쓰는 것 자체가 사용자 선택). 서버 로그 · 작업 `params`에 본문 없음(지금 K16 그대로). 서버 DB에는 `page_texts` 쓰기를 트리거가 막음(6장).
8. **R2 키 검사**: 받기 접두어에 `sources/` 추가 — 여전히 `users/{내 uid}/`만. 서버 `UserStorage.check`는 원본 키 규칙(`_SOURCE_KEY_RE`)을 이미 받음(서재 문서 명세 4장).
9. **사용자 격리**: 새 열은 모두 `papers` · `folders` · `jobs` · `sync_devices`(RLS force 그대로). `holder_device_id`는 그 사용자 기기만(`devices (id, user_id)` 복합 FK + 코드 검사), `GET /api/sync/holders`도 그 사용자 기기만.
10. **로그**: 서버 · 앱 모두 id · 결과 코드 · 개수만(파일 이름 · 경로 · 해시 · 서명 주소 없음 — 6단계 12.6절).

---

## 12. 경계 사례

| 경우 | 처리 |
|---|---|
| 로컬 항목을 보관 PC에서 **이름 바꾸기 · 폴더 안 이동** | 지금 `file.move`(메타데이터만). 저장 위치 그대로(D-3) — 켬 폴더로 옮기면 "폴더 설정과 다름" |
| 로컬 항목을 **루트 밖으로** 옮김 · 지움 | 지금처럼 `file.delete` → 서재 휴지통(정보 · 노트 보존). 파일은 PC 휴지통 · 다른 곳에 사용자가 둔 그대로 |
| 웹에서 로컬 항목 **이동 · 이름** | 피드 → 보관 PC가 `local_move`(지금 그대로) |
| 웹에서 로컬 항목 **삭제**(휴지통) | 피드 `trash` → 보관 PC가 Windows 휴지통(지금 그대로, 대량 기준). 보관 PC가 꺼져 있으면 켜질 때 |
| 서재 휴지통에서 **되살리기** | 정보 되살림, 저장 위치 그대로. 보관 PC에 파일이 없으면 문제 `local_missing`(Windows 휴지통에서 되살리면 `linked`) |
| **영구 삭제** · 30일 정리 | 행만 지움(R2에 아무것도 없음). 보관 PC 파일은 이미 Windows 휴지통 |
| 끄기 대기 중 **다른 PC가 내용을 고쳐 올림** | 서버 내용 교체(지금 규칙) → 보관 PC의 `mode.ack`가 `changed` → 받기로 맞춘 뒤 다시 확인 |
| 끄기 대기 중 **보관 PC에서 파일을 지움** | `file.delete` → 휴지통(대기 유지). 되살리면 이어짐 |
| 끄기 대기 중 **보관 PC가 해지됨** | `local_device_id`는 남지만 해지 → 화면 "확인 필요 — 고른 PC가 해지됐어요" + [취소] · [다른 PC 고르기](같은 `sync-mode` 요청을 새 `holder_device_id`로 — `to_local` 대기 중 보관 PC 변경 허용) |
| 켜기 대기 중 보관 PC가 **꺼져 있음 · 제거됨** | 기다림. 제거 후 해지하면 "파일 없음 (연결 해지된 PC)" · [파일 다시 올리기] 또는 다른 PC에 같은 파일 → `adopted`(대기가 `to_cloud`면 그 PC가 이어서 올림) |
| **같은 파일이 두 PC에** — A는 끔 폴더(로컬, 보관 A), B는 켬 폴더에 같은 해시 | B의 `files/add` → `local_elsewhere`(B 파일 그대로 · 문제 목록). 사용자가 A에서 켜면 B는 링크(같은 해시 · 위치는 나중 것 — 지금 규칙) |
| **같은 해시를 두 PC가 동시에 새로 넣음**(둘 다 끔 폴더) | 먼저 온 쪽이 로컬 항목(보관 = 그 PC), 나중 쪽은 `local_elsewhere` |
| 두 사람이 동시에(웹 · PC 앱) **끄기와 켜기** | 도착 순서. 나중 요청이 반대 방향이면 대기 취소(5.3절) — 지운 것 없음 |
| **폴더 끄기 후 그 폴더에 웹에서 업로드** | `cloud` + "폴더 설정과 다름" + 토스트(5.4절) |
| 켬 파일을 **끔 폴더로 PC에서 옮김** | 저장 위치 그대로, "폴더 설정과 다름". 엔진 · 서버가 자동으로 지우지 않음 |
| 보관 PC에서 **동기화 끄기** | 파일 그대로, 로컬 항목도 그대로(보관 PC 활성). 화면 "집 PC에만 (그 PC의 동기화가 꺼져 있어요)". 다시 켜면 첫 연결에서 해시로 `linked` |
| **재설치**(설치 ID 바뀜 → 새 기기로 다시 연결) | 6단계 규칙대로 옛 기기를 해지해야 루트를 고를 수 있음 → 해지된 옛 보관 PC의 로컬 항목은 첫 연결에서 같은 해시로 **`adopted`** |
| PC를 **영영 잃음**(고장) | 해지 → 로컬 항목은 정보만 남음("파일 없음"). 파일 사본이 있으면 [파일 다시 올리기] 또는 다른 PC 동기화 폴더에 넣어 `adopted`. **이것이 "PC에만"의 본질적 위험** — 끄기 확인 창의 경고 문단(확정 Q-5 — 10.5절) · 도움말 |
| 로컬 문서 AI인데 형식이 `.ppt` · `.xls` · `.rtf` · 사진 | 서버가 작업을 만들지 않고 400 `local_unsupported`(문구 10.9절) |
| 로컬 `.hwp`가 배포용 · 암호 · 손상 | 워커 `local_unreadable` — 작업 실패, 다시 시도 없음 |
| 로컬 `.docx`가 압축 폭탄 · 거대 XML | 상한에서 멈춤 → `local_unreadable`, 추출 Worker만 끝나고 앱 · 동기화는 그대로 |
| 로컬 문서를 보관 PC에서 **고침**(Word로 저장) | `upload_content(local)` → 해시 · 크기 · 시각만 서버에. 충돌 없음(보관 PC 하나) |
| 켬 문서를 **두 PC에서 고침** | 6단계 10장 그대로(표현 해시 기준). 사본은 `원래 이름 (충돌 사본 PC 날짜).docx`(`copy_name` 확장자 일반화), 서버의 진 쪽 원본 · 변환본 · 본문을 사본 논문으로 먼저 복사 |
| 켬 문서의 **서버 변환 실패**(암호 걸린 hwp 등) | `files/add` 400 `convert_failed` → 문제 목록(재시도 안 함 — 같은 파일이면 같은 결과, 파일이 바뀌면 다시) |
| 서버에 **LibreOffice 없음** | `no_converter` → 문제 목록 "서버에 문서 변환기가 없어 이 파일은 올릴 수 없어요 — PC에만 두기로 바꾸면 맞출 수 있어요" |
| `.pdf` 이름의 **PDF가 아닌** 파일 · 확장자와 내용 불일치 | `not_pdf` · `bad_format` — 올리지 않음(지금 규칙) |
| **옛 변환본**(0.3.1이 받은 `X.pdf`)을 사용자가 고쳐 둠 | `swap_rep`에서 옛 파일을 새 항목으로 올리고 원본은 따로 받음(둘 다 남음) |
| 0.3.1 PC가 남아 있음 | 426 → 업데이트 확인 → 0.4.0 설치 전까지 그 PC는 동기화를 멈춤(파일 · 저널 그대로). 그 PC를 보관 PC로 고를 수 없음(`protocol` 1) |
| 0.4.0 PC + **옛 서버**(배포 전) | v1 모드(8.6절) — 0.3.1과 같은 동작 |
| 로컬 항목 + **휴지통 같은 논문 중복 판정**(웹 업로드 · K-40) | 해시 · DOI 규칙 그대로. 로컬 항목은 DOI가 없는 일이 많아 해시로만 짝지어짐 |
| 대량: 폴더 하나 끄기 = 1,000편 | 요청은 대기만 씀(빠름). 보관 PC는 `mode.ack`를 20개씩(ops 상한). 다른 PC의 사본 1,000개는 대량 확인 창 |

---

## 13. 호환 · 배포 순서 (D-7)

실제 순서(팀장 확정 — 서버 PC는 같은 저장소로 서버를 반영한 직후 앱을 빌드함, `deploy/server-pc/README.md` 20.2절):

1. **서버 배포 + 앱 0.4.0 빌드 · 내보내기 — `update.ps1 -Yes` 한 번**. 이 반영은 `desktop/`이 바뀌므로(`update.ps1`의 `$desktopChanged` = 옛 커밋과 새 커밋 사이 `git diff --name-only -- desktop/`가 비지 않음) `update.ps1 -Yes`가 **그 실행 안에서** 차례로: 코드 → 마이그레이션 `20261017000001`(코드보다 먼저 DB — 새 열은 기본값이라 옛 코드가 돌아도 안전) → 재시작 → `/api/health?deep=1`이 새 `commit` → `update.log` "업데이트 성공" → **앱 0.4.0 빌드**(`npm ci` · `npm run dist`, 몇 분 · 최대 20분) → `releases`에 `.exe` · `.blockmap` · `release.json` · **`latest.yml`(마지막)** → "데스크톱 앱 빌드 성공: 버전 0.4.0". `-BuildDesktop`을 따로 돌릴 필요가 없음(빌드가 실패 · 건너뜀일 때만 — 3번). 재시작 순간부터 0.3.1 PC는 동기화가 **426으로 안전하게 멈춤**(파일 · 저널 그대로).
2. (서재 문서 기능이 먼저 운영에 나갔으므로) **`python -m paperlab.admin sync-originals`(`--dry-run` → 실행)를 1번이 도는 동안 두 번째 PowerShell 창에서** — 원본 해시 · 이름. 1번은 빌드까지 끝나야 돌아오므로 1번이 끝난 뒤에 하면 이미 늦음.
   - **안전한 창**: 시작 = `/api/health?deep=1`의 `commit`이 새 커밋(7자리 — `update.log` "업데이트 시작: 옛 → 새"의 새)이 된 때(그 전에는 옛 서버 — 0.3.1 PC가 아직 동기화 중이고 마이그레이션 전일 수 있으므로 돌리지 않음. 상태 확인 실패로 `update.ps1`이 옛 커밋으로 되돌렸으면 돌리지 않음). 끝 = `releases\latest.yml`이 0.4.0이 된 때(`update.log` "데스크톱 앱 빌드 성공: 버전 0.4.0"). 그 사이에는 서버가 새 코드라 0.3.1 PC는 426으로 멈춰 있고 0.4.0은 아직 받을 수 없어 **어떤 PC도 옛 문서 행을 건드리지 못함**. 창의 길이 ≈ 빌드 시간(몇 분)이라 `--dry-run`은 숫자만 보고 곧바로 실행.
   - 창이 끝나도 실행이 끝나지 않았으면 멈추지 않고 끝까지 둠(잃는 파일 없음): 0.4.0 PC는 다음 확인(426 재시도 30분 · 앱 시작 · 6시간) 때 받아 쉬는 동안 설치하므로 실제로는 조금 더 여유가 있고, 끝나지 않은 행은 서버가 지킴 — 끄기 막음(`needs_originals` — 7.2절) · PC에서 올라온 `.pdf`가 원본을 지우지 않음(7.3절). 그 사이 PC가 변환본을 고쳐 올린 행은 `sync-originals`가 옛 원본을 PC 표현으로 되돌리지 않고 원본을 떼어 냄(7.3절 — PC의 PDF가 최신).
3. 빌드가 실패 · 건너뜀(`update.log` WARN)이면 `sync-originals`를 마친 뒤 `update.ps1 -BuildDesktop`(그동안 0.3.1 PC는 426으로 멈춰 있으므로 오래 미루지 않음). 0.4.0이 `releases`에 올라가면 자동 업데이트.
4. 남은 0.3.1 PC: 동기화 426 → `updater.check()`(`main.js:94`) → 0.4.0. 그 사이 그 PC의 파일 · 저널은 그대로(엔진은 426에서 아무것도 지우지 않음 — `engine.js:550` 확인됨). 관리자 확인: `select app_version, count(*) from paperlab.devices where revoked_at is null group by 1`.
- 0.4.0 앱은 **옛 서버**(배포 전 · 되돌린 서버)를 만나면 v1 모드 — 동작이 0.3.1과 같음(8.6절). 그래서 순서가 거꾸로 되어도(앱 먼저) 안전함.
5. 웹 화면은 서버와 같이 배포(같은 정적 파일). `sync` 객체가 없으면(옛 서버 캐시) 배지를 그리지 않음.
- **되돌리기**: 서버 코드를 되돌려도 새 열은 기본값이라 옛 코드가 동작. 단 **로컬 항목이 이미 생겼으면** 옛 코드의 6단계 피드가 그 항목을 "PDF 없음"으로 보고 동기화 대상에서 빼므로 0.4.0 엔진(v1 모드로 내려감)이 K-23 다시 올리기를 할 수 있음 → **로컬 항목이 생긴 뒤에는 서버를 되돌리지 않음**(되돌려야 하면 먼저 모든 로컬 항목을 켜기 — 관리자 작업, 위험 R-3).

---

## 14. 테스트 계획

공통: 6단계 18장 원칙 그대로(운영 금지 · 가짜 휴지통 주입 · 임시 루트). 표시 `[자동]` pytest(DB 없음) · `[db]` 테스트용 Supabase · `[Node]` node:test · `[다중]` 로컬 서버 + 엔진 여러 개 · `[수동]` · `[실환경]`.

### S0x 데이터
- **AC-S01** [db] 마이그레이션 두 번 돌리면 두 번째는 할 일 없음, 기존 마이그레이션 파일 diff 0. 기존 행: `sync_mode = 'inherit'` · `storage = 'cloud'` · 나머지 빈 값.
- **AC-S02** [db] `papers_local_no_keys_check`: `storage = 'local'`에 `pdf_key` · `source_key` · `rag_key`를 쓰면 23514. `mode_pending` 일관 제약.
- **AC-S03** [db] `file_name` CHECK가 목록 확장자(대소문자 무관)를 받고 `.exe` · `.lnk` · 확장자 없음은 거부.
- **AC-S04** [db] 트리거: `storage` · `local_device_id` · `mode_pending` · `source_sha256` 변경은 `sync_rev`를 올리고 `sync_mode`(논문)만 바꾸면 안 올림. 폴더 `sync_mode` 변경은 올림.
- **AC-S05** [db] 로컬 논문에 `page_texts` insert → 23514(트리거).
- **AC-S06** [db] 기기 행 삭제 → `local_device_id` · `pinned_device_id` null(FK set null), RLS 자동 검사(1단계 AC-20)가 그대로 통과.

### S1x 서버 API — 워커 v2
- **AC-S11** [db] 머리글 없는 동기화 요청 → 426(`min_app_version: "0.4.0"`), 머리글 2 → 정상, `start` 응답 `protocol: 2` · `exts`.
- **AC-S12** [db] 스냅숏 · 피드 · lookup: 로컬 항목 포함 · 표현 해시 · `kind`/`storage`/`holder`/`pending`. 원본 항목은 `source`(원래 확장자 이름), 해시 모르는 옛 원본은 `pdf`.
- **AC-S13** [db] `files/add` 원본(docx · hwpx — LibreOffice 있을 때) → `sources/` 원본 · `papers/` 변환본 · `page_texts`, `file_name` 원래 이름, 해시 = 원본. `download`가 원본 서명 주소 · `kind: "source"`.
- **AC-S14** [db] `files/add` `storage: "local"`: R2 쓰기 0 · `page_texts` 0 · 제목 = 확장자 뗀 이름 · `storage = 'local'` · 보관 = 그 기기. 실효 켬 위치면 409 `upload_required`. 올렸는데 실효 끔이면 로컬로 만들고 임시 파일 삭제.
- **AC-S15** [db] 해시 일치 표 5줄(`linked` · `adopted` · `local_elsewhere` · `restored` · 켬 `linked`) 각각.
- **AC-S16** [db] 로컬 항목 `content`: 보관 PC만(다른 기기 409 `not_holder`), 메타데이터만 바뀜, R2 0.
- **AC-S17** [db] 원본 항목 내용 충돌: 사본 논문이 원본 · 변환본 · 본문을 모두 가짐, 사본 이름 확장자 유지, 원래 논문의 옛 원본은 커밋 뒤 삭제.
- **AC-S18** [db] `download`의 로컬 항목 → 그 항목만 409 `local_only`.

### S2x 전환
- **AC-S21** [db] 끄기 요청 → 대기만(R2 · `page_texts` 그대로). `mode.ack`(해시 일치) → R2 PDF · 원본 · 번역 파일 삭제(커밋 뒤) · `page_texts` 0 · 벡터 캐시에서 빠짐 · 노트 · 하이라이트 · 태그 · 컬렉션 · 요약 남음 · 번역 · 색인 작업 취소. 해시 다름 → `changed`(아무것도 안 지움).
- **AC-S22** [db] 보관 PC가 아닌 기기의 `mode.ack` · 대기 아님 → `not_pending`, 아무것도 안 지움.
- **AC-S23** [db] 켜기 요청 → `promote`(업로드 · 변환 · 추출) → `storage = 'cloud'` · 색인 작업 생성 · 용량 · DB 검사(`db_full`).
- **AC-S24** [db] 반대 방향 요청이 대기를 취소(R2 · 본문 변화 0). 같은 방향 반복은 멱등.
- **AC-S25** [db] 폴더 끄기: `inherit` 논문만 대기, 따로 정한 것은 그대로, `reset_children`이면 아래 설정 초기화 후 계산. `dry_run` 숫자(`freed_bytes` · `other_pcs`)가 실제와 같음.
- **AC-S26** [db] `holder_required` · `no_sync_pc` · `holder_not_eligible`(프로토콜 1 · 해지 · 동기화 꺼짐).
- **AC-S27** [db] 옮기기 · 웹 업로드 · 되살리기는 저장 위치를 바꾸지 않고 `mismatch`가 참.
- **AC-S28** [db] 사용자 격리: 남의 논문 · 폴더 · 기기 id → 404 · `blocked` · 400.

### S3x PC 엔진
- **AC-S31** [Node] `filekind.kindOf`가 `convert.kind`와 같은 결과(공유 시험 표 — PDF/ZIP/OLE/RTF/그림 매직 × 확장자). `SYNC_EXTS` = `convert.ACCEPT_EXTS`(`[자동]` 계약 시험).
- **AC-S32** [Node] `reconcile`: 8.3절 표의 모든 줄을 그대로 시험 사례로.
- **AC-S33** [Node] `moved_local` 대량 확인 창(기준 넘음) · [나중에] · Esc. 기준 아래면 바로 Windows 휴지통(가짜).
- **AC-S34** [Node] `swap_rep`: 원본 받기 → 옛 변환본 가짜 휴지통 → 저널. 중간에 죽어도 다음 바퀴가 삭제로 읽지 않음(디스크 → 저널 순서).
- **AC-S35** [Node] v1 저널 → v2 이전 + 전체 다시 맞추기에서 삭제 추론 0.
- **AC-S36** [Node] v1 모드(옛 서버 응답 — `protocol` 없음): `.pdf`만 · 새 동작 0 · 0.3.1 시험 묶음(`sync-engine.test.js`) 전부 통과.
- **AC-S37** [Node] `transfer.checkUrl` 받기가 `sources/` 접두어를 받고 남의 uid · 다른 접두어는 요청 0.
- **AC-S38** [Node] `add_local` → `upload_required` → 다음 바퀴 `upload_new`.

### S4x 다리 · 보안
- **AC-S41** [Node] `checkInRoot`: 루트 밖 · `..` · 정션 상위 · 대상이 링크 · UNC · `\\?\` · 확장자 밖 → 거부. 해시가 저널과 다르면 거부.
- **AC-S42** [Node] `ipc` 처리기: 하위 프레임 · 다른 출처 · `app://` 프레임의 `pl:local-file` 거부, 숫자 아닌 id 거부, 동시 · 분당 제한.
- **AC-S43** [Node] `localFile`은 이 PC 보관 로컬 항목만(켬 항목 · 남의 보관 · 대기 중 → `not_local`).
- **AC-S44** [수동] 추출 창이 네트워크 요청 0(개발자 도구 네트워크), 권한 요청 거부.
- **AC-S45** [자동] `window.uiFile`이 정확히 두 vendor 경로만 더 받고 `vendor/../main.js` · 다른 `.mjs`는 null.
- **AC-S46** [Node] `zip.js` 거부 사례(시험이 만든 견본): ZIP64 표지 · 암호 플래그 · 압축 방법 12/14 · 항목 5,001개 · 선언 비율 201배 · **선언은 작고 실제로 큰 항목(선언을 속인 폭탄)** — 실제 출력이 `maxOutputLength`에서 멈춤 · 42.zip 꼴 중첩(안의 ZIP을 풀지 않음) · 위치가 파일 밖 · 로컬/중앙 이름 길이 불일치 · CRC 불일치 → 모두 `local_unreadable`, 메모리 최고점 < 600MB.
- **AC-S47** [Node] `xmltext.js`: `<!DOCTYPE` · `<!ENTITY` 거부, 엔터티 폭증 견본 거부, 깊이 257 · 태그 64KB 초과 거부, 5개 엔터티 · 숫자 참조 해독, 잘못된 코드 포인트 무시.
- **AC-S48** [Node] 형식별 추출(9.5.1절 표 줄마다): 시험이 만든 `.docx` · `.hwpx` · `.pptx` · `.xlsx`(공유 문자열 · inlineStr · 숫자) · `.odt` · `.odp` · `.ods`와 커밋한 `sample.hwp` · `sample.doc`에서 "PaperLab 시험 문서 가나다 ABC"가 나옴, 조각 단위 · 2,000조각 · 8MB 상한, HWP 3.x 표지 → `local_unsupported`, 배포용 · 암호 `.hwp` → `local_unreadable`, 확장자와 판정 불일치 → `local_unreadable`.
- **AC-S49** [자동] 코드 검사: `hwp.js` · `word-extractor`를 `require`하는 파일은 `desktop/extract/` 안뿐. 추출 프로세스 코드에 `fs.write*` · `child_process` · `net` · `http` · `fetch` 없음. `scripts/check-licenses.js`가 통과(정확한 버전 · 허용 라이선스), `THIRD_PARTY_NOTICES.txt`에 잠금 파일의 모든 운영 의존성이 있음.
- **AC-S4A** [Node] 추출 Worker: 무한 반복 견본(시험용 가짜 파서 주입) → 30초에 끝나고 `local_unreadable`, 메모리 폭주 가짜 → `ERR_WORKER_OUT_OF_MEMORY` → `local_unreadable`, 다음 작업은 정상. 추출 프로세스가 죽으면 main이 다시 띄움.
- **AC-S4B** [수동 · 스파이크] SX-1(`--permission` 가능 여부) · SX-2(`hwp.js`를 DOM 없는 Worker에서 불러오기) 결과 보고.

### S5x AI
- **AC-S51** [db] 로컬 논문 요약 요청 → 작업 `runner = cli` · `pinned_device_id = 보관 PC`, API 칸 0. 다른 기기 `claim` → 안 잡힘, 보관 PC → 잡힘, `caps` 없는 잡기 → 안 잡힘.
- **AC-S52** [db] 보관 PC CLI 칸 실패 → API로 넘어가지 않고 실패(`fail_or_fallback`).
- **AC-S53** [db] `cli_task` 프롬프트에 본문 0 · 표지 정확히 1회 · 제목에 넣은 `\u2063`는 지워짐. `api_runner`가 로컬 논문을 받으면 `local_only`.
- **AC-S54** [Node · 자동] JS `fence` · `tagged_text`가 Python `ai.fence` · `PaperContext.tagged_text`와 같은 출력(공유 시험 벡터 — `tests/test_js_node.py` 방식).
- **AC-S55** [db] explain · translation · fetch-pdf · pdf/complete(보관 PC 활성) → 409 `local_only`, 보관 PC 해지면 pdf/complete 허용 → `cloud`.
- **AC-S56** [db] 서재 질문 · 본문 검색에 로컬 항목 0, 메타데이터 검색은 찾음, `excluded_local` 숫자.
- **AC-S57** [db] 로컬 `.ppt` · `.xls` · `.rtf` · 사진 항목의 요약 · 대화 요청 → 400 `local_unsupported`, 작업 0. `LOCAL_TEXT_EXTS`(서버) = `desktop/extract/kinds.js`(계약 시험).
- **AC-S58** [다중] 보관 PC의 로컬 `.hwp` · `.docx` 요약: 가짜 CLI(`desktop/test/fixtures/fake-cli.js`)가 받은 프롬프트에 견본 글이 있고 표지가 없음, 서버로 간 요청(잡기 · 결과)에는 견본 글이 없음(결과 본문은 가짜 CLI가 정한 요약뿐).
- **AC-S59** [db] 끄기(`mode.ack`) 뒤 `ai_summaries` · `chat_sessions`/메시지 · `explanations` · `annotations.text`가 그대로(확정 Q-1 · Q-2).

### S6x 웹 화면
- **AC-S61** [Node(mjs)] 배지 · 메뉴 항목 결정 함수(새 `syncmode.js` 순수 함수): 10.2 · 10.3 · 10.4절 표의 모든 상태.
- **AC-S62** [수동] 확인 창 문구 · 처음 초점 [취소] · 보관 PC 라디오 · 토스트. **끄기 확인 창에 Q-5 경고 문단이 파일 하나 · 여러 개 · 폴더 모두에서 보임**(AC-S61 순수 함수 시험에도 문구 그대로 확인).
- **AC-S63** [수동 · PC 앱] 보관 PC에서 로컬 PDF 읽기 · 하이라이트 저장 · 다시 열기에서 하이라이트 위치 같음, 사진 보기, 문서 [기본 앱으로 열기].
- **AC-S64** [수동] 다른 PC · 웹에서 안내 · 노트 · 하이라이트 목록 보임, 읽기 · 설명 · 번역 막힘 문구.

### S7x 호환
- **AC-S71** [다중] 0.3.1 엔진(옛 코드 고정본 — `desktop/test/fixtures`에 6단계 엔진 사본 대신 **머리글 없이 부르는 가짜**) + 새 서버 → 426, 파일 · 저널 변화 0.
- **AC-S72** [다중] 0.4.0 엔진 + 옛 서버 응답(가짜 API v1 모드) → 6단계 다중 시험 그대로 통과.
- **AC-S73** [db] `admin sync-originals --dry-run` 숫자 · 실제 실행 뒤 표현이 `source`로, 두 번째 실행 할 일 0.
- **AC-S74** [db] 원본을 적은 뒤 PC가 변환본(`.pdf`)을 고쳐 올린 옛 문서 행: `sync-originals`는 해시를 채우지 않고 원본을 떼어 냄(`source_key` 비움 · R2 원본 삭제 · PC 표현 = 고친 PDF 그대로 · 이름 `.pdf` 그대로), `--dry-run`은 떼어 낼 수를 셈, 웹에서만 바뀐 옆 행은 그대로 원본 표현. 그 뒤 끌 수 있음(`needs_originals` 없음).

### S8x 여러 PC 끝에서 끝까지
- **AC-S81** [다중] A · B 동기화. A에서 폴더 끄기 → A `mode.ack` → R2 객체 0 · B 파일 가짜 휴지통 · 웹 배지 "A에만". 다시 켜기 → A 올림 → B가 받음 · 본문 검색 됨.
- **AC-S82** [다중] A 끔 폴더에 새 docx → 로컬 항목, B에 파일 0, 웹 정보만. B에 같은 파일 → `local_elsewhere`. A 해지 → B에 같은 파일 → `adopted`.
- **AC-S83** [다중] 켬 폴더 docx: A 추가 → B는 `.docx` 원본을 받음(해시 같음). A · B 동시 수정 → 충돌 사본 `.docx`.
- **AC-S84** [다중] 무작위 불변식(6단계 AC-656 확장): 끄고 켜기 · 옮기기 · 지우기를 섞어도 ① 어떤 파일도 소리 없이 사라지지 않음 ② 로컬 항목은 R2 객체 0 · `page_texts` 0 ③ 로컬 항목 파일은 보관 PC에만(다른 PC는 휴지통).
- **AC-S8R** [실환경] 시험용 계정 · 시험용 루트, PC 두 대(6단계 6R과 같은 조건): 위 S81 · S82, 한글 문서 하나로 S83.

---

## 15. 작업 분담 — 병렬 3명 (파일 소유 · 계약)

**원칙**: 한 파일은 한 사람만 고침. 계약(아래 C-1~C-4)은 **첫날 이 명세로 고정**하고 바꿀 때는 세 사람 + 팀장 동의. 각자 가짜 상대(가짜 서버 · 가짜 다리)로 먼저 만들고 마지막에 `[다중]` · `[수동]`으로 붙임.

### 15.1 서버 · DB (개발자 S)

| 파일 | 할 일 |
|---|---|
| `supabase/migrations/20261017000001_selective_sync.sql`(새) | 6장 전부 |
| `paperlab/db.py` | `file_name_problem` · `clean_file_name` · `numbered_name` · `copy_name` 확장자 일반화(`:87-141`), `set_source(..., sha256)`, `mode_map` · `effective_mode` · `sync_view` · `set_sync_mode` · `demote_to_local` · `promote_to_cloud` · `holders()`, `_PAPER_SELECT`(`:304`)에 보관 PC 이름 · 해지 여부, `_HIDDEN_PAPER_COLS`(`:51`)에 새 내부 열, `list_folders`(`:771`)에 `sync_mode` · `effective_mode` · `local_count`, `ensure_file_name` · `name_all_files`(`:887-901`) 로컬 포함, `stats` · 사용량에 `local_only` · `local_bytes` |
| `paperlab/sync.py` | 7.1절 전부: 프로토콜 문(`:311-329`), 피드 · 스냅숏 · lookup · download 표현(`:167-279` · `:516-564`), `read_upload` 이름 · 변환(`:566-580`), `add_file` 로컬 · 해시 일치 표(`:607-669`), `content` · `conflict` 표현 해시 · 원본 사본(`:673-738`), `promote` 경로, `OPS`에 `mode.ack` · `mode.fail`(`:860`), `COUNT_KEYS`에 `local` · `pending_mode` |
| `paperlab/server.py` | `prepare_upload` · `attach_from_incoming` 7.3절, `read_incoming` 이름 전달, `demote_paper` · `promote` 도우미 · `H`에 추가(`:3044`), 7.2절 경로 3개 · 응답 필드, `pdf-url` · `source-url` · `pdf/*` · `fetch-pdf` · `explain` · `translation*` 409, `route_for(ctx, kind, paper)` 7.4절, `/api/devices` · 해지 응답, `ask` `excluded_local`, 업로드 `note_local_folder` |
| `paperlab/jobs.py` | `build_route` 보관 PC 한정, `create_job(pinned_device_id)`, `claim_cli` 조건 · `caps`, `text_request` · `cli_task` 표지 · `local`, `WORKER_CODES` · `DEFAULT_ERRORS`, `device_view` `local_count` · `sync.protocol`, `waiting_reason` |
| `paperlab/ai.py` | `PaperContext.local_text`, `LOCAL_TEXT_MARKER`, 다른 부분에서 `\u2063` 제거 |
| `paperlab/worker_api.py` | `claim`에서 `caps` 읽어 `jobs.claim_cli`에 |
| `paperlab/api_runner.py` | 로컬 논문 방어(`:184`) |
| `paperlab/admin.py` | `sync-originals` 명령 |
| `tests/test_selective_sync.py` · `tests/test_sync_v2_api.py` · `tests/test_local_ai_jobs.py` · `tests/test_selective_sync_contract.py`(새) | S0x · S1x · S2x · S5x(db) · S73, 계약 시험(확장자 목록이 `convert.ACCEPT_EXTS` = `desktop/sync/filekind.js` = `static/js/filetypes.js`, JS `fence` 시험 벡터 파일 `tests/fixtures/fence_vectors.json`을 만들어 D가 읽음) |
| `deploy/server-pc/README.md` | 13장 순서 · `sync-originals` |

### 15.2 PC 앱 (개발자 D)

| 파일 | 할 일 |
|---|---|
| `desktop/sync/filekind.js`(새) · `paths.js` · `scanner.js` | 8.1절 |
| `desktop/sync/reconcile.js` | 8.3절 표 + `effectiveMode` |
| `desktop/sync/engine.js` · `journal.js` · `entry.js` | 8.2 · 8.4 · 8.5 · 8.6절, `resolve` IPC, 상태 `counts.local` · `pending_mode`, 미리보기 줄 |
| `desktop/sync/transfer.js` | `sources/` 접두어 |
| `desktop/worker/api-client.js` | `headers` · 경로별 시간 제한 옵션 |
| `desktop/worker/worker.js` · `desktop/worker/local-text.js`(새) | 9.4절 워커 쪽, `caps`, `fence` · `taggedText` |
| `desktop/main/sync-host.js` | `checkInRoot`(떼어냄) · `localFile` · `openLocal` · `localHas` · `localText` · 추출 창 관리 · `:261` |
| `desktop/main/main.js` · `ipc.js` · `window.js` | 컨트롤러 함수 연결, `pl:local-*` · `extract:*` 처리기, `uiFile` · 추출 창 CSP · 세션 |
| `desktop/preload/preload.js` | 9.1절 함수 + `paperlabExtract` |
| `desktop/ui/extract.html` · `extract.js`(새) · `status-sync.js` · `sync-look.js` | 추출 화면, 10.8 · 10.9절 문구 |
| `desktop/scripts/copy-vendor.js`(새) · `package.json`(0.4.0 · 스크립트) · `.gitignore`(`ui/vendor/`) · `electron-builder.config.js`(`ui/vendor` 포함 확인) | 9.4절 빌드 |
| `desktop/test/*`(새 · 기존 시험 확장) · `test/fixtures/fake-sync-api.js` | S3x · S4x · S54(JS 쪽 — `tests/fixtures/fence_vectors.json` 읽기) · S71 · S72 |
| `desktop/README.md` | 사용자 안내: PC에만 두기 · 문서 동기화 · 로컬 AI · PC 고장 위험 |

### 15.3 웹 화면 (개발자 W)

| 파일 | 할 일 |
|---|---|
| `paperlab/static/js/syncmode.js`(새) | 순수 함수: `badgeFor(paper, ctx)` · `folderMenu(folder, ctx)` · `paperMenu(paper, ctx)` · `confirmText(preview, ctx)`(ctx = `{desktop: info()|null, deviceId}`) — AC-S61 |
| `paperlab/static/js/library.js` | 배지(`:193-196`), 상세 "저장 위치" 줄 · 버튼 줄 로컬 분기(`:362-367`), ⋯ 메뉴 · 여러 개 선택(`:470-481` · `:282`), 이동 · 업로드 뒤 토스트 |
| `paperlab/static/js/app.js` | 폴더 표 · 메뉴(`:709-737`), 폴더 스위치, 연결된 PC 줄 · 해지 확인 문구, `stats.local_only` |
| `paperlab/static/js/dialogs.js` | 켜고 끄기 확인 창(보관 PC 라디오 · 하위 항목 체크) |
| `paperlab/static/js/reader.js` | 9.3절 · 10.6절(`loadPdf` `:283-301` 로컬 분기, 사진 · 문서 · 안내, AI · 설명 탭 문구) |
| `paperlab/static/js/ask.js` | `excluded_local` 줄 |
| `paperlab/static/js/api.js` | 409 `local_only` · `holder_required`를 오류 토스트 대신 호출자에게(본문 필드 보존) |
| `paperlab/static/css/app.css` | 배지 · 점선 · 폴더 `PC` 표 · 스위치(디자인팀과 동시 수정 금지) |
| `tests/js/syncmode.test.mjs`(새) · `tests/test_js_node.py`(새 파일 등록) | AC-S61 |

### 15.4 계약 (세 사람이 지킬 인터페이스)

- **C-1 워커 동기화 API v2 (S ↔ D)** — 7.1절 표 · 오류 코드 · `files/add` 해시 일치 표 · `promote` · `mode.ack`/`mode.fail` · 머리글 `X-PaperLab-Sync: 2` · `start` 응답 `protocol`/`exts`/`device_id`. D는 `fake-sync-api.js`를 이 모양으로 먼저 고침.
- **C-2 사용자 API (S ↔ W)** — 7.2절 경로 3개 · "켜고 끄기 응답" JSON · 10.1절 `sync` 객체 · 폴더 `sync_mode`/`effective_mode`/`local_count` · 409 `local_only` 본문(`holder_device_id`, `holder_name`) · `no_route_local` · `excluded_local` · `note_local_folder` · `/api/devices` `local_count`/`local_bytes`. W는 개발 서버(`FakeStorage`)가 준비될 때까지 이 JSON으로 가짜 응답.
- **C-3 preload 다리 (D ↔ W)** — 9.1절 함수 이름 · 인자 · 돌려주는 모양 · `code` 값. `window.paperlabDesktop`가 없거나 `localFile`이 없으면(웹 · 옛 앱) W는 "다른 곳" 화면으로. W는 시험용으로 `window.paperlabDesktop` 가짜(바이트를 `fetch('/static/…sample.pdf')`로)를 개발 실행에서만 넣음.
- **C-4 로컬 AI 작업 (S ↔ D)** — 7.4절: `cli_task`의 `local {paper_id, sha256, kind}` · 표지 문자열 정확한 값 · `fence` 규칙(시험 벡터 `tests/fixtures/fence_vectors.json` — S가 만들고 D가 읽음) · 결과 오류 코드 3개 · 잡기 `caps: ["local_text"]`.

### 15.5 순서

1. 첫날: 계약 고정(이 명세 7 · 9.1 · 10.1절) · S는 마이그레이션 · `fence_vectors.json` 먼저.
2. 병렬: S(서버 · db 시험) / D(가짜 서버로 엔진 · 다리 · 추출) / W(가짜 JSON · 가짜 다리로 화면).
3. 붙이기: `[다중]` S8x(S · D), `[수동]` S6x(W · D), 계약 시험 S31 · S54(S · D).
4. 배포: 13장 — **서버(마이그레이션 → 코드) → 곧바로 `sync-originals` → 곧바로 `update.ps1 -BuildDesktop`(앱 0.4.0)**. 그 사이 0.3.1은 426으로 멈춤. 0.4.0은 옛 서버와 v1로 돎.

---

## 16. 위험 · 남은 질문

| # | 위험 | 대응 |
|---|---|---|
| R-1 | 보관 PC 고장 = 로컬 파일 영구 손실(서재는 정보만) | P-2의 본질. 확인 창 · 도움말에 명시(Q-5), 백업은 사용자 몫 |
| R-2 | 다른 PC 사본을 Windows 휴지통으로 보내는 것에 사용자가 놀람 | 확인 창(10.5) · 대량 확인 창 · 알림 문구 |
| R-3 | 로컬 항목이 생긴 뒤 서버를 옛 버전으로 되돌리면 0.4.0 v1 모드가 K-23 다시 올리기 | 13장 — 되돌리기 금지(필요하면 먼저 모두 켜기) |
| R-4 | 문서 변환이 느림(최대 180초) · 서버 변환이 한 번에 하나 | 엔진 시간 제한 240초, 사용자당 `files/add` 동시 1 그대로. 대량 문서 첫 연결은 오래 걸림(진행률) |
| R-5 | 로컬 항목 서지 정보가 빈약(제목 = 파일 이름) | 후속(3장 "안 하는 것") |
| R-6 | 하이라이트 글(`annotations.text`) · AI 결과가 서버에 남아 "본문 일부"가 서버에 있음 | P-5 "지금처럼" 그대로 + D-12 → Q-1 · Q-2 |
| R-7 | 추출 창(숨은 BrowserWindow)의 메모리(큰 PDF) | 한 번에 하나 · 60초 · 끝나면 닫음 · 100MB 상한 |

| # | 질문 | 추천 |
|---|---|---|
| Q-1 | 끌 때 AI 요약 · 대화 · 선택 설명 기록도 지울까? | 남김(D-12) + 확인 창 한 줄. 지우기를 원하면 확인 창 체크 상자 "AI 기록도 지우기" 추가 |
| Q-2 | 로컬 PDF의 하이라이트 글(`annotations.text`)을 서버에 둬도 되나? | 둠(P-5 "지금처럼"). 원하면 로컬 항목은 `text`를 비우고 쪽 + 사각형만 — 서재 질문 · 글쓰기 출처의 하이라이트 줄이 빠짐 |
| Q-3 | 로컬 문서 AI의 본문은 어떻게 읽나? | **확정 — D-14**: PC에 LibreOffice를 요구하지 않음. PC 앱이 직접 ZIP · XML로 글만 뽑음(`.docx` · `.hwpx` · `.pptx` · `.xlsx` · `.odt` · `.odp` · `.ods`), 옛 `.hwp`는 `hwp.js`, 옛 `.doc`는 `word-extractor`. 옛 `.ppt` · `.xls` · `.rtf`(그리고 사진)는 로컬 AI 지원 안 함 — 한국어 안내로 [동기화 켜기] 또는 새 형식 저장을 권함(10.9절) |
| Q-4 | 루트(폴더 없음) 자체를 끄는 설정이 필요한가? | 이번엔 없음(D-11) |
| Q-5 | 끄기 확인 창에 "PC가 고장 나면 서재에서 되살릴 수 없어요"를 넣을까? | 넣음(R-1) |

## 17. 변경 기록
- 2026-10-17 초안(설계): 제품 책임자 결정 P-1~P-8 반영, 설계 결정 D-1~D-13, 마이그레이션 초안, API · 엔진 · 다리 · 화면 · 시험 · 3인 분담.
