// 화면 전체가 함께 쓰는 상태

export const state = {
  view: "library", // library | discover | reader
  filter: { kind: "all", id: null }, // all | recent | starred | status | unfiled | collection | tag | folder | no_folder
  q: "",
  sort: "added",
  papers: [],
  total: 0,
  selected: new Set(),
  activeId: null,
  collections: [],
  folders: [], // [{id, name, parent_id, count}]
  tags: [],
  stats: {},
  meta: { styles: {}, models: {}, item_types: {}, statuses: {} },
  settings: {},
  user: null, // GET /api/me {user_id, email, display_name}
  usage: null, // GET /api/storage/usage {used_bytes, limit_bytes, mine_bytes, level}
};

// 로그아웃할 때 화면 상태를 처음처럼 비운다
export function resetState() {
  Object.assign(state, {
    view: "library", filter: { kind: "all", id: null }, q: "", papers: [], total: 0, activeId: null,
    collections: [], folders: [], tags: [], stats: {}, settings: {}, user: null, usage: null,
  });
  state.selected.clear();
}

const listeners = new Set();

export function onRefresh(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 서재 데이터가 바뀌었을 때 사이드바·목록·상세를 다시 그린다
export async function refreshAll() {
  for (const fn of [...listeners]) {
    try { await fn(); } catch (e) { console.error(e); }
  }
}

// 저장 공간 사용량을 다시 받는다 (시작 · 업로드 · PDF 첨부/교체 · 논문 삭제 뒤 · 설정 창 열 때 — 시안 9장).
// app.js가 받는 함수를 넣어 두고, 새 사용량(실패하면 null)을 돌려준다
let usageLoader = null;

export function setUsageLoader(fn) {
  usageLoader = fn;
}

export function refreshUsage() {
  return usageLoader ? usageLoader().catch(() => null) : Promise.resolve(null);
}

// 여러 화면이 부르는 앱 동작 (app.js가 채운다 — 순환 import를 피하려고)
export const actions = { logout: null };
