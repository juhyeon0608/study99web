# PaperLab — 설치형 논문 연구 도구

논문을 **찾고 → 모으고 → 읽고 → 정리하고 → 인용하는** 과정을 한 프로그램에서 끝내는 데스크톱 도구입니다.
Python 백엔드와 HTML/JS 화면으로 만들었고, 내 컴퓨터에서만 실행되며 모든 데이터는 내 컴퓨터에 저장됩니다.

## 설치와 실행

필요한 것: **Python 3.10 이상** ([python.org](https://www.python.org/downloads/), Windows는 설치할 때 *Add python.exe to PATH* 체크)

| 운영체제 | 실행 방법 |
|---|---|
| Windows | `PaperLab.bat` 더블클릭 |
| macOS | `PaperLab.command` 더블클릭 (처음 한 번은 우클릭 → 열기) |
| Linux | `./paperlab.sh` |

처음 실행할 때 프로그램 폴더 안에 가상환경(`.venv`)을 만들고 필요한 패키지를 설치합니다(1~3분).
그다음부터는 바로 브라우저에 PaperLab 화면이 열립니다. 종료는 실행 창에서 `Ctrl+C`.
코드를 업데이트해서 `pyproject.toml`이 바뀌면 다음 실행 때 자동으로 다시 설치합니다.

직접 설치하고 싶다면:

```bash
pip install -e .           # 또는 pip install .
paperlab                   # 브라우저로 열기
paperlab --window          # 앱 창으로 열기 (pip install -e ".[desktop]" 필요)
paperlab --port 9000 --data-dir D:\PaperLabData --no-browser
```

### AI 기능 설정 (선택)

**설정 → AI 엔진**에서 둘 중 하나를 고릅니다.

- **Anthropic API** (권장): [API 키](https://console.anthropic.com/settings/keys)를 넣으면 PDF를 그림·수식까지 통째로 읽고, 답변의 근거를 **쪽 번호와 원문 인용**으로 보여줍니다. 기본 모델은 Claude Opus 5.5이고, 설정에서 Sonnet 5.5 · Haiku 4.5로 바꿀 수 있습니다. 사용량만큼 요금이 나갑니다.
- **Claude CLI**: 이미 설치·로그인된 Claude Code(`claude` 명령)를 그대로 씁니다. API 키가 필요 없고, PDF에서 뽑은 텍스트만 보냅니다.

AI 없이도 검색·서재·읽기·하이라이트·노트·인용은 모두 동작합니다.

## 기능

### 1. 논문 찾기 (Google Scholar 방식)
- **OpenAlex**(2억+ 편, 피인용 수·인용 관계), **Semantic Scholar**(TL;DR 요약), **arXiv**(최신 프리프린트), **Crossref**(DOI 출판물) 통합 검색
- 기간, 정렬(관련도·피인용·최신), 무료 PDF만 보기 필터
- 결과마다 **서재에 추가 / PDF 포함 추가 / 인용 / 피인용 N / 참고문헌 / 관련 논문** — 피인용을 누르면 그 논문을 인용한 후속 연구로 따라갈 수 있습니다
- DOI · arXiv ID · arXiv 주소를 넣으면 그 논문을 바로 찾습니다

> Google Scholar는 공식 API가 없고 자동 수집을 약관으로 금지해서, 같은 기능을 공개 학술 데이터베이스로 구현했습니다.

### 2. 내 서재 (EndNote · Zotero · Mendeley 방식)
- **PDF를 끌어다 놓으면** 본문에서 DOI·arXiv ID·제목을 찾아 서지 정보를 자동으로 채움
- **컬렉션**(하위 폴더 가능, 논문을 끌어다 놓아 분류), **태그**(색 지정), 읽기 상태(읽을 예정·읽는 중·다 읽음), 즐겨찾기, 중요도 별점
- **전문 검색**: 제목·저자·초록·**PDF 본문**·노트·하이라이트 메모까지 한 번에 검색, 본문에서 찾은 부분을 미리보기로 표시 (한국어 2글자 검색 지원)
- 중복 감지(DOI·arXiv·제목), 온라인 정보로 빈 항목·피인용 수 채우기, 무료 PDF 자동 받기
- 여러 편 선택 후 일괄 작업: 컬렉션 넣기·태그·상태·삭제·참고문헌 목록
- 상세 패널의 **인용 관계** 탭: 이 논문을 인용한 논문 / 참고문헌 / 관련 논문

### 3. 읽기 화면
- PDF.js 기반 뷰어 (확대·축소, 폭 맞춤, 쪽 이동)
- 문장을 드래그하면 **5색 하이라이트, 메모, AI에게 묻기, 복사**
- 하이라이트 목록(색별 필터, 쪽으로 이동), 마크다운 내보내기
- 논문별 **마크다운 노트** (수식 `$...$` 지원, 자동 저장, 하이라이트를 노트로 가져오기)

### 4. AI 요약 · 논문과 대화
- **한 줄 요약**, 연구 질문 · 방법 · 결과
- **수준별 설명**: 초등 · 중등 · 고등 · 대학원 — 논문 전체와 섹션마다 각각
- **섹션별 정리**(핵심 포인트, 해당 쪽으로 이동), **핵심 수식 풀이**(KaTeX 렌더링, 기호 설명, 유도 과정)
- 기여 · 한계 · 생각해 볼 질문(눌러서 바로 질문)
- **질문하기**: 논문 내용을 근거로 답하고, 답의 `[1]`을 누르면 근거가 있는 쪽으로 이동해 해당 문장을 표시

### 5. 인용 · 내보내기
인용 문구는 **Zotero·Mendeley와 같은 인용 엔진(citeproc-js)과 공식 CSL 스타일 파일**로 만듭니다. 손으로 짠 규칙이 아니라 학계 표준 스타일 정의를 그대로 따르므로 형식이 정확합니다.

- **기본 제공 20개 스타일**: APA 7판, IEEE, Chicago(저자-연도·각주), MLA 9판, Harvard, Vancouver(NLM), Nature, AMA, ACS, ACM, Elsevier, Springer, ASA, 국내 학술지(대한내과학회지, Korean Journal of Radiology, 대한토목학회논문집 등)
- **어떤 학술지 형식이든 추가**: [Zotero 스타일 저장소](https://www.zotero.org/styles)(10,000+개)에서 투고할 학술지의 `.csl` 파일을 받아 *설정 → 학술지 스타일 추가*. 종속 스타일도 지원
- **본문 인용과 참고문헌 항목을 따로 복사** (기울임꼴 등 서식 유지 → Word·한글·Google Docs에 그대로 붙여넣기), 각주 스타일은 각주 문구
- **참고문헌 목록**: 선택한 논문·컬렉션으로 생성, 저자-연도 스타일은 **국문 문헌 먼저** 정렬(국내 학위논문 관례), 번호식 스타일은 본문 인용 순서대로 ↑↓ 재배열, `.txt`·`.html`(Word에서 열림) 저장
- **인용 정보 점검**: 스타일에 필요한 항목(학술지명·권·쪽·출판사 등)이 비면 상세 패널·인용 창에 경고하고, *온라인에서 찾기*로 채움
- 정확한 메타데이터: 발행일(월·일까지), arXiv 프리프린트는 저장소·식별자·DOI(10.48550/arXiv.…) 형식, 한국어 저자는 전체 이름으로 인용(홍길동 & 김철수, 2023), `van`·`de` 같은 성 앞 접두어 처리
- APA처럼 제목을 문장형으로 쓰는 스타일을 위한 *문장형으로* 변환 버튼 (약어·고유명사는 확인 후 저장)
- **BibTeX(.bib) · RIS(.ris, EndNote/Mendeley) · CSL-JSON** 가져오기/내보내기 (발행일 포함)

## 비교

| 기능 | Google Scholar | EndNote | Zotero | **PaperLab** |
|---|:-:|:-:|:-:|:-:|
| 논문 검색 · 피인용 추적 | ● | △ | △ | ● |
| PDF에서 서지 정보 자동 인식 | – | ● | ● | ● |
| 컬렉션 · 태그 · 전문 검색 | △ | ● | ● | ● |
| PDF 하이라이트 · 메모 | – | ● | ● | ● |
| 인용 스타일 · BibTeX/RIS | ● | ● | ● | ● |
| 수준별 AI 요약 · 수식 풀이 | – | – | – | ● |
| 쪽 번호 근거가 붙는 논문 Q&A | – | – | – | ● |
| 내 컴퓨터에만 저장 · 무료 | – | – | ● | ● |

## 데이터 위치와 백업

| 운영체제 | 폴더 |
|---|---|
| Windows | `%APPDATA%\PaperLab` |
| macOS | `~/Library/Application Support/PaperLab` |
| Linux | `~/.local/share/paperlab` |

`library.db`(서재·노트·하이라이트·AI 결과), `pdfs/`(PDF 파일), `styles/`(직접 추가한 인용 스타일), `settings.json`(설정·API 키)이 들어 있습니다.
폴더째 복사하면 백업되고, `PAPERLAB_HOME` 환경변수나 `--data-dir`로 위치를 바꿀 수 있습니다.

## 구조

```
paperlab/
├─ PaperLab.bat · PaperLab.command · paperlab.sh   실행기
├─ pyproject.toml
├─ paperlab/
│  ├─ __main__.py    실행 (서버 시작 + 브라우저 열기)
│  ├─ server.py      FastAPI: JSON API + 화면 제공, 로컬 요청만 허용
│  ├─ db.py          SQLite: 논문·컬렉션·태그·하이라이트·노트·AI 결과, FTS5 전문 검색
│  ├─ pdf.py         PyMuPDF: 쪽별 텍스트 추출, DOI/arXiv/제목 인식
│  ├─ sources.py     OpenAlex · arXiv · Semantic Scholar · Crossref
│  ├─ citations.py   CSL-JSON 변환, 인용 정보 점검, BibTeX · RIS · CSL-JSON
│  ├─ csl_style.py   CSL 스타일 파일 정보
│  ├─ ai.py          요약(구조화 출력) · Q&A(인용) — Anthropic API / Claude CLI
│  ├─ config.py      데이터 폴더, settings.json
│  └─ static/        화면 (HTML · CSS · ES 모듈 JS, PDF.js · citeproc-js · CSL 스타일 · KaTeX · marked · DOMPurify 포함)
└─ tests/            pytest
```

## 보안

서버는 `127.0.0.1`에서만 열리고, 다른 호스트 이름(DNS 리바인딩)·다른 사이트에서 온 요청(`Origin` 검사)·
화면이 붙이는 `X-PaperLab` 헤더가 없는 쓰기 요청(CSRF)을 거부합니다. AI 답변과 외부 데이터는 DOMPurify로 거른 뒤 표시합니다.

## 개발

```bash
pip install -e ".[dev]"
pytest
```

외부 API와 AI 호출은 테스트에서 가짜 전송 계층으로 대체하므로 네트워크 없이 돌아갑니다.
