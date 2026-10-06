// 화면 전체가 함께 쓰는 상태

export const state = {
  view: "library", // library | discover | reader
  filter: { kind: "all", id: null }, // all | recent | starred | status | unfiled | collection | tag
  q: "",
  sort: "added",
  papers: [],
  total: 0,
  selected: new Set(),
  activeId: null,
  collections: [],
  tags: [],
  stats: {},
  meta: { styles: {}, models: {}, item_types: {}, statuses: {} },
  settings: {},
};

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
