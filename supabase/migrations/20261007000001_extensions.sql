-- 확장: 한국어·부분 일치 전문 검색(PGroonga). Supabase 권장대로 extensions 스키마에 둔다.
create extension if not exists pgroonga with schema extensions;

-- 개인 표를 두는 스키마 (Data API "Exposed schemas"에 넣지 않는다 — 명세 5.3)
create schema if not exists paperlab;
