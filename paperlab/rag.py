"""3단계 여러 논문 RAG (docs/specs/phase3-rag-verify-search.md 6~11장).

- 임베딩: 서버 PC 로컬 EmbeddingGemma-300M ONNX(K-1), 768 → 512로 잘라 다시 정규화. 모델 파일이 없으면 None →
  낱말(PGroonga) 검색만으로 동작(6.2절). 테스트는 `HashEmbedder`.
- 벡터: DB가 아니라 R2 파일(`users/{uid}/rag/{paper_id}.v{ver}.{gen}.bin`) + 서버 메모리(`VectorCache`, U-2).
  **R2 · 메모리에는 RLS가 없으므로** 읽을 키는 늘 사용자 권한(RLS) 질의로 얻은 `papers.rag_key`뿐이고,
  읽기 전에 `UserStorage.check`(fullmatch + uid 일치)를 거친다(9.2 · 9.6절).
- 로그는 숫자만(15장) — 질문 · 제목 · 키 · 논문 id를 남기지 않는다.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import struct
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

import numpy as np
from psycopg.types.json import Jsonb

from . import pdf
from .storage import RAG_TYPE, NotFound, StorageError, StorageKeyError, UserStorage, rag_key

log = logging.getLogger("paperlab.rag")

# ---------------------------------------------------------------- 상수 (가정값 — 명세 6.3 · 7 · 9 · 11장)
EMBED_DIM = 512
RAG_VERSION = "eg512c1"            # 모델 · 차원 · 조각 규칙 · 파일 형식이 바뀌면 바꿈 → 전체 재색인
NO_MODEL_VERSION = RAG_VERSION + "n"  # 모델 없이 색인(dim 0, 낱말 검색만) — 모델이 생기면 대기로 보임
SEARCH_VERSIONS = (RAG_VERSION, NO_MODEL_VERSION)
MODEL_REPO = "onnx-community/embeddinggemma-300m-ONNX"   # 게이트 없음(2026-10-08 확인), Gemma 약관
MODEL_REVISION = "5090578d9565bb06545b4552f76e6bc2c93e4a66"
MODEL_FILES = {  # 받을 파일 → (SHA-256, 바이트) — Hugging Face LFS etag · 크기와 같은 값, 2026-10-08 확인
    "onnx/model_quantized.onnx": ("172efde319fe1542dc41f31be6154910b05b78f7a861c265c4600eec906bd6d8", 567_874),
    "onnx/model_quantized.onnx_data": ("705626e28e4c23c82ade34566b4197d97f534c12275fa406dfb71e9937d388c0", 308_890_624),
    "tokenizer.json": ("4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47", 20_323_312),
}
MODEL_HOSTS = ("huggingface.co", ".huggingface.co", ".hf.co")  # 받기 리디렉션은 Hugging Face와 그 CDN만 (품질팀 L6)
DEFAULT_MODEL_DIR = r"D:\PaperLab\models\embeddinggemma-300m"
MAX_TOKENS, BATCH = 2048, 16
QUERY_PREFIX = "task: search result | query: "
CHUNK_TARGET, CHUNK_MIN, CHUNK_MAX = 1400, 300, 2400
MAX_CHUNKS = 20_000
CACHE_MAX_BYTES = 512 * 1024 * 1024
IDLE_S = 30 * 60
LOAD_THREADS = 8
LOAD_WAIT_S = 60.0
VEC_TOP, FTS_PAGES, TOP_K, PER_PAPER, RRF_K = 40, 20, 8, 3, 60
HISTORY_N = 6
SOURCE_PREVIEW = 300
PARTICLES = sorted("은 는 이 가 을 를 의 에 에서 으로 로 와 과 도 만".split(), key=len, reverse=True)
PGRN_QUERY = "operator(extensions.&@~)"


class RagFileError(Exception):
    """벡터 파일 검사 실패 (8.2절) — 그 논문은 색인 대기로 되돌린다"""


class RagBusy(Exception):
    """벡터 불러오기가 기다리는 시간(60초)을 넘음 → 503"""


# ====================================================================== 임베딩
def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=1, keepdims=True)
    return (v / np.where(n == 0, 1, n)).astype(np.float32)


def doc_text(title: str, text: str) -> str:
    return f"title: {(title or 'none').replace('|', ' ')} | text: {text}"


class HashEmbedder:
    """테스트 전용 가짜 임베딩(명세 17장): 낱말을 해시해 512차원에 더하고 정규화. 앞 문구는 빼고 센다"""
    dim = EMBED_DIM

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), EMBED_DIM), np.float32)
        for i, t in enumerate(texts):
            t = re.sub(r"^(task: search result \| query: |title: [^|]* \| text: )", "", t)
            for w in re.findall(r"\w+", t.lower()):
                out[i, int.from_bytes(hashlib.md5(w.encode()).digest()[:4], "little") % EMBED_DIM] += 1.0
        return _normalize(out)


class OnnxEmbedder:
    """EmbeddingGemma-300M ONNX(q8). 처음 쓸 때 한 번 불러 둔다. ONNX 스레드 = 코어 절반(K-2)"""
    dim = EMBED_DIM

    def __init__(self, model_dir: str | Path, threads: int | None = None):
        self.dir = Path(model_dir)
        self.threads = threads or max(1, (os.cpu_count() or 2) // 2)
        self._lock = threading.Lock()
        self._session = self._tok = None

    def _load(self) -> None:
        with self._lock:
            if self._session is not None:
                return
            import onnxruntime as ort
            from tokenizers import Tokenizer
            so = ort.SessionOptions()
            so.intra_op_num_threads = self.threads
            so.enable_cpu_mem_arena = False  # 색인 묶음마다 커지는 메모리 풀을 두지 않음 (서버 PC 메모리 — AC-I08)
            self._session = ort.InferenceSession(str(self.dir / "onnx" / "model_quantized.onnx"), so,
                                                 providers=["CPUExecutionProvider"])
            tok = Tokenizer.from_file(str(self.dir / "tokenizer.json"))
            tok.enable_truncation(MAX_TOKENS)
            tok.enable_padding(pad_id=0, pad_token="<pad>")
            self._tok = tok

    def embed(self, texts: list[str]) -> np.ndarray:
        self._load()
        out = []
        for i in range(0, len(texts), BATCH):
            encs = self._tok.encode_batch(texts[i:i + BATCH])
            feed = {"input_ids": np.array([e.ids for e in encs], np.int64),
                    "attention_mask": np.array([e.attention_mask for e in encs], np.int64)}
            out.append(self._session.run(["sentence_embedding"], feed)[0][:, :EMBED_DIM])
        return _normalize(np.concatenate(out)) if out else np.zeros((0, EMBED_DIM), np.float32)


def model_dir() -> Path:
    return Path(os.environ.get("PAPERLAB_EMBED_MODEL_DIR") or DEFAULT_MODEL_DIR)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def model_problems(directory: Path, check_hash: bool = False) -> list[str]:
    """빠졌거나(check_hash면 내용이) 틀린 모델 파일 이름"""
    return [name for name, (sha, _) in MODEL_FILES.items()
            if not (directory / name).is_file() or (check_hash and _sha256(directory / name) != sha)]


def load_embedder(directory: str | Path | None = None):
    """모델 파일이 있고 onnxruntime · tokenizers를 불러올 수 있으면 OnnxEmbedder, 아니면 None(낱말 검색만 — 6.2절)"""
    d = Path(directory) if directory else model_dir()
    try:
        import onnxruntime  # noqa: F401
        import tokenizers  # noqa: F401
    except ImportError:
        log.warning("임베딩 실행 패키지가 없어 낱말 검색만 해요 (onnxruntime · tokenizers)")
        return None
    if model_problems(d):
        log.warning("임베딩 모델 파일이 없어 낱말 검색만 해요 (python -m paperlab.admin rag-model --download)")
        return None
    return OnnxEmbedder(d)


def download_model(directory: Path, client=None) -> list[str]:
    """Hugging Face 공식 저장소(고정 커밋)에서 모델 파일을 받아 SHA-256을 확인하고 제자리에 둔다. 받은 파일 이름 목록"""
    import httpx

    def only_hf(request: httpx.Request) -> None:
        host = request.url.host
        if request.url.scheme != "https" or not (host == MODEL_HOSTS[0] or host.endswith(MODEL_HOSTS[1:])):
            raise RuntimeError(f"허용하지 않은 주소로 이동하려 했어요 ({host})")

    got = []
    own = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0), follow_redirects=True)
    client.event_hooks["request"] = [only_hf]
    try:
        for name, (sha, size) in MODEL_FILES.items():
            target = directory / name
            if target.is_file() and _sha256(target) == sha:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".part")
            h, n = hashlib.sha256(), 0
            url = f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{name}"
            try:
                with client.stream("GET", url) as r, open(tmp, "wb") as f:
                    if r.status_code != 200:
                        raise RuntimeError(f"{name}: HTTP {r.status_code}")
                    for block in r.iter_bytes(1 << 20):
                        n += len(block)
                        if n > size * 1.2:
                            raise RuntimeError(f"{name}: 예상보다 커요")
                        h.update(block)
                        f.write(block)
                if h.hexdigest() != sha:
                    raise RuntimeError(f"{name}: SHA-256이 맞지 않아요")
            except BaseException:
                tmp.unlink(missing_ok=True)  # 실패하면 받다 만 파일을 남기지 않는다
                raise
            os.replace(tmp, target)
            got.append(name)
    finally:
        if own:
            client.close()
    return got


# ====================================================================== 조각 (10.2절)
def _locate(text: str, blocks: list[tuple]) -> list[tuple[int, tuple]]:
    """글 블록을 쪽 글 안에서 앞에서부터 찾음(공백 정규화) → [(시작, bbox)]. 못 찾은 블록은 건너뜀"""
    out, cur = [], 0
    for x0, y0, x1, y1, bt in blocks:
        words = bt.split()
        if not words:
            continue
        m = re.compile(r"\s+".join(map(re.escape, words))).search(text, cur)
        if m:
            out.append((m.start(), (x0, y0, x1, y1)))
            cur = m.end()
    return out


def _cut(text: str, start: int, limit: int) -> int:
    """start + CHUNK_MIN ~ limit 사이 마지막 공백 뒤(없으면 limit)"""
    seg = text[start + CHUNK_MIN:limit]
    i = max(seg.rfind(" "), seg.rfind("\n"))
    return start + CHUNK_MIN + i + 1 if i >= 0 else limit


def _union(a, b):
    if a is None or b is None:
        return a if b is None else b
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def make_chunks(page_texts: list[str], layout: list | None = None) -> list[dict]:
    """쪽 안에서만 자른 조각 [{page, start, end, rect}]. 한 쪽의 조각은 그 쪽 글을 빈틈 · 겹침 없이 덮는다(AC-I02).
    layout = pdf.text_blocks 결과(없거나 블록을 못 맞추면 그 쪽은 글자 수로만 자르고 rect 없음)"""
    chunks = []
    for pno, text in enumerate(page_texts, 1):
        if not text.strip():
            continue
        units = []
        if layout and pno <= len(layout):
            w, h, blocks = layout[pno - 1]
            spans = _locate(text, blocks) if w and h else []
            for i, (s, bb) in enumerate(spans):
                end = spans[i + 1][0] if i + 1 < len(spans) else len(text)
                rect = tuple(min(1.0, max(0.0, v / d)) for v, d in zip(bb, (w, h, w, h)))
                units.append([0 if i == 0 else s, end, rect])
        units = [u for u in units if u[1] > u[0]] or [[0, len(text), None]]
        pieces = []
        for s, e, r in units:
            while e - s > CHUNK_MAX:
                cut = _cut(text, s, s + CHUNK_TARGET)
                pieces.append([s, cut, r])
                s = cut
            pieces.append([s, e, r])
        groups: list[list] = []
        for s, e, r in pieces:
            g = groups[-1] if groups else None
            if g and (g[1] - g[0] < CHUNK_MIN or e - g[0] <= CHUNK_TARGET):
                g[1], g[2] = e, _union(g[2], r)
            else:
                groups.append([s, e, r])
        if len(groups) > 1 and groups[-1][1] - groups[-1][0] < CHUNK_MIN:  # 짧은 꼬리는 앞에 붙임
            last = groups.pop()
            groups[-1][1], groups[-1][2] = last[1], _union(groups[-1][2], last[2])
        chunks += [{"page": pno, "start": s, "end": e, "rect": r} for s, e, r in groups]
    return chunks


# ====================================================================== 파일 형식 (8.2절)
HEADER = struct.Struct("<8sQIHH64s16s24s")
MAGIC = b"PLRAGV01"
META = np.dtype([("page", "<u2"), ("start", "<u4"), ("end", "<u4"), ("rect", "<f2", (4,)), ("_r", "<u2")])
assert HEADER.size == 128 and META.itemsize == 20


def pack(paper_id: int, sha: str, version: str, chunks: list[dict], vecs: np.ndarray | None) -> bytes:
    n, dim = len(chunks), (0 if vecs is None else vecs.shape[1])
    meta = np.zeros(n, META)
    for i, c in enumerate(chunks):
        meta[i] = (c["page"], c["start"], c["end"], c["rect"] if c["rect"] else (math.nan,) * 4, 0)
    head = HEADER.pack(MAGIC, paper_id, n, dim, 0, sha.encode("ascii"), version.encode("ascii"), b"")
    return head + meta.tobytes() + (vecs.astype("<f2").tobytes() if dim else b"")


def unpack(data: bytes, paper_id: int, sha: str, version: str) -> tuple[np.ndarray, np.ndarray]:
    """→ (메타, float32 행렬 n×dim). 머리 · 길이 · 논문 · PDF · 판이 DB 행과 다르면 RagFileError(AC-S05)"""
    if len(data) < HEADER.size:
        raise RagFileError("short")
    magic, pid, n, dim, _, fsha, fver, _ = HEADER.unpack_from(data)
    if (magic != MAGIC or n > MAX_CHUNKS or dim not in (0, EMBED_DIM)
            or len(data) != HEADER.size + META.itemsize * n + 2 * n * dim):
        raise RagFileError("format")
    if pid != paper_id or fsha.rstrip(b"\0").decode("ascii", "replace") != sha \
            or fver.rstrip(b"\0").decode("ascii", "replace") != version:
        raise RagFileError("mismatch")
    meta = np.frombuffer(data, META, n, HEADER.size).copy()  # 파일 바이트 전체를 붙잡지 않게 (캐시 크기 = 메타 + 행렬)
    rect = meta["rect"].astype(np.float32)
    nan = np.isnan(rect)
    if ((meta["page"] < 1).any() or (meta["start"] > meta["end"]).any()   # 메타 범위 (품질팀 L2)
            or (nan.any(axis=1) & ~nan.all(axis=1)).any() or ((rect < 0) | (rect > 1))[~nan].any()):
        raise RagFileError("meta")
    mat = np.frombuffer(data, "<f2", n * dim, HEADER.size + META.itemsize * n).reshape(n, dim).astype(np.float32)
    if not np.isfinite(mat).all():
        raise RagFileError("vector")
    return meta, mat


def rect_of(meta_row) -> list | None:
    r = [float(x) for x in meta_row["rect"]]
    return None if any(math.isnan(x) for x in r) else [round(x, 4) for x in r]


# ====================================================================== 메모리 캐시 (9장)
class _User:
    def __init__(self, now: float):
        self.papers: dict[int, tuple] = {}   # paper_id → (rag_key, meta, mat)
        self.bad: set[str] = set()           # 검사에 실패한 키 — 대기로 되돌릴 때까지 R2를 다시 읽지 않음 (품질팀 L1)
        self.last = now
        self.lock = threading.Lock()

    def nbytes(self) -> int:
        return sum(m.nbytes + v.nbytes for _, m, v in list(self.papers.values()))


class VectorCache:
    """{검증된 uid: 그 사용자 논문들의 메타 · 행렬}. 상한 · 사용자 단위 LRU · 유휴 내림(K-18).
    캐시를 고르는 키는 늘 검증된 uid(JWT sub · actor_claims)뿐이고, 꺼내는 논문은 RLS 질의로 얻은 목록과의 교집합뿐이다."""

    def __init__(self, max_bytes: int = CACHE_MAX_BYTES, idle_s: float = IDLE_S, threads: int = LOAD_THREADS,
                 clock: Callable[[], float] = time.monotonic):
        self.max_bytes, self.idle_s, self.threads, self.clock = max_bytes, idle_s, threads, clock
        self._users: dict[str, _User] = {}
        self._lock = threading.Lock()
        self._swept = 0.0

    def _user(self, uid: str) -> _User:
        with self._lock:
            u = self._users.get(uid)
            if u is None:
                u = self._users[uid] = _User(self.clock())
            return u

    def users(self) -> list[str]:
        with self._lock:
            return list(self._users)

    def loaded(self, uid: str, rows: list[dict]) -> bool:
        with self._lock:
            u = self._users.get(uid)
        papers, bad = (u.papers, u.bad) if u else ({}, set())
        return all((papers.get(r["id"]) or ("",))[0] == r["rag_key"] for r in rows if r["rag_key"] and r["rag_key"] not in bad)

    def _read(self, us: UserStorage, row: dict):
        try:
            return unpack(us.get(row["rag_key"]), row["id"], row["pdf_sha256"], row["rag_version"])
        except StorageKeyError:
            raise
        except (NotFound, RagFileError):
            return None
        except StorageError:
            return False  # 일시 오류: 이번엔 빼고 다음에 다시 (대기로 되돌리지 않음)

    def load(self, uid: str, rows: list[dict], us: UserStorage, wait_s: float = LOAD_WAIT_S) -> tuple[dict, list[dict]]:
        """rows(RLS 질의 결과)의 파일을 불러 → ({paper_id: (메타, 행렬)}, 검사에 실패한 행). 목록 밖 캐시 항목은 쓰지 않는다"""
        if us.uid != uid:
            raise StorageKeyError("사용자가 다른 저장소예요")
        self._sweep_idle(keep=uid)
        u = self._user(uid)
        if not u.lock.acquire(timeout=wait_s):
            raise RagBusy()
        try:
            bad = [r for r in rows if r["rag_key"] in u.bad]
            need = [r for r in rows if r["rag_key"] and r["rag_key"] not in u.bad
                    and (u.papers.get(r["id"]) or ("",))[0] != r["rag_key"]]
            if need:
                started = time.monotonic()
                with ThreadPoolExecutor(min(self.threads, len(need))) as ex:
                    results = list(ex.map(lambda r: self._read(us, r), need))
                for r, res in zip(need, results):
                    if res:
                        u.papers[r["id"]] = (r["rag_key"], *res)
                    else:
                        u.papers.pop(r["id"], None)
                        if res is None:
                            bad.append(r)
                            u.bad.add(r["rag_key"])
                log.info(json.dumps({"event": "rag_load", "papers": len(need), "ms": int((time.monotonic() - started) * 1000),
                                     "mb": round(u.nbytes() / 1048576, 1)}))
            u.last = self.clock()
            out = {}
            for r in rows:
                hit = u.papers.get(r["id"])
                if hit and hit[0] == r["rag_key"]:
                    out[r["id"]] = hit[1:]
        finally:
            u.lock.release()
        self._evict(keep=uid)
        return out, bad

    def prefetch(self, uid: str, rows: list[dict], us: UserStorage) -> None:
        """#/ask를 열 때: 백그라운드로 미리 불러오기(같은 사용자 로드는 잠금으로 한 번만 — 9.4절)"""
        if self.loaded(uid, rows) or self._user(uid).lock.locked():
            return

        def run():
            try:
                self.load(uid, rows, us, wait_s=0.1)
            except Exception as e:  # noqa: BLE001 - 미리 불러오기는 실패해도 질문 때 다시
                log.warning("rag prefetch failed: %s", type(e).__name__)
        threading.Thread(target=run, name="rag-prefetch", daemon=True).start()

    def put_paper(self, uid: str, paper_id: int, key: str, meta, mat) -> None:
        """색인 교체 뒤: 그 사용자가 올라와 있을 때만 바꿔 넣음"""
        with self._lock:
            u = self._users.get(uid)
        if u is not None:
            u.papers[paper_id] = (key, meta, mat)

    def drop_paper(self, uid: str, paper_id: int) -> None:
        with self._lock:
            u = self._users.get(uid)
        if u is not None:
            u.papers.pop(paper_id, None)

    def _drop(self, uid: str, reason: str) -> None:
        u = self._users.pop(uid)
        log.info(json.dumps({"event": "rag_evict", "reason": reason, "mb": round(u.nbytes() / 1048576, 1)}))

    def _sweep_idle(self, keep: str) -> None:
        now = self.clock()
        with self._lock:
            if now - self._swept < min(60.0, self.idle_s):
                return
            self._swept = now
            for uid, u in list(self._users.items()):
                if uid != keep and now - u.last > self.idle_s and not u.lock.locked():
                    self._drop(uid, "idle")

    def _evict(self, keep: str) -> None:
        # ponytail: 한 사용자가 혼자 상한을 넘는 경우(약 8,000편)는 그대로 둠 — 그런 서재가 생기면 범위 논문만 올리기
        with self._lock:
            sizes = {uid: u.nbytes() for uid, u in self._users.items()}
            total = sum(sizes.values())
            for uid in sorted((x for x in self._users if x != keep), key=lambda x: self._users[x].last):
                if total <= self.max_bytes:
                    break
                if not self._users[uid].lock.locked():
                    total -= sizes[uid]
                    self._drop(uid, "lru")


