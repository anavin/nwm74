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

/* ---------- ตัวช่วยวินิจฉัย ----------
   "เซสชันหมดอายุ" ที่เจอบ่อยมักไม่ใช่เซสชันหมดอายุจริง แต่เป็น 3 อย่างนี้
     1) คีย์ใน Vercel ผิด (เอา publishable มาใส่ หรือคัดลอกไม่ครบ)
     2) SUPABASE_URL ชี้คนละโปรเจกต์กับที่หน้าเว็บล็อกอินอยู่
     3) ยังไม่ได้ deploy ใหม่หลังตั้งค่า ค่าเลยยังไม่มีผล
   จึงต้องแยกให้ออกว่าเป็นอันไหน ไม่งั้นผู้ใช้จะไปล็อกอินใหม่ซ้ำๆ โดยไม่มีอะไรดีขึ้น */
const hostOf = u => { try { return new URL(u).host; } catch { return ""; } };

/* อ่านเนื้อใน JWT โดยไม่ตรวจลายเซ็น — ใช้ดูว่าโทเคนออกจากโปรเจกต์ไหนเท่านั้น */
function jwtBody(t) {
  try {
    const p = String(t).split(".")[1];
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch { return null; }
}

/* บอกชนิดของคีย์ได้โดยไม่เปิดเผยตัวคีย์ */
function keyKind(k) {
  if (!k) return { ok: false, kind: "ยังไม่ได้ตั้งค่า" };
  if (k.startsWith("sb_secret_"))      return { ok: true,  kind: "sb_secret (ถูกต้อง)" };
  if (k.startsWith("sb_publishable_")) return { ok: false, kind: "sb_publishable — นี่คือคีย์สาธารณะ ใช้แทนกันไม่ได้ ต้องเอาจากหัวข้อ Secret keys" };
  if (k.startsWith("eyJ")) {
    const b = jwtBody(k) || {};
    return b.role === "service_role"
      ? { ok: true,  kind: "service_role (คีย์แบบเก่า ใช้ได้)" }
      : { ok: false, kind: "JWT แบบเก่า role = " + (b.role || "ไม่ทราบ") + " — ต้องเป็น service_role" };
  }
  return { ok: false, kind: "รูปแบบไม่ตรงกับคีย์ของ Supabase (อาจคัดลอกไม่ครบหรือมีช่องว่างติดมา)" };
}

/* ตรวจว่าผู้เรียกล็อกอินอยู่จริงและเป็นแอดมิน */
async function requireAdmin(req) {
  const raw = req.headers.authorization || "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!token) throw Object.assign(new Error("ไม่ได้ล็อกอิน"), { status: 401 });

  const r = await fetch(URL_BASE + "/auth/v1/user", {
    headers: { apikey: SERVICE, Authorization: "Bearer " + token }
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    const tokenHost = hostOf((jwtBody(token) || {}).iss || "");
    const envHost = hostOf(URL_BASE);
    const kk = keyKind(SERVICE);
    let msg;
    if (tokenHost && envHost && tokenHost !== envHost)
      msg = "SUPABASE_URL ใน Vercel ชี้คนละโปรเจกต์กับที่หน้าเว็บล็อกอินอยู่ (" + envHost + " ≠ " + tokenHost + ")";
    else if (!kk.ok)
      msg = "คีย์ SUPABASE_SERVICE_ROLE_KEY ใน Vercel ไม่ถูกต้อง: " + kk.kind;
    else if (/api\s*key|invalid.*key/i.test(detail))
      msg = "Supabase ปฏิเสธคีย์ SUPABASE_SERVICE_ROLE_KEY — ตรวจว่าคัดลอกครบและไม่มีช่องว่างติดหัวท้าย แล้ว deploy ใหม่อีกครั้ง";
    else
      msg = "เซสชันหมดอายุ กรุณาล็อกอินใหม่";
    console.error("api/users auth check failed", r.status, detail.slice(0, 200));
    throw Object.assign(new Error(msg), { status: 401, expose: true });
  }
  const me = await r.json();

  let rows;
  try {
    rows = await db("/members?user_id=eq." + encodeURIComponent(me.id) + "&select=role");
  } catch (e) {
    console.error("api/users members lookup failed", e && e.message);
    throw Object.assign(
      new Error("อ่านตาราง nm74.members ไม่ได้ — ยังไม่ได้รัน supabase/setup-all.sql ส่วนที่ 2 หรือยังไม่ได้เพิ่ม nm74 ใน Settings → API → Exposed schemas"),
      { status: 500, expose: true });
  }
  if (!rows.length)
    throw Object.assign(
      new Error("บัญชีนี้ยังไม่มีในตาราง members — รัน setup-all.sql ส่วนที่ 2 เพื่อตั้งเป็นแอดมินคนแรก (แก้อีเมลในไฟล์ให้ตรงกับบัญชีคุณก่อน)"),
      { status: 403, expose: true });
  if (rows[0].role !== "admin")
    throw Object.assign(new Error("เฉพาะแอดมินเท่านั้นที่จัดการผู้ใช้ได้"), { status: 403 });
  return me;
}

const cleanUser = u => String(u || "").trim().toLowerCase().replace(/\s+/g, "");
const toEmail = u => (cleanUser(u).includes("@") ? cleanUser(u) : cleanUser(u) + "@" + DOMAIN);
const validUser = u => /^[a-z0-9][a-z0-9._-]{1,30}$/.test(cleanUser(u));
/* userId ต้องเป็น uuid ตัวพิมพ์เล็กเท่านั้น
   - ตัวพิมพ์ใหญ่จะทำให้การเทียบ id === me.id ไม่ตรง แล้วข้ามด่านกันลบตัวเอง/ลดสิทธิ์ตัวเองได้
   - และกันไม่ให้ยิง path แปลกๆ เข้า /auth/v1/admin/... */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cleanId = v => String(v || "").trim().toLowerCase();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  /* ---------- ตรวจการตั้งค่า ----------
     ตอบได้แม้ตั้งค่าไม่ครบ จะได้บอกได้ว่าขาดอะไร
     ไม่คืนค่าคีย์ออกไป — บอกแค่ "ตั้งไว้ไหม / ชนิดถูกไหม / ยาวกี่ตัว" */
  if (req.method === "GET" && String(req.query.diag || "") === "1") {
    const raw = req.headers.authorization || "";
    const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
    const kk = keyKind(SERVICE);
    const envHost = hostOf(URL_BASE);
    const tokenHost = hostOf((jwtBody(token) || {}).iss || "");
    const out = {
      url:   { set: !!URL_BASE, host: envHost || "(ไม่ได้ตั้งค่า)" },
      key:   { set: !!SERVICE, ok: kk.ok, kind: kk.kind, length: SERVICE.length },
      token: { sent: !!token, host: tokenHost || "(อ่านไม่ได้)" },
      match: !!(envHost && tokenHost) ? envHost === tokenHost : null,
      keyAlone: null, auth: null, members: null
    };
    /* ทดสอบคีย์ "เดี่ยวๆ" ก่อน โดยไม่มีโทเคนผู้ใช้มาเกี่ยว
       ผ่าน  = คีย์ใช้ได้ ปัญหาอยู่ที่โทเคนผู้ใช้
       ไม่ผ่าน = คีย์นั่นแหละที่มีปัญหา */
    if (URL_BASE && SERVICE) {
      try {
        const r = await fetch(URL_BASE + "/auth/v1/admin/users?per_page=1",
          { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } });
        out.keyAlone = { status: r.status, ok: r.ok };
        if (!r.ok) out.keyAlone.detail = (await r.text().catch(() => "")).slice(0, 200);
      } catch (e) {
        out.keyAlone = { status: 0, ok: false, detail: String(e.message || e).slice(0, 200) };
      }
    }
    if (URL_BASE && SERVICE && token) {
      try {
        const r = await fetch(URL_BASE + "/auth/v1/user", { headers: { apikey: SERVICE, Authorization: "Bearer " + token } });
        out.auth = { status: r.status, ok: r.ok };
        if (r.ok) {
          const me = await r.json();
          try {
            const rows = await db("/members?user_id=eq." + encodeURIComponent(me.id) + "&select=role");
            out.members = rows.length ? { found: true, role: rows[0].role } : { found: false };
          } catch (e) {
            out.members = { found: false, error: String(e.message || e).slice(0, 160) };
          }
        } else {
          /* ข้อความจาก Supabase ตรงๆ — ไม่มีคีย์ปนอยู่ในนี้ */
          out.auth.detail = (await r.text().catch(() => "")).slice(0, 200);
        }
      } catch (e) {
        out.auth = { status: 0, ok: false, detail: String(e.message || e).slice(0, 200) };
      }
    }
    /* โทเคนหมดอายุหรือยัง — อ่านจาก exp ในโทเคนเอง ไม่ต้องถาม Supabase */
    const tb = jwtBody(token) || {};
    if (tb.exp) out.token.expired = (tb.exp * 1000) < Date.now();
    if (tb.role) out.token.role = tb.role;
    return res.status(200).json(out);
  }

  if (!URL_BASE || !SERVICE) {
    return res.status(500).json({
      error: "ยังไม่ได้ตั้งค่าใน Vercel → Settings → Environment Variables: " +
             [!URL_BASE && "SUPABASE_URL", !SERVICE && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(" และ ") +
             " (ตั้งแล้วต้อง deploy ใหม่อีกครั้งค่าถึงจะมีผล)"
    });
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
      const id = cleanId(body.userId);
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "ไม่พบผู้ใช้ที่ต้องการแก้ไข" });

      if (body.password) {
        if (String(body.password).length < 6)
          return res.status(400).json({ error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัว" });
        await auth("/admin/users/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify({ password: String(body.password) }) });
      }

      const patch = {};
      if (body.role === "admin" || body.role === "member") patch.role = body.role;
      if (body.name !== undefined) patch.name = body.name;
      if (body.note !== undefined) patch.note = body.note;

      if (patch.role === "member" && id === cleanId(me.id))
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
      const id = cleanId(body.userId || req.query.userId);
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "ไม่พบผู้ใช้ที่ต้องการลบ" });
      if (id === cleanId(me.id)) return res.status(400).json({ error: "ลบบัญชีตัวเองไม่ได้" });

      /* ต้องเหลือแอดมินอย่างน้อย 1 คนเสมอ ไม่งั้นจะไม่มีใครจัดการผู้ใช้ได้อีกเลย */
      const admins = await db("/members?role=eq.admin&select=user_id");
      const ids = admins.map(a => cleanId(a.user_id));
      if (ids.includes(id) && ids.length <= 1)
        return res.status(400).json({ error: "ต้องเหลือแอดมินอย่างน้อย 1 คน" });

      await auth("/admin/users/" + encodeURIComponent(id), { method: "DELETE" });   // members ลบตามด้วย on delete cascade
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method ไม่รองรับ" });
  } catch (e) {
    const st = e.status || 500;
    console.error("api/users error", st, e && e.message);      /* รายละเอียดเก็บไว้ฝั่งเซิร์ฟเวอร์ */
    /* 4xx และข้อความที่ตั้ง expose ไว้เอง ส่งกลับได้
       5xx อื่นๆ อาจมีชื่อคอลัมน์/โครงสร้างฐานข้อมูลติดมา จึงตอบกลางๆ */
    const show = st < 500 || e.expose;
    return res.status(st).json({ error: show ? (e.message || "ทำรายการไม่สำเร็จ") : "ระบบขัดข้อง กรุณาลองใหม่" });
  }
}
