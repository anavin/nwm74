"use strict";
/* ============================ helpers ============================ */
const $ = (s,r=document)=>r.querySelector(s);
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => (n==null||n==="")?"—":Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
function thDate(iso){
  if(!iso) return "—";
  const d = new Date(iso+"T00:00:00");
  if(isNaN(d)) return iso;
  return d.getDate()+" "+TH_M[d.getMonth()]+" "+String(d.getFullYear()+543).slice(-2);
}
function thDateFull(iso){
  if(!iso) return "—";
  const d=new Date(iso+"T00:00:00"); if(isNaN(d)) return iso;
  return d.getDate()+" "+TH_M[d.getMonth()]+" "+(d.getFullYear()+543);
}
/* toISOString() คืนค่าเป็น UTC — ที่ไทย (UTC+7) จะได้วันก่อนหน้า 1 วัน
   ทุกที่ที่แปลง Date เป็น YYYY-MM-DD ต้องใช้ isoLocal เท่านั้น */
const isoLocal = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const todayISO = () => isoLocal(new Date());
/* ต้องคำนวณใหม่ทุกครั้ง ไม่งั้นเปิดหน้าจอทิ้งไว้ข้ามคืนแล้ววันที่ค้างอยู่ที่เมื่อวาน */
const today0 = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
function daysBetween(isoA,isoB){
  if(!isoA) return null;
  const a=new Date(isoA+"T00:00:00"), b=isoB?new Date(isoB+"T00:00:00"):today0();
  if(isNaN(a)||isNaN(b)) return null;
  return Math.round((b-a)/86400000);
}
const uid = p => p+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
function toast(msg){
  const t=$("#toast"); t.innerHTML='<div class="toast">'+esc(msg)+"</div>";
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.innerHTML="",3200);
}
const bytes = n => n<1024?n+" B" : n<1048576?(n/1024).toFixed(0)+" KB" : (n/1048576).toFixed(1)+" MB";

const RFA_STATUS = ["ยังไม่ยื่น","รออนุมัติ","อนุมัติแล้ว","อนุมัติตามหมายเหตุ","ให้แก้ไข/ยื่นใหม่","ไม่อนุมัติ"];

/* ============================ state ============================ */
const S = {db:null, dl:null, mode:"local", view:"dash",
           contracts:[], payments:[], extras:[], eots:[], rfas:[], files:[],
           filter:{contract:"", status:"", q:""}, seeded:false, role:"", members:[], me:"", acts:[], actUser:"", actErr:"", usersErr:"", usersDiag:null};

const COLS = {contracts:"contracts", payments:"payments", extras:"extras", eots:"eot", rfas:"rfa", files:"files"};
function addDays(iso,d){ if(!iso) return ""; const x=new Date(iso+"T00:00:00"); if(isNaN(x)) return "";
  x.setDate(x.getDate()+Number(d||0)); return isoLocal(x); }
function rfaDeadline(r){ return r.requiredOn ? addDays(r.requiredOn, -Number(r.leadDays||0)) : ""; }
function rfaState(r){
  const st=r.status||"ยังไม่ยื่น";
  if(st==="อนุมัติแล้ว"||st==="อนุมัติตามหมายเหตุ") return "paid";
  if(st==="ไม่อนุมัติ"||st==="ให้แก้ไข/ยื่นใหม่") return "late";
  const dl=rfaDeadline(r), today=todayISO();
  if(st==="ยังไม่ยื่น") return (dl && dl<today) ? "late" : "idle";
  const over = (r.dueDate && r.dueDate<today) || (dl && dl<today) || (daysBetween(r.submitDate)||0)>14;
  return over ? "late" : "due";
}

/* ---------- derived ---------- */
const paidNet = p => Number(p.amount||0)+Number(p.vat||0)-Number(p.retention||0)-Number(p.discount||0);
const isPaid = r => !!r.paidDate;
function contractOf(r){ return S.contracts.find(c=>c.id===r.contractId); }
/* บวกวันทำการ (ข้ามเสาร์-อาทิตย์ ยังไม่รวมวันหยุดนักขัตฤกษ์) */
function addWorkdays(iso,n){
  if(!iso) return "";
  const d=new Date(iso+"T00:00:00"); if(isNaN(d)) return "";
  let left=Number(n||0);
  while(left>0){ d.setDate(d.getDate()+1); const w=d.getDay(); if(w!==0&&w!==6) left--; }
  return isoLocal(d);
}
const vatRate = c => Number(c&&c.vat||0)/100;
/* มูลค่าสัญญา: amount = เนื้องาน (ก่อน VAT) · total = รวม VAT */
const contractTotal = c => Number(c&&c.amount||0)*(1+vatRate(c));
/* วันที่ CM ต้องตรวจงานให้เสร็จ */
function inspectDueOf(r){
  const c=contractOf(r);
  return (c&&c.inspectDays&&r.reqDate)? addWorkdays(r.reqDate,c.inspectDays) : "";
}
/* วันครบกำหนดจ่าย: ถ้าสัญญากำหนด "จ่ายทุกวันที่ N ของเดือน" ให้ใช้วันที่ N ครั้งถัดไปนับจากวันที่ยื่นเบิก */
function dueDateOf(r){
  const c=contractOf(r), d=Number(c&&c.dueDay||0);
  /* แบบที่ 2: จ่ายภายใน N วันทำการ นับจากวันที่รับรองผลตรวจ (ตามสัญญาข้อ 3) */
  if(!d && c && c.payDays && r.certDate) return addWorkdays(r.certDate, c.payDays);
  if(!d || !r.reqDate) return "";
  const t=new Date(r.reqDate+"T00:00:00"); if(isNaN(t)) return "";
  const mk=(y,m)=>{ const last=new Date(y,m+1,0).getDate(); return new Date(y,m,Math.min(d,last)); };
  let x=mk(t.getFullYear(),t.getMonth());
  if(x<t) x=mk(t.getFullYear(),t.getMonth()+1);
  return isoLocal(x);
}
/* จำนวนวันที่เลยกำหนด (บวก = เลยแล้ว, ลบ = ยังไม่ถึงกำหนด) */
function overdueDays(r){
  const due=dueDateOf(r);
  return due ? daysBetween(due) : daysBetween(r.reqDate);
}
function pstatus(r){
  if(r.paidDate) return "paid";
  const due=dueDateOf(r);
  if(due) return daysBetween(due)>0 ? "late" : "due";
  const age = daysBetween(r.reqDate);
  return (age!=null && age>30) ? "late" : "due";
}
function dueNote(r){
  const due=dueDateOf(r);
  if(!due){
    const insp=inspectDueOf(r);
    if(insp && !r.certDate){
      const n=daysBetween(insp);
      return n>0 ? "รอผลตรวจ — CM เกินกำหนดตรวจ "+n+" วัน" : "รอผลตรวจ — CM ต้องตรวจให้เสร็จภายใน "+thDate(insp);
    }
    return "";
  }
  const n=daysBetween(due);
  return n>0 ? "เลยกำหนด "+n+" วัน" : n===0 ? "ครบกำหนดวันนี้" : "ครบกำหนด "+thDate(due)+" (อีก "+Math.abs(n)+" วัน)";
}
const statusLabel = s => s==="paid"?"จ่ายแล้ว":s==="late"?"เลยกำหนดจ่าย":"ค้างจ่าย";
function contractStats(c){
  const rows = S.payments.filter(p=>p.contractId===c.id);
  const billed = rows.reduce((s,p)=>s+paidNet(p),0);          // ยอดเงินสดที่เบิกแล้ว (รวม VAT − ประกัน)
  const paid = rows.filter(isPaid).reduce((s,p)=>s+paidNet(p),0);
  const due = billed-paid;
  const base = rows.reduce((s,p)=>s+Number(p.amount||0),0);   // เนื้องานที่เบิกแล้ว (ก่อน VAT)
  const rest = Math.max(0, Number(c.amount||0)-base);         // เนื้องานคงเหลือ (ก่อน VAT)
  const retention = rows.filter(isPaid).reduce((s,p)=>s+Number(p.retention||0),0);
  const pct = Math.min(100, base/Math.max(1,Number(c.amount||0))*100);
  /* gross = ยอดที่เรียกเก็บจริงตามใบเบิก (รวม VAT ยังไม่หักประกัน) — ใช้กับตัวเลข "เบิกแล้ว"
     billed/paid/due = เงินสดที่ต้องโอน (หักประกันแล้ว)
     retentionAll = ประกันที่หักไว้ทุกงวดที่เบิก · retention = เฉพาะงวดที่โอนแล้ว */
  const gross = rows.reduce((s,p)=>s+Number(p.amount||0)+Number(p.vat||0),0);
  const retentionAll = rows.reduce((s,p)=>s+Number(p.retention||0),0);
  const paidBase = rows.filter(isPaid).reduce((s,p)=>s+Number(p.amount||0),0);
  return {rows,billed,paid,due,base,rest,retention,retentionAll,gross,paidBase,pct,count:rows.length};
}
/* กำหนดคืนเงินประกันผลงาน = ส่งมอบงาน + 1 ปี (สัญญาข้อ 4.3) */
function retentionDue(c){
  if(!c.handoverDate) return "";
  const d=new Date(c.handoverDate+"T00:00:00"); if(isNaN(d)) return "";
  const dd=d.getDate(); d.setFullYear(d.getFullYear()+1);
  if(d.getDate()!==dd) d.setDate(0);          /* 29 ก.พ. → 28 ก.พ. ไม่ใช่ 1 มี.ค. */
  return isoLocal(d);
}
function warrantyEnd(c,years){
  if(!c.handoverDate) return "";
  const d=new Date(c.handoverDate+"T00:00:00"); if(isNaN(d)) return "";
  const dd=d.getDate(); d.setFullYear(d.getFullYear()+Number(years||0));
  if(d.getDate()!==dd) d.setDate(0);
  return isoLocal(d);
}
function totals(){
  const t={contract:0,billed:0,paid:0,due:0,extra:0,extraPaid:0,
           base:0,baseBilled:0,gross:0,retention:0,retentionAll:0};
  S.contracts.forEach(c=>{const s=contractStats(c);
    t.contract+=contractTotal(c); t.billed+=s.billed; t.paid+=s.paid; t.due+=s.due;
    t.base+=Number(c.amount||0); t.baseBilled+=s.base; t.gross+=s.gross;
    t.retention+=s.retention; t.retentionAll+=s.retentionAll;});
  S.extras.forEach(x=>{t.extra+=paidNet(x); if(isPaid(x)) t.extraPaid+=paidNet(x);});
  return t;
}
function avgPayLag(){
  const lags = S.payments.filter(p=>p.paidDate&&p.reqDate).map(p=>daysBetween(p.reqDate,p.paidDate)).filter(n=>n!=null);
  return lags.length? Math.round(lags.reduce((a,b)=>a+b,0)/lags.length) : null;
}
/* สัญญาหลักที่ใช้อ้างอิงกำหนดแล้วเสร็จของโครงการ (อาคาร 3 ชั้น) */
const mainContract = () => S.contracts.find(c=>c.id==="c2") || S.contracts.find(c=>c.durationDays) || S.contracts[0];
/* คำขอขยายเวลาของสัญญานั้นเท่านั้น — EOT ของสัญญาอื่นต้องไม่ไปยืดกำหนดของสัญญานี้ */
function eotsOf(status){
  const c = mainContract(); if(!c) return [];
  return S.eots.filter(e=>e.status===status && (!e.contractId || e.contractId===c.id))
               .sort((a,b)=>(a.newEnd||"").localeCompare(b.newEnd||""));
}
function currentEnd(){
  const c = mainContract(), ok = eotsOf("อนุมัติแล้ว");
  const base = (c && c.endDate) || "";
  const last = ok.length ? ok[ok.length-1].newEnd : "";
  if(!last) return base;
  return (!base || last > base) ? last : base;
}
function pendingEnd(){
  const p = eotsOf("รออนุมัติ");
  return p.length? p[p.length-1].newEnd : null;
}
const filesFor = (t,id) => S.files.filter(f=>f.refType===t&&f.refId===id);

/* ============================ store (Supabase) ============================ */
async function boot(){
  const ok = await Store.init();
  if(!ok){ showConfigHelp(); return; }
  Store.onAuth(async session=>{
    if(!session){ showLogin(); return; }
    hideLogin();
    const prof = await Store.myProfile();
    S.role = prof.role;
    const uname = prof.username || Store.displayName(session.user.email||"");
    $("#dbstate").innerHTML =
      '<div class="whoami"><div class="wa-lab">เข้าสู่ระบบ</div>'+
      '<div class="wa-nm">'+esc(prof.name || uname)+
        (S.role==="admin" ? ' <span class="rolechip">แอดมิน</span>' : "")+'</div>'+
      (prof.name ? '<div class="wa-id num">@'+esc(uname)+'</div>' : "")+'</div>';
    await refresh();
    Store.subscribe(()=>refresh());
  });
}
function sortRows(){
  S.contracts.sort((a,b)=>(a.order||0)-(b.order||0));
  S.payments.sort((a,b)=>String(a.contractId||"").localeCompare(String(b.contractId||""))||(a.seq||0)-(b.seq||0));
  S.eots.sort((a,b)=>(a.no||0)-(b.no||0));
  S.rfas.sort((a,b)=>(a.order||0)-(b.order||0));
  S.files.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}
async function refresh(){
  try{
    const d = await Store.loadAll();
    S.contracts=d.contracts; S.payments=d.payments; S.extras=d.extras;
    S.eots=d.eots; S.rfas=d.rfas; S.files=d.files;
    S.mode="db"; sortRows(); renderAll();
  }catch(e){ toast("โหลดข้อมูลไม่สำเร็จ: "+(e.message||e)); }
}
/* ---- ประวัติการใช้งาน: แปลงรายการเป็นข้อความที่คนอ่านรู้เรื่อง ---- */
const REF_LABEL = {payments:"งวดงาน", extras:"งานเพิ่ม", rfa:"งานขออนุมัติ", eot:"คำขอขยายเวลา",
                   contracts:"สัญญา", files:"เอกสารแนบ"};
function describe(col,id,body){
  const b = body||{};
  if(col===COLS.payments){
    const c=S.contracts.find(x=>x.id===b.contractId);
    return (c?c.code+" · ":"")+"งวดที่ "+(b.seq||"?")+(b.invoice?" ("+b.invoice+")":"")+
      (b.paidDate?" — บันทึกการโอน "+thDate(b.paidDate):"");
  }
  if(col===COLS.extras)  return "งานเพิ่ม "+(b.building||"")+(b.invoice?" ("+b.invoice+")":"");
  if(col===COLS.rfas)    return (b.title||"รายการขออนุมัติ")+(b.docNo?" ("+b.docNo+")":"")+
                                (b.status?" — "+b.status:"");
  if(col===COLS.eots)    return "ขอขยายเวลาครั้งที่ "+(b.no||"?")+(b.docNo?" ("+b.docNo+")":"");
  if(col===COLS.contracts) return "สัญญา "+(b.code||"")+" "+(b.name||"");
  return (REF_LABEL[col]||col)+" "+id;
}
/* ป้ายสั้นๆ ของรายการที่เอกสารแนบอยู่ */
function refLabel(rt,id){
  const r = refRecord(rt,id) || {};
  if(rt==="payment"){ const c=S.contracts.find(x=>x.id===r.contractId);
    return (c?c.code+" · ":"")+"งวดที่ "+(r.seq||"?")+(r.invoice?" ("+r.invoice+")":""); }
  if(rt==="extra")    return "งานเพิ่ม "+(r.building||"");
  if(rt==="rfa")      return r.title || "รายการขออนุมัติ";
  if(rt==="eot")      return "ขอขยายเวลาครั้งที่ "+(r.no||"?");
  if(rt==="contract") return "สัญญา "+(r.code||"");
  return rt+" "+id;
}
function describeExisting(col,id){
  const pools={[COLS.payments]:S.payments,[COLS.extras]:S.extras,[COLS.rfas]:S.rfas,
               [COLS.eots]:S.eots,[COLS.contracts]:S.contracts};
  const rec=(pools[col]||[]).find(x=>x.id===id);
  return rec ? describe(col,id,rec) : (REF_LABEL[col]||col)+" "+id;
}
async function save(col,id,body){
  const isNew = !((({[COLS.payments]:S.payments,[COLS.extras]:S.extras,[COLS.rfas]:S.rfas,
                     [COLS.eots]:S.eots,[COLS.contracts]:S.contracts})[col]||[]).some(x=>x.id===id));
  try{
    await Store.save(col,id,body);
    Store.logActivity(isNew?"create":"update", col, id, describe(col,id,body));
    await refresh();
  }
  catch(e){ throw new Error(e.message||e); }
}
async function remove(col,id){
  const what = describeExisting(col,id);
  try{ await Store.remove(col,id); Store.logActivity("delete", col, id, what); await refresh(); }
  catch(e){ toast("ลบไม่สำเร็จ: "+(e.message||e)); }
}

/* ============================ ประเภทเอกสารแนบ ============================ */
const DOC_TYPES = {
  payment:[["invoice","ใบเบิก","บ"],["report","รายงานงวดงาน","ร"],["bundle","ใบเบิก + รายงาน (เล่มเดียว)","บร"],
           ["slip","สลิปโอนเงิน","ส"],["receipt","ใบเสร็จรับเงิน","สร"],["other","อื่นๆ","อ"]],
  extra:  [["invoice","ใบเบิก","บ"],["report","รายงาน / รูปงาน","ร"],["bundle","ใบเบิก + รายงาน (เล่มเดียว)","บร"],
           ["slip","สลิปโอนเงิน","ส"],["receipt","ใบเสร็จรับเงิน","สร"],["other","อื่นๆ","อ"]],
  rfa:    [["form","แบบฟอร์ม RFA","ฟ"],["spec","แคตตาล็อก / สเปก","ค"],["drawing","Shop Drawing","ด"],["result","ผลอนุมัติ","ผ"],["other","อื่นๆ","อ"]],
  contract:[["contract","สัญญาก่อสร้าง","ส"],["drawing","แบบก่อสร้าง","บ"],["boq","BOQ / ราคากลาง","ค"],
            ["annex","เอกสารแนบท้าย / แก้ไขสัญญา","น"],["other","อื่นๆ","อ"]],
  eot:    [["letter","หนังสือขอขยายเวลา","น"],["form","แบบฟอร์ม RFA","ฟ"],["support","เอกสารประกอบ","ป"],["result","ผลอนุมัติ","ผ"],["other","อื่นๆ","อ"]]
};
const docMeta=(rt,t)=>(DOC_TYPES[rt]||DOC_TYPES.payment).find(x=>x[0]===t)||["other","อื่นๆ","อ"];
const GUESS=[[/ใบเสร็จ|เสร็จรับเงิน|ใบกำกับภาษี|receipt|tax[-_ ]?invoice/i,"receipt"],
  [/สลิป|slip|โอน|transfer|pay[-_ ]?in/i,"slip"],[/ใบเบิก|เบิก|invoice|บิล|แจ้งหนี้|pph|nt20/i,"invoice"],
  [/รายงาน|report|ตรวจ|inspect|progress/i,"report"],[/shop|drawing|แบบขยาย|dwg/i,"drawing"],
  [/catalog|แคตตาล็อก|spec|สเปค|brochure/i,"spec"],[/สัญญา|contract|agreement/i,"contract"],
  [/boq|ราคากลาง|ปริมาณงาน/i,"boq"],[/แนบท้าย|annex|addendum|แก้ไขสัญญา/i,"annex"],[/rfa|ฟอร์ม/i,"form"],[/หนังสือ|letter/i,"letter"],
  [/อนุมัติ|approve|result/i,"result"]];
