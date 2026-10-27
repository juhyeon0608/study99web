"""공용 SSL 문맥 (tls.py — 2026-10-28): 인증서 묶음을 한 번만 읽고, 외부 접속 클라이언트가 모두 그 문맥을 쓴다"""
import ssl
from pathlib import Path

from paperlab import tls

SRC = Path(__file__).resolve().parents[1] / "paperlab"


def test_context_is_shared_and_verifies():
    c = tls.context()
    assert c is tls.context() and isinstance(c, ssl.SSLContext)
    assert c.verify_mode == ssl.CERT_REQUIRED and c.check_hostname


def test_every_outbound_client_uses_shared_context():
    import re
    for f in ("sources.py", "rag.py", "ai.py", "auth.py"):
        text = (SRC / f).read_text(encoding="utf-8")
        for m in re.finditer(r"httpx\.(Client|get)\((?:[^()]|\([^()]*\))*\)", text):
            assert "verify=tls.context()" in m.group(), (f, m.group()[:80])
    assert "anthropic.DefaultHttpxClient(verify=tls.context())" in (SRC / "ai.py").read_text(encoding="utf-8")
