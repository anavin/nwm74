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
const TODAY = new Date(); TODAY.setHours(0,0,0,0);
function daysBetween(isoA,isoB){
  if(!isoA) return null;
  const a=new Date(isoA+"T00:00:00"), b=isoB?new Date(isoB+"T00:00:00"):TODAY;
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
           filter:{contract:"", status:"", q:""}, seeded:false};

const COLS = {contracts:"contracts", payments:"payments", extras:"extras", eots:"eot", rfas:"rfa", files:"files"};
function addDays(iso,d){ if(!iso) return ""; const x=new Date(iso+"T00:00:00"); if(isNaN(x)) return "";
  x.setDate(x.getDate()+Number(d||0)); return x.toISOString().slice(0,10); }
function rfaDeadline(r){ return r.requiredOn ? addDays(r.requiredOn, -Number(r.leadDays||0)) : ""; }
function rfaState(r){
  const st=r.status||"ยังไม่ยื่น";
  if(st==="อนุมัติแล้ว"||st==="อนุมัติตามหมายเหตุ") return "paid";
  if(st==="ไม่อนุมัติ"||st==="ให้แก้ไข/ยื่นใหม่") return "late";
  const dl=rfaDeadline(r), today=new Date().toISOString().slice(0,10);
  if(st==="ยังไม่ยื่น") return (dl && dl<today) ? "late" : "idle";
  const over = (r.dueDate && r.dueDate<today) || (dl && dl<today) || (daysBetween(r.submitDate)||0)>14;
  return over ? "late" : "due";
}

