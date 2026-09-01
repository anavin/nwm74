/* ============================================================
   store.js — ชั้นข้อมูลของระบบ เชื่อมกับ Supabase
   - ตาราง: schema "nm74" (contracts, payments, extras, eot, rfa, files)
   - ไฟล์แนบ: Supabase Storage bucket "nm74-files" (private)
   - สิทธิ์: ต้องล็อกอิน (Supabase Auth) และ RLS อนุญาตเฉพาะ authenticated
   ============================================================ */
"use strict";

const BUCKET = "nm74-files";

/* ---- แปลงชื่อฟิลด์ ระหว่าง JS (camelCase) กับ Postgres (snake_case) ---- */
const MAPS = {
  contracts: {order:"ord", code:"code", name:"name", contractor:"contractor", amount:"amount",
    periods:"periods", vat:"vat", retention:"retention", endDate:"end_date", dueDay:"due_day",
    startDate:"start_date", durationDays:"duration_days", inspectDays:"inspect_days", payDays:"pay_days",
    penaltyDay:"penalty_day", handoverDate:"handover_date", employer:"employer", employerRep:"employer_rep",
    bank:"bank"},
  payments: {contractId:"contract_id", seq:"seq", detail:"detail", amount:"amount", vat:"vat",
    retention:"retention", invoice:"invoice", reqDate:"req_date", certDate:"cert_date",
    paidDate:"paid_date", docsOk:"docs_ok", note:"note"},
  extras: {building:"building", detail:"detail", amount:"amount", discount:"discount",
    invoice:"invoice", reqDate:"req_date", paidDate:"paid_date", docsOk:"docs_ok", note:"note"},
  eot: {no:"no", docNo:"doc_no", contractId:"contract_id", submitDate:"submit_date", reason:"reason",
    days:"days", oldEnd:"old_end", newEnd:"new_end", status:"status", decisionDate:"decision_date",
    eventDate:"event_date", note:"note"},
  rfa: {order:"ord", title:"title", trade:"trade", category:"category", detail:"detail", docNo:"doc_no",
    brand:"brand", reviewer:"reviewer", leadDays:"lead_days", requiredOn:"required_on", dueDate:"due_date",
    submitDate:"submit_date", status:"status", decisionDate:"decision_date", note:"note"},
  files: {name:"name", size:"size", mime:"mime", refType:"ref_type", refId:"ref_id",
    docType:"doc_type", storagePath:"storage_path", url:"url", createdAt:"created_at"}
};
const DATE_FIELDS = new Set(["end_date","req_date","paid_date","submit_date","old_end","new_end",
  "decision_date","required_on","due_date","start_date","handover_date","cert_date","event_date"]);

function toRow(table, obj){
  const map = MAPS[table], row = {};
  for(const k in map){
    let v = obj[k];
    if(v === undefined) continue;
    if(DATE_FIELDS.has(map[k]) && (v === "" || v === null)) v = null;
    if(v === "" && ["amount","vat","retention","discount","days","seq","ord","periods","lead_days","no",
      "duration_days","inspect_days","pay_days","penalty_day","due_day"].includes(map[k])) v = null;
    row[map[k]] = v;
  }
  return row;
}
function fromRow(table, row){
  const map = MAPS[table], out = {id: row.id};
  for(const k in map){ const v = row[map[k]]; out[k] = (v === null || v === undefined) ? (map[k].endsWith("_ok") ? false : "") : v; }
  return out;
}

