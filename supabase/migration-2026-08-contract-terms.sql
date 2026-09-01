-- เพิ่มเงื่อนไขตามหนังสือสัญญาจ้างเหมาก่อสร้าง (ฉบับ STV2)
-- รันใน Supabase → SQL Editor ครั้งเดียว (รันซ้ำได้)

alter table nm74.contracts add column if not exists start_date     date;   -- วันเริ่มงานตามสัญญา
alter table nm74.contracts add column if not exists duration_days  int;    -- ระยะเวลาก่อสร้าง (วัน)
alter table nm74.contracts add column if not exists inspect_days   int;    -- CM ต้องตรวจงานเสร็จภายใน (วันทำการ)
alter table nm74.contracts add column if not exists pay_days       int;    -- จ่ายภายใน (วันทำการ) หลังรับรองผลตรวจ
alter table nm74.contracts add column if not exists penalty_day    numeric(12,2); -- ค่าปรับล่าช้าต่อวัน
alter table nm74.contracts add column if not exists handover_date  date;   -- วันตรวจรับ/ส่งมอบงานงวดสุดท้าย
alter table nm74.contracts add column if not exists employer       text;   -- ผู้ว่าจ้าง
alter table nm74.contracts add column if not exists employer_rep   text;   -- ตัวแทนผู้ว่าจ้าง
alter table nm74.payments  add column if not exists cert_date      date;   -- วันที่ CM รับรองผลตรวจงวดนั้น
alter table nm74.eot       add column if not exists event_date     date;   -- วันที่เกิดเหตุ (ใช้เช็คกรอบแจ้ง 15 วัน)

-- ค่าตามสัญญาทั้งสองฉบับ (ลงนาม 19 ก.พ. 2569 เริ่มงาน 20 ก.พ. 2569 แล้วเสร็จ 15 เม.ย. 2570 = 420 วัน)
update nm74.contracts set
  start_date = date '2026-02-20',
  duration_days = 420,
  inspect_days = 5,
  pay_days = 5,
  penalty_day = 5000,
  employer = 'นายสมเกียรติ ตนภู',
  employer_rep = 'คุณณปภัช อิทธิชนานันท์'
where id in ('c1','c2');

-- อาคาร 3 ชั้น: มูลค่าสัญญาในตารางงวดงานคือเนื้องาน 21,500,000 + VAT 7% = 23,005,000
update nm74.contracts set amount = 21500000 where id = 'c2' and amount = 23005000;

-- อาคาร 2 ชั้น: ขอบเขตครอบคลุม 3 หลังตามข้อ 1 ของสัญญา
update nm74.contracts set name = 'อาคารสำนักงาน + อาคารจอดรถ/เก็บของ + อาคารห้องน้ำรวม'
where id = 'c1' and name like 'วิหารปรมาจารย์%';