# ====================================================================== 검색 (11장)
def query_terms(question: str) -> list[str]:
    """낱말(2자 미만 버림, 한글 낱말 끝 조사 한 번 떼기, 최대 8개 — 11.2절)"""
    out, seen = [], set()
    for w in re.findall(r"\w+", question or ""):
        if re.search(r"[가-힣]$", w):
            for p in PARTICLES:
                if w.endswith(p) and len(w) - len(p) >= 2:
                    w = w[:-len(p)]
                    break
        if len(w) >= 2 and w.lower() not in seen:
            seen.add(w.lower())
            out.append(w)
    return out[:8]


def pgroonga_query(terms: list[str]) -> str:
    """&@~ 질의: 낱말마다 큰따옴표로 감싸(문법 문자를 글자로) OR로 잇는다"""
    return " OR ".join('"' + t.replace("\\", "\\\\").replace('"', '\\"') + '"' for t in terms)


def rrf_pick(rank_lists: list[list], k: int = TOP_K, per_group: int = PER_PAPER, group=lambda x: x[0]) -> list:
    """RRF(k=60, 가중치 1) → 상위 k개, 같은 무리(논문) 최대 per_group개"""
    score: dict = {}
    for ranks in rank_lists:
        for i, item in enumerate(ranks):
            score[item] = score.get(item, 0.0) + 1.0 / (RRF_K + i + 1)
    out, per = [], {}
    for item in sorted(score, key=lambda x: -score[x]):
        g = group(item)
        if per.get(g, 0) < per_group:
            per[g] = per.get(g, 0) + 1
            out.append((item, score[item]))
            if len(out) >= k:
                break
    return out