const Store = (() => {
  let sb = null, authCb = null;

  async function init(){
    const cfg = window.NM74_CONFIG || {};
    if(!window.supabase || !window.supabase.createClient){
      console.error("โหลดไลบรารี supabase-js ไม่สำเร็จ — ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต");
      return false;
    }
    if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /YOUR_/.test(cfg.SUPABASE_URL)) return false;
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      db: { schema: "nm74" },
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return true;
  }

  /* ---------------- auth ----------------
     ล็อกอินด้วย "ชื่อผู้ใช้" ไม่ต้องมีอีเมลจริง
     Supabase Auth บังคับให้ผู้ใช้มีอีเมล ระบบจึงเติมโดเมนภายในให้อัตโนมัติ
     เช่น พิมพ์ "somchai" → ใช้ somchai@nm74.local ตอนล็อกอิน
     (ถ้าพิมพ์ที่มี @ อยู่แล้ว จะใช้ค่านั้นตรงๆ — อีเมลจริงก็ยังล็อกอินได้) */
  const userDomain = () => (window.NM74_CONFIG && window.NM74_CONFIG.USER_DOMAIN) || "nm74.local";
  const toEmail = u => {
    const t = String(u||"").trim();
    return t.includes("@") ? t : t.toLowerCase().replace(/\s+/g,"") + "@" + userDomain();
  };
  /* ตัดโดเมนภายในออกตอนแสดงผล */
  const displayName = e => String(e||"").replace(new RegExp("@"+userDomain().replace(/\./g,"\\.")+"$","i"), "");

  function onAuth(cb){
    authCb = cb;
    sb.auth.getSession().then(({data}) => cb(data.session));
    sb.auth.onAuthStateChange((_e, session) => cb(session));
  }
  async function signIn(user, password){
    const {error} = await sb.auth.signInWithPassword({email: toEmail(user), password});
    if(error) throw error;
  }
  async function signOut(){ await sb.auth.signOut(); }

  /* ---------------- data ---------------- */
  async function readAll(table, order){
    const q = sb.from(table).select("*");
    if(order) order.forEach(o => q.order(o[0], {ascending: o[1] !== false, nullsFirst: false}));
    const {data, error} = await q;
    if(error) throw error;
    return data.map(r => fromRow(table, r));
  }
  async function loadAll(){
    const [contracts, payments, extras, eots, rfas, files] = await Promise.all([
      readAll("contracts", [["ord"]]),
      readAll("payments", [["contract_id"], ["seq"]]),
      readAll("extras", [["req_date"]]),
      readAll("eot", [["no"]]),
      readAll("rfa", [["ord"]]),
      readAll("files", [["created_at", false]])
    ]);
    return {contracts, payments, extras, eots, rfas, files};
  }
  async function save(table, id, body){
    const row = toRow(table, body);
    row.id = id;
    const {error} = await sb.from(table).upsert(row, {onConflict: "id"});
    if(error) throw error;
  }
  /* แก้เฉพาะบางคอลัมน์ (UPDATE จริง ไม่ใช่ upsert)
     ใช้ตอนไม่อยากส่งทุกคอลัมน์ เช่น ฐานข้อมูลยังไม่มีคอลัมน์ใหม่บางตัว */
  async function patch(table, id, body){
    const row = toRow(table, body);
    delete row.id;
    const {error} = await sb.from(table).update(row).eq("id", id);
    if(error) throw error;
  }
  async function remove(table, id){
    const {error} = await sb.from(table).delete().eq("id", id);
    if(error) throw error;
  }

  /* ---------------- realtime ---------------- */
  let channel = null;
  function subscribe(cb){
    if(channel) return;
    channel = sb.channel("nm74-changes");
    ["contracts","payments","extras","eot","rfa","files"].forEach(t =>
      channel.on("postgres_changes", {event: "*", schema: "nm74", table: t}, () => cb()));
    channel.subscribe();
  }

  /* ---------------- storage ---------------- */
  /* Supabase Storage รับเฉพาะคีย์แบบ ASCII — ชื่อไฟล์ไทยต้องแปลงก่อน
     (ชื่อจริงยังเก็บครบในคอลัมน์ name เพื่อแสดงผล) */
  const slug = s => {
    const src = String(s || "file");
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(src);
    const ext = m ? "." + m[1].toLowerCase() : "";
    const base = src.replace(/\.[^.]*$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 48);
    return (base || "file") + ext;
  };
  async function uploadFile(file, refType, refId, docType){
    const path = `${refType}/${refId}/${docType || "other"}-${Date.now()}-${Math.random().toString(36).slice(2,7)}-${slug(file.name)}`;
    const up = await sb.storage.from(BUCKET).upload(path, file, {contentType: file.type || undefined, upsert: false});
    if(up.error) throw up.error;
    const {error} = await sb.from("files").insert({
      name: file.name, size: file.size, mime: file.type || "application/octet-stream",
      ref_type: refType, ref_id: refId, doc_type: docType || "other", storage_path: path
    });
    if(error){ await sb.storage.from(BUCKET).remove([path]); throw error; }
  }
  async function addLink({url, name, refType, refId, docType}){
    const {error} = await sb.from("files").insert({
      name: name || url, size: null, mime: "link", url,
      ref_type: refType, ref_id: refId, doc_type: docType || "other", storage_path: null
    });
    if(error) throw error;
  }
  async function fileUrl(f){
    if(f.url) return f.url;
    const {data, error} = await sb.storage.from(BUCKET).createSignedUrl(f.storagePath, 60 * 10);
    if(error) throw error;
    return data.signedUrl;
  }
  async function deleteFile(f){
    if(f.storagePath) await sb.storage.from(BUCKET).remove([f.storagePath]);
    const {error} = await sb.from("files").delete().eq("id", f.id);
    if(error) throw error;
  }

  return {init, onAuth, signIn, signOut, displayName, loadAll, save, patch, remove, subscribe, uploadFile, addLink, fileUrl, deleteFile,
          get client(){ return sb; }};
})();
