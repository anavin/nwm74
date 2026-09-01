-- ============================================================
--  ศูนย์ควบคุมงานมหาวิหารเก้าฟ้า (NM74)
--  รวม SQL ทั้งหมดที่ค้างอยู่ไว้ในไฟล์เดียว — วางใน Supabase → SQL Editor แล้ว Run
--
--  ปลอดภัย: รันซ้ำได้ไม่จำกัดครั้ง ไม่ลบข้อมูล ไม่ทับข้อมูลที่แก้ไว้แล้ว
--  ไฟล์นี้ไม่มีข้อมูลตั้งต้น (งวดงาน/สัญญา) เพราะของคุณมีอยู่ในระบบแล้ว
--  ถ้าต้องสร้างใหม่หมดจากศูนย์ ให้ใช้ supabase/schema.sql แทน
-- ============================================================


-- ############################################################
--  ส่วนที่ 1 — โครงสร้าง (เพิ่มคอลัมน์/ตารางที่ยังไม่มี)
-- ############################################################

-- ---------- 1.1 แนบลิงก์เอกสาร (Google Drive ฯลฯ) ----------
--  แก้ error "Could not find the 'url' column of 'files'"
alter table nm74.files add column if not exists url text;
alter table nm74.files alter column storage_path drop not null;
alter table nm74.files alter column size drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'files_has_source') then
    alter table nm74.files add constraint files_has_source
      check (storage_path is not null or url is not null);
  end if;
end $$;


-- ---------- 1.2 ยืนยันว่าเอกสารครบแล้ว (ปิดการเตือน) ----------
alter table nm74.payments add column if not exists docs_ok boolean default false;
alter table nm74.extras   add column if not exists docs_ok boolean default false;


-- ---------- 1.3 ประเภทเอกสารแนบ + วันครบกำหนดจ่ายประจำเดือน ----------
alter table nm74.files     add column if not exists doc_type text default 'other';
alter table nm74.contracts add column if not exists due_day  int;
create index if not exists files_type_idx on nm74.files (ref_type, ref_id, doc_type);


-- ---------- 1.4 เงื่อนไขตามหนังสือสัญญาจ้างเหมาก่อสร้าง ----------
alter table nm74.contracts add column if not exists start_date    date;
alter table nm74.contracts add column if not exists duration_days int;
alter table nm74.contracts add column if not exists inspect_days  int;
alter table nm74.contracts add column if not exists pay_days      int;
alter table nm74.contracts add column if not exists penalty_day   numeric(12,2);
alter table nm74.contracts add column if not exists handover_date date;
alter table nm74.contracts add column if not exists employer      text;
alter table nm74.contracts add column if not exists employer_rep  text;
alter table nm74.payments  add column if not exists cert_date     date;
alter table nm74.eot       add column if not exists event_date    date;


-- ---------- 1.5 ขนาดไฟล์แนบสูงสุด 50 MB ----------
update storage.buckets set file_size_limit = 52428800 where id = 'nm74-files';


-- ############################################################
--  ส่วนที่ 2 — ระบบสมาชิก (เพิ่มผู้ใช้จากหน้าเว็บได้เอง)
-- ############################################################

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

drop policy if exists members_read on nm74.members;
create policy members_read on nm74.members
  for select to authenticated using (true);
-- ไม่มี policy insert/update/delete ให้ authenticated
-- การเพิ่ม/ลบผู้ใช้ทำผ่าน API ฝั่งเซิร์ฟเวอร์ (service_role ข้าม RLS อยู่แล้ว)

-- ตั้งบัญชีเจ้าของเป็นแอดมินคนแรก
-- ** ถ้าคุณใช้บัญชีอื่น ให้แก้อีเมลบรรทัดล่างนี้ก่อนรัน **
insert into nm74.members (user_id, username, name, role)
select id,
       split_part(email, '@', 1),
       coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1)),
       'admin'
from auth.users
where email = 'anavin.st@gmail.com'
on conflict (user_id) do update set role = 'admin';


-- ############################################################
--  ส่วนที่ 3 — ประวัติการใช้งานรายผู้ใช้
-- ############################################################

create table if not exists nm74.activity (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  username   text,                 -- เก็บชื่อไว้ด้วย เผื่อผู้ใช้ถูกลบภายหลัง
  action     text not null,        -- create | update | delete | upload | link | unlink | login
  ref_type   text,
  ref_id     text,
  summary    text,
  created_at timestamptz default now()
);

create index if not exists activity_created_idx on nm74.activity (created_at desc);
create index if not exists activity_user_idx    on nm74.activity (user_id, created_at desc);

alter table nm74.activity enable row level security;

drop policy if exists activity_read on nm74.activity;
create policy activity_read on nm74.activity
  for select to authenticated using (true);

-- เขียนได้เฉพาะแถวของตัวเอง — ปลอมเป็นคนอื่นไม่ได้
drop policy if exists activity_write on nm74.activity;
create policy activity_write on nm74.activity
  for insert to authenticated with check (user_id = auth.uid());
-- ไม่มี policy update/delete = แก้ย้อนหลังหรือลบประวัติจากหน้าเว็บไม่ได้


-- ---------- 3.1 เฉพาะแอดมินเท่านั้นที่อ่านประวัติและรายชื่อผู้ใช้ได้ ----------
create or replace function nm74.is_admin() returns boolean
language sql security definer stable
set search_path = nm74, public
as $fn$
  select exists (select 1 from nm74.members where user_id = auth.uid() and role = 'admin');
$fn$;