function guessType(name,refType){
  const allowed=(DOC_TYPES[refType]||[]).map(x=>x[0]);
  // ชื่อไฟล์ที่มีทั้ง "ใบเบิก" และ "รายงาน" = เล่มรวม
  if(allowed.includes("bundle") && /ใบเบิก|เบิก|invoice/i.test(name) && /รายงาน|report/i.test(name)) return "bundle";
  for(const [re,t] of GUESS) if(re.test(name) && allowed.includes(t)) return t;
  return "other";
}
/* เอกสารที่ "ต้องมี" ของแต่ละรายการ ขึ้นกับสถานะของรายการนั้น */
function requiredDocs(rt,rec){
  if(rt==="payment"||rt==="extra") return rec.paidDate?["invoice","report","slip"]:["invoice","report"];
  if(rt==="rfa"){
    const decided = ["อนุมัติแล้ว","อนุมัติตามหมายเหตุ","ไม่อนุมัติ","ให้แก้ไข/ยื่นใหม่"].includes(rec.status);
    if(!rec.submitDate && !decided) return [];      /* ยังไม่ยื่นและยังไม่มีผล = ยังไม่ต้องมีเอกสาร */
    return decided ? ["form","result"] : ["form"]; }
  if(rt==="contract") return ["contract"];
  if(rt==="eot"){
    const decided = rec.decisionDate || ["อนุมัติแล้ว","ไม่อนุมัติ"].includes(rec.status);
    return decided?["letter","result"]:["letter"]; }
  return [];
}
function docState(rt,rec){
  const fs=filesFor(rt,rec.id), have=new Set(fs.map(f=>f.docType||"other"));
  if(have.has("bundle")){ have.add("invoice"); have.add("report"); }   // เล่มรวมนับเป็นทั้งใบเบิกและรายงาน
  const need=requiredDocs(rt,rec);
  const missing = rec.docsOk ? [] : need.filter(t=>!have.has(t));
  return {files:fs, have, need, missing, confirmed:!!rec.docsOk};
}
/* ตัวบ่งชี้เอกสารในตาราง — ตัวอักษรย่อ ทึบ = มีแล้ว, เส้นประ = ยังขาด */
function docChip(rt,rec){
  const st=docState(rt,rec);
  let shown=st.need.length?st.need.slice():(DOC_TYPES[rt]||[]).slice(0,3).map(x=>x[0]);
  const rawHave=new Set(st.files.map(f=>f.docType||"other"));
  if(rawHave.has("bundle")) shown=["bundle"].concat(shown.filter(t=>t!=="invoice"&&t!=="report"));
  /* ประเภทที่ไม่ได้บังคับแต่แนบไว้แล้ว (เช่น ใบเสร็จ) ก็ควรเห็นในป้าย */
  (DOC_TYPES[rt]||[]).forEach(d=>{ if(d[0]!=="other" && rawHave.has(d[0]) && !shown.includes(d[0])) shown.push(d[0]); });
  const extra=st.files.filter(f=>!shown.includes(f.docType||"other")).length;
  if(st.confirmed) return '<button class="docchip" data-files="'+rt+':'+rec.id+'" title="ยืนยันเอกสารครบแล้ว">'+
    '<i class="on" title="ยืนยันเอกสารครบแล้ว">✓</i></button>';
  const anyRequired = st.need.length>0;
  return '<button class="docchip" data-files="'+esc(rt+':'+rec.id)+'" title="จัดการเอกสารแนบ">'+
    shown.map(t=>{const m=docMeta(rt,t);
      const cls = st.have.has(t) ? "on" : (anyRequired && st.missing.includes(t) ? "miss" : "opt");
      return '<i class="'+cls+'" title="'+esc(m[1])+'">'+m[2]+'</i>';}).join("")+
    (extra?'<span class="xtra">+'+extra+'</span>':'')+'</button>';
}
function missingLabel(rt,rec){
  const st=docState(rt,rec);
  return st.missing.map(t=>docMeta(rt,t)[1]).join(" · ");
}

