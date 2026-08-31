# ศูนย์ควบคุมงานมหาวิหารเก้าฟ้า (NM74)

ระบบติดตามงวดงาน เอกสารแนบ งานขออนุมัติ (RFA) และการขอขยายระยะเวลาก่อสร้าง
ของโครงการก่อสร้างมหาวิหารเก้าฟ้า ซอยนวมินทร์ 74 แยก 5 เขตบึงกุ่ม กรุงเทพฯ

เว็บแบบ static ล้วน (ไม่มี build step) + Supabase เป็นฐานข้อมูล/ที่เก็บไฟล์/ระบบล็อกอิน

```
index.html            หน้าเดียวจบ — โครงหน้าเว็บ
assets/app.css        ระบบดีไซน์ (โหมดสว่าง/มืด)
assets/app.js         ตรรกะหน้าจอทั้งหมด (ภาพรวม, งวดงาน, งานเพิ่ม, RFA, ขยายเวลา, คลังเอกสาร, สัญญา)
assets/store.js       ชั้นข้อมูล — Supabase (auth / ตาราง / storage / realtime)
config.example.js     ต้นแบบไฟล์ตั้งค่า — คัดลอกเป็น config.js
supabase/schema.sql   สร้าง schema nm74 + RLS + bucket + ข้อมูลตั้งต้น
```

## 1. ตั้งค่า Supabase (ทำครั้งเดียว)

ใช้โปรเจกต์ `labparfumo-core` ที่ active อยู่แล้ว โดยแยกเป็น schema `nm74` ไม่ยุ่งกับ `public`

1. เปิด **SQL Editor** → วางเนื้อหาไฟล์ `supabase/schema.sql` ทั้งไฟล์ → Run
   (สร้าง 6 ตาราง + RLS + bucket `nm74-files` + ใส่ข้อมูลปัจจุบันทั้งหมด)
2. **Settings → API → Exposed schemas** : เพิ่ม `nm74` ต่อจาก `public` แล้วกด Save
3. **Authentication → Users → Add user** : สร้างผู้ใช้ด้วยอีเมล + รหัสผ่าน (ติ๊ก Auto Confirm)
   เพิ่มผู้ใช้ทีหลังได้เรื่อยๆ ทุกคนที่ล็อกอินได้จะเห็นและแก้ข้อมูลได้เหมือนกัน
4. **Authentication → Providers → Email** : ปิด *Enable sign ups*
   เพื่อไม่ให้ใครสมัครเข้ามาเอง (เพิ่มผู้ใช้ผ่านหน้า Users เท่านั้น)

## 2. ตั้งค่าไฟล์ config

```bash
cp config.example.js config.js   # ถ้ายังไม่มี
```

แล้วแก้ `config.js` ใส่ **Project URL** และ **anon public key** จาก Settings → API

> anon key เป็นคีย์ฝั่งเบราว์เซอร์ ปลอดภัยที่จะอยู่ในไฟล์นี้ เพราะทุกตารางเปิด RLS
> ให้เฉพาะผู้ที่ล็อกอินแล้วเท่านั้น — **ห้ามใส่ service_role key**

## 3. รันในเครื่อง

```bash
python3 -m http.server 5173      # แล้วเปิด http://localhost:5173
```

## 4. ขึ้น GitHub

```bash
git init
git add -A
git commit -m "ระบบติดตามโครงการมหาวิหารเก้าฟ้า"
git branch -M main
git remote add origin git@github.com:anavin/nwm74.git
git push -u origin main
```

## 5. Deploy บน Vercel

- New Project → Import repo นี้
- Framework Preset: **Other** · Build Command: เว้นว่าง · Output Directory: `.`
- Deploy — ทุกครั้งที่ push จะ deploy ให้อัตโนมัติ
- ถ้าใส่ custom domain แล้ว ให้เพิ่ม URL นั้นใน Supabase → Authentication → URL Configuration

## โครงสร้างข้อมูล

| ตาราง | เก็บอะไร |
|---|---|
| `nm74.contracts` | สัญญาแต่ละฉบับ ผู้รับจ้าง มูลค่า จำนวนงวด VAT ประกันผลงาน บัญชีรับเงิน |
| `nm74.payments` | งวดงาน/ใบเบิกแต่ละงวด วันที่เบิก วันที่โอน |
| `nm74.extras` | งานเพิ่มนอกสัญญา |
| `nm74.rfa` | งานขออนุมัติ วัสดุ/อุปกรณ์/แบบขยาย พร้อม lead time |
| `nm74.eot` | คำขอขยายระยะเวลาก่อสร้าง |
| `nm74.files` | ทะเบียนเอกสารแนบ (ไฟล์จริงอยู่ใน Storage bucket `nm74-files`) |

ยอด "จ่ายจริง" คำนวณจาก `มูลค่างวด + VAT − หักประกัน − ส่วนลด` ในหน้าเว็บ
ไม่ได้เก็บซ้ำในฐานข้อมูล เพื่อไม่ให้ตัวเลขขัดกันเอง

## การสำรองข้อมูล

โปรเจกต์นี้อยู่ในระบบ backup เดิม (repo `anavin/db-backup`) อยู่แล้ว
schema `nm74` และ bucket `nm74-files` จะถูก dump ไปพร้อมกันโดยไม่ต้องตั้งค่าเพิ่ม
