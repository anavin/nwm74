-- ขยายขนาดไฟล์สูงสุดของ bucket เอกสารเป็น 50 MB (เดิม 25 MB)
-- จำเป็นสำหรับรายงานประจำเดือนของ CM ที่ไฟล์ใหญ่
update storage.buckets set file_size_limit = 52428800 where id = 'nm74-files';