/* ============================ files ============================ */
const MAX_FILE = 50*1024*1024;
async function uploadFiles(list, refType, refId, docType){
  for(const f of list){
    if(f.size>MAX_FILE){ toast("ไฟล์ "+f.name+" ใหญ่เกิน 50 MB"); continue; }
    const t = docType || guessType(f.name, refType);
    try{ await Store.uploadFile(f,refType,refId,t);
         Store.logActivity("upload","files",refId, "แนบ "+f.name+" ("+docMeta(refType,t)[1]+") กับ "+refLabel(refType,refId));
         toast("แนบ "+f.name+" เป็น "+docMeta(refType,t)[1]); }
    catch(e){ toast("อัปโหลดไม่สำเร็จ: "+(e.message||e)); }
  }
  await refresh();
}
function addLinkDialog(refType, refId, docType, after){
  const dts=DOC_TYPES[refType]||DOC_TYPES.payment;
  openModal("แนบลิงก์เอกสาร",
    fld("url","ลิงก์ (URL)","","url")+
    fld("name","ชื่อที่จะให้แสดง","")+
    sel("dt","ประเภทเอกสาร",docType||dts[0][0],dts.map(d=>[d[0],d[1]]))+
    '<div class="muted" style="font-size:12.5px;line-height:1.6">ใช้กับเอกสารที่เก็บไว้ที่อื่น เช่น Google Drive, '+
    'OneDrive, ลิงก์แชร์จากผู้รับเหมา — ระบบจะเก็บแค่ลิงก์ ไม่ได้คัดลอกไฟล์มาเก็บ '+
    'ผู้ที่กดเปิดต้องมีสิทธิ์เข้าถึงลิงก์นั้นเอง</div>',
    async o=>{
      const url=(o.url||"").trim();
      if(!/^https?:\/\//i.test(url)) throw new Error("ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://");
      let nm=(o.name||"").trim();
      if(!nm){ try{ const u=new URL(url); nm=decodeURIComponent((u.pathname.split("/").filter(Boolean).pop())||u.hostname); }catch(e){ nm=url; } }
      await Store.addLink({url, name:nm, refType, refId, docType:o.dt});
      await refresh();
      if(after) after();
    });
}
async function downloadFile(f){
  try{
    const url = await Store.fileUrl(f);
    if(f.url){ window.open(url,"_blank","noopener"); return; }
    const a=document.createElement("a"); a.href=url; a.download=f.name; a.rel="noopener";
    document.body.appendChild(a); a.click(); a.remove();
  }catch(e){ toast("เปิดไฟล์ไม่สำเร็จ: "+(e.message||e)); }
}
async function deleteFile(f){
  if(!confirm("ลบเอกสาร \""+f.name+"\" ?")) return;
  try{ await Store.deleteFile(f); Store.logActivity("unlink","files",f.refId,"ลบเอกสาร "+f.name);
       toast("ลบเอกสารแล้ว"); await refresh(); }
  catch(e){ toast("ลบไม่สำเร็จ: "+(e.message||e)); }
}
async function fileData(f){ return null; }

/* ============================ views ============================ */
const VIEWS=[
  {id:"dash",  label:"ภาพรวมโครงการ", sub:"สรุปสถานะการเงิน ความคืบหน้า และสิ่งที่ต้องติดตาม"},
  {id:"pay",   label:"งวดงาน / เบิกจ่าย", sub:"รายการเบิกจ่ายตามสัญญา พร้อมเอกสารแนบรายงวด"},
  {id:"rfa",   label:"งานขออนุมัติ (RFA)", sub:"ทะเบียนขออนุมัติวัสดุ อุปกรณ์ งานระบบ และแบบขยาย พร้อมกำหนดวันที่ต้องอนุมัติ"},
  {id:"eot",   label:"ขอขยายระยะเวลา", sub:"คำขอขยายเวลาก่อสร้าง สถานะอนุมัติ และไทม์ไลน์สัญญา"},
  {id:"import",label:"นำเข้าเอกสาร", sub:"เลือกทั้งโฟลเดอร์แล้วให้ระบบจับคู่ไฟล์กับงวดงาน สัญญา และรายการอนุมัติให้อัตโนมัติ"},
  {id:"docs",  label:"คลังเอกสาร", sub:"เอกสารแนบทั้งหมดของโครงการ"},
  {id:"extra", label:"งานเพิ่ม (นอกสัญญา)", sub:"งานที่เกิดขึ้นนอกเหนือสัญญาและใบเบิกที่เกี่ยวข้อง"},
  {id:"setup", label:"สัญญาและผู้รับจ้าง", sub:"ข้อมูลสัญญา มูลค่า เงื่อนไข และบัญชีรับเงิน"},
  {id:"users", label:"ผู้ใช้งาน", sub:"เพิ่มผู้ใช้ ตั้งรหัสผ่าน และกำหนดสิทธิ์ — เห็นเฉพาะแอดมิน", admin:true}
];
const visibleViews = () => VIEWS.filter(v=>!v.admin || S.role==="admin");
function renderNav(){
  const counts={pay:S.payments.length,extra:S.extras.length,rfa:S.rfas.length,eot:S.eots.length,docs:S.files.length,
                setup:S.contracts.length,users:(S.members||[]).length};
  $("#nav").innerHTML = visibleViews().map(v=>
    '<button class="navitem" data-view="'+v.id+'" aria-current="'+(S.view===v.id)+'">'+
    '<span class="dot"></span>'+esc(v.label)+
    (counts[v.id]!=null?'<span class="badge num">'+counts[v.id]+'</span>':'')+'</button>').join("");
}
function renderAll(){
  if(!visibleViews().some(x=>x.id===S.view)) S.view="dash";
  const v=VIEWS.find(x=>x.id===S.view)||VIEWS[0];
  renderNav();
  $("#viewTitle").textContent=v.label; $("#viewSub").textContent=v.sub;
  const mb=$("#mbView"); if(mb) mb.textContent=v.label;
  $("#banner").innerHTML = S.mode==="db" ? "" :
    '<div class="banner">กำลังเชื่อมต่อฐานข้อมูล…</div>';
  ({dash:viewDash,pay:viewPay,extra:viewExtra,rfa:viewRfa,eot:viewEot,import:viewImport,docs:viewDocs,setup:viewSetup,users:viewUsers}[S.view]||viewDash)();
}
function tools(html){ $("#viewTools").innerHTML=html; }

/* ---------- คลิกจากหน้าภาพรวมไปยังเนื้อหาจริง ----------
   data-go="<view>"            เปิดหน้านั้น
   data-go="<view>#<rt>:<id>"  เปิดหน้านั้นแล้วเลื่อนไปที่แถวนั้น พร้อมไฮไลต์
   data-gc / data-gs / data-gq  ตั้งค่าตัวกรอง (สัญญา / สถานะ / คำค้น) */
function goTo(view,opts){
  opts=opts||{};
  S.view=view;
  S.filter={contract:opts.contract||"",status:opts.status||"",q:opts.q||""};
  closeNav(); renderAll();
  const key=opts.row||"";
  if(!key){ window.scrollTo({top:0,behavior:"smooth"}); return; }
  requestAnimationFrame(()=>{
    const el=document.querySelector('[data-row="'+key+'"]');
    if(!el){ window.scrollTo({top:0,behavior:"smooth"}); return; }
    el.scrollIntoView({behavior:"smooth",block:"center"});
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    clearTimeout(goTo._t); goTo._t=setTimeout(()=>el.classList.remove("flash"),2600);
  });
}

/* ---------- dashboard ---------- */
function viewDash(){
  tools('<button class="btn" data-act="export-all">ส่งออก CSV ทั้งโครงการ</button>');
  const t=totals(), lag=avgPayLag(), end=currentEnd(), pend=pendingEnd();
  const left=daysBetween(todayISO(), end);
  const approved=S.eots.filter(e=>e.status==="อนุมัติแล้ว").reduce((s,e)=>s+Number(e.days||0),0);
  const waiting=S.eots.filter(e=>e.status==="รออนุมัติ").reduce((s,e)=>s+Number(e.days||0),0);
  const rfaLate=S.rfas.filter(r=>rfaState(r)==="late"), rfaDue=S.rfas.filter(r=>rfaState(r)==="due");

  /* ---- ค้างจ่าย: รวมงวดงาน + งานเพิ่ม เรียงตามอายุหนี้ ---- */
  const dueRows=[];
  S.payments.filter(p=>!isPaid(p)).forEach(p=>{
    const c=S.contracts.find(c=>c.id===p.contractId);
    dueRows.push({rt:"payment",rec:p,who:c?c.code:"—",what:"งวดที่ "+p.seq,
      invoice:p.invoice,amount:paidNet(p),date:p.reqDate,due:dueDateOf(p),age:overdueDays(p),late:pstatus(p)==="late"});
  });
  S.extras.filter(x=>!isPaid(x)).forEach(x=>dueRows.push({rt:"extra",rec:x,who:x.building,what:"งานเพิ่ม",
      invoice:x.invoice,amount:paidNet(x),date:x.reqDate,due:"",age:daysBetween(x.reqDate),late:pstatus(x)==="late"}));
  const urgent=(a,b)=>(b.late?1:0)-(a.late?1:0) || (b.age||0)-(a.age||0);
  dueRows.sort(urgent);
  const dueTotal=dueRows.reduce((s,r)=>s+r.amount,0);
  const overdue=dueRows.filter(r=>r.late);
  const overdueSum=overdue.reduce((s,r)=>s+r.amount,0);
  const maxAge=Math.max(30,...dueRows.map(r=>Math.abs(r.age||0)));

  /* เรียงตามสัญญา (ในสัญญาเรียงตามความเร่งด่วน) แล้วต่อท้ายด้วยงานเพิ่ม
     — ชื่อสัญญาไปอยู่หน้าชื่อแต่ละงวด ไม่มีแถบหัวกลุ่มและยอดรวมรายกลุ่ม */
  const dueSorted=[];
  S.contracts.forEach(c=>{
    dueSorted.push(...dueRows.filter(r=>r.rt==="payment"&&r.rec.contractId===c.id).sort(urgent));
  });
  dueSorted.push(...dueRows.filter(r=>r.rt==="extra").sort(urgent));

  const kpi=(cls,lab,val,unit,note,go)=>'<div class="kpi '+cls+(go?" go":"")+'"'+(go||"")+
    (go?' role="button" tabindex="0"':'')+'><div class="lab">'+lab+'</div><div class="val">'+val+
    (unit?'<small>'+unit+'</small>':'')+'</div><div class="note">'+(note||"")+'</div></div>';

  $("#view").innerHTML =
  /* ============ แผงค้างจ่าย — ไม่มีรายการค้าง = ไม่ต้องแสดง ============ */
  (dueRows.length ?
  '<section class="hero">'+
    '<div class="hero-main">'+
      '<div class="hero-lab">ยอดค้างจ่าย ณ วันนี้</div>'+
      '<div class="hero-fig">'+money(dueTotal)+'<small>บาท</small></div>'+
      '<div class="hero-sub">'+
        '<button class="golink" data-go="pay">'+dueRows.length+' รายการที่เบิกแล้วยังไม่ได้โอน</button>'+
        (overdue.length?' · <button class="golink warn" data-go="pay" data-gs="late">เลยกำหนดจ่ายแล้ว '+overdue.length+
          ' รายการ ('+money(overdueSum)+' บาท)</button>':' · ยังไม่มีรายการเลยกำหนด')+
      '</div>'+
    '</div>'+
    '<div class="hero-split">'+
      S.contracts.map(c=>{const st=contractStats(c); if(!st.due) return "";
        return '<div class="hs-row go" role="button" tabindex="0" data-go="pay" data-gc="'+esc(c.id)+'">'+
          '<span class="hs-nm">'+esc(c.code)+'</span>'+
          '<span class="hs-bar"><i style="width:'+Math.round(st.due/Math.max(1,dueTotal)*100)+'%"></i></span>'+
          '<span class="hs-val num">'+money(st.due)+'</span></div>';}).join("")+
      (S.extras.filter(x=>!isPaid(x)).length?
        '<div class="hs-row go" role="button" tabindex="0" data-go="extra"><span class="hs-nm">งานเพิ่ม</span><span class="hs-bar"><i style="width:'+
        Math.round(S.extras.filter(x=>!isPaid(x)).reduce((s,x)=>s+paidNet(x),0)/Math.max(1,dueTotal)*100)+
        '%"></i></span><span class="hs-val num">'+money(S.extras.filter(x=>!isPaid(x)).reduce((s,x)=>s+paidNet(x),0))+'</span></div>':'')+
      '<div class="hs-foot">รอบจ่ายเฉลี่ยที่ผ่านมา '+(lag==null?"—":lag+" วัน")+' หลังยื่นใบเบิก</div>'+
    '</div>'+
  '</section>' : "")+

  /* ============ ตารางค้างจ่ายรายรายการ ============ */
  /* ไม่มีรายการค้าง = ไม่ต้องแสดงการ์ดนี้เลย */
  (dueRows.length ?
  '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>รายการค้างจ่าย</h3>'+
  '<span class="hint"><button class="btn ghost sm" data-go="pay">ดูงวดงานทั้งหมด</button></span>'+
  '</div><div class="tablewrap">'+
  ('<table class="duetbl"><thead><tr><th>รายการ</th><th>เลขที่ใบเบิก</th><th>ยื่นเมื่อ</th>'+
    '<th>ครบกำหนดจ่าย</th><th>สถานะเวลา</th><th class="r">ยอดที่ต้องโอน</th><th class="c">เอกสาร</th><th></th></tr></thead><tbody>'+
    dueSorted.map(r=>{
      const late=r.late;
      const gv = r.rt==="payment" ? "pay" : "extra";
      const gc = r.rt==="payment" ? ' data-gc="'+(r.rec.contractId||"")+'"' : "";
      return '<tr><td data-l="รายการ" class="stripe '+(late?"late":"due")+'" style="min-width:200px">'+
        '<button class="golink strong" data-go="'+gv+'#'+r.rt+':'+r.rec.id+'"'+gc+'>'+
          esc(r.who)+' · '+esc(r.what)+'</button>'+
        '<div class="muted" style="font-size:13px">'+esc(r.rec.detail||"")+'</div></td>'+
        '<td data-l="เลขที่ใบเบิก" class="num">'+esc(r.invoice||"—")+'</td>'+
        '<td data-l="ยื่นเมื่อ" class="num">'+thDate(r.date)+'</td>'+
        '<td data-l="ครบกำหนดจ่าย" class="num">'+(r.due?thDate(r.due):
          '<span class="muted">'+(r.rt==="payment"&&inspectDueOf(r.rec)&&!r.rec.certDate?"รอผลตรวจ":"ตามที่ตกลง")+'</span>')+'</td>'+
        '<td data-l="สถานะเวลา" style="min-width:150px"><div class="agewrap"><span class="agebar'+(late?" late":"")+'">'+
          '<i style="width:'+Math.min(100,Math.max(4,Math.round(Math.abs(r.age||0)/maxAge*100)))+'%"></i></span>'+
          '<b class="num'+(late?" agelate":"")+'">'+(r.age==null?"—":
            (r.due? (r.age>0?"เลย "+r.age+" วัน":r.age===0?"ครบวันนี้":"อีก "+Math.abs(r.age)+" วัน")
                  : "ยื่นมา "+r.age+" วัน"))+'</b></div></td>'+
        '<td data-l="ยอดที่ต้องโอน" class="r num" style="font-weight:600;font-size:16px">'+money(r.amount)+'</td>'+
        '<td data-l="เอกสาร" class="c"><div>'+docChip(r.rt,r.rec)+'</div></td>'+
        '<td><div class="rowacts"><button class="btn ghost sm" data-edit="'+(r.rt==="payment"?"pay":"extra")+':'+r.rec.id+'">บันทึกการโอน</button></div></td></tr>';
    }).join("")+
    '</tbody><tfoot><tr><td colspan="5" class="r" style="font-weight:600">รวมค้างจ่าย</td>'+
    '<td class="r num" style="font-weight:700;font-size:17px">'+money(dueTotal)+'</td><td colspan="2"></td></tr></tfoot></table>'
   )+
  '</div></div>' : "")+

  /* ============ งานขออนุมัติ ============ */
  '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>งานขออนุมัติ (RFA)</h3>'+
  '<span class="hint"><span class="rfatally">'+
    '<b>'+S.rfas.length+'</b> รายการทั้งหมด'+
    [["รอผล",rfaDue.length,""],["ต้องเร่ง",rfaLate.length,"ghlate"],
     ["อนุมัติแล้ว",S.rfas.filter(r=>rfaState(r)==="paid").length,""],
     ["ยังไม่ยื่น",S.rfas.filter(r=>rfaState(r)==="idle").length,""]]
      .filter(t=>t[1]>0)                                   /* ตัวเลขที่เป็น 0 ไม่ต้องโชว์ */
      .map(t=>' · '+t[0]+' <b'+(t[2]?' class="'+t[2]+'"':'')+'>'+t[1]+'</b>').join("")+
  '</span> · <button class="btn ghost sm" data-go="rfa">ดูทั้งหมด</button></span></div>'+
  '<div class="tablewrap"><table><thead><tr><th>หมวดงาน / เรื่อง</th><th>เลขที่เอกสาร</th><th>ยี่ห้อ / รุ่น</th>'+
  '<th class="c">Lead time</th><th>ต้องอนุมัติภายใน</th><th>ยื่นเมื่อ</th><th class="c">สถานะ</th><th class="c">เอกสาร</th></tr></thead><tbody>'+
  /* หน้าภาพรวมโชว์เฉพาะงานที่ยังต้องตาม — ยื่นแล้วแต่ยังไม่ได้ผล
     อนุมัติแล้ว/อนุมัติตามหมายเหตุ = จบแล้ว ไปดูได้ที่เมนูงานขออนุมัติ */
  (function(){ const shown=S.rfas.filter(r=>{const s=rfaState(r); return s!=="idle" && s!=="paid";});
    return shown.length? [...shown].sort((a,b)=>{
      const rank={late:0,due:1,idle:2,paid:3};
      const ra=rank[rfaState(a)], rb=rank[rfaState(b)];
      if(ra!==rb) return ra-rb;
      const da=rfaDeadline(a)||"9999", db=rfaDeadline(b)||"9999";
      return da.localeCompare(db) || (a.order||0)-(b.order||0);
    }).slice(0,8).map(r=>{
      const st=rfaState(r), dl=rfaDeadline(r), today=todayISO();
      const lateDl = dl && dl<today && st!=="paid";
      return '<tr><td data-l="หมวดงาน" class="stripe '+(st==="idle"?"":st)+'" style="min-width:220px">'+
        '<button class="golink strong" data-go="rfa#rfa:'+r.id+'">'+esc(r.title||"—")+'</button>'+
        (r.detail?'<div class="muted" style="font-size:13px;line-height:1.45;margin-top:2px">'+esc(r.detail)+'</div>':'')+
        '<div class="muted" style="font-size:12.5px;margin-top:3px">'+esc(r.trade||"")+
          (r.category?' · '+esc(r.category):'')+' · ผู้พิจารณา '+esc(r.reviewer||"—")+'</div>'+
        (r.note?'<div class="muted" style="font-size:12.5px;margin-top:2px">หมายเหตุ: '+esc(r.note)+'</div>':'')+'</td>'+
        '<td data-l="เลขที่เอกสาร" class="num">'+esc(r.docNo||"—")+'</td>'+
        '<td data-l="ยี่ห้อ / รุ่น">'+(r.brand?esc(r.brand):'<span class="muted">—</span>')+'</td>'+
        '<td data-l="Lead time" class="c num">'+(r.leadDays?r.leadDays+" วัน":'<span class="muted">—</span>')+'</td>'+
        '<td data-l="ต้องอนุมัติภายใน" class="num"'+(lateDl?' style="color:var(--late);font-weight:600"':'')+'>'+
          (dl?thDate(dl):'<span class="muted">ยังไม่กำหนดวันใช้งาน</span>')+'</td>'+
        '<td data-l="ยื่นเมื่อ" class="num">'+(r.submitDate?thDate(r.submitDate):'<span class="muted">ยังไม่ยื่น</span>')+'</td>'+
        '<td data-l="สถานะ" class="c"><span class="pill '+(st==="idle"?"info":st)+'">'+esc(r.status||"—")+'</span></td>'+
        '<td data-l="เอกสาร" class="c"><div>'+docChip("rfa",r)+'</div></td></tr>';
    }).join("")+
    (shown.length>8?'<tr><td colspan="8" class="muted" style="text-align:center">และอีก '+(shown.length-8)+' รายการ — กด “ดูทั้งหมด” ที่หัวตาราง</td></tr>':'')
   :(function(){ const idle=S.rfas.filter(r=>rfaState(r)==="idle").length,
                      ok=S.rfas.filter(r=>rfaState(r)==="paid").length;
      return '<tr><td colspan="8"><div class="empty">'+
        (ok&&!idle ? 'อนุมัติครบทุกรายการแล้ว ('+ok+' รายการ) — ไม่มีงานที่ต้องติดตาม'
         : ok ? 'ไม่มีรายการที่รอผลอนุมัติ — อนุมัติแล้ว '+ok+' รายการ · อีก '+idle+' หมวดงานรอเตรียมเอกสาร'
         : 'ยังไม่มีรายการที่ยื่นขออนุมัติ — '+idle+' หมวดงานรอเตรียมเอกสาร ดูได้ที่เมนูงานขออนุมัติ')+
        '</div></td></tr>'; })(); })()+
  '</tbody></table></div></div>'+

  /* ============ ตัวเลขรอง ============ */
  '<div class="grid kpis" style="margin-bottom:16px">'+
    kpi("lead","มูลค่าสัญญารวม",money(t.contract),"บาท",
      "เนื้องาน "+money(t.base)+" + VAT · "+S.contracts.length+" สัญญา · งานเพิ่ม "+money(t.extra)+" บาท",
      ' data-go="setup"')+
    kpi("","เบิกแล้วสะสม",money(t.gross+t.extra),"บาท",
      "ตามใบเบิก (รวม VAT ก่อนหักประกัน) · เนื้องานที่เบิกแล้ว "+
      (t.base?(t.baseBilled/t.base*100).toFixed(1):"0.0")+"% ของเนื้องานตามสัญญา",
      ' data-go="pay"')+
    kpi("","โอนแล้วจริง",money(t.paid+t.extraPaid),"บาท",
      "หักประกันผลงานไว้แล้ว "+money(t.retention||0)+" บาท"+
      (t.retentionAll>t.retention?" · รอโอนอีก "+money(t.retentionAll-t.retention)+" บาทที่หักจากงวดที่ยังไม่จ่าย":""),
      ' data-go="pay" data-gs="paid"')+
    kpi(left<90?"bad":"","กำหนดแล้วเสร็จ",thDate(end),"",
      (left>=0?"เหลืออีก "+left+" วัน":"เลยกำหนด "+Math.abs(left)+" วัน")+" · ขยายแล้ว "+approved+" วัน"+
      (waiting?" (รออนุมัติอีก "+waiting+" วัน)":""),
      ' data-go="eot"')+
  '</div>'+

  /* ============ สองคอลัมน์ ============ */
  '<div class="grid" style="grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);align-items:start">'+
    '<div class="card"><div class="card-h"><h3>ความคืบหน้าการเบิกจ่ายรายสัญญา</h3>'+
      '<span class="hint">คลิกสัญญาเพื่อดูงวดของสัญญานั้น · <button class="btn ghost sm" data-go="setup">ข้อมูลสัญญา</button></span></div><div class="card-b">'+
      S.contracts.map(c=>{
        const st=contractStats(c), amt=Math.max(1,contractTotal(c));
        const wp=Math.min(100,st.paid/amt*100), wd=Math.min(100,st.due/amt*100);
        return '<div class="ctr-row go" role="button" tabindex="0" data-go="pay" data-gc="'+c.id+'">'+
          '<div class="ctr-head"><div><div class="nm">'+esc(c.code)+' — '+esc(c.name)+'</div>'+
          '<div class="who">'+esc(c.contractor)+'</div></div>'+
          '<div class="num" style="font-weight:600">'+money(contractTotal(c))+
          ' <span class="muted" style="font-weight:400">บาท'+(c.vat?" (รวม VAT)":"")+'</span></div></div>'+
          '<div class="meter"><span class="s-paid" style="width:'+wp+'%"></span>'+
          '<span class="s-due" style="width:'+wd+'%"></span>'+
          '<span class="s-un" style="width:'+Math.max(0,100-wp-wd)+'%"></span></div>'+
          '<div class="ctr-figs"><span>จ่ายแล้ว <b>'+money(st.paid)+'</b></span>'+
          '<span>ค้างจ่าย <b'+(st.due?' style="color:var(--due)"':'')+'>'+money(st.due)+'</b></span>'+
          '<span>เนื้องานคงเหลือ <b>'+money(st.rest)+'</b></span>'+
          '<span class="muted">'+st.count+'/'+(c.periods||"—")+' งวด · เบิกแล้ว '+st.pct.toFixed(0)+'%</span></div></div>';
      }).join("")+
      '<div class="legend"><span><i style="background:var(--fill-paid)"></i>จ่ายแล้ว</span>'+
      '<span><i style="background:var(--fill-due)"></i>เบิกแล้วรอโอน</span>'+
      '<span><i style="background:var(--unbilled)"></i>ยังไม่เบิก</span></div>'+
    '</div></div>'+

    '<div style="display:grid;gap:14px">'+
      '<div class="card"><div class="card-h"><h3>ต้องติดตาม</h3>'+
      '<span class="hint">คลิกเพื่อไปที่รายการนั้น</span></div>'+
      '<div class="card-b" style="display:grid;gap:12px">'+
        (S.payments.filter(p=>!isPaid(p)&&!p.certDate&&inspectDueOf(p)&&daysBetween(inspectDueOf(p))>0).slice(0,3).map(p=>{
        const c=contractOf(p), n=daysBetween(inspectDueOf(p));
        return '<div class="tk go" role="button" tabindex="0" data-go="pay#payment:'+p.id+'" data-gc="'+(p.contractId||"")+'">'+
          '<span class="pill late">ตรวจช้า '+n+' วัน</span>'+
          '<div><div class="tk-t">รอ CM รับรองผลตรวจ · '+esc(p.invoice||"")+'</div>'+
          '<div class="tk-s">'+esc(c?c.code:"")+' งวดที่ '+p.seq+' · ครบกำหนดตรวจ '+thDate(inspectDueOf(p))+'</div></div></div>';
      }).join(""))+
      ((S.eots.filter(e=>e.status==="รออนุมัติ").map(e=>
          '<div class="tk go" role="button" tabindex="0" data-go="eot#eot:'+e.id+'"><span class="pill due">รออนุมัติ</span>'+
          '<div><div class="tk-t">ขอขยายเวลาครั้งที่ '+e.no+' · '+esc(e.docNo)+'</div>'+
          '<div class="tk-s">ยื่น '+thDate(e.submitDate)+' · ขอ '+e.days+' วัน · ค้าง '+(daysBetween(e.submitDate)||0)+' วันแล้ว</div></div></div>').join("")+
         rfaLate.concat(rfaDue).slice(0,4).map(r=>{
          const st=rfaState(r), dl=rfaDeadline(r);
          return '<div class="tk go" role="button" tabindex="0" data-go="rfa#rfa:'+r.id+'"><span class="pill '+st+'">'+(st==="late"?"ต้องเร่ง":"รออนุมัติ")+'</span>'+
            '<div><div class="tk-t">'+esc(r.title||"")+(r.docNo?' · '+esc(r.docNo):'')+'</div>'+
            '<div class="tk-s">'+esc(r.trade||"")+(dl?' · ต้องอนุมัติภายใน '+thDate(dl):'')+'</div></div></div>';
         }).join("")) || '<div class="muted">ไม่มีงานค้างอนุมัติ</div>')+
      '</div></div>'+

    '</div>'+
  '</div>'+

  '<div class="card" style="margin-top:16px"><div class="card-h"><h3>ไทม์ไลน์สัญญาและการขยายเวลา</h3>'+
  '<span class="hint">อาคาร 3 ชั้น — บริษัท เอ พลัส แอสโซซิเอท จำกัด<br>'+
  '<button class="btn ghost sm" data-go="eot">ดูคำขอขยายเวลาทั้งหมด</button></span></div>'+
  '<div class="card-b">'+timelineHTML()+'</div></div>';
}
function timelineHTML(){
  const items=[];
  const mc = mainContract();
  const first=S.payments.filter(p=>p.paidDate && (!mc||p.contractId===mc.id))
                        .sort((a,b)=>a.paidDate.localeCompare(b.paidDate))[0];
  if(first) items.push({d:first.paidDate,t:"เริ่มต้นสัญญา / จ่ายงวดเซ็นสัญญา",b:"โอนงวดแรก "+money(paidNet(first))+" บาท",k:"milestone"});
  const base=mc;
  if(base&&base.endDate) items.push({d:base.endDate,t:"กำหนดแล้วเสร็จตามสัญญาเดิม",b:"ตามสัญญาก่อสร้างฉบับเดิม",k:"milestone"});
  S.eots.forEach(e=>{
    items.push({d:e.submitDate,t:"ยื่นขอขยายเวลาครั้งที่ "+e.no+" ("+e.docNo+")",
      b:"ขอ "+e.days+" วัน · "+e.status+(e.decisionDate?" "+thDate(e.decisionDate):"" )+" → สิ้นสุด "+thDate(e.newEnd),
      k:e.status==="อนุมัติแล้ว"?"done":"pending", go:e.id});
    items.push({d:e.newEnd,t:"กำหนดแล้วเสร็จหลังขยายครั้งที่ "+e.no,
      b:thDateFull(e.oldEnd)+" + "+e.days+" วัน"+(e.status==="รออนุมัติ"?" (ยังไม่ยืนยัน)":""),
      k:e.status==="อนุมัติแล้ว"?"done":"pending", go:e.id});
  });
  items.sort((a,b)=>(a.d||"").localeCompare(b.d||""));
  return '<div class="tl">'+items.map(i=>'<div class="tl-item '+i.k+(i.go?" go":"")+'"'+
    (i.go?' role="button" tabindex="0" data-go="eot#eot:'+i.go+'"':'')+'><div class="tl-date">'+thDateFull(i.d)+'</div>'+
    '<div class="tl-title">'+esc(i.t)+'</div><div class="tl-body">'+esc(i.b)+'</div></div>').join("")+'</div>';
}

/* ---------- payments ---------- */
function viewPay(){
  tools('<button class="btn" data-act="export-pay">ส่งออก CSV</button>'+
        '<button class="btn primary" data-act="new-pay">+ เพิ่มงวดงาน</button>');
  const f=S.filter;
  /* แถบหมายเหตุ: งวดที่เอกสารยังไม่ครบ */
  const gaps=S.payments.map(p=>({p,st:docState("payment",p)})).filter(g=>g.st.missing.length);
  const gapBar = gaps.length? '<div class="card notecard" style="margin-bottom:14px">'+
    '<div class="card-h"><h3>หมายเหตุ — เอกสารยังไม่ครบ '+gaps.length+' งวด</h3>'+
    '<span class="hint">ยังไม่จ่าย: ต้องมีใบเบิก + รายงานงวดงาน · จ่ายแล้ว: ต้องมีสลิปโอนเงินด้วย<br>'+
    'ถ้าใบเบิกกับรายงานอยู่ในเล่มเดียวกัน ให้เลือกประเภท “ใบเบิก + รายงาน (เล่มเดียว)” ตอนแนบไฟล์</span></div>'+
    '<div class="card-b" style="display:grid;gap:9px">'+
      gaps.slice(0,10).map(g=>{
        const c=contractOf(g.p);
        return '<div class="tk"><button class="clip" data-files="payment:'+g.p.id+'">แนบ</button>'+
          '<div><div class="tk-t">'+esc(c?c.code:"")+' · งวดที่ '+g.p.seq+' ('+esc(g.p.invoice||"—")+')</div>'+
          '<div class="tk-s">ขาด: '+esc(missingLabel("payment",g.p))+'</div></div></div>';
      }).join("")+
      (gaps.length>10?'<div class="muted" style="font-size:13px">และอีก '+(gaps.length-10)+' งวด</div>':'')+
    '</div></div>' : '';
  const filterBar=gapBar+'<div class="filters">'+
    '<select data-filter="contract"><option value="">ทุกสัญญา</option>'+
      S.contracts.map(c=>'<option value="'+c.id+'"'+(f.contract===c.id?" selected":"")+'>'+esc(c.code)+'</option>').join("")+'</select>'+
    '<select data-filter="status"><option value="">ทุกสถานะ</option>'+
      ["paid","due","late"].map(s=>'<option value="'+s+'"'+(f.status===s?" selected":"")+'>'+statusLabel(s)+'</option>').join("")+'</select>'+
    '<input type="search" data-filter="q" placeholder="ค้นหา เลขที่ใบเบิก / รายละเอียด" value="'+esc(f.q)+'">'+
    '</div>';
  const groups=S.contracts.filter(c=>!f.contract||c.id===f.contract).map(c=>{
    let rows=S.payments.filter(p=>p.contractId===c.id);
    if(f.status) rows=rows.filter(p=>pstatus(p)===f.status);
    if(f.q){ const q=f.q.toLowerCase();
      rows=rows.filter(p=>((p.invoice||"")+" "+(p.detail||"")).toLowerCase().includes(q)); }
    if(!rows.length) return "";
    const s=contractStats(c);
    return '<div class="card" style="margin-bottom:14px"><div class="card-h">'+
      '<h3>'+esc(c.code)+' — '+esc(c.name)+'</h3>'+
      '<span class="hint">'+esc(c.contractor)+' · สัญญา '+money(c.amount)+' บาท'+(c.vat?" · VAT "+c.vat+"%":" · ไม่มี VAT")+
      (c.retention?" · หักประกัน "+c.retention+"%":"")+'</span></div>'+
      '<div class="tablewrap"><table><thead><tr>'+
      '<th class="c">งวด</th><th>รายละเอียดงาน</th><th class="r">มูลค่างวด</th><th class="r">VAT</th>'+
      '<th class="r">หักประกัน</th><th class="r">ยอดจ่ายจริง</th><th>เลขที่ใบเบิก</th><th>วันที่เบิก</th>'+
      '<th>วันที่โอน</th><th class="c">สถานะ</th><th class="c">เอกสาร</th><th></th></tr></thead><tbody>'+
      rows.map(p=>{
        const st=pstatus(p), age=daysBetween(p.reqDate), n=filesFor("payment",p.id).length;
        return '<tr data-row="payment:'+p.id+'"><td data-l="งวดที่" class="c stripe '+st+' num">'+p.seq+'</td>'+
          '<td data-l="รายละเอียดงาน" style="min-width:250px">'+esc(p.detail)+(p.note?'<div class="muted" style="font-size:13px">'+esc(p.note)+'</div>':'')+'</td>'+
          '<td data-l="มูลค่างวด" class="r num">'+money(p.amount)+'</td><td data-l="VAT" class="r num">'+(p.vat?money(p.vat):'<span class="muted">—</span>')+'</td>'+
          '<td data-l="หักประกัน" class="r num">'+(p.retention?money(p.retention):'<span class="muted">—</span>')+'</td>'+
          '<td data-l="ยอดจ่ายจริง" class="r num" style="font-weight:600">'+money(paidNet(p))+'</td>'+
          '<td data-l="เลขที่ใบเบิก" class="num">'+esc(p.invoice||"—")+'</td><td data-l="วันที่เบิก" class="num">'+thDate(p.reqDate)+'</td>'+
          '<td data-l="วันที่โอน" class="num">'+(p.paidDate?thDate(p.paidDate):'<span class="muted">—</span>')+'</td>'+
          '<td data-l="สถานะ" class="c"><span class="pill '+st+'">'+statusLabel(st)+'</span>'+
          (st!=="paid"?'<div class="muted" style="font-size:12px;margin-top:3px">'+esc(dueNote(p)||((age!=null?age+" วันหลังยื่นเบิก":"")))+'</div>':'')+'</td>'+
          '<td data-l="เอกสาร" class="c"><div>'+docChip("payment",p)+'</div></td>'+
          '<td><div class="rowacts"><button class="btn ghost sm" data-edit="pay:'+p.id+'">แก้ไข</button>'+
          '<button class="btn ghost sm" data-del="pay:'+p.id+'">ลบ</button></div></td></tr>';
      }).join("")+
      (function(){
        const filtered = !!(f.status||f.q);
        const shownSum = rows.reduce((a,p)=>a+paidNet(p),0);
        const shownPaid = rows.filter(isPaid).reduce((a,p)=>a+paidNet(p),0);
        const shownDue  = shownSum-shownPaid;
        return '</tbody><tfoot><tr><td colspan="5" class="r" style="font-weight:600">'+
        (filtered? 'รวมเฉพาะที่แสดง ('+rows.length+' งวด)' : 'รวมของสัญญานี้')+'</td>'+
        '<td class="r num" style="font-weight:700">'+money(shownSum)+'</td>'+
        '<td colspan="3" class="muted">จ่ายแล้ว '+money(shownPaid)+' · ค้าง '+money(shownDue)+'</td>'+
        '<td colspan="3"></td></tr></tfoot></table></div></div>';
      })();
  }).join("");
  $("#view").innerHTML=filterBar+(groups||'<div class="card"><div class="empty">ไม่พบรายการตามเงื่อนไขที่เลือก</div></div>');
  if(S._focusQ){ const i=$('[data-filter="q"]'); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length); } S._focusQ=false; }
}

