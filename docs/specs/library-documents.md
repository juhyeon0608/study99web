# 서재에 문서 · 사진 넣기 (워드 · 한글 · PPT · 엑셀 · 이미지) — 기능 명세

- 작성: 개발팀 · 2026-10-16 (작업 브랜치 `dev/2026-10-16`)
- 근거: 사용자 요청 2026-10-16 — 서재에 PDF만이 아니라 워드 · 한글 · PPT · 엑셀 · 사진도 넣고 싶음. 넣는 것이 꼭 논문은 아님(내가 쓰던 문서 등).
- 설계(팀장 결정): **원본은 보관하고 서버가 올릴 때 PDF 변환본을 만든다.** 읽기(PDF.js) · 하이라이트 · RAG 색인 · AI · 설명 · 번역 · 인용 검증은 모두 지금처럼 변환본(`papers.pdf_key`)으로 돈다. 원본은 R2 `users/{uid}/sources/{pid}.{gen}.bin`(`papers.source_key` · `source_name` · `source_size`)에 두고 **[원본 받기]** 로 내려받는다.

## 1. 받는 형식

| 종류 | 확장자 | 변환 |
|---|---|---|
| PDF | `.pdf` | 그대로(예전과 같음) |
| 문서 | `.doc` `.docx` `.hwp` `.hwpx` `.ppt` `.pptx` `.xls` `.xlsx` `.odt` `.odp` `.ods` `.rtf` | LibreOffice `soffice --headless --convert-to pdf`(한글은 H2Orestart 확장 · Java) |
| 사진 | `.jpg` `.jpeg` `.png` `.gif` `.bmp` `.tif` `.tiff` `.webp` | PyMuPDF(쪽마다 그림 하나 · A4 안으로 줄임 · EXIF 방향 반영). WebP만 LibreOffice |

- 판정(`paperlab/convert.py` `kind`): 내용이 `%PDF`로 시작하면 이름과 상관없이 PDF. 아니면 **확장자와 내용 첫 바이트가 함께 맞아야**(문서 = ZIP · OLE · `{\rtf`, 사진 = 각 형식 매직) 받는다. 화면 목록(`static/js/filetypes.js`)과 서버 목록(`convert.ACCEPT_EXTS`)은 같아야 한다(`tests/test_convert.py`).
- 크기 한도는 예전 그대로 **원본 100MB**, 한 번에 20개.
- 오류 문구(사용자에게 그대로): 받지 않는 형식 "올릴 수 없는 파일 형식이에요 (PDF · 워드 · 한글 · PPT · 엑셀 · 이미지)", 이름이 `.pdf`(또는 이름 없음 — 동기화 · 옛 화면)인데 PDF가 아니면 예전 "PDF 파일이 아니에요", 변환 실패 "문서를 PDF로 바꾸지 못했어요. 파일이 손상됐거나 암호가 걸려 있을 수 있어요", 변환기 없음 "서버에 문서 변환기(LibreOffice)가 없어 이 파일은 올릴 수 없어요. PDF나 사진(JPG · PNG)으로 올려 주세요". 화면은 이 셋을 *다시 시도* 없는 오류로 본다.

## 2. 서버 흐름

