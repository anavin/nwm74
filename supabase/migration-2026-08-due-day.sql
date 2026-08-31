-- กำหนดวันครบกำหนดจ่ายประจำเดือนของแต่ละสัญญา
-- เช่น CM-P92 ครบกำหนดจ่ายทุกวันที่ 19 ของเดือน
alter table nm74.contracts add column if not exists due_day int;

update nm74.contracts set due_day = 19 where code ilike '%CM%';
