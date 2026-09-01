-- ยืนยันว่าเอกสารของงวดนั้นครบแล้ว (ปิดการเตือน "เอกสารไม่ครบ")
alter table nm74.payments add column if not exists docs_ok boolean default false;
alter table nm74.extras   add column if not exists docs_ok boolean default false;
