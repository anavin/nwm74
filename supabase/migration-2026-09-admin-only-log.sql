-- ============================================================
-- จำกัดให้ "เฉพาะแอดมิน" อ่านประวัติการใช้งานและรายชื่อผู้ใช้ได้
--
-- เดิมหน้าเว็บซ่อนเมนูให้แล้ว แต่ระดับฐานข้อมูลยังเปิดให้ทุกคนที่ล็อกอินอ่านได้
-- ไฟล์นี้ปิดช่องนั้น — ผู้ใช้ทั่วไปต่อให้ยิง API ตรงก็ไม่เห็นประวัติของใคร
--
-- รันใน Supabase → SQL Editor (รันซ้ำได้)
-- ============================================================

-- ฟังก์ชันเช็คว่าคนที่เรียกเป็นแอดมินไหม
-- ต้องเป็น security definer เพื่อให้อ่านตาราง members ได้โดยไม่วน RLS ซ้อนตัวเอง
create or replace function nm74.is_admin() returns boolean
language sql
security definer
stable
set search_path = nm74, public
as $$
  select exists (
    select 1 from nm74.members
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function nm74.is_admin() from public;
grant execute on function nm74.is_admin() to authenticated, service_role;


-- ---------- ประวัติการใช้งาน: อ่านได้เฉพาะแอดมิน ----------
drop policy if exists activity_read on nm74.activity;
create policy activity_read on nm74.activity
  for select to authenticated
  using (nm74.is_admin());

-- เขียนได้เฉพาะแถวของตัวเอง (ทุกคนต้องเขียนได้ ไม่งั้นบันทึกประวัติไม่ได้)
drop policy if exists activity_write on nm74.activity;
create policy activity_write on nm74.activity
  for insert to authenticated
  with check (user_id = auth.uid());
-- ยังไม่มี policy update/delete = แก้ย้อนหลังหรือลบประวัติไม่ได้ ต่อให้เป็นแอดมิน


-- ---------- รายชื่อผู้ใช้: เห็นแถวตัวเอง หรือเป็นแอดมินถึงเห็นทั้งหมด ----------
--  (แถวตัวเองต้องอ่านได้ ไม่งั้นระบบเช็คสิทธิ์ตอนล็อกอินไม่ได้)
drop policy if exists members_read on nm74.members;
create policy members_read on nm74.members
  for select to authenticated
  using (user_id = auth.uid() or nm74.is_admin());


-- ============================================================
-- ตรวจผล — ควรเห็น 3 policy และฟังก์ชัน is_admin
-- ============================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'nm74' and tablename in ('activity','members')
order by tablename, policyname;