def cite_sources(text: str, sources: list[dict]) -> tuple[str, list[dict]]:
    """[n] 해석(11.3절): 목록 밖 번호는 지우고 쓰인 번호만 citations에. `[1, 2]`는 `[1][2]`로"""
    by_n = {s["n"]: s for s in sources}
    used: list[int] = []

    def repl(m: re.Match) -> str:
        keep = [n for n in (int(x) for x in re.findall(r"\d+", m.group(0))) if n in by_n]
        used.extend(n for n in keep if n not in used)
        return "".join(f"[{n}]" for n in keep)

    text = re.sub(r"\[\d{1,3}(?:\s*[,，]\s*\d{1,3})*\]", repl, text or "")
    cites = [{k: by_n[n].get(k) for k in ("n", "paper_id", "page", "char_start", "char_end", "rect", "title", "year")}
             | {"text": (by_n[n].get("text") or "")[:SOURCE_PREVIEW]} for n in sorted(used)]
    return text.strip(), cites


def with_citations(events, sources: list[dict]):
    """AI 이벤트 → done에 출처 번호 해석을 붙인다(세 경로 같은 해석)"""
    for ev in events:
        if ev.get("type") == "done":
            text, cites = cite_sources(ev.get("text") or "", sources)
            yield {"type": "done", "text": text, "citations": cites}
        else:
            yield ev


