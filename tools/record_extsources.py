"""5단계 녹화 픽스처 만들기 — 관리자가 손으로 한 번 실행 (docs/specs/phase5-korean-db.md 13장 · K-18).

자동 테스트 · CI에서는 실행하지 않는다(테스트는 저장된 파일만 읽음). 실제 외부 서비스를 부른다.

    .venv\\Scripts\\python.exe tools\\record_extsources.py [--env-file 경로] [--only kci,riss,epmc,oc,openalex]

- 키: 서버 PC cloud.env의 KCI_API_KEY · RISS_API_KEY(값은 출력하지 않음). 키가 없는 소스는 건너뜀(RISS는 키가 있을 때만 — U-2).
- 정해 둔 질의(국문 2 · 영문 1 · DOI 5편)로 받아 tests/fixtures/extsources/ 에 **응답 본문만** 저장(요청 주소 · 헤더는 버림).
  본문에 키 문자열이 있으면 저장하지 않고 중단, 이메일 모양 문자열(저자 연락처 등)은 redacted@example.invalid로 바꿔 저장. 파일 옆 *.meta.json에는 받은 날짜 · 소스 · 질의 종류만.
- OpenAlex는 무료 PDF 위치(best_oa_location · oa_locations)의 license 실제 값 목록을 끝에 보여 줌(8.2절 허용 목록 확인용).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from paperlab import extsources as ex  # noqa: E402
from paperlab.config import load_env_file  # noqa: E402
from paperlab.sources import OC, OPENALEX, doi_path, strict_get  # noqa: E402

OUT = ROOT / "tests" / "fixtures" / "extsources"
KO_QUERIES = ("딥러닝", "인공지능 교육")
EN_QUERY = "deep learning"
# 무료 PDF 라이선스가 여러 가지인 DOI(CC · 출판사 OA · OA 없음 섞이게 — 관리자가 바꿔도 됨)
DOIS = ("10.1371/journal.pone.0000308", "10.3390/s21010001", "10.1038/nature12373", "10.1038/nature14539",
        "10.1016/j.cell.2016.01.010")
EMAIL_RE = re.compile(rb"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def contains_secret(body: bytes, secrets) -> bool:
    """본문에 키 문자열이 있으면 참 (저장하지 않고 멈춤)"""
    return any(s and s.encode() in (body or b"") for s in secrets)


def scrub_emails(body: bytes) -> bytes:
    """이메일 모양 문자열을 가려 저장 — 저자 개인정보를 픽스처에 남기지 않음"""
    return EMAIL_RE.sub(b"redacted@example.invalid", body or b"")


def save(name: str, body: bytes, source: str, kind: str, secrets) -> None:
    if contains_secret(body, secrets):
        raise SystemExit(f"{name}: 응답 본문에 키 문자열이 있어 저장하지 않고 멈춰요")
    body = scrub_emails(body)
    (OUT / name).write_bytes(body)
    meta = {"recorded_on": date.today().isoformat(), "source": source, "kind": kind}
    (OUT / f"{name}.meta.json").write_text(json.dumps(meta, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"저장: {name} ({len(body):,}바이트)")


def get(url: str, params: dict) -> bytes:
    status, _, body = strict_get(url, params, {})
    if status != 200:
        raise SystemExit(f"{url.split('/')[2]} 응답 {status} — 저장하지 않음")  # 주소 · 매개변수(키)는 출력하지 않음
    return body


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--env-file", default=None)
    ap.add_argument("--only", default="kci,riss,epmc,oc,openalex")
    args = ap.parse_args(argv)
    env = load_env_file(args.env_file)
    kci, riss = (env.get("KCI_API_KEY") or "").strip(), (env.get("RISS_API_KEY") or "").strip()
    secrets = [kci, riss]
    only = set(args.only.split(","))
    OUT.mkdir(parents=True, exist_ok=True)
    if "kci" in only:
        if not kci:
            print("KCI_API_KEY가 없어 KCI는 건너뜀")
        else:
            for i, q in enumerate(KO_QUERIES, 1):
                body = get(ex.KCI_URL, {"key": kci, "apiCode": "articleSearch", "title": q, "displayCount": 20})
                save(f"kci_search{'' if i == 1 else i}.xml", body, "kci", f"ko-{i}", secrets)
    if "riss" in only:
        if not riss:
            print("RISS_API_KEY가 없어 RISS는 건너뜀(U-2 — 손 픽스처만 씀)")
        else:
            for i, q in enumerate(KO_QUERIES, 1):
                body = get(ex.RISS_URL, {"key": riss, "version": "1.0", "type": "A", "keyword": q, "rowcount": 20})
                save(f"riss_search{'' if i == 1 else i}.xml", body, "riss", f"ko-{i}", secrets)
    if "epmc" in only:
        body = get(ex.EPMC_URL, {"query": EN_QUERY, "format": "json", "resultType": "core", "pageSize": 20, "cursorMark": "*"})
        save("epmc_search.json", body, "europepmc", "en-1", secrets)
    licenses: dict[str, int] = {}
    for i, doi in enumerate(DOIS, 1):
        if "oc" in only:
            save(f"oc_references_{i}.json", get(f"{OC}/references/doi:{doi_path(doi)}", {}), "opencitations", f"doi-{i}",
                 secrets)
        if "openalex" in only:
            body = get(f"{OPENALEX}/works/doi:{doi_path(doi)}",
                       {"select": "id,doi,display_name,open_access,best_oa_location,oa_locations"})
            save(f"openalex_oa_{i}.json", body, "openalex", f"doi-{i}", secrets)
            w = json.loads(body)
            for loc in [w.get("best_oa_location")] + list(w.get("oa_locations") or []):
                if isinstance(loc, dict):
                    key = repr(loc.get("license"))
                    licenses[key] = licenses.get(key, 0) + 1
    if licenses:
        print("OpenAlex license 값(8.2절 허용 목록 확인 — 목록 밖 값은 팀장 보고):")
        for k, n in sorted(licenses.items()):
            print(f"  {k}: {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
