-- ============================================================
-- CM-P92 ครบกำหนดจ่ายทุกวันที่ 19 ของเดือน
-- รันใน Supabase → SQL Editor (รันซ้ำได้ ไม่มีผลเสีย)
-- ============================================================

-- 1) เผื่อยังไม่มีคอลัมน์นี้
alter table nm74.contracts add column if not exists due_day int;

-- 2) ตั้งค่าให้สัญญา CM (จับทั้งจากรหัสสัญญาและชื่องาน)
update nm74.contracts
set due_day = 19
where code ilike '%CM%'
   or code ilike '%P92%'
   or name ilike '%ที่ปรึกษา%'
   or contractor ilike '%พรชัย%';

-- 3) ตรวจผล — CM-P92 ต้องขึ้น due_day = 19
--    (อีก 2 สัญญาก่อสร้างต้องเป็น null และใช้ inspect_days=5 / pay_days=5 แทน)
select ord, id, code, name, due_day, inspect_days, pay_days
from nm74.contracts
order by ord;