/* ---------- extras ---------- */
function viewExtra(){
  tools('<button class="btn primary" data-act="new-extra">+ เพิ่มรายการงานเพิ่ม</button>');
  const sum=S.extras.reduce((s,x)=>s+paidNet(x),0);
  const gross=S.extras.reduce((s,x)=>s+Number(x.amount||0),0);
  const disc=S.extras.reduce((s,x)=>s+Number(x.discount||0),0);
  $("#view").innerHTML='<div class="card"><div class="card-h"><h3>งานเพิ่มนอกสัญญา</h3>'+
    '<span class="hint">มูลค่างาน '+money(gross)+' − ส่วนลด '+money(disc)+' = จ่ายจริง '+money(sum)+' บาท</span></div>'+
    '<div class="tablewrap"><table><thead><tr><th>อาคาร</th><th>รายละเอียดงาน</th><th class="r">มูลค่างาน</th>'+
    '<th class="r">ส่วนลด</th><th class="r">ยอดจ่ายจริง</th><th>เลขที่ใบเบิก</th><th>วันที่เบิก</th><th>วันที่โอน</th>'+
    '<th class="c">สถานะ</th><th class="c">เอกสาร</th><th></th></tr></thead><tbody>'+
    (S.extras.length?S.extras.map(x=>{
      const st=pstatus(x), n=filesFor("extra",x.id).length;
      return '<tr data-row="extra:'+x.id+'"><td data-l="อาคาร" class="stripe '+st+'">'+esc(x.building)+'</td>'+
        '<td data-l="รายละเอียดงาน" style="min-width:260px">'+esc(x.detail)+(x.note?'<div class="muted" style="font-size:13px">'+esc(x.note)+'</div>':'')+'</td>'+
        '<td data-l="มูลค่างาน" class="r num">'+money(x.amount)+'</td><td data-l="ส่วนลด" class="r num">'+(x.discount?money(x.discount):'<span class="muted">—</span>')+'</td>'+
        '<td data-l="ยอดจ่ายจริง" class="r num" style="font-weight:600">'+money(paidNet(x))+'</td>'+
        '<td data-l="เลขที่ใบเบิก" class="num">'+esc(x.invoice||"—")+'</td><td data-l="วันที่เบิก" class="num">'+thDate(x.reqDate)+'</td>'+
        '<td data-l="วันที่โอน" class="num">'+(x.paidDate?thDate(x.paidDate):'<span class="muted">—</span>')+'</td>'+
        '<td data-l="สถานะ" class="c"><span class="pill '+st+'">'+statusLabel(st)+'</span></td>'+
        '<td data-l="เอกสาร" class="c"><div>'+docChip("extra",x)+'</div></td>'+
        '<td><div class="rowacts"><button class="btn ghost sm" data-edit="extra:'+x.id+'">แก้ไข</button>'+
        '<button class="btn ghost sm" data-del="extra:'+x.id+'">ลบ</button></div></td></tr>';
    }).join(""):'<tr><td colspan="11"><div class="empty">ยังไม่มีรายการงานเพิ่ม</div></td></tr>')+
    '</tbody></table></div></div>';
}

/* ---------- RFA approvals ---------- */
const RFA_LABEL = {idle:"ยังไม่ยื่น",due:"รออนุมัติ",late:"ต้องเร่ง",paid:"อนุมัติแล้ว"};
function viewRfa(){
  tools('<button class="btn" data-act="export-rfa">ส่งออก CSV</button>'+
        '<button class="btn primary" data-act="new-rfa">+ เพิ่มรายการขออนุมัติ</button>');
  const f=S.filter, today=todayISO();
  const trades=[...new Set(S.rfas.map(r=>r.trade).filter(Boolean))];
  let rows=S.rfas.slice();
  if(f.contract) rows=rows.filter(r=>r.trade===f.contract);
  if(f.status) rows=rows.filter(r=>rfaState(r)===f.status);
  if(f.q){ const q=f.q.toLowerCase();
    rows=rows.filter(r=>((r.title||"")+" "+(r.detail||"")+" "+(r.docNo||"")+" "+(r.brand||"")).toLowerCase().includes(q)); }
  const cnt=k=>S.rfas.filter(r=>rfaState(r)===k).length;

  $("#view").innerHTML=
  '<div class="grid kpis" style="margin-bottom:14px">'+
    '<div class="kpi"><div class="lab">รอผลอนุมัติ</div><div class="val">'+cnt("due")+'<small>รายการ</small></div>'+
      '<div class="note">ยื่นแล้วและยังไม่มีผลตอบกลับ</div></div>'+
    '<div class="kpi '+(cnt("late")?"bad":"")+'"><div class="lab">ต้องเร่ง</div><div class="val">'+cnt("late")+'<small>รายการ</small></div>'+
      '<div class="note">เลยวันครบกำหนดตอบ หรือเลยวันที่ต้องอนุมัติตาม lead time</div></div>'+
    '<div class="kpi"><div class="lab">ยังไม่ได้ยื่น</div><div class="val">'+cnt("idle")+'<small>รายการ</small></div>'+
      '<div class="note">หมวดงานที่ต้องเตรียมเอกสารขออนุมัติ</div></div>'+
    '<div class="kpi"><div class="lab">อนุมัติแล้ว</div><div class="val">'+cnt("paid")+'<small>รายการ</small></div>'+
      '<div class="note">สั่งผลิต/สั่งของได้</div></div>'+
  '</div>'+
  '<div class="filters">'+
    '<select data-filter="contract"><option value="">ทุกหมวดงาน</option>'+
      trades.map(t=>'<option value="'+esc(t)+'"'+(f.contract===t?" selected":"")+'>'+esc(t)+'</option>').join("")+'</select>'+
    '<select data-filter="status"><option value="">ทุกสถานะ</option>'+
      ["idle","due","late","paid"].map(k=>'<option value="'+k+'"'+(f.status===k?" selected":"")+'>'+RFA_LABEL[k]+'</option>').join("")+'</select>'+
    '<input type="search" data-filter="q" placeholder="ค้นหา หมวดงาน / เลขที่เอกสาร / ยี่ห้อ" value="'+esc(f.q)+'">'+
  '</div>'+
  '<div class="card"><div class="card-h"><h3>ทะเบียนงานขออนุมัติ</h3>'+
  '<span class="hint">วันที่ต้องอนุมัติ = วันที่ต้องใช้งาน − ระยะเวลาสั่งของ</span></div>'+
  '<div class="tablewrap"><table><thead><tr><th>หมวดงาน / เรื่องที่ขออนุมัติ</th><th>ประเภท</th>'+
  '<th>เลขที่เอกสาร</th><th>ยี่ห้อ / รุ่น</th><th>ผู้พิจารณา</th><th class="c">Lead time</th>'+
  '<th>ต้องใช้งาน</th><th>ต้องอนุมัติภายใน</th><th>ยื่น</th><th>ครบกำหนดตอบ</th>'+
  '<th class="c">สถานะ</th><th class="c">เอกสาร</th><th></th></tr></thead><tbody>'+
  (rows.length? rows.map(r=>{
    const st=rfaState(r), dl=rfaDeadline(r), n=filesFor("rfa",r.id).length;
    const lateDl = dl && dl<today && st!=="paid";
    return '<tr data-row="rfa:'+r.id+'"><td data-l="หมวดงาน" class="stripe '+(st==="idle"?"":st)+'" style="min-width:230px">'+
      '<div style="font-weight:600">'+esc(r.title||"—")+'</div>'+
      '<div class="muted" style="font-size:13.5px">'+esc(r.detail||"")+'</div>'+
      (r.note?'<div class="muted" style="font-size:13px">'+esc(r.note)+'</div>':'')+'</td>'+
      '<td data-l="ประเภท" style="font-size:13.5px">'+esc(r.category||"—")+'</td>'+
      '<td data-l="เลขที่เอกสาร" class="num">'+esc(r.docNo||"—")+'</td>'+
      '<td data-l="ยี่ห้อ / รุ่น" style="font-size:14px">'+(r.brand?esc(r.brand):'<span class="muted">—</span>')+'</td>'+
      '<td data-l="ผู้พิจารณา" style="font-size:14px">'+esc(r.reviewer||"—")+'</td>'+
      '<td data-l="Lead time" class="c num">'+(r.leadDays?r.leadDays+" วัน":'<span class="muted">—</span>')+'</td>'+
      '<td data-l="ต้องใช้งาน" class="num">'+(r.requiredOn?thDate(r.requiredOn):'<span class="muted">—</span>')+'</td>'+
      '<td data-l="ต้องอนุมัติภายใน" class="num" style="font-weight:600'+(lateDl?";color:var(--late)":"")+'">'+(dl?thDate(dl):'<span class="muted">—</span>')+'</td>'+
      '<td data-l="วันที่ยื่น" class="num">'+(r.submitDate?thDate(r.submitDate):'<span class="muted">—</span>')+'</td>'+
      '<td data-l="ครบกำหนดตอบ" class="num">'+(r.dueDate?thDate(r.dueDate):'<span class="muted">—</span>')+'</td>'+
      '<td data-l="สถานะ" class="c"><span class="pill '+(st==="idle"?"info":st)+'">'+esc(r.status||"—")+'</span>'+
        (r.decisionDate?'<div class="muted num" style="font-size:12.5px">'+thDate(r.decisionDate)+'</div>':'')+'</td>'+
      '<td data-l="เอกสาร" class="c"><div>'+docChip("rfa",r)+'</div></td>'+
      '<td><div class="rowacts"><button class="btn ghost sm" data-edit="rfa:'+r.id+'">แก้ไข</button>'+
      '<button class="btn ghost sm" data-del="rfa:'+r.id+'">ลบ</button></div></td></tr>';
  }).join("") : '<tr><td colspan="13"><div class="empty">ไม่พบรายการตามเงื่อนไขที่เลือก</div></td></tr>')+
  '</tbody></table></div></div>'+
  '<div class="card" style="margin-top:14px"><div class="card-b muted" style="font-size:14px;line-height:1.6">'+
  'รายการตั้งต้นเป็นโครงหมวดงานที่ต้องขออนุมัติตามลำดับงาน — เติมเลขที่เอกสาร RFA ยี่ห้อ/รุ่น วันที่ยื่น และวันที่ต้องใช้งานหน้างานได้เอง '+
  'ระบบจะคำนวณวันสุดท้ายที่ต้องได้รับอนุมัติจาก lead time ให้อัตโนมัติ และขึ้นเตือนในหน้าภาพรวมเมื่อใกล้หรือเลยกำหนด'+
  '</div></div>';
  if(S._focusQ){ const i=$('[data-filter="q"]'); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length); } S._focusQ=false; }
}

/* ---------- EOT ---------- */
function viewEot(){
  tools('<button class="btn primary" data-act="new-eot">+ บันทึกคำขอขยายเวลา</button>');
  let acc=0;
  const rows=S.eots.map(e=>{
    acc+=Number(e.days||0);
    const n=filesFor("eot",e.id).length, ok=e.status==="อนุมัติแล้ว";
    return '<tr data-row="eot:'+e.id+'"><td data-l="ครั้งที่" class="c stripe '+(ok?"paid":"due")+' num" style="font-weight:600">'+e.no+'</td>'+
      '<td data-l="เหตุผล / สาเหตุ" style="min-width:300px">'+esc(e.reason)+(e.note?'<div class="muted" style="font-size:13px">'+esc(e.note)+'</div>':'')+'</td>'+
      '<td data-l="เลขที่เอกสาร" class="num">'+esc(e.docNo)+'</td>'+
      '<td data-l="วันที่ยื่น" class="num">'+thDate(e.submitDate)+
      (e.eventDate?'<div class="muted" style="font-size:12px">เหตุเกิด '+thDate(e.eventDate)+
        ' · '+((daysBetween(e.eventDate,e.submitDate)||0)<=15?'<span style="color:var(--paid)">แจ้งใน 15 วัน ✓</span>':
        '<span style="color:var(--late)">เกิน 15 วัน ('+daysBetween(e.eventDate,e.submitDate)+' วัน)</span>')+'</div>':'')+'</td>'+
      '<td data-l="ขอขยาย (วัน)" class="c num" style="font-weight:600">'+e.days+'</td><td data-l="รวมสะสม" class="c num">'+acc+'</td>'+
      '<td data-l="สิ้นสุดเดิม" class="num">'+thDate(e.oldEnd)+'</td><td data-l="สิ้นสุดใหม่" class="num" style="font-weight:600">'+thDate(e.newEnd)+'</td>'+
      '<td data-l="สถานะ" class="c"><span class="pill '+(ok?"paid":"due")+'">'+esc(e.status)+'</span>'+
        (e.decisionDate?'<div class="muted num" style="font-size:12.5px">'+thDate(e.decisionDate)+'</div>':'')+'</td>'+
      '<td data-l="เอกสาร" class="c"><div>'+docChip("eot",e)+'</div></td>'+
      '<td><div class="rowacts"><button class="btn ghost sm" data-edit="eot:'+e.id+'">แก้ไข</button>'+
      '<button class="btn ghost sm" data-del="eot:'+e.id+'">ลบ</button></div></td></tr>';
  }).join("");
  const approved=S.eots.filter(e=>e.status==="อนุมัติแล้ว").reduce((s,e)=>s+Number(e.days||0),0);
  $("#view").innerHTML=
   '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>ทะเบียนคำขอขยายระยะเวลาก่อสร้าง</h3>'+
   '<span class="hint">อนุมัติแล้ว '+approved+' วัน · รวมที่ขอ '+acc+' วัน</span></div>'+
   '<div class="tablewrap"><table><thead><tr><th class="c">ครั้งที่</th><th>เหตุผล / สาเหตุความล่าช้า</th>'+
   '<th>เลขที่เอกสาร</th><th>วันที่ยื่น</th><th class="c">ขอขยาย (วัน)</th><th class="c">รวมสะสม</th>'+
   '<th>สิ้นสุดเดิม</th><th>สิ้นสุดใหม่</th><th class="c">สถานะ</th><th class="c">เอกสาร</th><th></th></tr></thead>'+
   '<tbody>'+(rows||'<tr><td colspan="11"><div class="empty">ยังไม่มีคำขอขยายเวลา</div></td></tr>')+'</tbody></table></div></div>'+
   '<div class="card"><div class="card-h"><h3>ไทม์ไลน์</h3></div><div class="card-b">'+timelineHTML()+'</div></div>';
}


