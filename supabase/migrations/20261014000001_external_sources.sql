-- 5단계 국내 DB · 기관 연동 (docs/specs/phase5-korean-db.md 10.2절). 추가만 한다 — 기존 행 · RLS · 권한 그대로.

-- external_works: OpenAlex best_oa_location 라이선스 칸 (K-21).
-- null = 아직 모름(이 열 전에 쓴 행), '' = 라이선스 값 없음 — abstract와 같은 방식
alter table paperlab.external_works
    add column if not exists oa_license text check (oa_license is null or char_length(oa_license) <= 100);

-- citation_edges: OpenCitations로 만든 참고문헌 목록 (K-8). 제약 이름은 1B 마이그레이션의 자동 이름
alter table paperlab.citation_edges drop constraint if exists citation_edges_source_check;
alter table paperlab.citation_edges add constraint citation_edges_source_check
    check (source in ('openalex', 's2', 'opencitations'));