/* ---------- derived ---------- */
const paidNet = p => Number(p.amount||0)+Number(p.vat||0)-Number(p.retention||0)-Number(p.discount||0);
const isPaid = r => !!r.paidDate;
function pstatus(r){
  if(r.paidDate) return "paid";
  const age = daysBetween(r.reqDate);
  return (age!=null && age>30) ? "late" : "due";
}
const statusLabel = s => s==="paid"?"จ่ายแล้ว":s==="late"?"ค้างเกินกำหนด":"ค้างจ่าย";
function contractStats(c){
  const rows = S.payments.filter(p=>p.contractId===c.id);
  const billed = rows.reduce((s,p)=>s+paidNet(p),0);
  const paid = rows.filter(isPaid).reduce((s,p)=>s+paidNet(p),0);
  const due = billed-paid;
  const rest = Math.max(0, Number(c.amount||0)-rows.reduce((s,p)=>s+Number(p.amount||0),0));
  return {rows,billed,paid,due,rest,count:rows.length};
}
function totals(){
  const t={contract:0,billed:0,paid:0,due:0,extra:0,extraPaid:0};
  S.contracts.forEach(c=>{const s=contractStats(c);t.contract+=Number(c.amount||0);t.billed+=s.billed;t.paid+=s.paid;t.due+=s.due;});
  S.extras.forEach(x=>{t.extra+=paidNet(x); if(isPaid(x)) t.extraPaid+=paidNet(x);});
  return t;
}
function avgPayLag(){
  const lags = S.payments.filter(p=>p.paidDate&&p.reqDate).map(p=>daysBetween(p.reqDate,p.paidDate)).filter(n=>n!=null);
  return lags.length? Math.round(lags.reduce((a,b)=>a+b,0)/lags.length) : null;
}
function currentEnd(){
  const ok = S.eots.filter(e=>e.status==="อนุมัติแล้ว").sort((a,b)=>(a.newEnd||"").localeCompare(b.newEnd||""));
  const base = S.contracts.find(c=>c.id==="c2")?.endDate || "2027-04-15";
  return ok.length? ok[ok.length-1].newEnd : base;
}
function pendingEnd(){
  const p = S.eots.filter(e=>e.status==="รออนุมัติ").sort((a,b)=>(a.newEnd||"").localeCompare(b.newEnd||""));
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
    $("#dbstate").innerHTML = "เข้าสู่ระบบ: " + esc(session.user.email||"") ;
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
async function save(col,id,body){
  try{ await Store.save(col,id,body); await refresh(); }
  catch(e){ throw new Error(e.message||e); }
}
async function remove(col,id){
  try{ await Store.remove(col,id); await refresh(); }
  catch(e){ toast("ลบไม่สำเร็จ: "+(e.message||e)); }
}

/* ============================ files ============================ */
const MAX_FILE = 25*1024*1024;
async function uploadFiles(list, refType, refId){
  for(const f of list){
    if(f.size>MAX_FILE){ toast("ไฟล์ "+f.name+" ใหญ่เกิน 25 MB"); continue; }
    try{ await Store.uploadFile(f,refType,refId); toast("แนบ "+f.name+" แล้ว"); }
    catch(e){ toast("อัปโหลดไม่สำเร็จ: "+(e.message||e)); }
  }
  await refresh();
}
async function downloadFile(f){
  try{
    const url = await Store.fileUrl(f);
    const a=document.createElement("a"); a.href=url; a.download=f.name; a.rel="noopener";
    document.body.appendChild(a); a.click(); a.remove();
  }catch(e){ toast("เปิดไฟล์ไม่สำเร็จ: "+(e.message||e)); }
}
async function deleteFile(f){
  if(!confirm("ลบเอกสาร \""+f.name+"\" ?")) return;
  try{ await Store.deleteFile(f); toast("ลบเอกสารแล้ว"); await refresh(); }
  catch(e){ toast("ลบไม่สำเร็จ: "+(e.message||e)); }
}
async function fileData(f){ return null; }

/* ============================ views ============================ */
const VIEWS=[
  {id:"dash",  label:"ภาพรวมโครงการ", sub:"สรุปสถานะการเงิน ความคืบหน้า และสิ่งที่ต้องติดตาม"},
  {id:"pay",   label:"งวดงาน / เบิกจ่าย", sub:"รายการเบิกจ่ายตามสัญญา พร้อมเอกสารแนบรายงวด"},
  {id:"extra", label:"งานเพิ่ม (นอกสัญญา)", sub:"งานที่เกิดขึ้นนอกเหนือสัญญาและใบเบิกที่เกี่ยวข้อง"},
  {id:"rfa",   label:"งานขออนุมัติ (RFA)", sub:"ทะเบียนขออนุมัติวัสดุ อุปกรณ์ งานระบบ และแบบขยาย พร้อมกำหนดวันที่ต้องอนุมัติ"},
  {id:"eot",   label:"ขอขยายระยะเวลา", sub:"คำขอขยายเวลาก่อสร้าง สถานะอนุมัติ และไทม์ไลน์สัญญา"},
  {id:"docs",  label:"คลังเอกสาร", sub:"เอกสารแนบทั้งหมดของโครงการ"},
  {id:"setup", label:"สัญญาและผู้รับจ้าง", sub:"ข้อมูลสัญญา มูลค่า เงื่อนไข และบัญชีรับเงิน"}
];
function renderNav(){
  const counts={pay:S.payments.length,extra:S.extras.length,rfa:S.rfas.length,eot:S.eots.length,docs:S.files.length,setup:S.contracts.length};
  $("#nav").innerHTML = VIEWS.map(v=>
    '<button class="navitem" data-view="'+v.id+'" aria-current="'+(S.view===v.id)+'">'+
    '<span class="dot"></span>'+esc(v.label)+
    (counts[v.id]!=null?'<span class="badge num">'+counts[v.id]+'</span>':'')+'</button>').join("");
}
function renderAll(){
  const v=VIEWS.find(x=>x.id===S.view)||VIEWS[0];
  renderNav();
  $("#viewTitle").textContent=v.label; $("#viewSub").textContent=v.sub;
  $("#banner").innerHTML = S.mode==="db" ? "" :
    '<div class="banner">กำลังเชื่อมต่อฐานข้อมูล…</div>';
  ({dash:viewDash,pay:viewPay,extra:viewExtra,rfa:viewRfa,eot:viewEot,docs:viewDocs,setup:viewSetup}[S.view]||viewDash)();
}
function tools(html){ $("#viewTools").innerHTML=html; }

/* ---------- dashboard ---------- */
function viewDash(){
  tools('<button class="btn" data-act="export-all">ส่งออก CSV ทั้งโครงการ</button>');
  const t=totals(), lag=avgPayLag(), end=currentEnd(), pend=pendingEnd();
  const left=daysBetween(new Date().toISOString().slice(0,10), end);
  const approved=S.eots.filter(e=>e.status==="อนุมัติแล้ว").reduce((s,e)=>s+Number(e.days||0),0);
  const waiting=S.eots.filter(e=>e.status==="รออนุมัติ").reduce((s,e)=>s+Number(e.days||0),0);
  const overdue=S.payments.filter(p=>pstatus(p)==="late");
  const dues=S.payments.filter(p=>!isPaid(p)).sort((a,b)=>(a.reqDate||"").localeCompare(b.reqDate||""));
  const rfaLate=S.rfas.filter(r=>rfaState(r)==="late"), rfaDue=S.rfas.filter(r=>rfaState(r)==="due");

  const kpi=(cls,lab,val,unit,note)=>'<div class="kpi '+cls+'"><div class="lab">'+lab+'</div><div class="val">'+val+
    (unit?'<small>'+unit+'</small>':'')+'</div><div class="note">'+(note||"")+'</div></div>';

  $("#view").innerHTML =
  '<div class="grid kpis" style="margin-bottom:16px">'+
    kpi("hero","มูลค่าสัญญารวม",money(t.contract),"บาท",S.contracts.length+" สัญญา · งานเพิ่ม "+money(t.extra)+" บาท")+
    kpi("","เบิกแล้วสะสม",money(t.billed+t.extra),"บาท","คิดเป็น "+((t.billed+t.extra)/Math.max(1,t.contract)*100).toFixed(1)+"% ของมูลค่าสัญญา")+
    kpi("","จ่ายแล้ว",money(t.paid+t.extraPaid),"บาท","รอบจ่ายเฉลี่ย "+(lag==null?"—":lag+" วัน")+" หลังยื่นใบเบิก")+
    kpi(t.due>0?"warn":"","ค้างจ่าย",money(t.due),"บาท",dues.length+" งวดที่ยังไม่โอน"+(overdue.length?" · เกิน 30 วัน "+overdue.length+" งวด":""))+
    kpi(left<90?"bad":"","กำหนดแล้วเสร็จ",thDate(end),"",
      (left>=0?"เหลืออีก "+left+" วัน":"เลยกำหนด "+Math.abs(left)+" วัน")+" · ขยายแล้ว "+approved+" วัน"+
      (waiting?" (รออนุมัติอีก "+waiting+" วัน → "+thDate(pend)+")":""))+
    kpi(rfaLate.length?"bad":(rfaDue.length?"warn":""),"งานขออนุมัติ",S.rfas.length,"รายการ",
      "รอผล "+rfaDue.length+" · ต้องเร่ง "+rfaLate.length+" · ยังไม่ยื่น "+S.rfas.filter(r=>rfaState(r)==="idle").length+
      " · อนุมัติแล้ว "+S.rfas.filter(r=>rfaState(r)==="paid").length)+
  '</div>'+

  '<div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);align-items:start">'+
    '<div class="card"><div class="card-h"><h3>ความคืบหน้าการเบิกจ่ายรายสัญญา</h3>'+
      '<span class="hint">สัดส่วนของมูลค่าสัญญา</span></div><div class="card-b">'+
      S.contracts.map(c=>{
        const s=contractStats(c), amt=Number(c.amount||1);
        const wp=Math.min(100,s.paid/amt*100), wd=Math.min(100,s.due/amt*100);
        return '<div class="ctr-row"><div class="ctr-head"><div><div class="nm">'+esc(c.code)+' — '+esc(c.name)+'</div>'+
          '<div class="who">'+esc(c.contractor)+'</div></div>'+
          '<div class="num" style="font-weight:600">'+money(c.amount)+' <span class="muted" style="font-weight:400">บาท</span></div></div>'+
          '<div class="meter"><span class="s-paid" style="width:'+wp+'%"></span>'+
          '<span class="s-due" style="width:'+wd+'%"></span>'+
          '<span class="s-un" style="width:'+Math.max(0,100-wp-wd)+'%"></span></div>'+
          '<div class="ctr-figs"><span>จ่ายแล้ว <b>'+money(s.paid)+'</b></span>'+
          '<span>ค้างจ่าย <b>'+money(s.due)+'</b></span>'+
          '<span>ยังไม่เบิก <b>'+money(s.rest)+'</b></span>'+
          '<span class="muted">'+s.count+'/'+(c.periods||"—")+' งวด</span></div></div>';
      }).join("")+
      '<div class="legend"><span><i style="background:var(--paid)"></i>จ่ายแล้ว</span>'+
      '<span><i style="background:var(--due)"></i>เบิกแล้วรอโอน</span>'+
      '<span><i style="background:var(--unbilled)"></i>ยังไม่เบิก</span></div>'+
    '</div></div>'+

    '<div class="card"><div class="card-h"><h3>ต้องติดตาม</h3><span class="hint">เรียงตามความเร่งด่วน</span></div>'+
    '<div class="card-b" style="display:grid;gap:12px">'+
      (S.eots.filter(e=>e.status==="รออนุมัติ").map(e=>
        '<div style="display:flex;gap:10px;align-items:flex-start"><span class="pill due">รออนุมัติ</span>'+
        '<div><div style="font-weight:600;font-size:13px">ขอขยายเวลาครั้งที่ '+e.no+' · '+esc(e.docNo)+'</div>'+
        '<div class="muted" style="font-size:12px">ยื่น '+thDate(e.submitDate)+' · ขอ '+e.days+' วัน · ค้าง '+
        (daysBetween(e.submitDate)||0)+' วันแล้ว</div></div></div>').join("")||"")+
      (rfaLate.concat(rfaDue).slice(0,4).map(r=>{
        const st=rfaState(r), dl=rfaDeadline(r);
        return '<div style="display:flex;gap:10px;align-items:flex-start"><span class="pill '+st+'">'+
          (st==="late"?"ต้องเร่ง":"รออนุมัติ")+'</span>'+
          '<div><div style="font-weight:600;font-size:13px">'+esc(r.title||"")+(r.docNo?' · '+esc(r.docNo):'')+'</div>'+
          '<div class="muted" style="font-size:12px">'+esc(r.trade||"")+
          (dl?' · ต้องอนุมัติภายใน '+thDate(dl):'')+(r.submitDate?' · ยื่น '+thDate(r.submitDate):' · ยังไม่ยื่น')+'</div></div></div>';
      }).join(""))+
      (dues.length? dues.slice(0,5).map(p=>{
        const st=pstatus(p), age=daysBetween(p.reqDate);
        const c=S.contracts.find(c=>c.id===p.contractId);
        return '<div style="display:flex;gap:10px;align-items:flex-start"><span class="pill '+st+'">'+(st==="late"?age+" วัน":"ค้าง")+'</span>'+
          '<div><div style="font-weight:600;font-size:13px">'+esc(p.invoice||"—")+' · '+money(paidNet(p))+' บาท</div>'+
          '<div class="muted" style="font-size:12px">'+esc(c?c.code:"")+' งวดที่ '+p.seq+' · ยื่น '+thDate(p.reqDate)+'</div></div></div>';
      }).join("") : '<div class="muted">ไม่มีงวดค้างจ่าย</div>')+
    '</div></div>'+
    '<div class="card" style="margin-top:14px"><div class="card-h"><h3>เอกสารล่าสุด</h3>'+
    '<span class="hint">'+S.files.length+' ไฟล์</span></div><div class="card-b" style="padding-top:4px">'+
    (S.files.length? S.files.slice(0,5).map(f=>
      '<div class="filerow"><div class="ic">'+esc((f.name.split(".").pop()||"?").slice(0,4).toUpperCase())+'</div>'+
      '<div style="flex:1;min-width:0"><div class="nm">'+esc(f.name)+'</div>'+
      '<div class="mt">'+bytes(f.size)+' · '+thDate((f.createdAt||"").slice(0,10))+'</div></div>'+
      '<button class="btn ghost sm" data-dl="'+f.id+'">บันทึก</button></div>').join("")
     : '<div class="empty" style="padding:26px 10px">ยังไม่มีเอกสารแนบ — กดปุ่มแนบในแต่ละรายการเพื่อเก็บเอกสารไว้ที่นี่</div>')+
    '</div></div>'+
  '</div>'+

  '<div class="card" style="margin-top:14px"><div class="card-h"><h3>ไทม์ไลน์สัญญาและการขยายเวลา</h3>'+
  '<span class="hint">อาคาร 3 ชั้น — บริษัท เอ พลัส แอสโซซิเอท จำกัด</span></div><div class="card-b">'+timelineHTML()+'</div></div>';
}
function timelineHTML(){
  const items=[];
  const first=S.payments.filter(p=>p.paidDate).sort((a,b)=>a.paidDate.localeCompare(b.paidDate))[0];
  if(first) items.push({d:first.paidDate,t:"เริ่มต้นสัญญา / จ่ายงวดเซ็นสัญญา",b:"โอนงวดแรก "+money(paidNet(first))+" บาท",k:"milestone"});
  const base=S.contracts.find(c=>c.id==="c2");
  if(base&&base.endDate) items.push({d:base.endDate,t:"กำหนดแล้วเสร็จตามสัญญาเดิม",b:"ตามสัญญาก่อสร้างฉบับเดิม",k:"milestone"});
  S.eots.forEach(e=>{
    items.push({d:e.submitDate,t:"ยื่นขอขยายเวลาครั้งที่ "+e.no+" ("+e.docNo+")",
      b:"ขอ "+e.days+" วัน · "+e.status+(e.decisionDate?" "+thDate(e.decisionDate):"" )+" → สิ้นสุด "+thDate(e.newEnd),
      k:e.status==="อนุมัติแล้ว"?"done":"pending"});
    items.push({d:e.newEnd,t:"กำหนดแล้วเสร็จหลังขยายครั้งที่ "+e.no,
      b:thDateFull(e.oldEnd)+" + "+e.days+" วัน"+(e.status==="รออนุมัติ"?" (ยังไม่ยืนยัน)":""),
      k:e.status==="อนุมัติแล้ว"?"done":"pending"});
  });
  items.sort((a,b)=>(a.d||"").localeCompare(b.d||""));
  return '<div class="tl">'+items.map(i=>'<div class="tl-item '+i.k+'"><div class="tl-date">'+thDateFull(i.d)+'</div>'+
    '<div class="tl-title">'+esc(i.t)+'</div><div class="tl-body">'+esc(i.b)+'</div></div>').join("")+'</div>';
}

/* ---------- payments ---------- */
function viewPay(){
  tools('<button class="btn" data-act="export-pay">ส่งออก CSV</button>'+
        '<button class="btn primary" data-act="new-pay">+ เพิ่มงวดงาน</button>');
  const f=S.filter;
  const filterBar='<div class="filters">'+
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
      '<span class="hint">'+esc(c.contractor)+' · สัญญา '+money(c.amount)+' บาท'+(c.vat?" · VAT 7%":" · ไม่มี VAT")+
      (c.retention?" · หักประกัน "+c.retention+"%":"")+'</span></div>'+
      '<div class="tablewrap"><table><thead><tr>'+
      '<th class="c">งวด</th><th>รายละเอียดงาน</th><th class="r">มูลค่างวด</th><th class="r">VAT</th>'+
      '<th class="r">หักประกัน</th><th class="r">ยอดจ่ายจริง</th><th>เลขที่ใบเบิก</th><th>วันที่เบิก</th>'+
      '<th>วันที่โอน</th><th class="c">สถานะ</th><th class="c">เอกสาร</th><th></th></tr></thead><tbody>'+
      rows.map(p=>{
        const st=pstatus(p), age=daysBetween(p.reqDate), n=filesFor("payment",p.id).length;
        return '<tr><td class="c stripe '+st+' num">'+p.seq+'</td>'+
          '<td style="min-width:250px">'+esc(p.detail)+(p.note?'<div class="muted" style="font-size:11.5px">'+esc(p.note)+'</div>':'')+'</td>'+
          '<td class="r num">'+money(p.amount)+'</td><td class="r num">'+(p.vat?money(p.vat):'<span class="muted">—</span>')+'</td>'+
          '<td class="r num">'+(p.retention?money(p.retention):'<span class="muted">—</span>')+'</td>'+
          '<td class="r num" style="font-weight:600">'+money(paidNet(p))+'</td>'+
          '<td class="num">'+esc(p.invoice||"—")+'</td><td class="num">'+thDate(p.reqDate)+'</td>'+
          '<td class="num">'+(p.paidDate?thDate(p.paidDate):'<span class="muted">—</span>')+'</td>'+
          '<td class="c"><span class="pill '+st+'">'+statusLabel(st)+(st!=="paid"&&age!=null?" "+age+" วัน":"")+'</span></td>'+
          '<td class="c"><div><button class="clip'+(n?"":" add")+'" data-files="payment:'+p.id+'">'+(n?"📎 "+n:"+ แนบ")+'</button></div></td>'+
          '<td><div class="rowacts"><button class="btn ghost sm" data-edit="pay:'+p.id+'">แก้ไข</button>'+
          '<button class="btn ghost sm" data-del="pay:'+p.id+'">ลบ</button></div></td></tr>';
      }).join("")+
      '</tbody><tfoot><tr><td colspan="5" class="r" style="font-weight:600">รวมของสัญญานี้</td>'+
      '<td class="r num" style="font-weight:700">'+money(s.billed)+'</td>'+
      '<td colspan="3" class="muted">จ่ายแล้ว '+money(s.paid)+' · ค้าง '+money(s.due)+'</td>'+
      '<td colspan="3"></td></tr></tfoot></table></div></div>';
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
      return '<tr><td class="stripe '+st+'">'+esc(x.building)+'</td>'+
        '<td style="min-width:260px">'+esc(x.detail)+(x.note?'<div class="muted" style="font-size:11.5px">'+esc(x.note)+'</div>':'')+'</td>'+
        '<td class="r num">'+money(x.amount)+'</td><td class="r num">'+(x.discount?money(x.discount):'<span class="muted">—</span>')+'</td>'+
        '<td class="r num" style="font-weight:600">'+money(paidNet(x))+'</td>'+
        '<td class="num">'+esc(x.invoice||"—")+'</td><td class="num">'+thDate(x.reqDate)+'</td>'+
        '<td class="num">'+(x.paidDate?thDate(x.paidDate):'<span class="muted">—</span>')+'</td>'+
        '<td class="c"><span class="pill '+st+'">'+statusLabel(st)+'</span></td>'+
        '<td class="c"><div><button class="clip'+(n?"":" add")+'" data-files="extra:'+x.id+'">'+(n?"📎 "+n:"+ แนบ")+'</button></div></td>'+
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
  const f=S.filter, today=new Date().toISOString().slice(0,10);
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
    return '<tr><td class="stripe '+(st==="idle"?"":st)+'" style="min-width:230px">'+
      '<div style="font-weight:600">'+esc(r.title||"—")+'</div>'+
      '<div class="muted" style="font-size:12px">'+esc(r.detail||"")+'</div>'+
      (r.note?'<div class="muted" style="font-size:11.5px">'+esc(r.note)+'</div>':'')+'</td>'+
      '<td style="font-size:12px">'+esc(r.category||"—")+'</td>'+
      '<td class="num">'+esc(r.docNo||"—")+'</td>'+
      '<td style="font-size:12.5px">'+(r.brand?esc(r.brand):'<span class="muted">—</span>')+'</td>'+
      '<td style="font-size:12.5px">'+esc(r.reviewer||"—")+'</td>'+
      '<td class="c num">'+(r.leadDays?r.leadDays+" วัน":'<span class="muted">—</span>')+'</td>'+
      '<td class="num">'+(r.requiredOn?thDate(r.requiredOn):'<span class="muted">—</span>')+'</td>'+
      '<td class="num" style="font-weight:600'+(lateDl?";color:var(--late)":"")+'">'+(dl?thDate(dl):'<span class="muted">—</span>')+'</td>'+
      '<td class="num">'+(r.submitDate?thDate(r.submitDate):'<span class="muted">—</span>')+'</td>'+
      '<td class="num">'+(r.dueDate?thDate(r.dueDate):'<span class="muted">—</span>')+'</td>'+
      '<td class="c"><span class="pill '+(st==="idle"?"info":st)+'">'+esc(r.status||"—")+'</span>'+
        (r.decisionDate?'<div class="muted num" style="font-size:11px">'+thDate(r.decisionDate)+'</div>':'')+'</td>'+
      '<td class="c"><div><button class="clip'+(n?"":" add")+'" data-files="rfa:'+r.id+'">'+(n?"📎 "+n:"+ แนบ")+'</button></div></td>'+
      '<td><div class="rowacts"><button class="btn ghost sm" data-edit="rfa:'+r.id+'">แก้ไข</button>'+
      '<button class="btn ghost sm" data-del="rfa:'+r.id+'">ลบ</button></div></td></tr>';
  }).join("") : '<tr><td colspan="13"><div class="empty">ไม่พบรายการตามเงื่อนไขที่เลือก</div></td></tr>')+
  '</tbody></table></div></div>'+
  '<div class="card" style="margin-top:14px"><div class="card-b muted" style="font-size:12.5px;line-height:1.6">'+
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
    return '<tr><td class="c stripe '+(ok?"paid":"due")+' num" style="font-weight:600">'+e.no+'</td>'+
      '<td style="min-width:300px">'+esc(e.reason)+(e.note?'<div class="muted" style="font-size:11.5px">'+esc(e.note)+'</div>':'')+'</td>'+
      '<td class="num">'+esc(e.docNo)+'</td><td class="num">'+thDate(e.submitDate)+'</td>'+
      '<td class="c num" style="font-weight:600">'+e.days+'</td><td class="c num">'+acc+'</td>'+
      '<td class="num">'+thDate(e.oldEnd)+'</td><td class="num" style="font-weight:600">'+thDate(e.newEnd)+'</td>'+
      '<td class="c"><span class="pill '+(ok?"paid":"due")+'">'+esc(e.status)+'</span>'+
        (e.decisionDate?'<div class="muted num" style="font-size:11px">'+thDate(e.decisionDate)+'</div>':'')+'</td>'+
      '<td class="c"><div><button class="clip'+(n?"":" add")+'" data-files="eot:'+e.id+'">'+(n?"📎 "+n:"+ แนบ")+'</button></div></td>'+
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

