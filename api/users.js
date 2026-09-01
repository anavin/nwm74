/* ============================================================
   api/users.js — จัดการผู้ใช้จากหน้าเว็บ (เฉพาะแอดมิน)

   ทำงานบนเซิร์ฟเวอร์ Vercel เท่านั้น เบราว์เซอร์ไม่เห็นโค้ดและคีย์ในนี้
   ต้องตั้ง Environment Variables ใน Vercel ก่อนใช้งาน:
     SUPABASE_URL               เช่น https://xxxx.supabase.co
     SUPABASE_SERVICE_ROLE_KEY  คีย์ service_role (ห้ามใส่ใน config.js เด็ดขาด)

   ทุกคำขอต้องแนบ Authorization: Bearer <access token ของผู้เรียก>
   เซิร์ฟเวอร์จะเช็คว่าโทเคนนั้นเป็นของคนที่มี role = 'admin' ใน nm74.members
   ============================================================ */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DOMAIN   = process.env.USER_DOMAIN || "nm74.local";

const admHeaders = () => ({
  apikey: SERVICE,
  Authorization: "Bearer " + SERVICE,
  "Content-Type": "application/json"
});

/* เรียก PostgREST บน schema nm74 */
async function db(path, opts = {}) {
  const h = Object.assign(admHeaders(), {
    "Accept-Profile": "nm74",
    "Content-Profile": "nm74"
  }, opts.headers || {});
  const r = await fetch(URL_BASE + "/rest/v1" + path, Object.assign({}, opts, { headers: h }));
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) throw Object.assign(new Error(typeof body === "string" ? body : (body && (body.message || body.hint)) || "database error"), { status: r.status });
  return body;
}

/* เรียก Supabase Auth Admin API */
async function auth(path, opts = {}) {
  const r = await fetch(URL_BASE + "/auth/v1" + path, Object.assign({}, opts, { headers: admHeaders() }));
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) throw Object.assign(new Error((body && (body.msg || body.message || body.error_description)) || "auth error"), { status: r.status });
  return body;
}

/* ตรวจว่าผู้เรียกล็อกอินอยู่จริงและเป็นแอดมิน */
async function requireAdmin(req) {
  const raw = req.headers.authorization || "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  if (!token) throw Object.assign(new Error("ไม่ได้ล็อกอิน"), { status: 401 });

  const r = await fetch(URL_BASE + "/auth/v1/user", {
    headers: { apikey: SERVICE, Authorization: "Bearer " + token }
  });
  if (!r.ok) throw Object.assign(new Error("เซสชันหมดอายุ กรุณาล็อกอินใหม่"), { status: 401 });
  const me = await r.json();

  const rows = await db("/members?user_id=eq." + encodeURIComponent(me.id) + "&select=role");
  if (!rows.length || rows[0].role !== "admin")
    throw Object.assign(new Error("เฉพาะแอดมินเท่านั้นที่จัดการผู้ใช้ได้"), { status: 403 });
  return me;
}

const cleanUser = u => String(u || "").trim().toLowerCase().replace(/\s+/g, "");
const toEmail = u => (cleanUser(u).includes("@") ? cleanUser(u) : cleanUser(u) + "@" + DOMAIN);
const validUser = u => /^[a-z0-9][a-z0-9._-]{1,30}$/.test(cleanUser(u));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!URL_BASE || !SERVICE) {
    return res.status(500).json({ error: "ยังไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน Vercel" });
  }

  try {
    const me = await requireAdmin(req);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    /* ---------- รายชื่อสมาชิก ---------- */
    if (req.method === "GET") {
      const members = await db("/members?select=user_id,username,name,role,note,created_at&order=role.asc,username.asc");
      const list = await auth("/admin/users?per_page=200");
      const byId = {};
      (list.users || []).forEach(u => { byId[u.id] = u; });
      return res.status(200).json({
        me: me.id,
        members: members.map(m => ({
          userId: m.user_id, username: m.username, name: m.name || "", role: m.role,
          note: m.note || "", createdAt: m.created_at,
          lastSignIn: byId[m.user_id] ? byId[m.user_id].last_sign_in_at : null,
          email: byId[m.user_id] ? byId[m.user_id].email : ""
        }))
      });
    }

    /* ---------- เพิ่มผู้ใช้ ---------- */
    if (req.method === "POST") {
      const username = cleanUser(body.username);
      if (!validUser(username))
        return res.status(400).json({ error: "ชื่อผู้ใช้ต้องเป็นตัวอังกฤษพิมพ์เล็ก/ตัวเลข/. _ - ยาว 2–31 ตัว ห้ามเว้นวรรค" });
      if (!body.password || String(body.password).length < 6)
        return res.status(400).json({ error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัว" });
      const role = body.role === "admin" ? "admin" : "member";

      const created = await auth("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: toEmail(username),
          password: String(body.password),
          email_confirm: true,
          user_metadata: { name: body.name || username }
        })
      });

      try {
        await db("/members", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            user_id: created.id, username, name: body.name || "", role, note: body.note || ""
          })
        });
      } catch (e) {
        await auth("/admin/users/" + created.id, { method: "DELETE" }).catch(() => {});
        throw e;
      }
      return res.status(200).json({ ok: true, userId: created.id });
    }

    /* ---------- แก้ไข: รหัสผ่าน / สิทธิ์ / ชื่อ ---------- */
    if (req.method === "PATCH") {
      const id = String(body.userId || "");
      if (!id) return res.status(400).json({ error: "ไม่พบผู้ใช้ที่ต้องการแก้ไข" });

      if (body.password) {
        if (String(body.password).length < 6)
          return res.status(400).json({ error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัว" });
        await auth("/admin/users/" + id, { method: "PUT", body: JSON.stringify({ password: String(body.password) }) });
      }

      const patch = {};
      if (body.role === "admin" || body.role === "member") patch.role = body.role;
      if (body.name !== undefined) patch.name = body.name;
      if (body.note !== undefined) patch.note = body.note;

      if (patch.role === "member" && id === me.id)
        return res.status(400).json({ error: "ลดสิทธิ์ตัวเองไม่ได้ ให้แอดมินคนอื่นทำแทน" });

      if (Object.keys(patch).length) {
        await db("/members?user_id=eq." + encodeURIComponent(id), {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch)
        });
      }
      return res.status(200).json({ ok: true });
    }

    /* ---------- ลบผู้ใช้ ---------- */
    if (req.method === "DELETE") {
      const id = String((body.userId || req.query.userId) || "");
      if (!id) return res.status(400).json({ error: "ไม่พบผู้ใช้ที่ต้องการลบ" });
      if (id === me.id) return res.status(400).json({ error: "ลบบัญชีตัวเองไม่ได้" });

      const admins = await db("/members?role=eq.admin&select=user_id");
      if (admins.length <= 1 && admins.some(a => a.user_id === id))
        return res.status(400).json({ error: "ต้องเหลือแอดมินอย่างน้อย 1 คน" });

      await auth("/admin/users/" + id, { method: "DELETE" });   // members ลบตามด้วย on delete cascade
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method ไม่รองรับ" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "เกิดข้อผิดพลาด" });
  }
}
