-- รองรับ "แนบลิงก์เอกสาร" (Google Drive, SharePoint, ลิงก์ภายนอกอื่นๆ)
-- รันใน Supabase → SQL Editor ครั้งเดียว (รันซ้ำได้)

alter table nm74.files add column if not exists url text;
alter table nm74.files alter column storage_path drop not null;
alter table nm74.files alter column size drop not null;

-- อย่างน้อยต้องมีอย่างใดอย่างหนึ่ง: ไฟล์ที่อัปโหลด หรือ ลิงก์
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'files_has_source') then
    alter table nm74.files add constraint files_has_source
      check (storage_path is not null or url is not null);
  end if;
end $$;