/* ============================ นำเข้าเอกสารทั้งโฟลเดอร์ ============================ */
const MONTH_TO_CM = {"มิ.ย":4,"มิถุนายน":4,"ก.ค":5,"กรกฎาคม":5,"ส.ค":6,"สิงหาคม":6,"พ.ค":3,"พฤษภาคม":3,"เม.ย":2,"เมษายน":2,"มี.ค":1,"มีนาคม":1};
const normKey = t => String(t||"").toUpperCase().replace(/[\s_\/\-.]/g,"");
function targets(){
  const out=[];
  S.contracts.forEach(c=>out.push({v:"contract:"+c.id,t:"สัญญา · "+c.code}));
  S.contracts.forEach(c=>S.payments.filter(p=>p.contractId===c.id).forEach(p=>
    out.push({v:"payment:"+p.id,t:c.code+" · งวดที่ "+p.seq+" ("+(p.invoice||"—")+")"})));
  S.extras.forEach(x=>out.push({v:"extra:"+x.id,t:"งานเพิ่ม · "+x.building+" ("+(x.invoice||"—")+")"}));
  S.rfas.forEach(r=>out.push({v:"rfa:"+r.id,t:"ขออนุมัติ · "+(r.title||"")}));
  S.eots.forEach(e=>out.push({v:"eot:"+e.id,t:"ขยายเวลาครั้งที่ "+e.no+" ("+e.docNo+")"}));
  return out;
}
function planFile(name){
  const n=name, low=n.toLowerCase(), isImg=/\.(jpe?g|png|heic|webp)$/i.test(n);
  const isSlip=/slip|สลิป/i.test(n);
  const pick=(rt,id,dt)=>({rt,id,dt});
  let m;
  /* สัญญาก่อสร้าง */
  if(/สัญญาก่อสร้าง/.test(n)){
    const c=/3[-\s]?ชั้น/.test(n)?"c2":/2[-\s]?ชั้น/.test(n)?"c1":null;
    if(c) return pick("contract",c,"contract");
  }
  /* ขอขยายระยะเวลา */
  if((m=n.match(/ขอขยายระยะเวลา.*?ครั้งที่\s*(\d+)/))){
    const e=S.eots.find(x=>String(x.no)===m[1]); if(e) return pick("eot",e.id,"letter");
  }
  /* งานเพิ่ม (PPH-04) */
  if(/งานเพิ่ม|PPH[-_ ]?0?4[^0-9]/i.test(n)){
    const x=S.extras[0]; if(x) return pick("extra",x.id,isSlip||isImg?"slip":"invoice");
  }
  /* รายงานประจำเดือนของ CM */
  if(/รายงานประจำเดือน/.test(n)){
    const key=Object.keys(MONTH_TO_CM).find(k=>n.includes(k));
    const c3=S.contracts.find(c=>/CM/i.test(c.code));
    if(key&&c3){ const p=S.payments.find(p=>p.contractId===c3.id&&p.seq===MONTH_TO_CM[key]);
      if(p) return pick("payment",p.id,"report"); }
  }
  /* จับจากเลขที่ใบเบิกที่มีอยู่จริงในระบบ */
  const nk=normKey(n);
  for(const p of S.payments){
    const inv=normKey(p.invoice); if(!inv||inv.length<5) continue;
    const short=inv.replace(/([A-Z]+)0*(\d+)/,"$1$2");
    if(nk.includes(inv)||nk.includes(short)) return pick("payment",p.id,isSlip||isImg?"slip":"invoice");
  }
  /* อาคาร 2/3 ชั้น + เบิกงวด N */
  if((m=n.match(/อาคาร[-\s]?([23])[-\s]?ชั้น[\s\S]*?งวด[-\s]?(\d+)/))||
     (m=n.match(/งวด[-\s]?(\d+)[\s\S]*?อาคาร[-\s]?([23])[-\s]?ชั้น/))&&(m=[m[0],m[2],m[1]])){
    const cid=m[1]==="2"?"c1":"c2";
    const p=S.payments.find(p=>p.contractId===cid&&p.seq===Number(m[2]));
    if(p) return pick("payment",p.id,isSlip||isImg?"slip":"invoice");
  }
  /* CM-P92 งวด N */
  if(/CM[-\s]?P?92/i.test(n)&&(m=n.match(/งวด\s?(\d+)/))){
    const c3=S.contracts.find(c=>/CM/i.test(c.code));
    const p=c3&&S.payments.find(p=>p.contractId===c3.id&&p.seq===Number(m[1]));
    if(p) return pick("payment",p.id, /ใบเสร็จ|ใบกำกับภาษี/.test(n)?"receipt":(isSlip||isImg?"slip":"invoice"));
  }
  /* ใบสรุปเอกสารประกอบการเบิก */
  if(/สรุปเอกสารเบิก/.test(n)&&(m=n.match(/งวดที่\s*(\d+)\s*ตึก\s*3/))){
    const p=S.payments.find(p=>p.contractId==="c2"&&p.seq===Number(m[1]));
    if(p) return pick("payment",p.id,"other");
  }
  /* เอกสารลิฟต์ */
  if(/lift|ลิฟต์|schneider|mrl/i.test(n)){
    const r=S.rfas.find(r=>/ลิฟต์/.test(r.trade||r.title||"")); 
    if(r) return pick("rfa",r.id, /spec|สเปค/i.test(n)?"spec":/rev|drawing|group/i.test(n)?"drawing":"other");
  }
  return {rt:"",id:"",dt:"other"};
}
function viewImport(){
  tools('<button class="btn" data-act="imp-pick">เลือกไฟล์</button>'+
        '<button class="btn primary" data-act="imp-folder">เลือกทั้งโฟลเดอร์</button>');
  const rows=S.imp||[];
  const opts=targets();
  const ready=rows.filter(r=>r.rt&&!r.done&&!r.tooBig);
  $("#view").innerHTML=
   '<input type="file" id="impFiles" multiple hidden><input type="file" id="impDir" webkitdirectory directory multiple hidden>'+
   (rows.length? '' : '<div class="card" style="margin-bottom:16px"><div class="card-b" style="line-height:1.8">'+
     '<h3 style="margin-bottom:6px">นำเข้าเอกสารครั้งละหลายไฟล์</h3>'+
     '<p class="muted">กด “เลือกทั้งโฟลเดอร์” แล้วเลือกโฟลเดอร์ที่เก็บเอกสารโครงการ ระบบจะอ่านชื่อไฟล์ '+
     'แล้วจับคู่กับงวดงาน สัญญา งานเพิ่ม คำขอขยายเวลา และรายการขออนุมัติให้อัตโนมัติ '+
     'พร้อมเดาว่าเป็นใบเบิก รายงาน หรือสลิปโอนเงิน — ตรวจแล้วแก้ได้ก่อนกดอัปโหลด</p></div></div>')+
   (rows.length?
   '<div class="card"><div class="card-h"><h3>ตรวจก่อนอัปโหลด</h3>'+
   '<span class="hint">'+rows.length+' ไฟล์ · จับคู่ได้ '+rows.filter(r=>r.rt).length+' · '+
   'อัปโหลดแล้ว '+rows.filter(r=>r.done).length+'</span></div>'+
   '<div class="tablewrap"><table><thead><tr><th>ชื่อไฟล์</th><th class="r">ขนาด</th>'+
   '<th>แนบเข้ากับ</th><th>ประเภท</th><th class="c">สถานะ</th></tr></thead><tbody>'+
   rows.map((r,i)=>{
     const dts=DOC_TYPES[r.rt]||DOC_TYPES.payment;
     return '<tr><td data-l="ชื่อไฟล์">'+esc(r.file.name)+'</td>'+
       '<td data-l="ขนาด" class="r num'+(r.tooBig?' agelate':'')+'">'+bytes(r.file.size)+'</td>'+
       '<td data-l="แนบเข้ากับ"><select data-imp="'+i+'" data-f="rt"><option value="">— ยังไม่จับคู่ —</option>'+
         opts.map(o=>'<option value="'+o.v+'"'+((r.rt+":"+r.id)===o.v?" selected":"")+'>'+esc(o.t)+'</option>').join("")+'</select></td>'+
       '<td data-l="ประเภท"><select data-imp="'+i+'" data-f="dt">'+
         dts.map(d=>'<option value="'+d[0]+'"'+(r.dt===d[0]?" selected":"")+'>'+esc(d[1])+'</option>').join("")+'</select></td>'+
       '<td data-l="สถานะ" class="c">'+(r.done?'<span class="pill paid">อัปโหลดแล้ว</span>':
          r.tooBig?'<span class="pill late">ไฟล์ใหญ่เกิน</span>':
          r.err?'<span class="pill late">'+esc(r.err)+'</span>':
          r.rt?'<span class="pill due">พร้อมอัปโหลด</span>':'<span class="pill info">ต้องเลือกเอง</span>')+'</td></tr>';
   }).join("")+
   '</tbody></table></div>'+
   '<div class="card-b" style="display:flex;gap:10px;align-items:center;justify-content:flex-end;border-top:1px solid var(--line)">'+
   '<span class="muted" id="impMsg">พร้อมอัปโหลด '+ready.length+' ไฟล์</span>'+
   '<button class="btn primary" data-act="imp-run"'+(ready.length?'':' disabled')+'>อัปโหลด '+ready.length+' ไฟล์</button>'+
   '</div></div>' : '');
  const fi=$("#impFiles"), di=$("#impDir");
  const take=list=>{
    S.imp=[...list].filter(f=>!/^\./.test(f.name)&&!/\.(ds_store)$/i.test(f.name)).map(f=>{
      const g=planFile(f.webkitRelativePath||f.name);
      return {file:f, rt:g.rt, id:g.id, dt:g.dt, tooBig:f.size>MAX_FILE, done:false, err:""};
    });
    renderAll();
  };
  if(fi) fi.onchange=()=>take(fi.files);
  if(di) di.onchange=()=>take(di.files);
}
async function runImport(){
  const rows=(S.imp||[]).filter(r=>r.rt&&!r.done&&!r.tooBig);
  const msg=$("#impMsg");
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(msg) msg.textContent="กำลังอัปโหลด "+(i+1)+"/"+rows.length+" — "+r.file.name;
    const dup=S.files.some(f=>f.refType===r.rt&&f.refId===r.id&&f.name===r.file.name);
    if(dup){ r.done=true; r.err=""; continue; }
    try{ await Store.uploadFile(r.file, r.rt, r.id, r.dt); r.done=true; r.err=""; }
    catch(e){ r.err=(e.message||String(e)).slice(0,60); }
  }
  await refresh();
  const ok=(S.imp||[]).filter(r=>r.done).length;
  toast("อัปโหลดสำเร็จ "+ok+" ไฟล์");
  renderAll();
}

/* ---------- docs ---------- */
function viewDocs(){
  tools('<button class="btn" data-view="import">นำเข้าเอกสารทั้งโฟลเดอร์</button>');
  const f=S.filter, today=todayISO();
  const REF_LABEL={payment:"งวดงาน",extra:"งานเพิ่ม",rfa:"งานขออนุมัติ",eot:"ขอขยายเวลา",contract:"สัญญา"};

  /* ชื่อรายการที่ไฟล์ผูกอยู่ */
  const refInfo=f=>{
    if(f.refType==="payment"){ const p=S.payments.find(x=>x.id===f.refId); const c=p&&contractOf(p);
      return p?{group:(c?c.code:"—")+" · งวดที่ "+p.seq, sub:(p.invoice||"")+" · "+String(p.detail||"").slice(0,60), key:"payment:"+p.id}
              :{group:"งวดงานที่ถูกลบ",sub:"",key:"x"}; }
    if(f.refType==="extra"){ const x=S.extras.find(v=>v.id===f.refId);
      return x?{group:"งานเพิ่ม · "+x.building, sub:x.invoice||"", key:"extra:"+x.id}:{group:"งานเพิ่มที่ถูกลบ",sub:"",key:"x"}; }
    if(f.refType==="rfa"){ const r=S.rfas.find(v=>v.id===f.refId);
      return r?{group:"ขออนุมัติ · "+(r.title||""), sub:(r.docNo||"")+" "+(r.brand||""), key:"rfa:"+r.id}:{group:"รายการขออนุมัติที่ถูกลบ",sub:"",key:"x"}; }
    if(f.refType==="eot"){ const e=S.eots.find(v=>v.id===f.refId);
      return e?{group:"ขอขยายเวลา ครั้งที่ "+e.no, sub:e.docNo||"", key:"eot:"+e.id}:{group:"คำขอที่ถูกลบ",sub:"",key:"x"}; }
    if(f.refType==="contract"){ const c=S.contracts.find(v=>v.id===f.refId);
      return c?{group:"สัญญา · "+c.code, sub:c.contractor||"", key:"contract:"+c.id}:{group:"สัญญาที่ถูกลบ",sub:"",key:"x"}; }
    return {group:"อื่นๆ",sub:"",key:"x"};
  };

  /* กรอง */
  let list=S.files.slice();
  if(f.contract) list=list.filter(x=>x.refType===f.contract);
  if(f.status)   list=list.filter(x=>(x.docType||"other")===f.status);
  if(f.q){ const q=f.q.toLowerCase();
    list=list.filter(x=>((x.name||"")+" "+refInfo(x).group+" "+refInfo(x).sub).toLowerCase().includes(q)); }

  /* สรุปหัวหน้า */
  const totalSize=S.files.reduce((s,x)=>s+Number(x.size||0),0);
  const links=S.files.filter(x=>x.url).length;
  const byType={}; S.files.forEach(x=>{const t=x.docType||"other"; byType[t]=(byType[t]||0)+1;});
  const typeOptions=[...new Set(S.files.map(x=>x.docType||"other"))];
  const refCounts={}; S.files.forEach(x=>{refCounts[x.refType]=(refCounts[x.refType]||0)+1;});

  /* จัดกลุ่มตามรายการที่ผูก */
  const groups=new Map();
  list.forEach(x=>{
    const info=refInfo(x);
    if(!groups.has(info.key)) groups.set(info.key,{info,files:[]});
    groups.get(info.key).files.push(x);
  });
  const order=["payment","extra","rfa","eot","contract"];
  const sorted=[...groups.values()].sort((a,b)=>{
    const ta=order.indexOf(a.files[0].refType), tb=order.indexOf(b.files[0].refType);
    return ta-tb || a.info.group.localeCompare(b.info.group,"th");
  });

  const fileRow=x=>{
    const m=docMeta(x.refType,x.docType||"other");
    return '<div class="drow">'+
      '<span class="dtype" title="'+esc(m[1])+'">'+esc(m[2])+'</span>'+
      '<div class="dinfo"><div class="dname">'+esc(x.name)+'</div>'+
      '<div class="dmeta">'+esc(m[1])+' · '+(x.url?"ลิงก์ภายนอก":bytes(x.size))+' · แนบเมื่อ '+thDate((x.createdAt||"").slice(0,10))+'</div></div>'+
      '<div class="dacts"><button class="btn ghost sm" data-dl="'+x.id+'">เปิด</button>'+
      '<button class="btn ghost sm" data-rmfile="'+x.id+'">ลบ</button></div></div>';
  };

  $("#view").innerHTML=
    '<div class="grid kpis" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(235px,1fr))">'+
      '<div class="kpi lead"><div class="lab">เอกสารทั้งหมด</div><div class="val">'+S.files.length+'<small>ไฟล์</small></div>'+
      '<div class="note">ขนาดรวม '+bytes(totalSize)+(links?' · ลิงก์ภายนอก '+links+' รายการ':'')+'</div></div>'+
      '<div class="kpi"><div class="lab">ผูกกับงวดงาน</div><div class="val">'+(refCounts.payment||0)+'<small>ไฟล์</small></div>'+
      '<div class="note">ใบเบิก รายงาน และสลิปโอนเงิน</div></div>'+
      '<div class="kpi"><div class="lab">สัญญา · งานเพิ่ม</div><div class="val">'+((refCounts.contract||0)+(refCounts.extra||0))+'<small>ไฟล์</small></div>'+
      '<div class="note">เอกสารสัญญาและงานนอกสัญญา</div></div>'+
      '<div class="kpi"><div class="lab">อนุมัติ · ขยายเวลา</div><div class="val">'+((refCounts.rfa||0)+(refCounts.eot||0))+'<small>ไฟล์</small></div>'+
      '<div class="note">RFA และคำขอขยายระยะเวลา</div></div>'+
    '</div>'+

    '<div class="filters">'+
      '<select data-filter="contract"><option value="">ทุกหมวด</option>'+
        Object.keys(REF_LABEL).filter(k=>refCounts[k]).map(k=>'<option value="'+k+'"'+(f.contract===k?" selected":"")+'>'+
          REF_LABEL[k]+' ('+refCounts[k]+')</option>').join("")+'</select>'+
      '<select data-filter="status"><option value="">ทุกประเภทเอกสาร</option>'+
        typeOptions.map(t=>{const anyF=S.files.find(x=>(x.docType||"other")===t);
          return '<option value="'+t+'"'+(f.status===t?" selected":"")+'>'+esc(docMeta(anyF.refType,t)[1])+' ('+byType[t]+')</option>';}).join("")+'</select>'+
      '<input type="search" data-filter="q" placeholder="ค้นหาชื่อไฟล์ / งวด / เลขที่เอกสาร" value="'+esc(f.q)+'">'+
      (f.contract||f.status||f.q?'<button class="btn ghost sm" data-act="docs-clear">ล้างตัวกรอง</button>':'')+
    '</div>'+

    (S.files.length===0?
      '<div class="card"><div class="empty" style="padding:60px 20px">ยังไม่มีเอกสารในระบบ<br>'+
      '<span style="font-size:13px">แนบได้จากปุ่มในแต่ละรายการ หรือกด “นำเข้าเอกสารทั้งโฟลเดอร์” มุมขวาบนเพื่ออัปโหลดครั้งละหลายไฟล์</span></div></div>'
     : sorted.length===0?
      '<div class="card"><div class="empty">ไม่พบเอกสารตามเงื่อนไขที่เลือก</div></div>'
     : sorted.map(g=>
        '<div class="card docgroup"><div class="card-h">'+
        '<div><h3>'+esc(g.info.group)+'</h3>'+(g.info.sub?'<div class="muted" style="font-size:12.5px">'+esc(g.info.sub)+'</div>':'')+'</div>'+
        '<span class="hint">'+g.files.length+' ไฟล์ · '+
        '<button class="btn ghost sm" data-files="'+g.info.key+'">จัดการเอกสาร</button></span></div>'+
        '<div class="card-b" style="padding:6px 16px 12px">'+g.files.map(fileRow).join("")+'</div></div>').join(""));

  if(S._focusQ){ const i=$('[data-filter="q"]'); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length); } S._focusQ=false; }
}

