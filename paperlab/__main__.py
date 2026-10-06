"""실행: `paperlab` 또는 `python -m paperlab`"""

from __future__ import annotations

import argparse
import socket
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

from . import __version__
from .config import default_data_dir
from .server import create_app


def _free_port(host: str, preferred: int) -> int:
    for port in [preferred, *range(preferred + 1, preferred + 50)]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit("사용할 수 있는 포트를 찾지 못했어요")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="paperlab", description="PaperLab — 설치형 논문 연구 도구")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1", help="기본값은 이 컴퓨터에서만 접속 가능한 127.0.0.1")
    ap.add_argument("--data-dir", type=Path, default=None, help=f"데이터 폴더 (기본: {default_data_dir()})")
    ap.add_argument("--no-browser", action="store_true", help="브라우저를 자동으로 열지 않음")
    ap.add_argument("--window", action="store_true", help="브라우저 대신 앱 창으로 열기 (pywebview 필요)")
    ap.add_argument("--version", action="version", version=f"PaperLab {__version__}")
    args = ap.parse_args(argv)

    port = _free_port(args.host, args.port)
    app = create_app(args.data_dir)
    url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host}:{port}/"
    print(f"PaperLab {__version__}")
    print(f"  주소:        {url}")
    print(f"  데이터 폴더: {app.state.data_dir}")
    print("  종료하려면 이 창에서 Ctrl+C 를 누르세요.")

    config = uvicorn.Config(app, host=args.host, port=port, log_level="warning")
    server = uvicorn.Server(config)

    if args.window:
        try:
            import webview  # pywebview
        except ImportError:
            raise SystemExit("앱 창 모드에는 pywebview가 필요해요: pip install \"paperlab[desktop]\"")
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        while not server.started:
            time.sleep(0.05)
        webview.create_window("PaperLab", url, width=1440, height=900, min_size=(960, 640))
        webview.start()
        server.should_exit = True
        return

    if not args.no_browser:
        def open_browser():
            while not server.started:
                time.sleep(0.05)
            webbrowser.open(url)
        threading.Thread(target=open_browser, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