ASK_SYSTEM = """당신은 연구자의 서재 논문들을 근거로 답하는 연구 조수입니다. {lang}로 답하세요.
- 아래 <source> 자료만 근거로 쓰고, 근거가 되는 문장 끝에 출처 번호를 [번호] 형식으로 붙이세요 (예: …이다 [1][3]).
- 자료에 없는 내용을 물으면 자료에는 없다고 먼저 밝히고, 일반 지식으로 답할 때는 그렇다고 구분하세요(번호 없이).
- 목록에 없는 번호는 쓰지 마세요. 수식은 $...$(인라인) 또는 $$...$$(블록) LaTeX로 쓰세요.
- 답은 핵심부터, 필요한 만큼만 길게."""


def _attr(v) -> str:
    return str(v if v is not None else "").replace('"', "'").replace("\n", " ")[:300]


def page_slices(lib, items: list[dict]) -> dict[tuple, str]:
    """{(paper_id, page): 쪽 글} — RLS 트랜잭션에서 필요한 쪽만"""
    pids = sorted({it["paper_id"] for it in items})
    pages = sorted({it["page"] for it in items})
    if not pids:
        return {}
    rows = lib._all("select paper_id, page, text from paperlab.page_texts where user_id = %s and paper_id = any(%s) "
                    "and page = any(%s)", (lib.uid, pids, pages))
    return {(r["paper_id"], r["page"]): r["text"] for r in rows}


