-- ============================================================
-- ประวัติการใช้งานรายผู้ใช้ (audit log)
-- บันทึกว่าใครทำอะไรกับรายการไหน เมื่อไหร่
-- รันใน Supabase → SQL Editor ครั้งเดียว (รันซ้ำได้)
-- ============================================================

create table if not exists nm74.activity (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  username   text,                 -- เก็บชื่อไว้ด้วย เผื่อผู้ใช้ถูกลบภายหลัง
  action     text not null,        -- create | update | delete | upload | link | unlink | login
  ref_type   text,                 -- payment | extra | rfa | eot | contract | file | member
  ref_id     text,
  summary    text,                 -- ข้อความอธิบายสั้นๆ ที่แสดงในหน้าประวัติ
  created_at timestamptz default now()
);

create index if not exists activity_created_idx on nm74.activity (created_at desc);
create index if not exists activity_user_idx    on nm74.activity (user_id, created_at desc);

alter table nm74.activity enable row level security;

-- ทุกคนที่ล็อกอินอ่านประวัติได้ (หน้าประวัติเปิดให้เฉพาะแอดมินอยู่แล้วในตัวแอป)
drop policy if exists activity_read on nm74.activity;
create policy activity_read on nm74.activity
  for select to authenticated using (true);

-- เขียนได้เฉพาะแถวที่เป็นของตัวเอง — ปลอมเป็นคนอื่นไม่ได้
drop policy if exists activity_write on nm74.activity;
create policy activity_write on nm74.activity
  for insert to authenticated with check (user_id = auth.uid());

-- ไม่มี policy update/delete = ประวัติแก้ย้อนหลังหรือลบทิ้งจากหน้าเว็บไม่ได้

-- ตรวจว่าสร้างสำเร็จ
select count(*) as จำนวนรายการ from nm74.activity;
