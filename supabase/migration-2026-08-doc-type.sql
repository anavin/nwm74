-- เพิ่มการแยกประเภทเอกสารแนบ (ใบเบิก / รายงาน / สลิปโอนเงิน ฯลฯ)
-- รันใน Supabase → SQL Editor ครั้งเดียว (รันซ้ำได้ ไม่พัง)

alter table nm74.files add column if not exists doc_type text default 'other';

create index if not exists files_type_idx on nm74.files(ref_type, ref_id, doc_type);

-- เดาประเภทให้ไฟล์ที่แนบไว้ก่อนหน้านี้จากชื่อไฟล์
update nm74.files set doc_type = case
  when name ~* 'สลิป|slip|โอน|transfer|pay[-_ ]?in'          then 'slip'
  when name ~* 'ใบเบิก|เบิก|invoice|บิล|แจ้งหนี้|pph|nt20'    then 'invoice'
  when name ~* 'รายงาน|report|ตรวจ|inspect|progress'          then 'report'
  when name ~* 'shop|drawing|แบบขยาย|dwg'                      then 'drawing'
  when name ~* 'catalog|แคตตาล็อก|spec|สเปค|brochure'          then 'spec'
  when name ~* 'rfa|ฟอร์ม'                                     then 'form'
  when name ~* 'หนังสือ|letter'                                then 'letter'
  else 'other' end
where doc_type is null or doc_type = 'other';