/* ---------- docs ---------- */
function viewDocs(){
  tools("");
  const refLabel=f=>{
    if(f.refType==="payment"){ const p=S.payments.find(x=>x.id===f.refId); const c=p&&S.contracts.find(c=>c.id===p.contractId);
      return p?((c?c.code+" · ":"")+"งวดที่ "+p.seq+" ("+(p.invoice||"—")+")"):"งวดงานที่ถูกลบ"; }
    if(f.refType==="extra"){ const x=S.extras.find(x=>x.id===f.refId); return x?("งานเพิ่ม · "+x.building):"งานเพิ่มที่ถูกลบ"; }
    if(f.refType==="rfa"){ const r=S.rfas.find(x=>x.id===f.refId); return r?("ขออนุมัติ · "+(r.trade||r.title)+(r.docNo?" ("+r.docNo+")":"")):"รายการขออนุมัติที่ถูกลบ"; }
    if(f.refType==="eot"){ const e=S.eots.find(x=>x.id===f.refId); return e?("ขอขยายเวลาครั้งที่ "+e.no+" · "+e.docNo):"คำขอที่ถูกลบ"; }
    return "โครงการ";
  };
  $("#view").innerHTML='<div class="card"><div class="card-h"><h3>เอกสารแนบทั้งหมด</h3>'+
   '<span class="hint">'+S.files.length+' ไฟล์ · รวม '+bytes(S.files.reduce((s,f)=>s+Number(f.size||0),0))+'</span></div>'+
   '<div class="tablewrap"><table><thead><tr><th>ชื่อไฟล์</th><th>ผูกกับรายการ</th><th>ประเภท</th>'+
   '<th class="r">ขนาด</th><th>วันที่แนบ</th><th></th></tr></thead><tbody>'+
   (S.files.length?S.files.map(f=>'<tr><td>'+esc(f.name)+'</td><td class="muted">'+esc(refLabel(f))+'</td>'+
     '<td class="num muted">'+esc((f.name.split(".").pop()||"").toUpperCase())+'</td>'+
     '<td class="r num">'+bytes(f.size)+'</td>'+
     '<td class="num">'+thDate((f.createdAt||"").slice(0,10))+'</td>'+
     '<td><div class="rowacts"><button class="btn ghost sm" data-dl="'+f.id+'">ดาวน์โหลด</button>'+
     '<button class="btn ghost sm" data-rmfile="'+f.id+'">ลบ</button></div></td></tr>').join("")
    :'<tr><td colspan="6"><div class="empty">ยังไม่มีเอกสารแนบ — แนบได้จากปุ่ม 📎 ในแต่ละรายการ</div></td></tr>')+
   '</tbody></table></div></div>';
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
      '<div class="muted" style="font-size:12.5px;margin-bottom:10px">'+esc(c.contractor)+'</div>'+
      '<div class="ctr-figs" style="margin:0 0 10px"><span>มูลค่าสัญญา <b>'+money(c.amount)+'</b></span>'+
      '<span>จำนวนงวด <b>'+(c.periods||"—")+'</b></span>'+
      '<span>VAT <b>'+(c.vat?c.vat+"%":"ไม่มี")+'</b></span>'+
      '<span>หักประกัน <b>'+(c.retention?c.retention+"%":"ไม่มี")+'</b></span></div>'+
      '<div class="bar"><span style="width:'+Math.min(100,s.billed/Math.max(1,c.amount)*100)+'%"></span></div>'+
      '<div class="muted" style="font-size:12px;margin-top:6px">เบิกแล้ว '+money(s.billed)+' บาท · คงเหลือ '+money(s.rest)+' บาท</div>'+
      (c.endDate?'<div style="font-size:12.5px;margin-top:8px">กำหนดแล้วเสร็จตามสัญญา <b class="num">'+thDateFull(c.endDate)+'</b></div>':'')+
      '<div style="font-size:12px;color:var(--ink-3);margin-top:8px;line-height:1.5">'+esc(c.bank||"")+'</div>'+
      '</div></div>';
    }).join("")+'</div>';
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
    try{ await onSave(o); closeOverlay(); toast("บันทึกแล้ว"); }
    catch(e){ toast("บันทึกไม่สำเร็จ: "+(e.code||e.message)); }
  };
  const first=$("#mform input,#mform select,#mform textarea"); if(first) first.focus();
}
const closeOverlay=()=>{ $("#overlay").innerHTML=""; };
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
    '<div class="f-2">'+fld("reqDate","วันที่เบิก",p.reqDate,"date")+fld("paidDate","วันที่โอน (เว้นว่าง = ยังไม่จ่าย)",p.paidDate,"date")+'</div>'+
    fld("note","หมายเหตุ",p.note),
    async o=>{
      await save(COLS.payments, id||uid("p"), {contractId:o.contractId,seq:Number(o.seq||0),detail:o.detail,
        amount:Number(o.amount||0),vat:Number(o.vat||0),retention:Number(o.retention||0),
        invoice:o.invoice,reqDate:o.reqDate,paidDate:o.paidDate,note:o.note});
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
    sel("contractId","สัญญาที่เกี่ยวข้อง",e.contractId,S.contracts.map(c=>[c.id,c.code+" — "+c.name]))+
    fld("reason","เหตุผล / สาเหตุความล่าช้า",e.reason,"textarea")+
    '<div class="f-3">'+fld("days","จำนวนวันที่ขอ",e.days,"number")+fld("oldEnd","สิ้นสุดเดิม",e.oldEnd,"date")+
    fld("newEnd","สิ้นสุดใหม่",e.newEnd,"date")+'</div>'+
    '<div class="f-2">'+sel("status","สถานะ",e.status,[["รออนุมัติ","รออนุมัติ"],["อนุมัติแล้ว","อนุมัติแล้ว"],["ไม่อนุมัติ","ไม่อนุมัติ"]])+
    fld("decisionDate","วันที่อนุมัติ / ตอบกลับ",e.decisionDate,"date")+'</div>'+
    fld("note","หมายเหตุ",e.note),
    async o=>{ await save(COLS.eots, id||uid("e"), {no:Number(o.no||0),docNo:o.docNo,contractId:o.contractId,
      submitDate:o.submitDate,reason:o.reason,days:Number(o.days||0),oldEnd:o.oldEnd,newEnd:o.newEnd,
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
    '<div class="f-3">'+fld("amount","มูลค่าสัญญา (บาท)",c.amount,"number")+fld("periods","จำนวนงวด",c.periods,"number")+
    fld("endDate","กำหนดแล้วเสร็จ",c.endDate,"date")+'</div>'+
    '<div class="f-3">'+fld("vat","VAT (%)",c.vat,"number")+fld("retention","หักประกัน (%)",c.retention,"number")+
    fld("order","ลำดับแสดงผล",c.order,"number")+'</div>'+
    fld("bank","บัญชีรับเงิน",c.bank,"textarea"),
    async o=>{ await save(COLS.contracts, id||uid("c"), {code:o.code,name:o.name,contractor:o.contractor,
      amount:Number(o.amount||0),periods:Number(o.periods||0),endDate:o.endDate,vat:Number(o.vat||0),
      retention:Number(o.retention||0),order:Number(o.order||0),bank:o.bank}); });
}

/* ---------- attachment drawer ---------- */
function openFiles(refType,refId){
  const title = refType==="payment"?"เอกสารแนบของงวดงาน":refType==="extra"?"เอกสารแนบของงานเพิ่ม":
    refType==="rfa"?"เอกสารแนบของรายการขออนุมัติ":"เอกสารแนบของคำขอขยายเวลา";
  const render=()=>{
    const list=filesFor(refType,refId);
    $("#flist").innerHTML = list.length? list.map(f=>
      '<div class="filerow"><div class="ic">'+esc((f.name.split(".").pop()||"?").slice(0,4).toUpperCase())+'</div>'+
      '<div style="flex:1;min-width:0"><div class="nm">'+esc(f.name)+'</div>'+
      '<div class="mt">'+bytes(f.size)+' · '+thDate((f.createdAt||"").slice(0,10))+'</div></div>'+
      '<button class="btn ghost sm" data-dl="'+f.id+'">บันทึก</button>'+
      '<button class="btn ghost sm" data-rmfile="'+f.id+'">ลบ</button></div>'+
      (/^image\//.test(f.mime||"")?'<img class="thumb" data-img="'+f.id+'" alt="'+esc(f.name)+'">':"")
    ).join("") : '<div class="empty">ยังไม่มีเอกสารแนบ</div>';
    list.filter(f=>/^image\//.test(f.mime||"")).forEach(async f=>{
      const el=document.querySelector('[data-img="'+f.id+'"]'); if(!el) return;
      try{ el.src=await Store.fileUrl(f); }catch(e){}
    });
  };
  $("#overlay").innerHTML='<div class="scrim" data-close="1" style="padding:0;align-items:stretch;justify-content:flex-end">'+
    '<div class="drawer" role="dialog" aria-modal="true" data-stop="1">'+
    '<div class="card-h"><h3>'+esc(title)+'</h3><button class="btn ghost sm" data-close="1">ปิด</button></div>'+
    '<div class="card-b" style="display:grid;gap:14px;align-content:start">'+
      '<div class="drop" id="drop">ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์<br><span class="muted">PDF, รูปภาพ, เอกสาร — ไม่เกิน 4 MB ต่อไฟล์</span></div>'+
      '<input type="file" id="fin" multiple hidden>'+
      '<div id="flist"></div>'+
    '</div></div></div>';
  const drop=$("#drop"), fin=$("#fin");
  drop.onclick=()=>fin.click();
  fin.onchange=async ()=>{ await uploadFiles([...fin.files],refType,refId); render(); };
  ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("hot");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("hot");}));
  drop.addEventListener("drop",async e=>{ await uploadFiles([...e.dataTransfer.files],refType,refId); render(); });
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
  const out=[["สัญญา","งวดที่","รายละเอียดงาน","มูลค่างวด","VAT","หักประกัน","ยอดจ่ายจริง","เลขที่ใบเบิก","วันที่เบิก","วันที่โอน","สถานะ","เอกสารแนบ"]];
  S.contracts.forEach(c=>S.payments.filter(p=>p.contractId===c.id).forEach(p=>
    out.push([c.code,p.seq,p.detail,p.amount,p.vat,p.retention,paidNet(p),p.invoice,thDateFull(p.reqDate),
      p.paidDate?thDateFull(p.paidDate):"",statusLabel(pstatus(p)),filesFor("payment",p.id).length])));
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
  out.push([],["สรุป"],["มูลค่าสัญญารวม",t.contract],["เบิกแล้วสะสม",t.billed+t.extra],["จ่ายแล้ว",t.paid+t.extraPaid],
    ["ค้างจ่าย",t.due],["กำหนดแล้วเสร็จปัจจุบัน",thDateFull(currentEnd())]);
  return out;
}

