"""개발 서버: `python -m paperlab` (명세 11장 — 사용자용 로컬 실행 모드는 없음)

PAPERLAB_DEV=1 과 **테스트용** Supabase 값(SUPABASE_TEST_URL · SUPABASE_TEST_ANON_KEY · SUPABASE_TEST_DB_URL)이
있어야만 뜬다. 127.0.0.1에만 열고, 데이터 폴더 · 브라우저 자동 열기는 없다.
운영 변수(SUPABASE_URL · SUPABASE_DB_URL · R2_* · APP_ENCRYPTION_KEY · ALLOWED_EMAILS)는 쓰지 않는다.
DB는 앱 역할로 접속하고, 저장소는 같은 출처 가짜 저장소(메모리, /_dev_storage)다.
"""

from __future__ import annotations

import argparse
import logging
import os

import uvicorn

from . import __version__
from .config import ConfigError, ServerConfig, decode_encryption_key, load_env_file, parse_allowed_emails

DEV_VARS = ("SUPABASE_TEST_URL", "SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_DB_URL")


def dev_config(env: dict, app_db_url: str | None = None) -> ServerConfig:
    """개발 서버 설정 (품질팀 F10).

    - DB: 관리자(postgres)가 아니라 **앱 역할**(paperlab_app)로 접속. 앱 역할 주소는 테스트 프로젝트에 보관한 비밀번호로
      만든다(`admin.test_app_role_conninfo` — 테스트 표지가 없는 DB면 거부). 관리자 주소는 시작할 때 그 값을 읽는 데만 쓴다.
    - 암호화 키 · 허용 목록: 운영 값(APP_ENCRYPTION_KEY · ALLOWED_EMAILS)을 쓰지 않고 개발용 변수
      PAPERLAB_DEV_ENCRYPTION_KEY(없으면 실행할 때만 쓰는 임시 키) · PAPERLAB_DEV_ALLOWED_EMAILS 를 쓴다.
      개발용 허용 목록이 비어 있으면 테스트 프로젝트의 로그인 사용자를 모두 허용한다(127.0.0.1 전용 서버).
    - 로그인: 테스트 프로젝트는 구글 공급자가 꺼져 있어, 개발 서버에서만 이메일 · 비밀번호 로그인 칸을 연다.
    """
    missing = [k for k in DEV_VARS if not env.get(k)]
    if missing:
        raise ConfigError("개발 서버에 필요한 변수가 비어 있어요: " + ", ".join(missing), missing)
    raw_key = env.get("PAPERLAB_DEV_ENCRYPTION_KEY")
    # 키가 없으면 실행할 때만 쓰는 임시 키 (저장한 API 키는 다시 시작하면 못 읽음)
    key = decode_encryption_key(raw_key) if raw_key else os.urandom(32)
    if app_db_url is None:
        from .admin import AdminError, test_app_role_conninfo
        try:
            app_db_url = test_app_role_conninfo(env["SUPABASE_TEST_DB_URL"])
        except AdminError as e:
            raise ConfigError(f"앱 역할 주소를 만들지 못했어요: {e}", ["SUPABASE_TEST_DB_URL"]) from None
    return ServerConfig(
        supabase_url=env["SUPABASE_TEST_URL"].rstrip("/"),
        supabase_anon_key=env["SUPABASE_TEST_ANON_KEY"],
        db_url=app_db_url,
        encryption_key=key,
        allowed_emails=parse_allowed_emails(env.get("PAPERLAB_DEV_ALLOWED_EMAILS", "")),
        storage_backend="fake",
    )


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m paperlab", description="PaperLab 개발 서버 (테스트 프로젝트 전용)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--env-file", default=None, help="환경 변수 파일 (기본 ~/.paperlab/cloud.env)")
    ap.add_argument("--version", action="version", version=f"PaperLab {__version__}")
    args = ap.parse_args(argv)
    if os.environ.get("PAPERLAB_DEV") != "1":
        raise SystemExit("개발 서버는 PAPERLAB_DEV=1 일 때만 뜹니다. 사용자는 클라우드 주소로 접속해 주세요.")
    try:
        config = dev_config(load_env_file(args.env_file))
    except ConfigError as e:
        raise SystemExit(f"{e}") from None
    from .server import create_app

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    # 외부 요청 주소(그래프 씨앗 · 식별자가 쿼리에 들어감)가 로그에 남지 않게 — 운영 serve.py와 같게 (인용 그래프 8.6절)
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    from .storage import FakeStorage

    # 가짜 저장소를 같은 출처 경로(/_dev_storage)로 열어 브라우저 업로드 · PDF 보기가 된다
    app = create_app(config, storage=FakeStorage(url_base="/_dev_storage"), dev=True)
    print(f"PaperLab {__version__} 개발 서버: http://127.0.0.1:{args.port}/ (테스트 프로젝트, 가짜 저장소, 이메일 로그인)")
    if not config.allowed_emails:
        print("  허용 목록: PAPERLAB_DEV_ALLOWED_EMAILS가 비어 있어 테스트 프로젝트의 로그인 사용자를 모두 허용합니다")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