/* ---------- setup ---------- */
function viewSetup(){
  tools('<button class="btn primary" data-act="new-contract">+ เพิ่มสัญญา</button>');
  $("#view").innerHTML='<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">'+
    S.contracts.map(c=>{
      const s=contractStats(c);
      return '<div class="card"><div class="card-h"><h3>'+esc(c.code)+'</h3>'+
      '<button class="btn ghost sm" data-edit="contract:'+c.id+'">แก้ไข</button></div><div class="card-b">'+
      '<div style="font-weight:600">'+esc(c.name)+'</div>'+
      '<div class="muted" style="font-size:14px;margin-bottom:10px">'+esc(c.contractor)+'</div>'+
      '<div class="ctr-figs" style="margin:0 0 10px"><span>เนื้องานตามสัญญา <b>'+money(c.amount)+'</b></span>'+
      (c.vat?'<span>รวม VAT <b>'+money(contractTotal(c))+'</b></span>':'')+
      '<span>จำนวนงวด <b>'+(c.periods||"—")+'</b></span>'+
      '<span>VAT <b>'+(c.vat?c.vat+"%":"ไม่มี")+'</b></span>'+
      '<span>หักประกัน <b>'+(c.retention?c.retention+"%":"ไม่มี")+'</b></span></div>'+
      '<div class="bar"><span style="width:'+s.pct.toFixed(1)+'%"></span></div>'+
      '<div class="muted" style="font-size:13.5px;margin-top:6px">เนื้องานที่เบิกแล้ว '+money(s.base)+
      ' บาท · คงเหลือ '+money(s.rest)+' บาท ('+s.pct.toFixed(0)+'%)</div>'+
      (c.endDate?'<div style="font-size:14px;margin-top:8px">กำหนดแล้วเสร็จตามสัญญา <b class="num">'+thDateFull(c.endDate)+'</b></div>':'')+
      (c.dueDay?'<div style="font-size:14px;margin-top:4px">ครบกำหนดจ่ายทุกวันที่ <b class="num">'+esc(c.dueDay)+'</b> ของเดือน</div>':'')+
      ((c.inspectDays||c.payDays)?'<div style="font-size:14px;margin-top:4px">ตรวจงานภายใน <b class="num">'+esc(c.inspectDays||"—")+
        '</b> วันทำการ · จ่ายภายใน <b class="num">'+esc(c.payDays||"—")+'</b> วันทำการหลังรับรองผลตรวจ</div>':'')+
      (c.startDate?'<div style="font-size:14px;margin-top:4px">เริ่มงาน <b class="num">'+thDateFull(c.startDate)+'</b>'+
        (c.durationDays?' · ระยะเวลา <b class="num">'+esc(c.durationDays)+'</b> วัน':'')+'</div>':'')+
      (c.penaltyDay?'<div style="font-size:14px;margin-top:4px">ค่าปรับล่าช้า <b class="num">'+money(c.penaltyDay)+'</b> บาท/วัน</div>':'')+
      '<div class="ctr-terms">'+
        '<div><span>เงินประกันผลงานที่หักแล้ว</span><b class="num">'+money(s.retention)+' บาท</b></div>'+
        '<div><span>กำหนดคืนเงินประกัน</span><b class="num">'+(retentionDue(c)?thDateFull(retentionDue(c)):"รอส่งมอบงาน")+'</b></div>'+
        '<div><span>ประกันงานโครงสร้าง 5 ปี</span><b class="num">'+(warrantyEnd(c,5)?thDateFull(warrantyEnd(c,5)):"รอส่งมอบงาน")+'</b></div>'+
        '<div><span>ประกันงานสถาปัตย์/ระบบ 1 ปี</span><b class="num">'+(warrantyEnd(c,1)?thDateFull(warrantyEnd(c,1)):"รอส่งมอบงาน")+'</b></div>'+
      '</div>'+
      ((c.employer||c.employerRep)?'<div class="muted" style="font-size:12.5px;margin-top:8px">ผู้ว่าจ้าง: '+esc(c.employer||"—")+
        (c.employerRep?' · ตัวแทน: '+esc(c.employerRep):'')+'</div>':'')+
      '<div style="font-size:13.5px;color:var(--ink-3);margin-top:8px;line-height:1.5">'+esc(c.bank||"")+'</div>'+
      '<div class="ctr-docs">'+docChip("contract",c)+
      '<button class="clip" data-files="contract:'+c.id+'">เอกสารสัญญา'+
      (filesFor("contract",c.id).length?' · '+filesFor("contract",c.id).length+' ไฟล์':' — ยังไม่มี')+'</button></div>'+
      '</div></div>';
    }).join("")+'</div>';
}

/* ---------- ผู้ใช้งาน (เฉพาะแอดมิน) ---------- */
async function loadMembers(){
  try{ const r = await Store.listMembers(); S.members = r.members||[]; S.me = r.me||""; S.usersErr=""; S.usersDiag=null; }
  catch(e){
    S.members=[]; S.usersErr = e.message||"โหลดรายชื่อไม่สำเร็จ";
    /* ตรวจการตั้งค่าให้เลยทันที ไม่ต้องรอให้ผู้ใช้ไปหาปุ่มเอง */
    try{ S.usersDiag = await Store.diagUsers(); }catch(err){ S.usersDiag = null; }
  }
  try{ S.acts = await Store.readActivity(300, S.actUser||""); S.actErr=""; }
  catch(e){ S.acts=[]; S.actErr = "ยังไม่ได้สร้างตารางประวัติ — รัน supabase/migration-2026-09-activity.sql"; }
}
const ACT_LABEL = {create:"เพิ่ม", update:"แก้ไข", delete:"ลบ", upload:"แนบไฟล์",
                   link:"แนบลิงก์", unlink:"ลบไฟล์", login:"เข้าสู่ระบบ"};
const ACT_CLASS = {create:"paid", update:"info", delete:"late", upload:"info", link:"info",
                   unlink:"due", login:"info"};
function whenText(iso){
  if(!iso) return "—";
  const d=new Date(iso); if(isNaN(d)) return iso;
  const mins=Math.round((Date.now()-d.getTime())/60000);
  const clock=String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
  if(mins<1) return "เมื่อครู่";
  if(mins<60) return mins+" นาทีที่แล้ว";
  if(mins<1440) return Math.round(mins/60)+" ชั่วโมงที่แล้ว · "+clock;
  return thDate(isoLocal(d))+" · "+clock;
}
/* ผลตรวจการตั้งค่า /api/users — แปลเป็นภาษาคนพร้อมบอกว่าต้องแก้ตรงไหน */
function diagHtml(d){
  const row = (ok,label,detail) =>
    '<div class="dgrow '+(ok===true?"ok":ok===false?"bad":"unk")+'">'+
      '<i>'+(ok===true?"✓":ok===false?"✕":"—")+'</i>'+
      '<div><b>'+esc(label)+'</b>'+(detail?'<small>'+esc(detail)+'</small>':'')+'</div></div>';

  const items = [];
  items.push(row(!!d.url.set, "SUPABASE_URL ใน Vercel",
    d.url.set ? "ชี้ไปที่ "+d.url.host : "ยังไม่ได้ตั้งค่า"));
  items.push(row(d.key.set ? !!d.key.ok : false, "SUPABASE_SERVICE_ROLE_KEY ใน Vercel",
    d.key.set ? d.key.kind+" · ยาว "+d.key.length+" ตัว" : "ยังไม่ได้ตั้งค่า"));
  if(d.match !== null)
    items.push(row(d.match, "URL ตรงกับโปรเจกต์ที่หน้าเว็บล็อกอินอยู่",
      d.match ? "ทั้งสองฝั่งคือ "+d.url.host
              : "Vercel ชี้ "+d.url.host+" แต่หน้าเว็บล็อกอินที่ "+d.token.host));
  if(d.keyAlone)
    items.push(row(!!d.keyAlone.ok, "คีย์เรียก Supabase Admin API ได้ (ทดสอบคีย์เดี่ยวๆ)",
      d.keyAlone.ok ? "คีย์ใช้งานได้จริง"
        : "ตอบกลับ "+(d.keyAlone.status||"เชื่อมต่อไม่ได้")+(d.keyAlone.detail?" · "+d.keyAlone.detail:"")));
  items.push(row(d.token.sent ? (d.token.expired===true ? false : true) : false,
    "โทเคนผู้ใช้ที่หน้าเว็บส่งมา",
    !d.token.sent ? "ยังไม่ได้ล็อกอิน หรือเซสชันหลุด"
      : d.token.expired===true ? "หมดอายุแล้ว"
      : "ยังไม่หมดอายุ"+(d.token.role?" · role "+d.token.role:"")));
  if(d.auth)
    items.push(row(!!d.auth.ok, "Supabase ยอมรับคีย์+โทเคนคู่กัน",
      d.auth.ok ? "" : "ตอบกลับ "+(d.auth.status||"เชื่อมต่อไม่ได้")+(d.auth.detail?" · "+d.auth.detail:"")));
  if(d.members)
    items.push(row(!!d.members.found, "บัญชีคุณอยู่ในตาราง nm74.members",
      d.members.found ? "สิทธิ์: "+(d.members.role==="admin"?"แอดมิน":d.members.role)
        : (d.members.error ? "อ่านตารางไม่ได้ · "+d.members.error
                           : "ยังไม่มีแถวของบัญชีนี้")));

  /* บอกขั้นตอนถัดไปข้อเดียว — ข้อแรกที่ยังไม่ผ่าน */
  let next = "";
  if(!d.url.set || !d.key.set)
    next = "ไปที่ Vercel → Settings → Environment Variables ใส่ค่าที่ขาด ติ๊กครบทั้ง 3 environment แล้ว deploy ใหม่หนึ่งครั้ง";
  else if(!d.key.ok)
    next = "คีย์ผิดชนิด — เอาจาก Supabase → Settings → API Keys หัวข้อ Secret keys (ขึ้นต้น sb_secret_) ไม่ใช่ Publishable key แล้ว deploy ใหม่";
  else if(d.match === false)
    next = "SUPABASE_URL ใน Vercel ชี้คนละโปรเจกต์กับ config.js แก้ให้เป็น https://"+d.token.host+" แล้ว deploy ใหม่";
  else if(!d.token.sent)
    next = "ออกจากระบบแล้วล็อกอินใหม่";
  else if(d.keyAlone && !d.keyAlone.ok)
    next = "คีย์ถูกชนิดแต่ Supabase ไม่รับ (ตอบ "+d.keyAlone.status+") — คีย์อาจถูก revoke ไปแล้ว "+
           "หรือคัดลอกไม่ครบ · สร้างคีย์ใหม่ที่ Supabase → Settings → API Keys → Secret keys "+
           "แล้ววางใหม่ใน Vercel และ deploy อีกครั้ง";
  else if(d.token.expired===true)
    next = "โทเคนหมดอายุจริง — ออกจากระบบแล้วล็อกอินใหม่";
  else if(d.auth && !d.auth.ok)
    next = "คีย์ใช้ได้และโทเคนยังไม่หมดอายุ แต่ Supabase ปฏิเสธเมื่อใช้คู่กัน (ตอบ "+d.auth.status+") — "+
           "ส่งข้อความในบรรทัดสีแดงให้ผมดูได้เลย";
  else if(d.members && !d.members.found)
    next = d.members.error
      ? "รัน supabase/setup-all.sql ใน Supabase → SQL Editor และเช็ค Settings → API → Exposed schemas ว่ามี nm74"
      : "รัน setup-all.sql ส่วนที่ 2 เพื่อตั้งบัญชีคุณเป็นแอดมินคนแรก (แก้อีเมลในไฟล์ให้ตรงกับบัญชีที่ใช้ก่อนรัน)";
  else if(d.members && d.members.found && d.members.role !== "admin")
    next = "บัญชีนี้เป็น "+d.members.role+" ให้แอดมินคนอื่นเปลี่ยนสิทธิ์ให้ หรือแก้ role ในตาราง members";
  else
    next = "ทุกอย่างผ่านแล้ว — กดรีเฟรชหน้าอีกครั้ง";

  return '<div class="diag">'+items.join("")+
    '<div class="dgnext"><b>ต้องทำต่อ</b> '+esc(next)+'</div></div>';
}

function viewUsers(){
  tools('<button class="btn primary" data-act="new-user">+ เพิ่มผู้ใช้</button>');
  const rows = S.members||[];
  const admins = rows.filter(m=>m.role==="admin").length;

  if(S.usersErr){
    $("#view").innerHTML =
      '<div class="card notecard"><div class="card-h"><h3>ยังใช้งานหน้านี้ไม่ได้</h3></div>'+
      '<div class="card-b" style="line-height:1.75">'+
      '<p style="margin:0 0 12px">'+esc(S.usersErr)+'</p>'+
      (S.usersDiag ? diagHtml(S.usersDiag) :
        '<p class="muted" style="margin:0 0 12px">ตรวจการตั้งค่าอัตโนมัติไม่สำเร็จ — '+
        'อาจยังไม่ได้ deploy เวอร์ชันล่าสุด</p>')+
      '<div style="margin-top:12px"><button class="btn ghost sm" data-act="diag-users">ตรวจอีกครั้ง</button></div>'+
      '</div></div>';
    return;
  }

  $("#view").innerHTML =
  '<div class="card"><div class="card-h"><h3>ผู้ใช้งานระบบ</h3>'+
  '<span class="hint"><b>'+rows.length+'</b> คน · แอดมิน <b>'+admins+'</b></span></div>'+
  '<div class="tablewrap"><table><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ-สกุล</th>'+
  '<th class="c">สิทธิ์</th><th>เข้าล่าสุด</th><th>เพิ่มเมื่อ</th><th>หมายเหตุ</th><th></th></tr></thead><tbody>'+
  (rows.length? rows.map(m=>{
    const isMe = m.userId===S.me;
    return '<tr data-row="user:'+esc(m.userId)+'">'+
      '<td data-l="ชื่อผู้ใช้" class="stripe '+(m.role==="admin"?"paid":"")+' num" style="font-weight:600">'+
        esc(m.username)+(isMe?' <span class="muted" style="font-weight:400;font-size:12.5px">(คุณ)</span>':'')+'</td>'+
      '<td data-l="ชื่อ-สกุล">'+(m.name?esc(m.name):'<span class="muted">—</span>')+'</td>'+
      '<td data-l="สิทธิ์" class="c"><span class="pill '+(m.role==="admin"?"paid":"info")+'">'+
        (m.role==="admin"?"แอดมิน":"ผู้ใช้ทั่วไป")+'</span></td>'+
      '<td data-l="เข้าล่าสุด" class="num">'+(m.lastSignIn?thDate(String(m.lastSignIn).slice(0,10)):'<span class="muted">ยังไม่เคยเข้า</span>')+'</td>'+
      '<td data-l="เพิ่มเมื่อ" class="num">'+thDate(String(m.createdAt||"").slice(0,10))+'</td>'+
      '<td data-l="หมายเหตุ" style="font-size:13.5px">'+(m.note?esc(m.note):'<span class="muted">—</span>')+'</td>'+
      '<td><div class="rowacts">'+
        '<button class="btn ghost sm" data-usrlog="'+esc(m.userId)+'">ประวัติ</button>'+
        '<button class="btn ghost sm" data-usredit="'+esc(m.userId)+'">แก้ไข</button>'+
        (isMe?'':'<button class="btn ghost sm" data-usrdel="'+esc(m.userId)+'">ลบ</button>')+
      '</div></td></tr>';
  }).join("") : '<tr><td colspan="7"><div class="empty">ยังไม่มีผู้ใช้ในระบบ</div></td></tr>')+
  '</tbody></table></div></div>'+
  /* ============ ประวัติการใช้งาน ============ */
  '<div class="card" id="actcard" style="margin-top:16px"><div class="card-h">'+
  '<h3>ประวัติการใช้งาน'+(function(){ const w=rows.find(m=>m.userId===S.actUser);
    return w ? ' · '+esc(w.name||w.username) : ""; })()+'</h3>'+
  '<span class="hint">'+(S.acts||[]).length+' รายการล่าสุด · เรียงจากใหม่ไปเก่า'+
  (S.actUser?' · <button class="btn ghost sm" data-act="act-all">ดูของทุกคน</button>':'')+'</span></div>'+
  (S.actErr ? '<div class="card-b muted" style="line-height:1.7">'+esc(S.actErr)+'</div>' :
  '<div class="card-b" style="padding-bottom:0"><div class="filters">'+
    '<select data-actuser><option value="">ทุกคน</option>'+
      rows.map(m=>'<option value="'+esc(m.userId)+'"'+(S.actUser===m.userId?" selected":"")+'>'+
        esc(m.name||m.username)+'</option>').join("")+'</select>'+
  '</div></div>'+
  '<div class="tablewrap"><table><thead><tr><th>เมื่อไหร่</th><th>ใคร</th>'+
  '<th class="c">ทำอะไร</th><th>รายการ</th></tr></thead><tbody>'+
  ((S.acts||[]).length ? S.acts.map(a=>{
    const who = (rows.find(m=>m.userId===a.userId)||{});
    return '<tr><td data-l="เมื่อไหร่" class="num" style="white-space:nowrap">'+esc(whenText(a.createdAt))+'</td>'+
      '<td data-l="ใคร" style="font-weight:600">'+esc(who.name || a.username || "—")+
        (who.name?'<div class="muted num" style="font-weight:400;font-size:12.5px">@'+esc(a.username)+'</div>':'')+'</td>'+
      '<td data-l="ทำอะไร" class="c"><span class="pill '+(ACT_CLASS[a.action]||"info")+'">'+
        esc(ACT_LABEL[a.action]||a.action)+'</span></td>'+
      '<td data-l="รายการ">'+esc(a.summary||"—")+'</td></tr>';
  }).join("") : '<tr><td colspan="4"><div class="empty">ยังไม่มีประวัติการใช้งาน</div></td></tr>')+
  '</tbody></table></div>')+'</div>'+

  '<div class="card" style="margin-top:14px"><div class="card-b muted" style="font-size:14px;line-height:1.75">'+
  '<b>แอดมิน</b> — จัดการผู้ใช้ได้ (เพิ่ม ลบ เปลี่ยนรหัส เปลี่ยนสิทธิ์) และแก้ข้อมูลโครงการได้ทุกอย่าง<br>'+
  '<b>ผู้ใช้ทั่วไป</b> — แก้ข้อมูลโครงการได้ทุกอย่างเหมือนกัน แต่ไม่เห็นเมนูนี้<br>'+
  'ผู้ใช้ล็อกอินด้วย <b>ชื่อผู้ใช้</b> เท่านั้น ไม่ต้องมีอีเมล และกดลืมรหัสผ่านเองไม่ได้ — '+
  'ถ้าลืมให้แอดมินกด “แก้ไข” แล้วตั้งรหัสใหม่ให้'+
  '</div></div>';
}
function editUser(id){
  const m = id ? (S.members||[]).find(x=>x.userId===id) : null;
  openModal(m ? "แก้ไขผู้ใช้ · "+m.username : "เพิ่มผู้ใช้",
    (m ? '<div class="f-row"><label>ชื่อผู้ใช้</label><div class="num" style="font-weight:600;padding:4px 0">'+
          esc(m.username)+'</div></div>'
       : fld("username","ชื่อผู้ใช้ (ตัวอังกฤษพิมพ์เล็ก/ตัวเลข ห้ามเว้นวรรค)",""))+
    fld("name","ชื่อ-สกุล / ตำแหน่ง", m?m.name:"")+
    fld("password", m?"ตั้งรหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)":"รหัสผ่าน (อย่างน้อย 6 ตัว)","","text")+
    sel("role","สิทธิ์", m?m.role:"member", [["member","ผู้ใช้ทั่วไป"],["admin","แอดมิน — จัดการผู้ใช้ได้"]])+
    fld("note","หมายเหตุ", m?m.note:""),
    async o=>{
      if(m){
        await Store.updateMember({userId:m.userId, name:o.name, note:o.note, role:o.role,
                                  password:o.password || undefined});
      }else{
        if(!o.username) throw new Error("กรอกชื่อผู้ใช้");
        if(!o.password || o.password.length<6) throw new Error("รหัสผ่านต้องยาวอย่างน้อย 6 ตัว");
        await Store.createMember({username:o.username, password:o.password, name:o.name, role:o.role, note:o.note});
      }
      await loadMembers();
      if(!m) toast("เพิ่มผู้ใช้ "+o.username+" แล้ว — แจ้งชื่อผู้ใช้และรหัสผ่านให้เจ้าตัว");
    });
}
async function delUser(id){
  const m = (S.members||[]).find(x=>x.userId===id); if(!m) return;
  if(!confirm('ลบผู้ใช้ "'+m.username+'" ออกจากระบบ?\nเขาจะเข้าใช้งานไม่ได้อีก (ข้อมูลโครงการไม่หายไปไหน)')) return;
  try{ await Store.deleteMember(id); await loadMembers(); renderAll(); toast("ลบผู้ใช้ "+m.username+" แล้ว"); }
  catch(e){ toast("ลบไม่สำเร็จ: "+(e.message||e)); }
}

