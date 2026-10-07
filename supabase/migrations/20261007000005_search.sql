-- 전문 검색 색인 (명세 5.7). 영문 부분 일치(transduc → transduction)를 위해 TokenNgram + unify_* false.
-- 정규화는 기본(NormalizerAuto — 대소문자 무시).
create index page_texts_pgroonga on paperlab.page_texts using pgroonga (text)
    with (tokenizer = 'TokenNgram("unify_alphabet", false, "unify_symbol", false, "unify_digit", false)');

create index paper_search_pgroonga on paperlab.paper_search using pgroonga (meta)
    with (tokenizer = 'TokenNgram("unify_alphabet", false, "unify_symbol", false, "unify_digit", false)');