def ask_request(lib, params: dict, history: list[dict], lang: str) -> tuple[str, str]:
    """범위 질문 (시스템, 프롬프트) — API · CLI 같은 프롬프트(11.3절). 조각 글은 page_texts에서 위치로 잘라 온다"""
    sources = params.get("sources") or []
    pages = page_slices(lib, sources)
    blocks = []
    for s in sources:
        text = (pages.get((s["paper_id"], s["page"])) or "")[s["char_start"]:s["char_end"]]
        blocks.append(f'<source n="{s["n"]}" title="{_attr(s.get("title"))}" year="{_attr(s.get("year"))}" '
                      f'page="{s["page"]}">\n{text.strip()}\n</source>')
    convo = "\n\n".join(f"{'사용자' if m['role'] == 'user' else '조수'}: {m['content']}" for m in history[-HISTORY_N:])
    return ASK_SYSTEM.format(lang=lang), ("<sources>\n" + "\n".join(blocks) + "\n</sources>\n\n"
                                          + (f"<conversation>\n{convo}\n</conversation>\n\n" if convo else "")
                                          + f"질문: {params.get('question') or ''}")


SCOPE_RE = re.compile(r"(library)|c([1-9][0-9]{0,14})|f([1-9][0-9]{0,14})")


def parse_scope(value: str) -> tuple[str, int | None]:
    m = SCOPE_RE.fullmatch(str(value or ""))
    if not m:
        raise ValueError("범위가 올바르지 않아요")
    if m.group(1):
        return "library", None
    return ("collection", int(m.group(2))) if m.group(2) else ("folder", int(m.group(3)))