/* ============================ forms ============================ */
function openModal(title, fieldsHTML, onSave, extraFoot){
  $("#overlay").innerHTML='<div class="scrim" data-close="1"><div class="modal" role="dialog" aria-modal="true">'+
    '<div class="card-h"><h3>'+esc(title)+'</h3><button class="btn ghost sm" data-close="1">ปิด</button></div>'+
    '<form class="card-b" id="mform" onsubmit="return false">'+fieldsHTML+'</form>'+
    '<div class="foot">'+(extraFoot||"")+'<button class="btn" data-close="1">ยกเลิก</button>'+
    '<button class="btn primary" id="msave">บันทึก</button></div></div></div>';
  $("#msave").onclick=async ()=>{
    const fd=new FormData($("#mform")); const o={};
    fd.forEach((v,k)=>o[k]=v);
    $("#msave").disabled=true;
    try{ await onSave(o); closeOverlay(); if(S.view!=="users") toast("บันทึกแล้ว"); renderAll(); }
    catch(e){ toast("บันทึกไม่สำเร็จ: "+(e.message||e.code||e)); }
    finally{ const b=$("#msave"); if(b) b.disabled=false; }
  };
  const f=$("#mform"); if(f) f._snap=snapOf(f);
  const first=$("#mform input,#mform select,#mform textarea"); if(first) first.focus();
}
const closeOverlay=()=>{ $("#overlay").innerHTML=""; };

/* ---- กันข้อมูลที่กรอกไว้หายโดยไม่ตั้งใจ ---- */
function snapOf(f){ const a=[]; new FormData(f).forEach((v,k)=>a.push(k+"="+v)); return a.join("\u0001"); }
function formDirty(){ const f=$("#mform"); return !!(f && f._snap!==undefined && snapOf(f)!==f._snap); }
/* ปิดกล่อง — ถ้ากรอกอะไรไว้แล้วยังไม่บันทึก ให้ถามก่อน */
function tryClose(){
  if(formDirty() && !confirm("ยังไม่ได้บันทึก — ถ้าปิดตอนนี้ ข้อมูลที่กรอกไว้จะหายไปทั้งหมด\n\nต้องการปิดหรือไม่?")) return;
  closeOverlay();
}
const fld=(name,label,val,type)=>'<div class="f-row"><label for="f_'+name+'">'+label+'</label>'+
  (type==="textarea"?'<textarea id="f_'+name+'" name="'+name+'">'+esc(val??"")+'</textarea>'
   :'<input id="f_'+name+'" name="'+name+'" type="'+(type||"text")+'" value="'+esc(val??"")+'">')+'</div>';
const sel=(name,label,val,opts)=>'<div class="f-row"><label for="f_'+name+'">'+label+'</label><select id="f_'+name+'" name="'+name+'">'+
  opts.map(o=>'<option value="'+esc(o[0])+'"'+(String(val)===String(o[0])?" selected":"")+'>'+esc(o[1])+'</option>').join("")+'</select></div>';

function editPayment(id){
  const p=S.payments.find(x=>x.id===id)||{contractId:S.contracts[0]&&S.contracts[0].id,seq:(S.payments.length+1),amount:"",vat:0,retention:0};
  openModal(id?"แก้ไขงวดงาน":"เพิ่มงวดงาน",
    sel("contractId","สัญญา",p.contractId,S.contracts.map(c=>[c.id,c.code+" — "+c.name]))+
    '<div class="f-2">'+fld("seq","งวดที่",p.seq,"number")+fld("invoice","เลขที่ใบเบิก",p.invoice)+'</div>'+
    fld("detail","รายละเอียดงาน",p.detail,"textarea")+
    '<div class="f-3">'+fld("amount","มูลค่างวด (บาท)",p.amount,"number")+fld("vat","VAT (บาท)",p.vat,"number")+
    fld("retention","หักประกัน (บาท)",p.retention,"number")+'</div>'+
    '<div class="f-3">'+fld("reqDate","วันที่เบิก",p.reqDate,"date")+
    fld("certDate","วันที่ CM รับรองผลตรวจ",p.certDate,"date")+
    fld("paidDate","วันที่โอน (เว้นว่าง = ยังไม่จ่าย)",p.paidDate,"date")+'</div>'+
    fld("note","หมายเหตุ",p.note),
    async o=>{
      await save(COLS.payments, id||uid("p"), {contractId:o.contractId,seq:Number(o.seq||0),detail:o.detail,
        amount:Number(o.amount||0),vat:Number(o.vat||0),retention:Number(o.retention||0),
        invoice:o.invoice,reqDate:o.reqDate,certDate:o.certDate,paidDate:o.paidDate,note:o.note});
    });
}
function editExtra(id){
  const x=S.extras.find(v=>v.id===id)||{building:"อาคาร 3 ชั้น",amount:"",discount:0};
  openModal(id?"แก้ไขงานเพิ่ม":"เพิ่มงานเพิ่มนอกสัญญา",
    '<div class="f-2">'+fld("building","อาคาร / หมวดงาน",x.building)+fld("invoice","เลขที่ใบเบิก",x.invoice)+'</div>'+
    fld("detail","รายละเอียดงาน",x.detail,"textarea")+
    '<div class="f-2">'+fld("amount","มูลค่างาน (บาท)",x.amount,"number")+fld("discount","ส่วนลด (บาท)",x.discount,"number")+'</div>'+
    '<div class="f-2">'+fld("reqDate","วันที่เบิก",x.reqDate,"date")+fld("paidDate","วันที่โอน",x.paidDate,"date")+'</div>'+
    fld("note","หมายเหตุ / เหตุผลของงานเพิ่ม",x.note,"textarea"),
    async o=>{ await save(COLS.extras, id||uid("x"), {building:o.building,detail:o.detail,amount:Number(o.amount||0),
      discount:Number(o.discount||0),invoice:o.invoice,reqDate:o.reqDate,paidDate:o.paidDate,note:o.note}); });
}
function editEot(id){
  const e=S.eots.find(v=>v.id===id)||{no:S.eots.length+1,contractId:"c2",days:"",status:"รออนุมัติ",
    oldEnd:currentEnd()};
  openModal(id?"แก้ไขคำขอขยายเวลา":"บันทึกคำขอขยายเวลา",
    '<div class="f-3">'+fld("no","ครั้งที่",e.no,"number")+fld("docNo","เลขที่เอกสาร",e.docNo)+
    fld("submitDate","วันที่ยื่น",e.submitDate,"date")+'</div>'+
    fld("eventDate","วันที่เกิดเหตุ (สัญญาข้อ 10.2 ให้แจ้งภายใน 15 วัน)",e.eventDate,"date")+
    sel("contractId","สัญญาที่เกี่ยวข้อง",e.contractId,S.contracts.map(c=>[c.id,c.code+" — "+c.name]))+
    fld("reason","เหตุผล / สาเหตุความล่าช้า",e.reason,"textarea")+
    '<div class="f-3">'+fld("days","จำนวนวันที่ขอ",e.days,"number")+fld("oldEnd","สิ้นสุดเดิม",e.oldEnd,"date")+
    fld("newEnd","สิ้นสุดใหม่",e.newEnd,"date")+'</div>'+
    '<div class="f-2">'+sel("status","สถานะ",e.status,[["รออนุมัติ","รออนุมัติ"],["อนุมัติแล้ว","อนุมัติแล้ว"],["ไม่อนุมัติ","ไม่อนุมัติ"]])+
    fld("decisionDate","วันที่อนุมัติ / ตอบกลับ",e.decisionDate,"date")+'</div>'+
    fld("note","หมายเหตุ",e.note),
    async o=>{ await save(COLS.eots, id||uid("e"), {no:Number(o.no||0),docNo:o.docNo,contractId:o.contractId,
      submitDate:o.submitDate,eventDate:o.eventDate,reason:o.reason,days:Number(o.days||0),oldEnd:o.oldEnd,newEnd:o.newEnd,
      status:o.status,decisionDate:o.decisionDate,note:o.note}); });
}
function editRfa(id){
  const r=S.rfas.find(v=>v.id===id)||{order:S.rfas.length+1,status:"ยังไม่ยื่น",leadDays:30,
    category:"วัสดุ/อุปกรณ์ (Material)",reviewer:"CM / Owner"};
  openModal(id?"แก้ไขรายการขออนุมัติ":"เพิ่มรายการขออนุมัติ",
    '<div class="f-2">'+fld("title","เรื่องที่ขออนุมัติ",r.title)+fld("trade","หมวดงาน (เช่น ลิฟต์, งานระบบไฟฟ้า)",r.trade)+'</div>'+
    sel("category","ประเภทเอกสาร",r.category,[["วัสดุ/อุปกรณ์ (Material)","วัสดุ/อุปกรณ์ (Material)"],
      ["วัสดุเข้าหน่วยงาน (Material on Site)","วัสดุเข้าหน่วยงาน (Material on Site)"],
      ["แบบขยาย (Shop Drawing)","แบบขยาย (Shop Drawing)"],["ขอตรวจงาน (Inspection)","ขอตรวจงาน (Inspection)"],
      ["อื่นๆ","อื่นๆ"]])+
    fld("detail","รายละเอียด / ขอบเขตที่ขออนุมัติ",r.detail,"textarea")+
    '<div class="f-3">'+fld("docNo","เลขที่เอกสาร RFA",r.docNo)+fld("brand","ยี่ห้อ / รุ่น / ผู้ผลิต",r.brand)+
    fld("reviewer","ผู้พิจารณา",r.reviewer)+'</div>'+
    '<div class="f-3">'+fld("leadDays","ระยะเวลาสั่งของ / ผลิต (วัน)",r.leadDays,"number")+
    fld("requiredOn","วันที่ต้องใช้งานหน้างาน",r.requiredOn,"date")+fld("dueDate","วันครบกำหนดตอบกลับ",r.dueDate,"date")+'</div>'+
    '<div class="f-3">'+fld("submitDate","วันที่ยื่น",r.submitDate,"date")+
    sel("status","สถานะ",r.status,RFA_STATUS.map(x=>[x,x]))+fld("decisionDate","วันที่ได้ผลตอบกลับ",r.decisionDate,"date")+'</div>'+
    '<div class="f-2">'+fld("note","หมายเหตุ",r.note)+fld("order","ลำดับแสดงผล",r.order,"number")+'</div>',
    async o=>{ await save(COLS.rfas, id||uid("r"), {title:o.title,trade:o.trade,category:o.category,detail:o.detail,
      docNo:o.docNo,brand:o.brand,reviewer:o.reviewer,leadDays:Number(o.leadDays||0),requiredOn:o.requiredOn,
      dueDate:o.dueDate,submitDate:o.submitDate,status:o.status,decisionDate:o.decisionDate,note:o.note,
      order:Number(o.order||0)}); });
}
function editContract(id){
  const c=S.contracts.find(v=>v.id===id)||{order:S.contracts.length+1,vat:0,retention:5};
  openModal(id?"แก้ไขสัญญา":"เพิ่มสัญญา",
    '<div class="f-2">'+fld("code","ชื่อย่อสัญญา",c.code)+fld("name","ชื่อสัญญา / อาคาร",c.name)+'</div>'+
    fld("contractor","ผู้รับจ้าง",c.contractor)+
    '<div class="f-3">'+fld("amount","เนื้องานตามสัญญา ก่อน VAT (บาท)",c.amount,"number")+fld("periods","จำนวนงวด",c.periods,"number")+
    fld("startDate","วันเริ่มงาน",c.startDate,"date")+'</div>'+
    '<div class="f-3">'+fld("endDate","กำหนดแล้วเสร็จ",c.endDate,"date")+fld("durationDays","ระยะเวลาก่อสร้าง (วัน)",c.durationDays,"number")+
    fld("penaltyDay","ค่าปรับล่าช้า (บาท/วัน)",c.penaltyDay,"number")+'</div>'+
    '<div class="f-3">'+fld("inspectDays","ตรวจงานภายใน (วันทำการ)",c.inspectDays,"number")+
    fld("payDays","จ่ายภายใน (วันทำการ) หลังรับรองผลตรวจ",c.payDays,"number")+
    fld("handoverDate","วันส่งมอบงาน (ใช้คำนวณคืนประกัน)",c.handoverDate,"date")+'</div>'+
    '<div class="f-2">'+fld("employer","ผู้ว่าจ้าง",c.employer)+fld("employerRep","ตัวแทนผู้ว่าจ้าง",c.employerRep)+'</div>'+
    '<div class="f-3">'+fld("vat","VAT (%)",c.vat,"number")+fld("retention","หักประกัน (%)",c.retention,"number")+
    fld("dueDay","ครบกำหนดจ่ายทุกวันที่ (เว้นว่าง = ไม่กำหนด)",c.dueDay,"number")+'</div>'+
    '<div class="f-2">'+fld("order","ลำดับแสดงผล",c.order,"number")+'</div>'+
    fld("bank","บัญชีรับเงิน",c.bank,"textarea"),
    async o=>{ await save(COLS.contracts, id||uid("c"), {code:o.code,name:o.name,contractor:o.contractor,
      amount:Number(o.amount||0),periods:Number(o.periods||0),endDate:o.endDate,vat:Number(o.vat||0),
      retention:Number(o.retention||0),dueDay:o.dueDay?Number(o.dueDay):null,order:Number(o.order||0),bank:o.bank,
      startDate:o.startDate,durationDays:o.durationDays?Number(o.durationDays):null,
      inspectDays:o.inspectDays?Number(o.inspectDays):null,payDays:o.payDays?Number(o.payDays):null,
      penaltyDay:o.penaltyDay?Number(o.penaltyDay):null,handoverDate:o.handoverDate,
      employer:o.employer,employerRep:o.employerRep}); });
}

