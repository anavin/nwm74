/* คัดลอกไฟล์นี้เป็น config.js แล้วใส่ค่าจริงของโปรเจกต์
   Supabase → Project Settings → API
   - Project URL           → SUPABASE_URL
   - Project API keys: anon public → SUPABASE_ANON_KEY
   คีย์ anon ออกแบบมาให้ใช้ในฝั่งเบราว์เซอร์ได้ ความปลอดภัยมาจาก RLS + การล็อกอิน
   ห้ามใส่ service_role key ในไฟล์นี้เด็ดขาด */
window.NM74_CONFIG = {
  SUPABASE_URL: "https://imwcisixfyuspmklilqw.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_9SVk6B-dGdWceYi87tF7cQ_zW3TESj6"
};
