"""로컬 웹 서버(FastAPI). 화면(static/)과 JSON API를 함께 제공한다."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import sqlite3
import threading
import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, citations, csl_style, pdf
from .ai import MODELS, AIError, AIService, PaperContext
from .config import Settings, default_data_dir
from .db import Database
from .sources import SourceError, Sources, detect_identifier, merge

STATIC_DIR = Path(__file__).parent / "static"
# Windows 레지스트리에 .js가 text/plain으로 잘못 등록된 경우 모듈 스크립트가 막히므로 직접 지정한다
for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                    (".woff2", "font/woff2"), (".svg", "image/svg+xml")):
    mimetypes.add_type(_type, _ext)
ITEM_TYPES = {"article": "학술지 논문", "conference": "학회 발표", "preprint": "프리프린트", "book": "단행본",
              "chapter": "책의 장", "thesis": "학위논문", "report": "보고서", "dataset": "데이터셋"}
STATUSES = {"unread": "읽을 예정", "reading": "읽는 중", "done": "다 읽음"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1", "testserver"}


def _slug(text: str) -> str:
    s = re.sub(r"[^\w\-]+", "-", (text or "paper"), flags=re.U).strip("-")
    return s[:60] or "paper"


class Jobs:
    """요약처럼 오래 걸리는 작업을 백그라운드 스레드에서 돌리고 진행 상황을 기록한다."""

    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._lock = threading.Lock()

    def start(self, key: str, fn) -> dict:
        with self._lock:
            for job in self._jobs.values():
                if job["key"] == key and job["status"] == "running":
                    return dict(job)
            job = {"id": uuid.uuid4().hex[:12], "key": key, "status": "running", "progress": None,
                   "message": "시작하는 중", "error": ""}
            # 끝난 작업은 최근 50개만 남긴다
            done = [k for k, j in self._jobs.items() if j["status"] != "running"]
            for k in done[:-50]:
                del self._jobs[k]
            self._jobs[job["id"]] = job

        def progress(message: str, frac: float | None):
            job["message"] = message
            job["progress"] = frac

        def run():
            try:
                fn(progress)
                job.update(status="done", progress=1.0, message="완료")
            except AIError as e:
                job.update(status="error", error=str(e))
            except Exception as e:  # noqa: BLE001 - 작업 실패는 화면에 그대로 알린다
                job.update(status="error", error=f"{type(e).__name__}: {e}")

        threading.Thread(target=run, daemon=True).start()
        return dict(job)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def running_for(self, key: str) -> dict | None:
        with self._lock:
            for job in self._jobs.values():
                if job["key"] == key and job["status"] == "running":
                    return dict(job)
        return None


def create_app(data_dir: Path | None = None, sources: Sources | None = None,
               ai: AIService | None = None) -> FastAPI:
    data_dir = Path(data_dir or default_data_dir())
    data_dir.mkdir(parents=True, exist_ok=True)
    pdf_dir = data_dir / "pdfs"
    pdf_dir.mkdir(exist_ok=True)
    settings = Settings(data_dir)
    db = Database(data_dir / "library.db")
    sources = sources or Sources(settings.get)
    ai = ai or AIService(settings.get)
    jobs = Jobs()

    app = FastAPI(title="PaperLab", version=__version__, docs_url=None, redoc_url=None)
    app.state.db = db
    app.state.settings = settings
    app.state.data_dir = data_dir

    # ------------------------------------------------------------ security
    @app.middleware("http")
    async def local_only(request: Request, call_next):
        # DNS 리바인딩과 다른 웹사이트에서 보내는 요청(CSRF)을 막는다
        host = (request.headers.get("host") or "").rsplit(":", 1)[0]
        if host not in LOCAL_HOSTS:
            return JSONResponse({"detail": "허용되지 않은 호스트"}, status_code=403)
        origin = request.headers.get("origin")
        if origin:
            ohost = urlparse(origin).hostname or ""
            if origin == "null" or (ohost not in LOCAL_HOSTS and f"[{ohost}]" not in LOCAL_HOSTS):
                return JSONResponse({"detail": "허용되지 않은 출처"}, status_code=403)
        # 쓰기 요청은 화면(api.js)이 붙이는 헤더가 있어야 한다. 다른 사이트의 폼 전송(CSRF)은 이 헤더를 못 붙인다
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-paperlab") != "1":
            return JSONResponse({"detail": "허용되지 않은 요청"}, status_code=403)
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def need_paper(pid: int) -> dict:
        p = db.get_paper(pid)
        if not p:
            raise HTTPException(404, "논문을 찾을 수 없어요")
        return p

    def pdf_path_of(p: dict) -> Path | None:
        if not p.get("pdf_path"):
            return None
        path = (data_dir / p["pdf_path"]).resolve()
        if data_dir.resolve() not in path.parents or not path.exists():
            return None
        return path

    def store_pdf(pid: int, data: bytes, title: str) -> pdf.PdfInfo:
        info = pdf.extract(data)
        old = db.get_paper(pid, detail=False)
        rel = f"pdfs/{pid}-{_slug(title)}.pdf"
        tmp = data_dir / (rel + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, data_dir / rel)
        db.set_pdf(pid, rel, info.page_texts)
        if old and old.get("pdf_path") and old["pdf_path"] != rel:
            old_path = data_dir / old["pdf_path"]
            if old_path.exists():
                old_path.unlink()
        return info

    def mark_library(items: list[dict]) -> list[dict]:
        for it in items:
            dup = db.find_duplicate(it.get("doi", ""), it.get("arxiv_id", ""), it.get("title", ""))
            it["in_library"] = dup["id"] if dup else None
        return items

    def metadata_from_pdf(info: pdf.PdfInfo) -> tuple[dict, str]:
        """PDF에서 찾은 식별자로 메타데이터를 채운다. (메타데이터, 출처 설명)"""
        if info.doi:
            try:
                return sources.lookup_doi(info.doi), f"DOI {info.doi}"
            except SourceError:
                pass
        if info.arxiv_id:
            try:
                return sources.lookup_arxiv(info.arxiv_id), f"arXiv {info.arxiv_id}"
            except SourceError:
                pass
        if info.title:
            match = sources.match_title(info.title)
            if match:
                return match, "제목 검색"
        meta = {"title": info.title, "doi": info.doi, "arxiv_id": info.arxiv_id, "year": info.year,
                "authors": [], "item_type": "article"}
        if info.meta_author:
            from .sources import split_name
            meta["authors"] = [split_name(a) for a in re.split(r"\s*(?:;|,| and )\s*", info.meta_author) if a]
        return meta, "PDF 정보만 사용"

    # ------------------------------------------------------------- general
    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__}

    @app.get("/api/meta")
    def meta():
        return {"version": __version__, "models": MODELS, "item_types": ITEM_TYPES,
                "statuses": STATUSES, "data_dir": str(data_dir)}

    @app.get("/api/stats")
    def stats():
        return db.stats()

    @app.get("/api/settings")
    def get_settings():
        return settings.public()

    @app.put("/api/settings")
    def put_settings(changes: dict = Body(...)):
        settings.update(changes)
        return settings.public()

    @app.get("/api/ai/status")
    def ai_status():
        return ai.status()

    # -------------------------------------------------------------- papers
    @app.get("/api/papers")
    def list_papers(q: str = "", collection: int | None = None, tag: int | None = None, status: str = "",
                    starred: bool = False, sort: str = "added", filter: str = "",
                    limit: int = Query(500, le=2000), offset: int = 0):
        return db.list_papers(q, collection, tag, status, starred, sort, filter, limit, offset)

    @app.post("/api/papers")
    def add_paper(data: dict = Body(...)):
        if not (data.get("title") or "").strip():
            raise HTTPException(400, "제목이 필요해요")
        if not data.get("allow_duplicate"):
            dup = db.find_duplicate(data.get("doi", ""), data.get("arxiv_id", ""), data.get("title", ""))
            if dup:
                return JSONResponse({"duplicate": True, "paper": dup}, status_code=409)
        pid = db.add_paper(data)
        if data.get("collection_id"):
            db.set_paper_collections([pid], int(data["collection_id"]), True)
        if data.get("tags"):
            db.set_paper_tags(pid, data["tags"])
        warning = ""
        if data.get("download_pdf") and data.get("pdf_url"):
            try:
                store_pdf(pid, sources.download_pdf(data["pdf_url"]), data["title"])
            except SourceError as e:
                warning = f"논문은 추가했지만 PDF는 받지 못했어요: {e}"
        return {"paper": db.get_paper(pid), "warning": warning}

    @app.post("/api/resolve")
    def resolve(data: dict = Body(...)):
        try:
            item = sources.resolve(data.get("identifier", ""))
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        return mark_library([item])[0]

    @app.post("/api/upload")
    def upload(files: list[UploadFile] = File(...), collection_id: int | None = Form(None),
               lookup: bool = Form(True)):
        results = []
        for f in files:
            name = f.filename or "document.pdf"
            data = f.file.read()
            if not data.startswith(b"%PDF"):
                results.append({"file": name, "error": "PDF 파일이 아니에요"})
                continue
            try:
                info = pdf.extract(data)
            except Exception as e:  # noqa: BLE001 - 손상된 PDF
                results.append({"file": name, "error": f"PDF를 열 수 없어요: {e}"})
                continue
            if lookup:
                meta_, matched_by = metadata_from_pdf(info)
            else:
                meta_, matched_by = {"title": info.title, "doi": info.doi, "arxiv_id": info.arxiv_id}, "PDF 정보만 사용"
            if not meta_.get("title"):
                meta_["title"] = re.sub(r"\.pdf$", "", name, flags=re.I)
            dup = db.find_duplicate(meta_.get("doi", ""), meta_.get("arxiv_id", ""), meta_.get("title", ""))
            if dup:
                if not dup["has_pdf"]:
                    store_pdf(dup["id"], data, dup["title"])
                    results.append({"file": name, "id": dup["id"], "title": dup["title"],
                                    "matched_by": matched_by, "note": "이미 있는 논문에 PDF를 붙였어요"})
                else:
                    results.append({"file": name, "id": dup["id"], "title": dup["title"],
                                    "duplicate": True, "note": "이미 서재에 있어요"})
                if collection_id:
                    db.set_paper_collections([dup["id"]], collection_id, True)
                continue
            pid = db.add_paper(meta_)
            store_pdf(pid, data, meta_["title"])
            if collection_id:
                db.set_paper_collections([pid], collection_id, True)
            results.append({"file": name, "id": pid, "title": meta_["title"], "matched_by": matched_by,
                            "warnings": info.warnings})
        return {"results": results}

    @app.get("/api/papers/{pid}")
    def get_paper(pid: int):
        p = need_paper(pid)
        p["cite_issues"] = citations.citation_issues(p)
        return p

    @app.patch("/api/papers/{pid}")
    def patch_paper(pid: int, data: dict = Body(...)):
        need_paper(pid)
        db.update_paper(pid, data)
        if "tags" in data:
            db.set_paper_tags(pid, data["tags"] or [])
        return db.get_paper(pid)

    @app.delete("/api/papers/{pid}")
    def delete_paper(pid: int):
        need_paper(pid)
        rel = db.delete_paper(pid)
        if rel:
            path = data_dir / rel
            if path.exists():
                path.unlink()
        return {"ok": True}

    @app.post("/api/papers/bulk")
    def bulk(data: dict = Body(...)):
        ids = [int(i) for i in data.get("ids") or []]
        action, value = data.get("action"), data.get("value")
        if action == "delete":
            for pid in ids:
                rel = db.delete_paper(pid)
                if rel and (data_dir / rel).exists():
                    (data_dir / rel).unlink()
        elif action in ("add_collection", "remove_collection"):
            if not str(value or "").isdigit():
                raise HTTPException(400, "컬렉션을 골라 주세요")
            db.set_paper_collections(ids, int(value), action == "add_collection")
        elif action == "add_tag":
            if not str(value or "").strip():
                raise HTTPException(400, "태그 이름이 필요해요")
            db.add_tag_to_papers(ids, str(value))
        elif action == "status":
            for pid in ids:
                db.update_paper(pid, {"status": value})
        elif action == "star":
            for pid in ids:
                db.update_paper(pid, {"starred": bool(value)})
        else:
            raise HTTPException(400, "알 수 없는 작업")
        return {"ok": True}

    @app.post("/api/papers/{pid}/open")
    def opened(pid: int):
        p = need_paper(pid)
        db.touch_opened(pid)
        if p["status"] == "unread":
            db.update_paper(pid, {"status": "reading"})
        return {"ok": True}

    # ----------------------------------------------------------------- PDF
    @app.get("/api/papers/{pid}/pdf")
    def get_pdf(pid: int):
        path = pdf_path_of(need_paper(pid))
        if not path:
            raise HTTPException(404, "PDF가 없어요")
        return FileResponse(path, media_type="application/pdf")

    @app.post("/api/papers/{pid}/pdf")
    def attach_pdf(pid: int, file: UploadFile = File(...)):
        p = need_paper(pid)
        data = file.file.read()
        if not data.startswith(b"%PDF"):
            raise HTTPException(400, "PDF 파일이 아니에요")
        try:
            info = store_pdf(pid, data, p["title"])
        except Exception as e:  # noqa: BLE001 - 손상된 PDF
            raise HTTPException(400, f"PDF를 열 수 없어요: {e}") from e
        return {"paper": db.get_paper(pid), "warnings": info.warnings}

    @app.post("/api/papers/{pid}/fetch-pdf")
    def fetch_pdf(pid: int):
        p = need_paper(pid)
        url = p.get("pdf_url")
        if not url and p.get("arxiv_id"):
            url = f"https://arxiv.org/pdf/{p['arxiv_id']}"
        if not url and p.get("doi"):
            try:
                url = sources.lookup_doi(p["doi"]).get("pdf_url")
            except SourceError:
                url = ""
        if not url:
            raise HTTPException(404, "무료로 받을 수 있는 PDF를 찾지 못했어요. 직접 파일을 첨부해 주세요.")
        try:
            info = store_pdf(pid, sources.download_pdf(url), p["title"])
        except SourceError as e:
            raise HTTPException(502, str(e)) from e
        db.update_paper(pid, {"pdf_url": url})
        return {"paper": db.get_paper(pid), "warnings": info.warnings}

    @app.post("/api/papers/{pid}/refresh")
    def refresh_metadata(pid: int, data: dict = Body(default={})):
        p = need_paper(pid)
        try:
            if p.get("doi"):
                fresh = sources.lookup_doi(p["doi"])
            elif p.get("arxiv_id"):
                fresh = sources.lookup_arxiv(p["arxiv_id"])
            elif data.get("identifier"):
                fresh = sources.resolve(data["identifier"])
            else:
                fresh = sources.match_title(p["title"])
                if not fresh:
                    raise SourceError("제목으로 일치하는 논문을 찾지 못했어요. DOI를 입력해 주세요.")
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        if data.get("overwrite"):
            update = {k: v for k, v in fresh.items() if v not in (None, "", [])}
        else:
            merged = merge(p, fresh)
            update = {k: merged[k] for k in fresh if k in merged and merged[k] != p.get(k)}
            if fresh.get("cited_by_count") is not None:
                update["cited_by_count"] = fresh["cited_by_count"]
        update.pop("source", None)
        db.update_paper(pid, update)
        out = db.get_paper(pid)
        out["cite_issues"] = citations.citation_issues(out)
        return out

    @app.get("/api/papers/{pid}/related")
    def related(pid: int, kind: str = "cited_by", page: int = 1):
        p = need_paper(pid)
        if kind not in ("cited_by", "references", "related"):
            raise HTTPException(400, "kind는 cited_by, references, related 중 하나예요")
        try:
            res = sources.related(p, kind, page)
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        if res.get("openalex_id") and not p.get("openalex_id"):
            db.update_paper(pid, {"openalex_id": res["openalex_id"]})
        res["items"] = mark_library(res["items"])
        return res

    @app.post("/api/related")
    def related_external(data: dict = Body(...)):
        """서재에 없는 검색 결과의 피인용·참고문헌·관련 논문"""
        kind = data.get("kind", "cited_by")
        if kind not in ("cited_by", "references", "related"):
            raise HTTPException(400, "kind는 cited_by, references, related 중 하나예요")
        try:
            res = sources.related(data.get("paper") or {}, kind, int(data.get("page") or 1))
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        res["items"] = mark_library(res["items"])
        return res

    @app.post("/api/cite-preview")
    def cite_preview(data: dict = Body(...)):
        """서재에 없는 논문(검색 결과)의 인용 데이터"""
        p = data.get("paper") or {}
        return cite_payload(p)

    # ------------------------------------------------------ notes/annotations
    @app.put("/api/papers/{pid}/note")
    def save_note(pid: int, data: dict = Body(...)):
        need_paper(pid)
        db.save_note(pid, data.get("content", ""))
        return {"ok": True}

    @app.get("/api/papers/{pid}/annotations")
    def annotations(pid: int):
        need_paper(pid)
        return db.list_annotations(pid)

    @app.post("/api/papers/{pid}/annotations")
    def add_annotation(pid: int, data: dict = Body(...)):
        need_paper(pid)
        aid = db.add_annotation(pid, data)
        return next(a for a in db.list_annotations(pid) if a["id"] == aid)

    @app.patch("/api/annotations/{aid}")
    def patch_annotation(aid: int, data: dict = Body(...)):
        a = db.update_annotation(aid, data)
        if not a:
            raise HTTPException(404, "하이라이트를 찾을 수 없어요")
        return a

    @app.delete("/api/annotations/{aid}")
    def delete_annotation(aid: int):
        db.delete_annotation(aid)
        return {"ok": True}

    @app.get("/api/annotations/export/{pid}")
    def export_annotations(pid: int):
        p = need_paper(pid)
        who = ", ".join(" ".join(x for x in (a.get("given"), a.get("family"), a.get("literal")) if x)
                        for a in p.get("authors") or [])
        source = " · ".join(str(x) for x in (who, p.get("year"), p.get("venue")) if x)
        link = f"https://doi.org/{p['doi']}" if p.get("doi") else p.get("url") or ""
        lines = [f"# {p['title']}", "", source + (f"  \n{link}" if link else ""), ""]
        for a in db.list_annotations(pid):
            lines.append(f"> {a['text']}" if a["text"] else "> (메모)")
            lines.append(f"> — p.{a['page']}")
            if a["comment"]:
                lines += ["", a["comment"]]
            lines.append("")
        if p.get("note"):
            lines += ["## 노트", "", p["note"]]
        return Response("\n".join(lines), media_type="text/markdown; charset=utf-8")

    # -------------------------------------------------------- collections
    @app.get("/api/collections")
    def collections():
        return db.list_collections()

    @app.post("/api/collections")
    def add_collection(data: dict = Body(...)):
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "이름이 필요해요")
        return {"id": db.add_collection(name, data.get("parent_id"))}

    @app.patch("/api/collections/{cid}")
    def patch_collection(cid: int, data: dict = Body(...)):
        try:
            db.update_collection(cid, data.get("name"), data["parent_id"] if "parent_id" in data else ...)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return {"ok": True}

    @app.delete("/api/collections/{cid}")
    def delete_collection(cid: int):
        db.delete_collection(cid)
        return {"ok": True}

    @app.get("/api/tags")
    def tags():
        return db.list_tags()

    @app.patch("/api/tags/{tid}")
    def patch_tag(tid: int, data: dict = Body(...)):
        try:
            db.update_tag(tid, data.get("name"), data.get("color"))
        except sqlite3.IntegrityError as e:
            raise HTTPException(400, "같은 이름의 태그가 이미 있어요") from e
        return {"ok": True}

    @app.delete("/api/tags/{tid}")
    def delete_tag(tid: int):
        db.delete_tag(tid)
        return {"ok": True}

    # ---------------------------------------------------------- citations
    def cite_payload(p: dict) -> dict:
        return {"csl": citations.to_csl_item(p), "issues": citations.citation_issues(p),
                "bibtex": citations.to_bibtex([p]), "ris": citations.to_ris([p])}

    @app.get("/api/papers/{pid}/cite")
    def cite(pid: int):
        return cite_payload(need_paper(pid))

    def papers_for(data: dict) -> list[dict]:
        if data.get("ids"):
            return [p for p in (db.get_paper(int(i)) for i in data["ids"]) if p]
        if data.get("collection_id"):
            return db.list_papers(collection_id=int(data["collection_id"]), limit=100000)["items"]
        return db.list_papers(limit=100000)["items"]

    @app.post("/api/csl")
    def csl_items(data: dict = Body(...)):
        """화면의 citeproc-js가 인용·참고문헌을 만들 때 쓰는 CSL-JSON (요청한 순서 유지)"""
        papers = papers_for(data)
        return {"items": [citations.to_csl_item(p) for p in papers],
                "issues": {str(p["id"]): citations.citation_issues(p) for p in papers}}

    # 인용 스타일 (공식 CSL 저장소의 .csl 파일)
    def style_dirs() -> list[tuple[Path, bool]]:
        return [(STATIC_DIR / "vendor" / "csl" / "styles", True), (data_dir / "styles", False)]

    def style_info(path: Path, builtin: bool) -> dict | None:
        info = csl_style.read_info(path.read_bytes())
        if not info:
            return None
        info.update(id=path.stem, builtin=builtin)
        return info

    def find_style(style_id: str) -> Path | None:
        if not re.fullmatch(r"[a-z0-9][a-z0-9\-]{0,120}", style_id or ""):
            return None
        for d, _ in reversed(style_dirs()):
            path = d / f"{style_id}.csl"
            if path.exists():
                return path
        return None

    @app.get("/api/styles")
    def list_styles():
        seen, out = set(), []
        for d, builtin in reversed(style_dirs()):
            if not d.exists():
                continue
            for path in sorted(d.glob("*.csl")):
                if path.stem in seen:
                    continue
                info = style_info(path, builtin)
                if info:
                    seen.add(path.stem)
                    out.append(info)
        order = {k: i for i, k in enumerate(csl_style.FEATURED)}
        out.sort(key=lambda x: (not x["builtin"], x["group"] != "주요 스타일", order.get(x["id"], 999), x["title"].lower()))
        return out

    @app.get("/api/styles/{style_id}")
    def get_style(style_id: str):
        path = find_style(style_id)
        if not path:
            raise HTTPException(404, "인용 스타일을 찾을 수 없어요")
        info = csl_style.read_info(path.read_bytes()) or {}
        # 종속 스타일은 서식이 없고 부모 스타일을 가리키기만 하므로 부모 서식을 보낸다
        if info.get("parent"):
            parent = find_style(info["parent"])
            if not parent:
                raise HTTPException(404, f"이 스타일이 기반으로 하는 '{info['parent']}' 스타일이 없어요. 그 스타일도 추가해 주세요.")
            path = parent
        return Response(path.read_bytes(), media_type="application/xml; charset=utf-8")

    @app.post("/api/styles")
    def upload_style(file: UploadFile = File(...)):
        raw = file.file.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise HTTPException(400, "스타일 파일이 너무 커요")
        info = csl_style.read_info(raw)
        if not info:
            raise HTTPException(400, "CSL 스타일(.csl) 파일이 아니에요")
        if info.get("parent") and not find_style(info["parent"]):
            raise HTTPException(400, f"이 스타일은 '{info['parent']}' 스타일을 기반으로 해요. 그 스타일 파일을 먼저 추가해 주세요.")
        style_id = csl_style.slug(info["source_id"] or file.filename or info["title"])
        d = data_dir / "styles"
        d.mkdir(exist_ok=True)
        (d / f"{style_id}.csl").write_bytes(raw)
        return {**info, "id": style_id, "builtin": False}

    @app.delete("/api/styles/{style_id}")
    def delete_style(style_id: str):
        path = find_style(style_id)
        if not path or path.parent != data_dir / "styles":
            raise HTTPException(400, "직접 추가한 스타일만 지울 수 있어요")
        path.unlink()
        return {"ok": True}

    @app.post("/api/export")
    def export(data: dict = Body(...)):
        fmt = data.get("format", "bibtex")
        papers = papers_for(data)
        if fmt == "ris":
            body, mt, ext = citations.to_ris(papers), "application/x-research-info-systems", "ris"
        elif fmt == "csljson":
            body, mt, ext = citations.to_csl_json(papers), "application/json", "json"
        else:
            body, mt, ext = citations.to_bibtex(papers), "application/x-bibtex", "bib"
        return Response(body, media_type=f"{mt}; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="paperlab-export.{ext}"'})

    @app.post("/api/import")
    def import_file(file: UploadFile = File(...), collection_id: int | None = Form(None)):
        raw = file.file.read()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp949", errors="replace")
        try:
            items = citations.parse_any(text)
        except (ValueError, json.JSONDecodeError) as e:
            raise HTTPException(400, str(e)) from e
        added = skipped = 0
        for it in items:
            if not it.get("title"):
                skipped += 1
                continue
            if db.find_duplicate(it.get("doi", ""), it.get("arxiv_id", ""), it["title"]):
                skipped += 1
                continue
            pid = db.add_paper(it)
            if collection_id:
                db.set_paper_collections([pid], collection_id, True)
            added += 1
        return {"added": added, "skipped": skipped, "total": len(items)}

    # ------------------------------------------------------------- search
    @app.get("/api/search")
    def search(q: str, source: str = "openalex", page: int = 1, year_from: int | None = None,
               year_to: int | None = None, sort: str = "relevance", oa: bool = False):
        kind, value = detect_identifier(q)
        try:
            if kind in ("doi", "arxiv", "openalex"):
                res = {"items": [sources.resolve(q)], "total": 1}
            else:
                res = sources.search(q, source, page, 20, year_from, year_to, sort, oa)
        except SourceError as e:
            raise HTTPException(502, str(e)) from e
        res["items"] = mark_library(res["items"])
        return res

    # ------------------------------------------------------------------ AI
    def context_for(p: dict) -> PaperContext:
        path = pdf_path_of(p)
        return PaperContext(title=p["title"], pdf_bytes=path.read_bytes() if path else None,
                            page_texts=db.page_texts(p["id"]), abstract=p.get("abstract") or "")

    @app.get("/api/papers/{pid}/summary")
    def get_summary(pid: int):
        need_paper(pid)
        return {"summary": db.get_summary(pid), "job": jobs.running_for(f"summary:{pid}")}

    @app.post("/api/papers/{pid}/summary")
    def make_summary(pid: int):
        p = need_paper(pid)
        st = ai.status()
        if not st["ready"]:
            raise HTTPException(400, st["message"])
        ctx = context_for(p)

        def work(progress):
            data = ai.summarize(ctx, progress)
            db.save_summary(pid, data, settings.get("model") if settings.get("ai_engine") == "api" else "claude-cli")
            if data.get("keywords") and not p.get("keywords"):
                db.update_paper(pid, {"keywords": data["keywords"][:10]})

        return jobs.start(f"summary:{pid}", work)

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str):
        j = jobs.get(job_id)
        if not j:
            raise HTTPException(404, "작업을 찾을 수 없어요")
        return j

    @app.get("/api/papers/{pid}/chat")
    def chat_history(pid: int):
        need_paper(pid)
        return db.chat_history(pid)

    @app.delete("/api/papers/{pid}/chat")
    def clear_chat(pid: int):
        db.clear_chat(pid)
        return {"ok": True}

    @app.post("/api/papers/{pid}/chat")
    def chat(pid: int, data: dict = Body(...)):
        p = need_paper(pid)
        question = (data.get("question") or "").strip()
        if not question:
            raise HTTPException(400, "질문을 입력해 주세요")
        st = ai.status()
        if not st["ready"]:
            raise HTTPException(400, st["message"])
        history = [{"role": m["role"], "content": m["content"]} for m in db.chat_history(pid)]
        ctx = context_for(p)

        def events():
            try:
                for ev in ai.chat(ctx, history, question):
                    if ev["type"] == "done":
                        db.add_chat_message(pid, "user", question)
                        mid = db.add_chat_message(pid, "assistant", ev["text"], ev["citations"])
                        ev["id"] = mid
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            except AIError as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    # -------------------------------------------------------------- static
    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app
