-- 공유 링크 검토본 (2026-10-28 사용자 요청): 의견을 받는 링크를 처음 열 때 그 순간의 원고를 검토본으로 복사해 두고,
-- 교수님은 그 검토본에 의견(comment)과 고친 글(edit)을 남긴다. 원고 주인은 의견마다 수정 완료(done) · 거부(rejected)를 고르고,
-- 모두 처리하면 검토본(snapshot)을 지운다. 추가만 한다 — 다시 돌려도 안전(if not exists · drop … if exists).

alter table paperlab.manuscript_shares add column if not exists snapshot_title text;
alter table paperlab.manuscript_shares add column if not exists snapshot text;
alter table paperlab.manuscript_shares add column if not exists snapshot_at timestamptz;

alter table paperlab.share_comments add column if not exists kind text not null default 'comment';
alter table paperlab.share_comments add column if not exists replacement text not null default '';
alter table paperlab.share_comments add column if not exists status text not null default 'open';
update paperlab.share_comments set status = 'done' where resolved_at is not null and status = 'open';

alter table paperlab.share_comments drop constraint if exists share_comments_kind_check;
alter table paperlab.share_comments add constraint share_comments_kind_check check (kind in ('comment', 'edit'));
alter table paperlab.share_comments drop constraint if exists share_comments_status_check;
alter table paperlab.share_comments add constraint share_comments_status_check check (status in ('open', 'done', 'rejected'));
alter table paperlab.share_comments drop constraint if exists share_comments_replacement_check;
alter table paperlab.share_comments add constraint share_comments_replacement_check check (char_length(replacement) <= 4000);
-- 고친 글(edit)은 설명 없이도 된다 · 고를 수 있는 글은 2000자까지
alter table paperlab.share_comments drop constraint if exists share_comments_body_check;
alter table paperlab.share_comments add constraint share_comments_body_check
    check (char_length(body) <= 4000 and (kind = 'edit' or char_length(body) >= 1));
alter table paperlab.share_comments drop constraint if exists share_comments_quote_check;
alter table paperlab.share_comments add constraint share_comments_quote_check
    check (char_length(quote) <= 2000 and (kind = 'comment' or char_length(quote) >= 1));
