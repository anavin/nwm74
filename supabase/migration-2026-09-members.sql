-- ============================================================
-- ระบบสมาชิก: ตาราง nm74.members
-- ให้แอดมินเพิ่ม/ลบ/รีเซ็ตรหัสผู้ใช้ได้จากหน้าเว็บ ไม่ต้องเข้า Supabase
-- รันใน Supabase → SQL Editor ครั้งเดียว (รันซ้ำได้)
-- ============================================================

create table if not exists nm74.members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text not null,                 -- ชื่อที่ใช้ล็อกอิน (ไม่มีโดเมน)
  name       text,                          -- ชื่อ-สกุล ไว้แสดงผล
  role       text not null default 'member' -- admin = จัดการผู้ใช้ได้ / member = ใช้งานทั่วไป
             check (role in ('admin','member')),
  note       text,
  created_at timestamptz default now()
);

create unique index if not exists members_username_key on nm74.members (lower(username));

alter table nm74.members enable row level security;

-- ทุกคนที่ล็อกอินแล้วดูรายชื่อได้ (ไว้แสดงว่าใครเป็นแอดมิน)
drop policy if exists members_read on nm74.members;
create policy members_read on nm74.members
  for select to authenticated using (true);

-- การเพิ่ม/แก้/ลบ ทำผ่าน API ฝั่งเซิร์ฟเวอร์เท่านั้น (service_role ข้าม RLS อยู่แล้ว)
-- จึงไม่สร้าง policy insert/update/delete ให้ authenticated

-- ============================================================
-- ตั้งบัญชีเจ้าของเป็นแอดมินคนแรก
-- แก้อีเมลด้านล่างให้ตรงกับบัญชีที่คุณใช้ล็อกอินอยู่ตอนนี้
-- ============================================================
insert into nm74.members (user_id, username, name, role)
select id,
       split_part(email, '@', 1),
       coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1)),
       'admin'
from auth.users
where email = 'anavin.st@gmail.com'
on conflict (user_id) do update set role = 'admin';

-- ตรวจผล — ต้องเห็นบัญชีคุณเป็น admin
select m.username, m.name, m.role, u.email, u.last_sign_in_at
from nm74.members m
join auth.users u on u.id = m.user_id
order by m.role, m.username;