1. 업로드 자리 · 브라우저 PUT은 예전과 같다(`incoming/{uid}/{id}.pdf` — 키 이름만 .pdf, 내용은 원본).
2. `POST /api/uploads/{id}/complete {"name"}` · `POST /api/papers/{pid}/pdf/complete {"upload_id", "name"}`: `read_incoming(name)` → `prepare_upload` — PDF가 아니면 **DB 연결을 놓은 채로** 변환하고 변환본을 새 임시 키에 올린다. 임시 키 둘 다 커밋 뒤(또는 롤백 때) 지운다.
3. `attach_from_incoming(source=…)`: 논문 행을 잠근 뒤 변환본을 `papers/{pid}.pdf`, 원본을 `sources/{pid}.{gen}.bin`(올릴 때마다 새 gen)에 복사하고 `set_source`. 옛 원본은 커밋 뒤 지운다. PC 파일 이름(`file_name`)은 `원래 이름.pdf`.
4. **웹에서 PDF를 바로 붙이거나 바꾸면** 옛 원본을 지운다(이제 그 PDF가 원본). **PC 폴더 동기화가 PDF(변환본)를 바꾸면 원본은 그대로 둔다**(PC에서 메모를 저장한 것뿐일 수 있음 — 사용자가 올린 원본을 지우지 않음).
5. 메타데이터: 문서 · 사진은 변환본 본문의 **DOI · arXiv 번호가 있을 때만** 조회하고 **제목 검색은 하지 않는다**. 못 찾으면 `item_type = "document"`(화면 "문서"), 제목 = 파일 이름(아는 확장자만 뗌), 정보 출처 "문서 (논문 정보 없음)".
6. 중복: 유형 `document`는 제목으로 짝짓지 않는다 — 올릴 때(`save_upload`)도, 다른 PDF가 올라올 때(`_find_duplicate`의 제목 단계에서 `item_type <> 'document'`)도. DOI · arXiv가 같으면 예전처럼 같은 항목.
7. `POST /api/papers/{pid}/refresh`(온라인 정보로 채우기): 문서는 DOI · arXiv가 없으면 제목 검색 대신 404 "문서는 제목으로 논문 정보를 찾지 않아요. DOI나 arXiv 번호를 입력해 주세요." 식별자로 찾으면 **덮어쓴다**(빈칸 채우기가 아님 — 제목이 파일 이름이므로).
8. 인용 점검(`citation_issues`): 유형 `document`는 제목만 본다(저자 · 연도 · 학술지 경고 없음). CSL `document` · BibTeX `@misc` · RIS `GEN`.
9. 사진은 글자가 없으므로 올릴 때 경고를 "사진(이미지)은 글자를 읽지 않아요. 본문 검색과 AI 기능은 쓸 수 없어요."로 바꾼다. 번역 거절 문구 · AI 질문 색인 줄은 "(스캔본 · 사진)".

## 3. API

| 경로 | 내용 |
|---|---|
| `GET /api/papers/{pid}/source-url` | `{url, expires_at, name}` — 원본 서명 주소(10분, `Content-Disposition: attachment; filename*=올린 이름`, `application/octet-stream`). 원본이 없으면 404 "원본 파일이 없어요", 남의 · 없는 논문 404 |
| 논문 응답 | `has_source`(bool) · `source_name` · `source_size` 추가. `source_key`는 응답에서 뺀다 |
| `POST /api/papers/{pid}/pdf/complete` | `name`을 주면 문서 · 사진도 받는다(웹 화면은 늘 보냄). 없으면 예전처럼 PDF만 |

## 4. 저장 · 정리

- 키 규칙(`storage.py` `_SOURCE_KEY_RE`): `users/{uid}/sources/{pid}.{8자리 16진수}.bin` — `check_user_key`가 받고, 서명 주소는 원본 키면 attachment.
- 사용량: 내 PDF 합계 · 휴지통 합계 · 서버 전체 합계 · 휴지통 목록의 크기(`pdf_size`)에 `source_size`를 더한다. 영구 삭제(`purge_paper`)는 `source_key`도 돌려줘 커밋 뒤 지운다. `admin orphans`는 DB에 없는 `sources/` 객체도 고아로 센다.
- 마이그레이션 `20261016000001_source_files.sql`: 열 3개 추가(`if not exists`, 기본값 '' · null) + 키 · 이름 CHECK.

## 5. 변환기 (서버 PC)

