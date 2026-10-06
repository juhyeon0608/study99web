// 서버 API 호출 도우미

async function request(method, url, body, opts = {}) {
  // 쓰기 요청을 이 화면에서 보냈다는 표시 (서버가 다른 사이트의 요청을 막는 데 쓴다)
  const init = { method, headers: { "X-PaperLab": "1" } };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (opts.raw) return res;
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 409 && opts.allowConflict) return { conflict: true, ...data };
    const detail = data && data.detail ? data.detail : (typeof data === "string" && data) || `오류 (${res.status})`;
    throw new Error(Array.isArray(detail) ? detail.map((d) => d.msg).join(", ") : detail);
  }
  return data;
}

export const api = {
  get: (url) => request("GET", url),
  post: (url, body, opts) => request("POST", url, body, opts),
  put: (url, body) => request("PUT", url, body),
  patch: (url, body) => request("PATCH", url, body),
  del: (url) => request("DELETE", url),
  raw: (method, url, body) => request(method, url, body, { raw: true }),
};

export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// 서버가 보내는 text/event-stream을 읽어 이벤트마다 콜백을 부른다
export async function streamEvents(url, body, onEvent, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PaperLab": "1" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = `오류 (${res.status})`;
    try { msg = (await res.json()).detail || msg; } catch { /* 본문 없음 */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
      }
    }
  }
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
