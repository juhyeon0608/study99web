-- 폴더 이름 규칙 강화 (품질팀 F6): 제어 문자(줄바꿈 · 탭 등) 금지, 마침표 · 공백으로 끝나기 금지.
-- 6단계 PC 폴더 동기화(Windows)에서 그대로 폴더 이름으로 쓸 수 있게. Windows 예약 이름(CON 등)은 서버 코드가 막는다.
alter table paperlab.folders drop constraint folders_name_check;
alter table paperlab.folders add constraint folders_name_check check (
    char_length(name) between 1 and 100
    and name !~ '[/\\:*?"<>|[:cntrl:]]'
    and name !~ '[. ]$'
);