/* ============================ events ============================ */
document.addEventListener("click",async e=>{
  if(e.target.closest("button[data-close]")){ closeOverlay(); return; }
  if(e.target.classList && e.target.classList.contains("scrim")){ closeOverlay(); return; }
  const t=e.target.closest("[data-view],[data-act],[data-edit],[data-del],[data-files],[data-dl],[data-rmfile]");
  if(!t) return;
  if(t.dataset.view){ S.view=t.dataset.view; S.filter={contract:"",status:"",q:""}; renderAll(); return; }
  if(t.dataset.act){
    const a=t.dataset.act;
    if(a==="new-pay") editPayment(null);
    if(a==="new-extra") editExtra(null);
    if(a==="new-eot") editEot(null);
    if(a==="new-rfa") editRfa(null);
    if(a==="export-rfa") saveCSV("งานขออนุมัติ-มหาวิหารเก้าฟ้า.csv",rfaRows());
    if(a==="new-contract") editContract(null);
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
  if(t.dataset.files){ const [rt,rid]=t.dataset.files.split(":"); openFiles(rt,rid); return; }
  if(t.dataset.dl){ const f=S.files.find(x=>x.id===t.dataset.dl); if(f) downloadFile(f); return; }
  if(t.dataset.rmfile){ const f=S.files.find(x=>x.id===t.dataset.rmfile); if(f){ await deleteFile(f); if(openFiles._render) openFiles._render(); } return; }
});
document.addEventListener("change",e=>{
  const f=e.target.closest("[data-filter]"); if(!f) return;
  S.filter[f.dataset.filter]=f.value; renderAll();
});
document.addEventListener("input",e=>{
  const f=e.target.closest('[data-filter="q"]'); if(!f) return;
  S.filter.q=f.value; S._focusQ=true; clearTimeout(window._qt); window._qt=setTimeout(renderAll,220);
});
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeOverlay(); });
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
      '<div class="f-row"><label for="lg_email">อีเมล</label><input id="lg_email" type="email" autocomplete="username" required></div>'+
      '<div class="f-row"><label for="lg_pw">รหัสผ่าน</label><input id="lg_pw" type="password" autocomplete="current-password" required></div>'+
      '<div id="lg_err" class="muted" style="font-size:12px;color:var(--late)"></div>'+
    '</form>'+
    '<div class="foot"><button class="btn primary" id="lg_go">เข้าสู่ระบบ</button></div></div></div>';
  const go=async()=>{
    const email=$("#lg_email").value.trim(), pw=$("#lg_pw").value;
    $("#lg_err").textContent="";
    try{ await Store.signIn(email,pw); }
    catch(e){ $("#lg_err").textContent = /Invalid/i.test(e.message||"")?"อีเมลหรือรหัสผ่านไม่ถูกต้อง":(e.message||"เข้าสู่ระบบไม่สำเร็จ"); }
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
document.addEventListener("click",e=>{
  if(e.target.id==="logoutBtn"){ Store.signOut(); location.reload(); }
});
renderAll();
boot();