def scope_rows(lib, stype: str, sid: int | None) -> list[dict]:
    """범위 → 논문 행(9.2절 1번 — 사용자 권한 트랜잭션). 이 목록이 검색해도 되는 논문의 전부"""
    cond = {"library": "",
            "collection": " and p.id in (select pc.paper_id from paperlab.paper_collections pc "
                          "where pc.user_id = %(uid)s and pc.collection_id = %(sid)s)",
            "folder": " and p.folder_id = %(sid)s"}[stype]
    return lib._all("select p.id, p.title, p.year, p.pdf_key <> '' as has_pdf, p.rag_key, p.rag_version, p.pdf_sha256 "
                    "from paperlab.papers p where p.user_id = %(uid)s" + cond + " order by p.id",
                    {"uid": lib.uid, "sid": sid})


def searchable(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["rag_version"] in SEARCH_VERSIONS and r["rag_key"]]


class Rag:
    """서버 프로세스 하나에 하나: 저장소 · 임베딩 · 벡터 캐시. 사용자 범위는 매번 (lib, uid)로 받는다"""

    def __init__(self, storage, embedder=None, cache: VectorCache | None = None):
        self.storage, self.embedder = storage, embedder
        self.cache = cache or VectorCache()

    @property
    def done_versions(self) -> list[str]:
        """이 판이면 다시 색인하지 않음. 모델이 생기면 '…n'도 대기로 보인다(AC-I05)"""
        return [RAG_VERSION] if self.embedder else [RAG_VERSION, NO_MODEL_VERSION]

    # ------------------------------------------------------------ 색인 (10장)
    def pending_count(self, lib, exclude=()) -> int:
        return lib._one("select count(*)::int as n from paperlab.papers where user_id = %s and pdf_key <> '' "
                        "and rag_version <> all(%s) and id <> all(%s)",
                        (lib.uid, self.done_versions, list(exclude)))["n"]

    def ensure_index_job(self, lib) -> int | None:
        """대기 논문이 있고 진행 중 index 작업이 없으면 만든다 → 새 작업 id (10.1절)"""
        row = lib._one(
            "insert into paperlab.jobs (user_id, kind, status, runner, engine, route) "
            "select %(uid)s, 'index', 'queued', 'api', 'local', %(route)s where exists (select 1 from paperlab.papers "
            "  where user_id = %(uid)s and pdf_key <> '' and rag_version <> all(%(done)s)) "
            "on conflict (user_id, kind) where kind = 'index' and status in ('queued', 'running') do nothing returning id",
            {"uid": lib.uid, "route": Jsonb([{"runner": "api", "engine": "local"}]), "done": self.done_versions})
        return row["id"] if row else None

    def index_next(self, tx: Callable, uid: str, skip: set) -> dict | None:
        """대기 논문 하나를 색인하고 교체(8.4절) → {"paper_id", "chunks"} | {"paper_id", "error"} | None(남은 것 없음)"""
        with tx() as lib:
            p = lib._one("select id, title, pdf_key, pdf_sha256 from paperlab.papers where user_id = %s and pdf_key <> '' "
                         "and rag_version <> all(%s) and id <> all(%s) order by id limit 1",
                         (uid, self.done_versions, list(skip)))
            if not p:
                return None
            texts = lib.page_texts(p["id"])
        us = UserStorage(self.storage, uid)
        layout = None
        try:
            layout = pdf.text_blocks(us.get(p["pdf_key"]))
        except StorageKeyError:
            raise
        except StorageError:
            return {"paper_id": p["id"], "error": "storage"}
        except Exception:  # noqa: BLE001 - 깨진 PDF: 좌표 없이 쪽 글만으로
            layout = None
        chunks = make_chunks(texts, layout)
        if len(chunks) > MAX_CHUNKS:
            return {"paper_id": p["id"], "error": "too_many_chunks"}
        new_key, meta, mat = "", None, None
        version = RAG_VERSION if (self.embedder or not chunks) else NO_MODEL_VERSION
        if chunks:
            try:
                vecs = self.embedder.embed([doc_text(p["title"], texts[c["page"] - 1][c["start"]:c["end"]])
                                            for c in chunks]) if self.embedder else None
            except Exception as e:  # noqa: BLE001 - 모델 실행 오류: 이번엔 건너뜀(작업 끝에 index_failed)
                log.warning("embed failed: %s", type(e).__name__)
                return {"paper_id": p["id"], "error": "embed"}
            blob = pack(p["id"], p["pdf_sha256"], version, chunks, vecs)
            meta, mat = unpack(blob, p["id"], p["pdf_sha256"], version)
            new_key = rag_key(uid, p["id"], version)
            try:
                us.put(new_key, blob, RAG_TYPE)
            except StorageError:
                return {"paper_id": p["id"], "error": "storage"}
        with tx() as lib:  # 교체 = 포인터 한 줄. 그 사이 PDF가 바뀌었으면 바꾸지 않음
            cur = lib._one("select pdf_sha256, rag_key from paperlab.papers where id = %s and user_id = %s for update",
                           (p["id"], uid))
            swapped = bool(cur) and cur["pdf_sha256"] == p["pdf_sha256"]
            if swapped:
                lib._x("update paperlab.papers set rag_key = %s, rag_version = %s where id = %s and user_id = %s",
                       (new_key, version, p["id"], uid))
        if not swapped:
            if new_key:
                us.delete_quietly(new_key)
            return {"paper_id": p["id"], "chunks": 0, "replaced": False}
        if cur["rag_key"] and cur["rag_key"] != new_key:
            us.delete_quietly(cur["rag_key"])
        if new_key:
            self.cache.put_paper(uid, p["id"], new_key, meta, mat)
        else:
            self.cache.drop_paper(uid, p["id"])
        return {"paper_id": p["id"], "chunks": len(chunks)}

    def forget(self, uid: str, paper_id: int, old_key: str) -> None:
        """논문 삭제 · PDF 교체 커밋 뒤: 옛 파일 지우기 + 캐시에서 빼기(8.4절)"""
        self.cache.drop_paper(uid, paper_id)
        if old_key:
            UserStorage(self.storage, uid).delete_quietly(old_key)

    # ------------------------------------------------------------ 검색 (11.2절)
    @staticmethod
    def _reset_bad(tx: Callable, bad: list[dict]) -> None:
        """검사에 실패한 파일의 논문을 색인 대기로 (AC-S05 — 키가 그대로일 때만)"""
        if bad:
            with tx() as lib:
                lib._x("update paperlab.papers set rag_version = '' where user_id = %s and id = any(%s) and rag_key = any(%s)",
                       (lib.uid, [r["id"] for r in bad], [r["rag_key"] for r in bad]))

    def papers(self, tx: Callable, uid: str, rows: list[dict]) -> dict:
        """RLS 목록(rows)의 벡터 파일을 캐시에서 꺼냄 — R2 읽기는 트랜잭션 밖. 검사에 실패한 논문은 대기로 되돌리고 뺀다"""
        loaded, bad = self.cache.load(uid, searchable(rows), UserStorage(self.storage, uid))
        self._reset_bad(tx, bad)
        return loaded

    def prefetch(self, tx: Callable, uid: str, rows: list[dict]) -> None:
        """#/ask를 열 때 백그라운드로 미리 불러오기. 검사 실패는 대기로 되돌려 다시 읽는 반복을 끊는다 (품질팀 L1)"""
        rows = searchable(rows)
        if self.cache.loaded(uid, rows) or self.cache._user(uid).lock.locked():
            return

        def run():
            try:
                _, bad = self.cache.load(uid, rows, UserStorage(self.storage, uid), wait_s=0.1)
                self._reset_bad(tx, bad)
            except Exception as e:  # noqa: BLE001 - 미리 불러오기는 실패해도 질문 때 다시
                log.warning("rag prefetch failed: %s", type(e).__name__)
        threading.Thread(target=run, name="rag-prefetch", daemon=True).start()

    def loaded(self, uid: str, rows: list[dict]) -> bool:
        return self.cache.loaded(uid, searchable(rows))

    def search(self, tx: Callable, uid: str, rows: list[dict], question: str, k: int = TOP_K, per_paper: int = PER_PAPER,
               prefer_page: int | None = None) -> list[dict]:
        """혼합 검색: 벡터(메모리, 상위 40) + PGroonga(쪽 20) → RRF → 상위 k조각(논문당 per_paper).
        rows = 호출하는 쪽이 RLS 트랜잭션으로 미리 읽은 목록(사용자 경계) — 결과는 모두 이 안의 논문.
        R2 읽기 · 임베딩은 트랜잭션 밖, 낱말 검색 · 쪽 글은 짧은 트랜잭션 tx() 하나. prefer_page: 그 쪽 조각을 앞에(인용 검증)"""
        papers = self.papers(tx, uid, rows)
        if not papers:
            return []
        lists = []
        dims = [pid for pid, (_, mat) in papers.items() if mat.shape[1]]
        if self.embedder and dims:
            q = self.embedder.embed([QUERY_PREFIX + question])[0]
            scores = np.concatenate([papers[pid][1] @ q for pid in dims])
            offsets = np.cumsum([0] + [papers[pid][1].shape[0] for pid in dims])
            top = np.argpartition(-scores, min(VEC_TOP, len(scores)) - 1)[:VEC_TOP]
            top = top[np.argsort(-scores[top])]
            owner = np.searchsorted(offsets, top, "right") - 1  # 행 번호 → 논문 순번
            lists.append([(dims[j], int(i - offsets[j])) for i, j in zip(top, owner)])
        terms = query_terms(question)
        page_text: dict[tuple, str] = {}
        with tx() as lib:  # 낱말 검색 · 쪽 글은 짧은 트랜잭션 하나 (품질팀 M2)
            if terms:
                hits = lib._all(
                    f"select pt.paper_id, pt.page, pt.text, extensions.pgroonga_score(pt.tableoid, pt.ctid) as score "
                    f"from paperlab.page_texts pt where pt.user_id = %s and pt.paper_id = any(%s) and pt.text {PGRN_QUERY} %s "
                    f"order by score desc, pt.paper_id, pt.page limit %s",
                    (uid, list(papers), pgroonga_query(terms), FTS_PAGES))
                low = [t.lower() for t in terms]
                fts = []
                for h in hits:
                    page_text[(h["paper_id"], h["page"])] = h["text"]
                    meta = papers[h["paper_id"]][0]
                    for i in np.nonzero(meta["page"] == h["page"])[0]:
                        seg = h["text"][int(meta["start"][i]):int(meta["end"][i])].lower()
                        if any(t in seg for t in low):
                            fts.append((h["paper_id"], int(i)))
                lists.append(fts)
            picked = rrf_pick(lists, k=10 ** 9, per_group=10 ** 9)
            if prefer_page is not None:
                picked.sort(key=lambda x: papers[x[0][0]][0]["page"][x[0][1]] != prefer_page)
            out, per = [], {}
            for (pid, i), score in picked:
                if per.get(pid, 0) >= per_paper:
                    continue
                per[pid] = per.get(pid, 0) + 1
                m = papers[pid][0][i]
                out.append({"paper_id": pid, "page": int(m["page"]), "char_start": int(m["start"]), "char_end": int(m["end"]),
                            "rect": rect_of(m), "score": round(float(score), 5)})
                if len(out) >= k:
                    break
            missing = [o for o in out if (o["paper_id"], o["page"]) not in page_text]
            page_text.update(page_slices(lib, missing))
            for o in out:
                o["text"] = (page_text.get((o["paper_id"], o["page"])) or "")[o["char_start"]:o["char_end"]]
        return out

    def sources_for(self, tx: Callable, uid: str, rows: list[dict], question: str) -> list[dict]:
        """질문 출처 8개(번호표) — params.sources에 고정되어 반영 때 같은 번호를 쓴다(11.3절)"""
        info = {r["id"]: r for r in rows}
        started = time.monotonic()
        hits = self.search(tx, uid, rows, question)
        log.info(json.dumps({"event": "ask", "ms": int((time.monotonic() - started) * 1000), "chunks": len(hits),
                             "papers": len({h["paper_id"] for h in hits}), "vector": bool(self.embedder)}))
        return [{"n": i + 1, "paper_id": h["paper_id"], "page": h["page"], "char_start": h["char_start"],
                 "char_end": h["char_end"], "rect": h["rect"], "title": info[h["paper_id"]]["title"],
                 "year": info[h["paper_id"]]["year"], "text": h["text"].strip()[:SOURCE_PREVIEW]}
                for i, h in enumerate(hits)]
