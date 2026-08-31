-- ============================================================
--  ศูนย์ควบคุมงานมหาวิหารเก้าฟ้า (NM74)
--  รันไฟล์นี้ใน Supabase → SQL Editor ของโปรเจกต์ labparfumo-core
--  สร้าง schema "nm74" แยกจาก public ทั้งหมด ไม่กระทบข้อมูลเดิม
-- ============================================================

create schema if not exists nm74;

-- ---------- ตาราง ----------
create table if not exists nm74.contracts (
  id          text primary key,
  ord         int      default 0,
  code        text     not null,
  name        text,
  contractor  text,
  amount      numeric(14,2) default 0,
  periods     int,
  vat         numeric(5,2)  default 0,
  retention   numeric(5,2)  default 0,
  end_date    date,
  bank        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists nm74.payments (
  id          text primary key,
  contract_id text references nm74.contracts(id) on delete cascade,
  seq         int,
  detail      text,
  amount      numeric(14,2) default 0,
  vat         numeric(14,2) default 0,
  retention   numeric(14,2) default 0,
  invoice     text,
  req_date    date,
  paid_date   date,
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists payments_contract_idx on nm74.payments(contract_id, seq);

create table if not exists nm74.extras (
  id         text primary key,
  building   text,
  detail     text,
  amount     numeric(14,2) default 0,
  discount   numeric(14,2) default 0,
  invoice    text,
  req_date   date,
  paid_date  date,
  note       text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists nm74.eot (            -- คำขอขยายระยะเวลาก่อสร้าง
  id            text primary key,
  "no"          int,
  doc_no        text,
  contract_id   text references nm74.contracts(id) on delete set null,
  submit_date   date,
  reason        text,
  days          int default 0,
  old_end       date,
  new_end       date,
  status        text default 'รออนุมัติ',
  decision_date date,
  note          text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists nm74.rfa (            -- งานขออนุมัติ วัสดุ/อุปกรณ์/แบบขยาย
  id            text primary key,
  ord           int default 0,
  title         text,
  trade         text,
  category      text,
  detail        text,
  doc_no        text,
  brand         text,
  reviewer      text,
  lead_days     int default 0,
  required_on   date,
  due_date      date,
  submit_date   date,
  status        text default 'ยังไม่ยื่น',
  decision_date date,
  note          text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists nm74.files (          -- ทะเบียนเอกสารแนบ (ไฟล์จริงอยู่ใน Storage)
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  size         bigint,
  mime         text,
  ref_type     text not null,                   -- payment | extra | rfa | eot
  ref_id       text not null,
  doc_type     text default 'other',            -- invoice | report | slip | form | spec | drawing | letter | result | other
  storage_path text,                             -- ว่างได้ ถ้าเป็นลิงก์
  url          text,                             -- ลิงก์ภายนอก (Drive ฯลฯ)
  created_at   timestamptz default now(),
  created_by   uuid default auth.uid()
);
alter table nm74.files drop constraint if exists files_has_source;
alter table nm74.files add constraint files_has_source check (storage_path is not null or url is not null);
create index if not exists files_ref_idx on nm74.files(ref_type, ref_id);
create index if not exists files_type_idx on nm74.files(ref_type, ref_id, doc_type);

-- ---------- updated_at อัตโนมัติ ----------
create or replace function nm74.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['contracts','payments','extras','eot','rfa'] loop
    execute format('drop trigger if exists touch_%1$s on nm74.%1$s', t);
    execute format('create trigger touch_%1$s before update on nm74.%1$s
                    for each row execute function nm74.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- สิทธิ์ + RLS (เข้าถึงได้เฉพาะผู้ที่ล็อกอิน) ----------
grant usage on schema nm74 to anon, authenticated, service_role;
grant all on all tables in schema nm74 to authenticated, service_role;
grant all on all sequences in schema nm74 to authenticated, service_role;
alter default privileges in schema nm74 grant all on tables to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['contracts','payments','extras','eot','rfa','files'] loop
    execute format('alter table nm74.%I enable row level security', t);
    execute format('drop policy if exists "authenticated_all" on nm74.%I', t);
    execute format('create policy "authenticated_all" on nm74.%I
                    for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Storage bucket สำหรับเอกสารแนบ ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('nm74-files', 'nm74-files', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "nm74_files_read"   on storage.objects;
drop policy if exists "nm74_files_write"  on storage.objects;
drop policy if exists "nm74_files_update" on storage.objects;
drop policy if exists "nm74_files_delete" on storage.objects;

create policy "nm74_files_read"   on storage.objects for select to authenticated
  using (bucket_id = 'nm74-files');
create policy "nm74_files_write"  on storage.objects for insert to authenticated
  with check (bucket_id = 'nm74-files');
create policy "nm74_files_update" on storage.objects for update to authenticated
  using (bucket_id = 'nm74-files') with check (bucket_id = 'nm74-files');
create policy "nm74_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'nm74-files');

-- ข้อมูลตั้งต้น (จากไฟล์สรุปเบิกจ่าย + เอกสาร RFA)
insert into nm74.contracts (id,ord,code,name,contractor,amount,periods,vat,retention,end_date,bank) values
  ('c1',1,'อาคาร 2 ชั้น','วิหารปรมาจารย์ (อาคารเล็ก)','นายชญุตม์ กาญจนรุจี',12000000,13,0,5,'2027-04-15','กสิกรไทย สาขาเทสโก้โลตัส ลาดพร้าว · 763-2-02092-3 · นายชญุตม์ กาญจนรุจี'),
  ('c2',2,'อาคาร 3 ชั้น','มหาวิหารเก้าฟ้า (อาคารพักอาศัย)','บริษัท เอ พลัส แอสโซซิเอท จำกัด',23005000,15,7,5,'2027-04-15','กสิกรไทย สาขายูเนียนมอลล์ ลาดพร้าว · 763-2-09297-5 · บริษัท เอ พลัส แอสโซซิเอท จำกัด'),
  ('c3',3,'CM-P92','ที่ปรึกษาและบริหารงานก่อสร้าง','นายพรชัย ชัยโชติวาณิช',1500000,15,0,0,null,'ไทยพาณิชย์ · 234-2-04398-6 · นายพรชัย ชัยโชติวาณิช')
on conflict (id) do nothing;

insert into nm74.payments (id,contract_id,seq,detail,amount,vat,retention,invoice,req_date,paid_date,note) values
  ('p01','c1',1,'เซ็นสัญญา',120000,0,6000,'ใบเบิกงวด 1','2026-02-19','2026-02-20',null),
  ('p02','c1',2,'จัดเตรียมสถานที่ / วางผังอาคาร / ทดสอบเสาเข็ม / ฐานรากอาคารทั้งหมด',990000,0,49500,'PPH/003','2026-05-15','2026-05-19',null),
  ('p03','c1',3,'โครงสร้างคานชั้น 1 / โครงสร้างพื้นชั้น 1 / เดินท่อสุขาภิบาลชั้น 1',990000,0,49500,'PPH/005','2026-06-05','2026-06-24',null),
  ('p04','c1',4,'โครงสร้างคานชั้น 2 / โครงสร้างพื้นชั้น 2 / เดินท่อสุขาภิบาลชั้น 2',990000,0,49500,'PPH/007','2026-06-30',null,null),
  ('p05','c1',5,'งานโครงสร้างและพื้นดาดฟ้า / งานโครงสร้างคาน คสล. รับโครงหลังคา',990000,0,49500,'PPH/010','2026-08-17',null,null),
  ('p06','c2',1,'เซ็นสัญญา',500000,35000,25000,'ใบเบิกงวด 1','2026-02-20','2026-02-20',null),
  ('p07','c2',2,'จัดเตรียมสถานที่ / ทดสอบเสาเข็ม / ฐานรากอาคารทั้งหมด',1500000,105000,75000,'ใบเบิกงวด 2','2026-04-11','2026-05-02',null),
  ('p08','c2',3,'โครงสร้างคานชั้น 1 / โครงสร้างพื้นชั้น 1 / เดินท่อสุขาภิบาลชั้น 1',1500000,105000,75000,'PPH/002','2026-05-15','2026-06-24',null),
  ('p09','c2',4,'เสารับโครงสร้างชั้น 2 / โครงสร้างคานชั้น 2 / โครงสร้างพื้นชั้น 2',1500000,105000,75000,'PPH/006','2026-06-08','2026-06-24',null),
  ('p10','c2',5,'เสารับโครงสร้างชั้น 3 / โครงสร้างคานชั้น 3 / โครงสร้างพื้นชั้น 3',1500000,105000,75000,'PPH/008','2026-07-09','2026-08-01',null),
  ('p11','c2',6,'เสารับโครงสร้างชั้น 3 / โครงสร้างคานชั้น 3 / โครงสร้างพื้นชั้น 3 (ต้นฉบับระบุงวดที่ 5 ซ้ำ)',1500000,105000,75000,'PPH/009','2026-08-17',null,null),
  ('p12','c3',1,'งานที่ปรึกษาและบริการก่อสร้างเดือนที่ 1',100000,0,0,'NT202603-002','2026-03-13','2026-03-18',null),
  ('p13','c3',2,'งานที่ปรึกษาและบริการก่อสร้างเดือนที่ 2',100000,0,0,'NT202604-001','2026-04-10','2026-05-19',null),
  ('p14','c3',3,'งานที่ปรึกษาและบริการก่อสร้างเดือนที่ 3',100000,0,0,'NT202605-003','2026-05-12','2026-05-19',null),
  ('p15','c3',4,'งานที่ปรึกษาและบริการก่อสร้างเดือนที่ 4',100000,0,0,'NT202606-002','2026-06-15','2026-06-24',null),
  ('p16','c3',5,'งานที่ปรึกษาและบริการก่อสร้างเดือนที่ 5',100000,0,0,'NT202607-001','2026-07-14','2026-07-24',null),
  ('p17','c3',6,'งานที่ปรึกษาและบริการก่อสร้างเดือนที่ 6 (ต้นฉบับระบุงวดที่ 5 ซ้ำ)',100000,0,0,'NT202608-001','2026-08-11',null,null)
on conflict (id) do nothing;

insert into nm74.extras (id,building,detail,amount,discount,invoice,req_date,paid_date,note) values
  ('x1','อาคาร 3 ชั้น','แก้ไข/ขยายฐานราก 21 จุด + เสริมคาน + ตัดหัวเข็ม (รวมค่าดำเนินการ 15%)',135303,0,'PPH/004','2026-05-20','2026-06-17','เหตุ: เสาเข็มคลาดเคลื่อนเกินระยะ วสท.'),
  ('x2','อาคาร 2 ชั้น','ขยายฐาน F1/F2 + เสริมคาน STB (รวมค่าดำเนินการ 15%)',54898,20000,'PPH/004','2026-05-20','2026-06-17','ส่วนลดรวมของใบเบิก 20,000 บาท')
on conflict (id) do nothing;

insert into nm74.eot (id,"no",doc_no,contract_id,submit_date,reason,days,old_end,new_end,status,decision_date,note) values
  ('e1',1,'NM74-AP-RFA-007','c2','2026-03-19','ตรวจพบค่าการเยื้องศูนย์ของเสาเข็มบางต้นเกินกว่ามาตรฐาน ต้องหยุดงานเพื่อสรุปวิธีแก้ไขและออกแบบฐานรากใหม่ ทำให้ปริมาณงานฐานรากเพิ่มขึ้น (กระทบ Critical Path)',15,'2027-04-15','2027-04-30','อนุมัติแล้ว','2026-03-25','CM / Owner อนุมัติ — งานแก้ไขเบิกตาม PPH/004'),
  ('e2',2,'NM74-AP-RFA-035','c2','2026-08-13','เกิดความล่าช้าในการเบิกจ่ายงวดงาน ทำให้ผู้รับจ้างต้องขยายเวลาในการจัดเตรียมวัสดุเข้าหน่วยงาน (กระทบ Critical Path)',30,'2027-04-30','2027-05-30','รออนุมัติ',null,'ยังไม่มีลายเซ็นอนุมัติในแบบฟอร์ม RFA')
on conflict (id) do nothing;

insert into nm74.rfa (id,ord,title,trade,category,detail,doc_no,brand,reviewer,lead_days,required_on,due_date,submit_date,status,decision_date,note) values
  ('r01',1,'ลิฟต์โดยสาร','ลิฟต์','วัสดุ/อุปกรณ์ (Material)','อนุมัติผู้ผลิต รุ่น ขนาดตู้โดยสาร และ Shop Drawing ช่องลิฟต์/ห้องเครื่อง',null,null,'CM / Owner',120,null,null,null,'ยังไม่ยื่น',null,null),
  ('r02',2,'งานระบบไฟฟ้า','งานระบบไฟฟ้า','วัสดุ/อุปกรณ์ (Material)','ตู้ MDB / สายไฟ / ท่อร้อยสาย / ดวงโคมและอุปกรณ์สวิตช์',null,null,'CM / Owner',45,null,null,null,'ยังไม่ยื่น',null,null),
  ('r03',3,'งานสุขาภิบาล','งานสุขาภิบาล','วัสดุ/อุปกรณ์ (Material)','ท่อน้ำดี-น้ำทิ้ง / ปั๊มน้ำ / ถังเก็บน้ำ / บ่อบำบัด',null,null,'CM / Owner',30,null,null,null,'ยังไม่ยื่น',null,null),
  ('r04',4,'งานโครงหลังคาและวัสดุมุง','หลังคา','วัสดุ/อุปกรณ์ (Material)','เหล็กโครงหลังคา / กระเบื้องมุง / ฉนวนกันความร้อน',null,null,'สถาปนิก / CM',60,null,null,null,'ยังไม่ยื่น',null,null),
  ('r05',5,'ประตู–หน้าต่างและกระจก','ประตู-หน้าต่าง','แบบขยาย (Shop Drawing)','วงกบอะลูมิเนียม/ไม้ ชนิดกระจก และแบบขยายตำแหน่งติดตั้ง',null,null,'สถาปนิก / CM',60,null,null,null,'ยังไม่ยื่น',null,null),
  ('r06',6,'กระเบื้องและวัสดุปูพื้น–ผนัง','วัสดุตกแต่ง','วัสดุ/อุปกรณ์ (Material)','ตัวอย่างกระเบื้อง สี ขนาด และแนวปูตามแบบ',null,null,'สถาปนิก / CM',45,null,null,null,'ยังไม่ยื่น',null,null),
  ('r07',7,'สุขภัณฑ์และอุปกรณ์ห้องน้ำ','สุขภัณฑ์','วัสดุ/อุปกรณ์ (Material)','รุ่นสุขภัณฑ์ ก๊อกน้ำ อุปกรณ์ประกอบห้องน้ำ',null,null,'สถาปนิก / CM',30,null,null,null,'ยังไม่ยื่น',null,null),
  ('r08',8,'สีและวัสดุตกแต่งผิว','งานสี','วัสดุ/อุปกรณ์ (Material)','ยี่ห้อ/เฉดสีภายใน-ภายนอก และระบบการทาสี',null,null,'สถาปนิก / CM',21,null,null,null,'ยังไม่ยื่น',null,null),
  ('r09',9,'งานฝ้าเพดาน','ฝ้าเพดาน','วัสดุ/อุปกรณ์ (Material)','ชนิดแผ่นฝ้า โครงคร่าว และแบบขยายฝ้า',null,null,'สถาปนิก / CM',30,null,null,null,'ยังไม่ยื่น',null,null),
  ('r10',10,'Shop Drawing งานสถาปัตย์–โครงสร้าง','แบบขยาย','แบบขยาย (Shop Drawing)','แบบขยายรายหมวดก่อนเริ่มงานแต่ละส่วน',null,null,'สถาปนิก / CM',0,null,null,null,'ยังไม่ยื่น',null,null)
on conflict (id) do nothing;

-- ============================================================
--  หลังรันไฟล์นี้เสร็จ อย่าลืม
--  1) Settings → API → Exposed schemas : เพิ่ม "nm74"
--  2) Authentication → Users → Add user : สร้างผู้ใช้ (อีเมล + รหัสผ่าน)
--  3) Authentication → Providers → Email : ปิด "Enable sign ups" กันคนสมัครเอง
-- ============================================================
