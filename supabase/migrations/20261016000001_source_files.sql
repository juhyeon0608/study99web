-- 문서 원본 보관 (워드 · 한글 · PPT 등 — 2026-10-16 사용자 요청).
-- 서재에 PDF가 아닌 문서를 올리면 서버가 PDF 변환본을 만들어 기존 pdf_key에 두고(읽기 · 형광펜 · AI · 색인은 그대로),
-- 올린 원본은 source_key에 따로 보관해 [원본 받기]로 내려준다. PDF를 바로 올린 논문은 '' 그대로.
-- 추가만 한다 — 기존 열은 고치지 않고, 새 열은 기존 행에 안전한 기본값. 다시 돌려도 안전하게 if not exists.

alter table paperlab.papers
    add column if not exists source_key text not null default '',
    add column if not exists source_name text not null default '',
    add column if not exists source_size bigint;

alter table paperlab.papers drop constraint if exists papers_source_key_check;
alter table paperlab.papers add constraint papers_source_key_check check (
    source_key = '' or source_key ~ '^users/[0-9a-f-]{36}/sources/[1-9][0-9]{0,18}\.[0-9a-f]{8}\.bin$');
alter table paperlab.papers drop constraint if exists papers_source_name_check;
alter table paperlab.papers add constraint papers_source_name_check check (
    char_length(source_name) <= 255 and source_name !~ '[/\\[:cntrl:]]');
