-- 1C 원고 인용 기반 추천 (docs/specs/writing-reference-pane.md 9.2절): citation_edges 관계에 'cited_by_top_c' 추가.
-- 뜻: 씨앗을 인용한 논문 피인용 순 상위 목록(C 단계)만 받은 것 — 함께 인용(D)은 미완료.
-- 'cited_by_top'은 C · D 완료 표시라 따로 둔다. 배열 상한은 기존 규칙(그 밖 관계 100)이 그대로 적용된다.
-- 제약만 바꾼다(기존 행 · RLS · 권한 그대로).
alter table paperlab.citation_edges drop constraint citation_edges_relation_check;
alter table paperlab.citation_edges add constraint citation_edges_relation_check
    check (relation in ('references', 'related', 'cited_by_top', 'cited_by_recent', 'cited_by_top_c'));