- `soffice` 찾는 순서: `cloud.env`의 `PAPERLAB_SOFFICE`(serve.py → `convert.configure`) → 환경 변수 → PATH → `Program Files\LibreOffice`. 서버 시작 줄 `"converter": true|false`.
- 전용 프로필 `%TEMP%\paperlab-soffice-profile`, **한 번에 하나**(프로세스 안 잠금), 한 파일 **180초** 제한(넘으면 프로세스 트리째 끝냄). 임시 작업 폴더는 매번 새로 만들고 지운다.
- 보안: 프로필에 `BlockUntrustedRefererLinks=true` · `DisableMacrosExecution=true` · `MacroSecurityLevel=3`을 넣는다. 2026-10-16 시험에서 설정 없이는 docx의 외부 링크 그림을 서버가 받으러 갔다(내부망 요청) — 설정 뒤 요청 0(`tests/test_convert.py`).
- 첫 변환(프로필 생성 포함) 약 3초, 보통 문서 3~15초. 화면(api.js)은 업로드 완료 요청에 시간 제한이 없고 "서버에 연결하는 중" 띠를 띄우지 않는다(`LONG_RE`). 여러 개를 올리면 서버가 하나씩 바꾸므로 뒤 파일은 기다린다.

## 6. 화면

- 받는 곳: 서재 *＋ 논문 추가 → 파일 추가*, 빈 서재 [파일 추가], 화면 어디든 끌어다 놓기(쓰기 화면은 예전처럼 .docx · .hwpx → 인용 넣기), 상세 패널 · 읽기 화면의 **[파일 첨부]**, ⋯ **파일 바꾸기**. 예전 이름 *PDF 추가 · 첨부 · 바꾸기*는 모두 *파일 …*로(안내 문구의 [PDF 첨부]도 [파일 첨부]). *PDF 파일 열기* · *무료 PDF 찾기*처럼 정말 PDF인 곳은 그대로.
- 목록 배지: 원본이 있으면 `DOCX` · `HWP` · `PPTX` · `XLSX` · `이미지`(파란색), 아니면 `PDF`(빨간색).
- **[원본 받기]**: 상세 패널 버튼 · ⋯ 메뉴 · 읽기 화면 위 막대. `source-url`을 받아 같은 탭의 숨은 링크로 연다(attachment라 화면은 그대로). PC 앱은 다른 출처 이동을 막고 시스템 브라우저로 넘긴다.
- 상세 정보 탭 *원본* 줄(이름 · 크기 · "PDF로 바꿔 읽어요"). 저자가 없는 문서는 "저자 미상" 대신 "내 문서".

## 7. PC 폴더 동기화

바꾸지 않는다 — **PDF만**. 문서 항목은 PC 폴더에 변환본이 `원래 이름.pdf`로 내려가고, PC에서 PDF가 아닌 파일은 예전처럼 올리지 않는다(동기화 `files/add`는 이름 없이 읽으므로 PDF가 아니면 `bad_pdf`).

## 8. 시험

- `tests/test_convert.py`(DB 없음): 형식 판정 · 화면 목록 일치 · 사진(A4 · EXIF) · 깨진 파일 · 변환기 없음 · `PAPERLAB_SOFFICE` · docx · hwpx · pptx 변환(LibreOffice 있을 때) · 외부 링크 그림 요청 없음 · 프로필 설정.
- `tests/test_source_files.py`[db]: 사진 업로드 → 원본 보관 · `source-url` · 같은 이름 다시 올리기, 문서 ↔ 논문 제목 짝짓기 없음 · 온라인 정보로 채우기, 받지 않는 형식 · 이름 없는 첨부, 교체 · 휴지통 · 사용량 · PDF로 바꾸면 원본 삭제 · 영구 삭제, docx · hwpx · pptx 업로드 · 본문 검색(LibreOffice), 문서 속 DOI, 동기화(변환본 받기 · PC 교체 때 원본 유지 · 비PDF 거절).
- `tests/js/filetypes.test.mjs`: 받는 형식 · 형식 배지. `tests/test_storage.py` 원본 키 · attachment.