/* ---------- attachment drawer ---------- */
function refRecord(rt,id){
  return (rt==="payment"?S.payments:rt==="extra"?S.extras:rt==="rfa"?S.rfas:
          rt==="contract"?S.contracts:S.eots).find(r=>r.id===id)||{id};
}
function openFiles(refType,refId){
  const rec=refRecord(refType,refId);
  const title = refType==="payment"?"เอกสารแนบของงวดงาน":refType==="extra"?"เอกสารแนบของงานเพิ่ม":
    refType==="rfa"?"เอกสารแนบของรายการขออนุมัติ":refType==="contract"?"เอกสารของสัญญา":"เอกสารแนบของคำขอขยายเวลา";
  const sub = refType==="contract"? (esc(rec.code||"")+" · "+esc(rec.contractor||"")) :
              refType==="payment"? (esc(rec.invoice||"")+" · งวดที่ "+(rec.seq||"—")) :
              refType==="rfa"? esc(rec.title||"") : refType==="eot"? ("ครั้งที่ "+(rec.no||"")+" · "+esc(rec.docNo||"")) :
              esc(rec.building||"");
  const fileRow = f=>'<div class="filerow"><div class="ic'+(f.url?" link":"")+'">'+
      (f.url?"LINK":esc((f.name.split(".").pop()||"?").slice(0,4).toUpperCase()))+'</div>'+
      '<div style="flex:1;min-width:0"><div class="nm">'+esc(f.name)+'</div>'+
      '<div class="mt">'+(f.url?esc(String(f.url).replace(/^https?:\/\//,"").slice(0,42)):bytes(f.size))+
      ' · '+thDate((f.createdAt||"").slice(0,10))+'</div></div>'+
      '<button class="btn ghost sm" data-dl="'+f.id+'">เปิด</button>'+
      '<button class="btn ghost sm" data-rmfile="'+f.id+'">ลบ</button>'+
      '<label class="ftrow"><span>ประเภท</span><select class="ftype" data-ftype="'+f.id+'">'+
        (DOC_TYPES[refType]||DOC_TYPES.payment).map(d=>'<option value="'+d[0]+'"'+
          ((f.docType||"other")===d[0]?" selected":"")+'>'+esc(d[1])+'</option>').join("")+'</select></label></div>'+
      (/^image\//.test(f.mime||"")?'<img class="thumb" data-img="'+f.id+'" alt="'+esc(f.name)+'">':"");

  const render=()=>{
    const st=docState(refType,rec);
    const types=DOC_TYPES[refType]||DOC_TYPES.payment;
    $("#flist").innerHTML = types.map(([t,label,ab])=>{
      const fs=st.files.filter(f=>(f.docType||"other")===t);
      const need=st.need.includes(t), missing=st.missing.includes(t);
      const covered = need && !missing && !fs.length;   // ครบแล้วโดยเล่มรวม หรือผู้ใช้ยืนยันเอง
      const cls = fs.length?" filled" : missing?" needed" : covered?" covered" : "";
      const status = fs.length ? fs.length+" ไฟล์"
        : covered ? (st.have.has("bundle")&&(t==="invoice"||t==="report") ? "✓ รวมอยู่ในเล่มเดียวกัน" : "✓ ยืนยันว่าครบแล้ว")
        : missing ? "ยังไม่มี — จำเป็นต้องมี" : "ยังไม่มี";
      return '<section class="docslot'+cls+'">'+
        '<header><span class="ab">'+ab+'</span><div><div class="lb">'+esc(label)+'</div>'+
        '<div class="st">'+status+'</div></div>'+
        '<button class="btn sm" data-add="'+t+'">แนบไฟล์</button>'+
        '<button class="btn sm" data-link="'+t+'">ลิงก์</button></header>'+
        (fs.length? fs.map(fileRow).join("") : "")+'</section>';
    }).join("");
    st.files.filter(f=>/^image\//.test(f.mime||"")).forEach(async f=>{
      const el=document.querySelector('[data-img="'+f.id+'"]'); if(!el) return;
      try{ el.src=await Store.fileUrl(f); }catch(e){}
    });
  };

  $("#overlay").innerHTML='<div class="scrim" data-close="1" style="padding:0;align-items:stretch;justify-content:flex-end">'+
    '<div class="drawer" role="dialog" aria-modal="true">'+
    '<div class="card-h"><div><h3>'+esc(title)+'</h3><div class="muted" style="font-size:13px">'+sub+'</div></div>'+
    '<button class="btn ghost sm" data-close="1">ปิด</button></div>'+
    '<div class="card-b" style="display:grid;gap:12px;align-content:start">'+
      '<div class="drop" id="drop">ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก<br>'+
      '<span class="muted">ระบบจะเดาประเภทจากชื่อไฟล์ให้ · ไม่เกิน 50 MB ต่อไฟล์</span></div>'+
      '<input type="file" id="fin" multiple hidden>'+
      '<div id="flist" style="display:grid;gap:10px"></div>'+
      ((refType==="payment"||refType==="extra")?
        '<label class="okrow"><input type="checkbox" id="docsOk"'+(rec.docsOk?" checked":"")+'>'+
        '<span>เอกสารครบแล้ว — ไม่ต้องเตือน<br><small class="muted">ใช้เมื่อเอกสารรวมอยู่ในเล่มเดียวกัน '+
        'หรืองวดนี้ตกลงกันว่าไม่ต้องมีเอกสารบางอย่าง</small></span></label>':'')+
    '</div></div></div>';

  const drop=$("#drop"), fin=$("#fin");
  let pendingType=null;
  drop.onclick=()=>{ pendingType=null; fin.click(); };
  fin.onchange=async ()=>{ await uploadFiles([...fin.files],refType,refId,pendingType); fin.value=""; render(); };
  ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("hot");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("hot");}));
  drop.addEventListener("drop",async e=>{ await uploadFiles([...e.dataTransfer.files],refType,refId,null); render(); });
  $("#flist").addEventListener("click",e=>{
    const lk=e.target.closest("[data-link]");
    if(lk){ addLinkDialog(refType,refId,lk.dataset.link,()=>openFiles(refType,refId)); return; }
    const b=e.target.closest("[data-add]"); if(!b) return;
    pendingType=b.dataset.add; fin.click();
  });
  const okBox=$("#docsOk");
  if(okBox) okBox.onchange=async ()=>{
    try{ await save(refType==="payment"?COLS.payments:COLS.extras, refId,
      Object.assign({}, refRecord(refType,refId), {docsOk:okBox.checked})); toast(okBox.checked?"บันทึกว่าเอกสารครบแล้ว":"เปิดการเตือนเอกสารอีกครั้ง"); }
    catch(e){ toast("บันทึกไม่สำเร็จ: "+(e.message||e)); }
  };
  $("#flist").addEventListener("change",async e=>{
    const sel=e.target.closest("[data-ftype]"); if(!sel) return;
    const f=S.files.find(x=>x.id===sel.dataset.ftype); if(!f) return;
    /* ส่งเฉพาะคอลัมน์ที่แก้ เพื่อไม่ให้ติดคอลัมน์ที่ยังไม่มีในฐานข้อมูล */
    try{ await Store.patch(COLS.files, f.id, {docType:sel.value}); await refresh();
      toast("เปลี่ยนประเภทเป็น "+docMeta(refType,sel.value)[1]); openFiles(refType,refId); }
    catch(err){ toast("เปลี่ยนประเภทไม่สำเร็จ: "+(err.message||err)); }
  });
  openFiles._render=render; render();
}

/* ============================ CSV ============================ */
function csvEscape(v){ const s=String(v??""); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function toCSV(rows){ return "﻿"+rows.map(r=>r.map(csvEscape).join(",")).join("\n"); }
function saveCSV(name,rows){
  const blob=new Blob([toCSV(rows)],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
function payRows(){
  const out=[["สัญญา","งวดที่","รายละเอียดงาน","มูลค่างวด","VAT","หักประกัน","ยอดจ่ายจริง","เลขที่ใบเบิก","วันที่เบิก","ครบกำหนดจ่าย","วันที่โอน","สถานะ","เอกสารแนบ"]];
  S.contracts.forEach(c=>S.payments.filter(p=>p.contractId===c.id).forEach(p=>
    out.push([c.code,p.seq,p.detail,p.amount,p.vat,p.retention,paidNet(p),p.invoice,thDateFull(p.reqDate),
      dueDateOf(p)?thDateFull(dueDateOf(p)):"",p.paidDate?thDateFull(p.paidDate):"",
      statusLabel(pstatus(p)),filesFor("payment",p.id).length])));
  return out;
}
function rfaRows(){
  const out=[["หมวดงาน","เรื่องที่ขออนุมัติ","ประเภท","เลขที่เอกสาร","ยี่ห้อ/รุ่น","ผู้พิจารณา","Lead time (วัน)",
    "วันที่ต้องใช้งาน","ต้องอนุมัติภายใน","วันที่ยื่น","ครบกำหนดตอบ","สถานะ","วันที่ตอบกลับ","เอกสารแนบ"]];
  S.rfas.forEach(r=>out.push([r.trade,r.title,r.category,r.docNo,r.brand,r.reviewer,r.leadDays,
    thDateFull(r.requiredOn),thDateFull(rfaDeadline(r)),thDateFull(r.submitDate),thDateFull(r.dueDate),
    r.status,thDateFull(r.decisionDate),filesFor("rfa",r.id).length]));
  return out;
}
function allRows(){
  const t=totals(); const out=payRows();
  out.push([],["งานเพิ่ม (นอกสัญญา)"],["อาคาร","รายละเอียดงาน","มูลค่างาน","ส่วนลด","ยอดจ่ายจริง","เลขที่ใบเบิก","วันที่เบิก","วันที่โอน","สถานะ"]);
  S.extras.forEach(x=>out.push([x.building,x.detail,x.amount,x.discount,paidNet(x),x.invoice,thDateFull(x.reqDate),
    x.paidDate?thDateFull(x.paidDate):"",statusLabel(pstatus(x))]));
  out.push([],["ทะเบียนงานขออนุมัติ (RFA)"]); rfaRows().forEach(r=>out.push(r));
  out.push([],["รายงานการขอขยายระยะเวลาก่อสร้าง"],["ครั้งที่","เลขที่เอกสาร","วันที่ยื่น","จำนวนวัน","สิ้นสุดเดิม","สิ้นสุดใหม่","สถานะ","เหตุผล"]);
  S.eots.forEach(e=>out.push([e.no,e.docNo,thDateFull(e.submitDate),e.days,thDateFull(e.oldEnd),thDateFull(e.newEnd),e.status,e.reason]));
  const extraDue = S.extras.filter(x=>!isPaid(x)).reduce((a,x)=>a+paidNet(x),0);
  out.push([],["สรุป"],
    ["มูลค่าสัญญารวม (รวม VAT)",t.contract],
    ["เบิกแล้วสะสม ตามใบเบิก",t.gross+t.extra],
    ["โอนแล้วจริง",t.paid+t.extraPaid],
    ["ค้างจ่าย",t.due+extraDue],
    ["เงินประกันที่หักไว้ทั้งหมด",t.retentionAll],
    ["  — จากงวดที่โอนแล้ว",t.retention],
    ["กำหนดแล้วเสร็จปัจจุบัน",thDateFull(currentEnd())]);
  return out;
}

/* ============================ events ============================ */
/* ปิดกล่องด้วยการคลิกฉากหลังได้ ก็ต่อเมื่อ "กดลง" ที่ฉากหลังจริงๆ
   ถ้าเริ่มลากจากในช่องกรอก (เช่น ลากเลือกข้อความเพื่อคัดลอก) แล้วปล่อยเมาส์นอกกล่อง จะไม่ปิด */
let downOnScrim=false;
const isScrim = t => !!(t && t.classList && t.classList.contains("scrim"));
document.addEventListener("mousedown", e=>{ downOnScrim=isScrim(e.target); }, true);
document.addEventListener("touchstart", e=>{ downOnScrim=isScrim(e.target); }, true);

document.addEventListener("click",async e=>{
  if(e.target.closest("button[data-close]")){ tryClose(); return; }
  if(isScrim(e.target)){ if(downOnScrim) tryClose(); return; }
  const t=e.target.closest("[data-go],[data-view],[data-act],[data-edit],[data-del],[data-files],[data-dl],[data-rmfile],[data-usrlog],[data-usredit],[data-usrdel]");
  if(!t) return;
  if(t.dataset.go){
    const [view,row]=t.dataset.go.split("#");
    goTo(view,{contract:t.dataset.gc||"",status:t.dataset.gs||"",q:t.dataset.gq||"",row:row||""});
    return;
  }
  if(t.dataset.view){
    S.view=t.dataset.view; S.filter={contract:"",status:"",q:""}; closeNav(); renderAll(); window.scrollTo({top:0});
    if(S.view==="users"){ await loadMembers(); renderAll(); }
    return;
  }
  if(t.dataset.act){
    const a=t.dataset.act;
    if(a==="new-pay") editPayment(null);
    if(a==="new-extra") editExtra(null);
    if(a==="new-eot") editEot(null);
    if(a==="new-rfa") editRfa(null);
    if(a==="imp-pick") $("#impFiles").click();
    if(a==="imp-folder") $("#impDir").click();
    if(a==="imp-run") runImport();
    if(a==="docs-clear"){ S.filter={contract:"",status:"",q:""}; renderAll(); }
    if(a==="export-rfa") saveCSV("งานขออนุมัติ-มหาวิหารเก้าฟ้า.csv",rfaRows());
    if(a==="new-contract") editContract(null);
    if(a==="new-user") editUser(null);
    if(a==="act-all"){ S.actUser=""; await loadMembers(); renderAll(); }
    if(a==="diag-users"){
      t.disabled=true; t.textContent="กำลังตรวจ…";
      try{ S.usersDiag = await Store.diagUsers(); }
      catch(err){ S.usersDiag=null; toast(err.message||"ตรวจไม่สำเร็จ"); }
      renderAll();
    }
    if(a==="export-pay") saveCSV("งวดงาน-มหาวิหารเก้าฟ้า.csv",payRows());
    if(a==="export-all") saveCSV("สรุปโครงการ-มหาวิหารเก้าฟ้า.csv",allRows());
    return;
  }
  if(t.dataset.edit){
    const [k,id]=t.dataset.edit.split(":");
    ({pay:editPayment,extra:editExtra,rfa:editRfa,eot:editEot,contract:editContract}[k])(id); return;
  }
  if(t.dataset.del){
    const [k,id]=t.dataset.del.split(":");
    if(!confirm("ลบรายการนี้? เอกสารแนบจะยังอยู่ในคลังเอกสาร")) return;
    await remove({pay:COLS.payments,extra:COLS.extras,rfa:COLS.rfas,eot:COLS.eots}[k],id); toast("ลบแล้ว"); return;
  }
  if(t.dataset.usrlog){
    S.actUser = t.dataset.usrlog; await loadMembers(); renderAll();
    const c=$("#actcard"); if(c) c.scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }
  if(t.dataset.usredit){ editUser(t.dataset.usredit); return; }
  if(t.dataset.usrdel){ await delUser(t.dataset.usrdel); return; }
  if(t.dataset.files){ const [rt,rid]=t.dataset.files.split(":"); openFiles(rt,rid); return; }
  if(t.dataset.dl){ const f=S.files.find(x=>x.id===t.dataset.dl); if(f) downloadFile(f); return; }
  if(t.dataset.rmfile){ const f=S.files.find(x=>x.id===t.dataset.rmfile); if(f){ await deleteFile(f); if(openFiles._render) openFiles._render(); } return; }
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Enter"&&e.key!==" ") return;
  const g=e.target.closest('[data-go][role="button"]'); if(!g) return;
  e.preventDefault(); g.click();
});
document.addEventListener("change",async e=>{
  const au=e.target.closest("[data-actuser]");
  if(au){ S.actUser=au.value; await loadMembers(); renderAll(); return; }
  const im=e.target.closest("[data-imp]");
  if(im){ const i=+im.dataset.imp, row=S.imp[i];
    if(im.dataset.f==="rt"){ const [rt,id]=(im.value||":").split(":"); row.rt=rt; row.id=id;
      if(rt&&!(DOC_TYPES[rt]||[]).some(d=>d[0]===row.dt)) row.dt=planFile(row.file.name).dt;
      if(rt&&!(DOC_TYPES[rt]||[]).some(d=>d[0]===row.dt)) row.dt="other"; }
    else row.dt=im.value;
    renderAll(); return; }
  const f=e.target.closest("[data-filter]"); if(!f) return;
  S.filter[f.dataset.filter]=f.value; renderAll();
});
document.addEventListener("input",e=>{
  const f=e.target.closest('[data-filter="q"]'); if(!f) return;
  S.filter.q=f.value; S._focusQ=true; clearTimeout(window._qt); window._qt=setTimeout(renderAll,220);
});
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeOverlay(); });
function openNav(){ document.querySelector(".rail").classList.add("open");
  const sc=$("#navScrim"); if(sc) sc.hidden=false;
  const b=$("#navToggle"); if(b) b.setAttribute("aria-expanded","true"); }
function closeNav(){ document.querySelector(".rail").classList.remove("open");
  const sc=$("#navScrim"); if(sc) sc.hidden=true;
  const b=$("#navToggle"); if(b) b.setAttribute("aria-expanded","false"); }
(function(){
  const b=$("#navToggle"), sc=$("#navScrim");
  if(b) b.onclick=()=>document.querySelector(".rail").classList.contains("open")?closeNav():openNav();
  if(sc) sc.onclick=closeNav;
  addEventListener("keydown",e=>{ if(e.key==="Escape") closeNav(); });
})();
/* ---------- ขนาดตัวอักษร ก / กก / กกก ----------
   จำไว้ในเครื่องของแต่ละคน ไม่ยุ่งกับฐานข้อมูล — คนละเครื่องตั้งคนละขนาดได้ */
const FS_KEY="nm74.fs";
function applyFs(v){
  const size = (v==="s"||v==="l") ? v : "m";
  if(size==="m") document.documentElement.removeAttribute("data-fs");
  else document.documentElement.setAttribute("data-fs", size);
  document.querySelectorAll(".fsbtn").forEach(b=>
    b.setAttribute("aria-pressed", String(b.dataset.fs===size)));
  try{ localStorage.setItem(FS_KEY, size); }catch(e){}
}
/* อ่านค่าที่เคยตั้งไว้ตั้งแต่ตอนเปิดหน้า — โหมดส่วนตัวหรือปิดคุกกี้ก็ต้องไม่พัง */
(function(){ let saved=null; try{ saved=localStorage.getItem(FS_KEY); }catch(e){}
  applyFs(saved||"m"); })();
document.addEventListener("click",e=>{
  const b=e.target.closest(".fsbtn"); if(b) applyFs(b.dataset.fs);
});

$("#themeBtn").onclick=()=>{
  const cur=document.documentElement.getAttribute("data-theme");
  const dark=cur? cur==="dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", dark?"light":"dark");
};
function showLogin(){
  document.body.classList.add("locked");
  $("#overlay").innerHTML='<div class="scrim" style="align-items:center"><div class="modal" style="width:min(400px,100%)">'+
    '<div class="card-h"><h3>เข้าสู่ระบบ</h3></div>'+
    '<form class="card-b" id="loginform" onsubmit="return false">'+
      '<div class="f-row"><label for="lg_email">ชื่อผู้ใช้</label>'+
      '<input id="lg_email" type="text" autocomplete="username" autocapitalize="none" '+
      'spellcheck="false" placeholder="เช่น anavin" required></div>'+
      '<div class="f-row"><label for="lg_pw">รหัสผ่าน</label><input id="lg_pw" type="password" autocomplete="current-password" required></div>'+
      '<div id="lg_err" class="muted" style="font-size:13.5px;color:var(--late)"></div>'+
    '</form>'+
    '<div class="foot"><button class="btn primary" id="lg_go">เข้าสู่ระบบ</button></div></div></div>';
  const go=async()=>{
    const user=$("#lg_email").value.trim(), pw=$("#lg_pw").value;
    $("#lg_err").textContent="";
    if(!user||!pw){ $("#lg_err").textContent="กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ"; return; }
    $("#lg_go").disabled=true;
    try{ await Store.signIn(user,pw); }
    catch(e){ $("#lg_err").textContent = /Invalid|credential/i.test(e.message||"")
      ? "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" : (e.message||"เข้าสู่ระบบไม่สำเร็จ"); }
    finally{ $("#lg_go").disabled=false; }
  };
  $("#lg_go").onclick=go;
  $("#loginform").addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
  $("#lg_email").focus();
}
function hideLogin(){ document.body.classList.remove("locked"); if($(".scrim")) closeOverlay(); }
function showConfigHelp(){
  $("#view").innerHTML='<div class="card"><div class="card-b" style="line-height:1.8">'+
    '<h3 style="margin-bottom:8px">ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase</h3>'+
    '<p class="muted">คัดลอกไฟล์ <code>config.example.js</code> เป็น <code>config.js</code> แล้วใส่ค่า '+
    '<code>SUPABASE_URL</code> และ <code>SUPABASE_ANON_KEY</code> ของโปรเจกต์ จากหน้า Project Settings → API</p>'+
    '</div></div>';
}
document.addEventListener("click",async e=>{
  /* ต้องรอให้ signOut เคลียร์เซสชันเสร็จก่อน ไม่งั้นรีโหลดแล้วยังล็อกอินค้างอยู่ */
  if(e.target.id==="logoutBtn"){ try{ await Store.signOut(); }catch(err){} location.reload(); return; }
});
renderAll();
boot();