revoke all on function nm74.is_admin() from public;
grant execute on function nm74.is_admin() to authenticated, service_role;

drop policy if exists activity_read on nm74.activity;
create policy activity_read on nm74.activity
  for select to authenticated using (nm74.is_admin());

--  แถวตัวเองต้องอ่านได้ ไม่งั้นระบบเช็คสิทธิ์ตอนล็อกอินไม่ได้
drop policy if exists members_read on nm74.members;
create policy members_read on nm74.members
  for select to authenticated
  using (user_id = auth.uid() or nm74.is_admin());


-- ---------- สิทธิ์ของตารางใหม่ ----------
grant usage on schema nm74 to anon, authenticated, service_role;
grant all on all tables    in schema nm74 to authenticated, service_role;
grant all on all sequences in schema nm74 to authenticated, service_role;


-- ############################################################
--  ส่วนที่ 4 — ค่าตามสัญญา
-- ############################################################

-- ---------- 4.1 CM-P92 ครบกำหนดจ่ายทุกวันที่ 19 ของเดือน ----------
update nm74.contracts
set due_day = 19
where code ilike '%CM%'
   or code ilike '%P92%'
   or name ilike '%ที่ปรึกษา%'
   or contractor ilike '%พรชัย%';

-- ---------- 4.2 สัญญาก่อสร้าง 2 ฉบับ (ลงนาม 19 ก.พ. 69 เริ่ม 20 ก.พ. 69) ----------
--  ตรวจงานภายใน 5 วันทำการ · จ่ายภายใน 5 วันทำการหลังรับรองผล
update nm74.contracts set
  start_date    = coalesce(start_date, date '2026-02-20'),
  duration_days = coalesce(duration_days, 420),
  inspect_days  = coalesce(inspect_days, 5),
  pay_days      = coalesce(pay_days, 5),
  penalty_day   = coalesce(penalty_day, 5000),
  employer      = coalesce(employer, 'นายสมเกียรติ ตนภู'),
  employer_rep  = coalesce(employer_rep, 'คุณณปภัช อิทธิชนานันท์')
where id in ('c1','c2');

-- ---------- 4.3 อาคาร 3 ชั้น: มูลค่าในตารางงวดงาน 23,005,000 คือรวม VAT แล้ว ----------
--  ระบบเก็บเป็น "เนื้องานก่อน VAT" จึงต้องเป็น 21,500,000
update nm74.contracts set amount = 21500000 where id = 'c2' and amount = 23005000;


-- ############################################################
--  ส่วนที่ 5 — แก้ข้อมูลที่ใส่หมายเหตุเกินไว้
-- ############################################################

-- CM-P92 เดือนที่ 6  (เอกสารระบุเดือนที่ 6 ถูกต้องแล้ว)
update nm74.payments
set detail = 'งานที่ปรึกษาและบริการก่อสร้างเดือนที่ 6'
where detail like 'งานที่ปรึกษาและบริการก่อสร้างเดือนที่ 6%';

-- อาคาร 3 ชั้น งวดที่ 6  (ใบเบิกระบุ "เบิกผลงานงวดที่ 6 อาคาร 3 ชั้น")
update nm74.payments
set detail = 'เสารับโครงสร้างชั้น 3 / โครงสร้างคานชั้น 3 / โครงสร้างพื้นชั้น 3'
where detail like 'เสารับโครงสร้างชั้น 3%ต้นฉบับระบุ%';


-- ############################################################
--  ส่วนที่ 6 — ตรวจผล
-- ############################################################

-- 6.1 สัญญา: CM-P92 ต้องมี due_day = 19 · อีก 2 ฉบับต้องมี inspect_days/pay_days = 5
select ord, id, code, due_day, inspect_days, pay_days, amount, periods
from nm74.contracts
order by ord;

-- 6.2 ผู้ใช้: ต้องเห็นบัญชีคุณเป็น admin
select m.username, m.name, m.role, u.email, u.last_sign_in_at
from nm74.members m
join auth.users u on u.id = m.user_id
order by m.role, m.username;

-- 6.3 หมายเหตุที่ต้องลบ: ควรได้ 0 แถว
select c.code, p.seq, p.invoice, p.detail
from nm74.payments p
join nm74.contracts c on c.id = p.contract_id
where p.detail like '%ต้นฉบับระบุ%'
order by c.ord, p.seq;

-- 6.4 คอลัมน์ใหม่ครบไหม: ควรได้ 4 แถว (url, doc_type, docs_ok ×2)
select table_name, column_name
from information_schema.columns
where table_schema = 'nm74'
  and (   (table_name = 'files'    and column_name in ('url','doc_type'))
       or (table_name in ('payments','extras') and column_name = 'docs_ok'))
order by table_name, column_name;


-- ============================================================
--  หลังรันเสร็จ ยังต้องทำอีก 2 อย่างนอก SQL Editor
--
--  1) Authentication → Sign In / Providers → Email
--     ปิด "Allow new users to sign up"  (กันคนนอกสมัครเอง — สำคัญ)
--     ปิด "Confirm email"               (อีเมลภายในส่งจริงไม่ได้)
--
--  2) Vercel → Settings → Environment Variables (ติ๊กครบทั้ง 3 environment)
--     SUPABASE_URL               = https://xxxxxxxx.supabase.co
--     SUPABASE_SERVICE_ROLE_KEY  = sb_secret_...
--     แล้ว git push อีกครั้งให้ deploy ใหม่ ค่าถึงจะมีผล
-- ============================================================
