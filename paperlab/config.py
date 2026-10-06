"""데이터 폴더 위치와 사용자 설정(settings.json)을 관리한다."""

from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path

DEFAULT_SETTINGS: dict = {
    # "api" = Anthropic API(권장), "cli" = 설치된 Claude Code CLI(`claude -p`)
    "ai_engine": "api",
    "anthropic_api_key": "",
    "model": "claude-opus-5-5",
    "effort": "medium",
    "summary_language": "한국어",
    # OpenAlex/Crossref의 polite pool에 들어가기 위한 연락처 (선택)
    "contact_email": "",
    "openalex_api_key": "",
    "semantic_scholar_api_key": "",
    "citation_style": "apa",
    # 인용 문구의 용어 언어 (en-US: et al., and / ko-KR: 외, 및)
    "citation_locale": "en-US",
    # 참고문헌 목록에서 국문 문헌을 영문 문헌보다 앞에 둘지 (국내 학위논문 관례)
    "korean_first": True,
    # 새 원고의 기본 논문 양식 (기본 양식 id 또는 내 양식 'user-{번호}')
    "doc_format_default": "default",
}

SECRET_KEYS = ("anthropic_api_key", "openalex_api_key", "semantic_scholar_api_key")


def default_data_dir() -> Path:
    env = os.environ.get("PAPERLAB_HOME")
    if env:
        return Path(env).expanduser()
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "PaperLab"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "PaperLab"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "paperlab"


class Settings:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.path = data_dir / "settings.json"
        self._lock = threading.Lock()
        self._values = dict(DEFAULT_SETTINGS)
        if self.path.exists():
            try:
                stored = json.loads(self.path.read_text(encoding="utf-8"))
                self._values.update({k: v for k, v in stored.items() if k in DEFAULT_SETTINGS})
            except (OSError, json.JSONDecodeError):
                pass

    def get(self, key: str):
        return self._values.get(key, DEFAULT_SETTINGS.get(key))

    def all(self) -> dict:
        return dict(self._values)

    def public(self) -> dict:
        """비밀 값은 설정 여부만 알려준다."""
        out = self.all()
        for key in SECRET_KEYS:
            out[key + "_set"] = bool(out.pop(key))
        out["env_api_key_set"] = bool(os.environ.get("ANTHROPIC_API_KEY"))
        return out

    def update(self, changes: dict) -> None:
        with self._lock:
            for key, value in changes.items():
                if key not in DEFAULT_SETTINGS:
                    continue
                # 비밀 값은 빈 문자열이 오면 "변경 없음"으로 본다. 지우려면 null을 보낸다.
                if key in SECRET_KEYS:
                    if value is None:
                        value = ""
                    elif value == "":
                        continue
                self._values[key] = value
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._values, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, self.path)
