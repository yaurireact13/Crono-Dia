/* ==========================================================================
   Crono-Dia · interfaz. Depende de js/core.js (estado, datos, Supabase).
   Reglas de rendimiento: un solo render por frame (rAF), solo se pinta la
   pantalla activa y no se toca el DOM si el HTML no cambió.
   ========================================================================== */

/* ---------- helpers ---------- */
const $$ = sel => document.querySelectorAll(sel);
const toMin = hhmm => { const [h,m] = hhmm.split(":").map(Number); return h*60+m; };
const nowHHMM = () => { const n = new Date(); return pad(n.getHours())+":"+pad(n.getMinutes()); };
const plusMin = (s,m) => { const t = Math.min(toMin(s)+m, 1439); return pad(Math.floor(t/60))+":"+pad(t%60); };
const isNow = t => {
  if(t.date!==today() || !t.start || t.done) return false;
  const n = nowHHMM();
  return t.start<=n && n < (t.end || plusMin(t.start,60));
};
function durText(a,b){
  const m = toMin(b)-toMin(a); if(m<=0) return "";
  const h = Math.floor(m/60), r = m%60;
  return (h?h+" h":"")+(h&&r?" ":"")+(r?r+" min":"");
}
const EMO = [
  [/meta|ads|anunci|campa|creativ|tiktok|publicid|pixel/i,"📣"],
  [/pedido|despach|env[ií]o|empaque|courier|entrega|stock|inventario|almac/i,"📦"],
  [/gym|entren|ejercicio|correr|pesas|cardio|deporte|f[uú]tbol|nadar/i,"🏋️"],
  [/le(er|ctura)|libro|aprend|curso|estudi|clase/i,"📚"],
  [/planific|agenda|organiz|cronograma/i,"🗓️"],
  [/reuni|llamar|llamada|cliente|proveedor|negoci|socio/i,"🤝"],
  [/n[uú]mero|cierre|finanz|cuenta|cobr|pago|gasto|ventas|caja|ganancia/i,"💰"],
  [/comer|almuer|desayun|cena|cocin/i,"🍽️"],
  [/dorm|descans|siesta/i,"😴"],
  [/whatsapp|mensaje|responder|soporte|chat/i,"💬"],
  [/dise[ñn]|video|foto|content|reel|grab|edit|canva/i,"🎬"],
  [/product|landing|tienda|shopify|web|p[aá]gina|checkout/i,"🛍️"],
  [/medit|respira|diario|reflex|journal|gratitud/i,"🧘"],
  [/famil|mam[aá]|pap[aá]|amig|pareja|salir|novi/i,"🫶"],
  [/limpi|ordenar|casa|lavar|ropa/i,"🧹"],
  [/ia\b|chatgpt|claude|automat|program|c[oó]digo/i,"🤖"]
];
const EMOJI_START = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u;
function emojiFor(title, scope){ for(const [re,e] of EMO) if(re.test(title)) return e; return scope==="trabajo" ? "💼" : "🌿"; }
function splitTitle(t){
  const m = EMOJI_START.exec(t.title);
  if(m) return {emoji:m[1], text:t.title.slice(m[0].length) || t.title};
  return {emoji:emojiFor(t.title, t.scope), text:t.title};
}
let rafId = 0;
function render(){ if(rafId) return; rafId = requestAnimationFrame(()=>{ rafId = 0; try { doRender(); } catch(e){ console.error(e); } }); }
function setHTML(el, html){ if(el._h!==html){ el._h = html; el.innerHTML = html; } }
function animate(el, cls){ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
const SPR = id => `<svg class="illo" aria-hidden="true"><use href="#${id}"/></svg>`;

/* ---------- toast (con acción opcional) ---------- */
function toast(msg, action){
  const t = $("toast"); t.replaceChildren();
  const s = document.createElement("span"); s.textContent = msg; t.append(s);
  if(action){ const b = document.createElement("button"); b.type="button"; b.textContent = action.label; b.onclick = () => { t.hidden = true; action.fn(); }; t.append(b); }
  t.hidden = false; animate(t, "in");
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.hidden = true, action ? 5000 : 2200);
}
function fail(e){ toast(e?.code==="quota_exceeded" ? "Límite de almacenamiento lleno: exporta y borra actividades antiguas" : "No se pudo guardar. Revisa tu conexión e intenta de nuevo"); }

/* ---------- tarjeta de actividad ---------- */
function taskCard(t, o={}){
  const {emoji, text} = splitTitle(t);
  const now = isNow(t), miss = t.date < today() && !t.done;
  const tm = t.start ? fmtTime(t.start)+(t.end ? " → "+fmtTime(t.end) : "") : "";
  const dur = t.start && t.end ? durText(t.start, t.end) : "";
  const chips = [
    now ? '<span class="chip now">● Ahora</span>' : "",
    miss ? '<span class="chip miss">No cumplida</span>' : "",
    state.scope==="todo" && !o.compact ? `<span class="chip ${t.scope}">${t.scope==="trabajo"?"Trabajo":"Personal"}</span>` : "",
    dur ? `<span class="chip">${dur}</span>` : "",
    t.routineId ? '<span class="chip">🔁 fijo</span>' : "",
    t.carried ? '<span class="chip">↪️ pasada</span>' : ""
  ].join("");
  return `<article class="task ${t.scope} ${t.done?"done":""} ${now?"now":""} ${state.just===t.id?"pop":""} ${o.compact?"compact":""}" data-id="${esc(t.id)}" tabindex="0" role="button" aria-label="Editar: ${esc(text)}">
    <div class="emo" aria-hidden="true">${emoji}</div>
    <div class="t-main"><div class="t-title">${esc(text)}</div>
      <div class="t-meta">${tm?`<span class="t-time">${tm}</span>`:""}${chips}</div></div>
    <button class="chk" data-act="toggle" aria-pressed="${!!t.done}" aria-label="${t.done?"Marcar como pendiente":"Marcar como cumplida"}: ${esc(text)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
  </article>`;
}

const GROUPS = [["manana","☀️ Mañana"],["tarde","🌤️ Tarde"],["noche","🌙 Noche"],["sin","📌 Sin hora"]];
const partOf = s => s<"12:00" ? "manana" : s<"18:00" ? "tarde" : "noche";

function emptyHTML(date){
  const past = date < today();
  return `<div class="empty">${SPR("illo-empty")}
    <h3>${past ? "No registraste nada este día" : "Tu día está vacío"}</h3>
    <p>${past ? "Los días sin plan se pasan solos." : "Un día sin plan lo decide otro. Agrega tu primera actividad: qué vas a hacer y a qué hora."}</p>
    ${past ? "" : '<button class="btn-primary" type="button" data-open="new">＋ Agregar actividad</button>'}</div>`;
}
function agendaHTML(list, date){
  if(!state.tasksReady) return '<div class="task sk"></div><div class="task sk"></div><div class="task sk"></div>';
  if(!list.length) return emptyHTML(date);
  const isToday = date===today(), nowS = nowHHMM();
  const buckets = {manana:[], tarde:[], noche:[], sin:[]};
  list.forEach(t => buckets[t.start ? partOf(t.start) : "sin"].push(t));
  let placed = !isToday, html = "";
  for(const [k,label] of GROUPS){
    if(!buckets[k].length) continue;
    html += `<h3 class="grp">${label}</h3><div class="cards">`;
    for(const t of buckets[k]){
      if(!placed && k!=="sin" && t.start>nowS){ html += `<div class="nowline" aria-hidden="true">Ahora · ${fmtTime(nowS)}</div>`; placed = true; }
      html += taskCard(t);
    }
    html += "</div>";
  }
  return html;
}

/* ---------- render ---------- */
function doRender(){
  const v = state.view;
  $$(".view").forEach(s => { s.hidden = s.id !== "v-"+v; });
  $$("[data-view]").forEach(b => b.setAttribute("aria-current", b.dataset.view===v ? "page" : "false"));
  $$(".scope-seg [data-v]").forEach(b => b.setAttribute("aria-pressed", b.dataset.v===state.scope));
  renderBanners();
  if(v==="hoy") renderHoy(); else if(v==="semana") renderSemana(); else if(v==="horario") renderHorario(); else renderAjustes();
  const st = streak();
  setHTML($("sideStreak"), `<b>🔥 ${st}</b><span>${st===1?"día":"días"} de racha</span>`);
}

function renderBanners(){
  const out = [], t0 = today(), yest = addDays(t0,-1);
  const yMiss = state.tasks.filter(t => t.date===yest && live(t) && !t.done);
  if(yMiss.length && !(state.days[yest]||{}).reviewed && state.tasksReady){
    const movable = yMiss.filter(t=>!t.routineId).length;
    out.push(`<div class="notice bad"><span class="n-ico" aria-hidden="true">⚠️</span><div class="n-txt"><b>Ayer dejaste ${yMiss.length} sin cumplir</b><small>${yMiss.slice(0,3).map(t=>esc(splitTitle(t).text)).join(" · ")}${yMiss.length>3?" …":""}</small></div>
      <div class="acts">${movable?`<button class="btn-sm" data-b="carry">Pasar a hoy</button>`:""}<button class="btn-sm ghost" data-b="review">Entendido</button></div></div>`);
  }
  const target = planTarget();
  if(target && state.tasksReady && state.routinesReady && !dayTasks(target,"todo").filter(t=>!t.routineId).length){
    const when = target===t0 ? "hoy" : "mañana";
    out.push(`<div class="notice warn"><span class="n-ico" aria-hidden="true">${state.cfg.planMode==="am"?"☀️":"🌙"}</span><div class="n-txt"><b>Hora de planificar ${when}</b><small>Aún no agregaste actividades para ${when}.</small></div>
      <div class="acts"><button class="btn-sm" data-b="plan" data-date="${target}">Planificar</button></div></div>`);
  }
  setHTML($("banners"), out.join(""));
}

function coachLine(date, tl){
  const t0 = today();
  if(date < t0) return tl.total ? (tl.done===tl.total ? "Ese día lo cerraste completo. 🔥" : `Cerraste ${Math.round(tl.done/tl.total*100)}%. ¿Qué te frenó?`) : "Sin registro. Lo que no se mide no mejora.";
  if(date > t0) return tl.total ? "Planificado. Llega ese día sin negociar." : "Aún sin plan. Hazlo hoy y mañana arrancas ligero.";
  if(!tl.total) return "Un día sin plan lo decide otro. Agrega tu primera actividad.";
  const p = tl.done/tl.total;
  return p===0 ? "Arranca por lo más importante. Marca la primera." : p<.5 ? "Ya empezaste. No dejes enfriar el ritmo." : p<1 ? "Pasaste la mitad. Cierra lo que falta." : "Día cumplido. Descansa con la conciencia limpia. 🔥";
}
const RING_C = 2*Math.PI*42;
let lastPct = null;

function renderHoy(){
  const date = state.date, t0 = today(), d = parse(date), h = new Date().getHours();
  const list = dayTasks(date, state.scope), tl = tally(list);
  const rel = date===t0 ? "Hoy" : date===addDays(t0,1) ? "Mañana" : date===addDays(t0,-1) ? "Ayer" : "";
  $("greet").textContent = date===t0 ? (h<5?"🌙 Madrugada":h<12?"☀️ Buenos días":h<19?"🌤️ Buenas tardes":"🌙 Buenas noches") : date<t0 ? "📖 Así fue" : "🗓️ Por venir";
  $("heroDate").textContent = WD[d.getDay()]+" "+d.getDate();
  $("heroSub").textContent = MONTHS[d.getMonth()]+" "+d.getFullYear()+(rel?" · "+rel:"");
  $("coach").textContent = coachLine(date, tl);
  const pct = tl.total ? tl.done/tl.total : 0;
  const fg = $("ringFg"); fg.style.strokeDashoffset = RING_C*(1-pct); fg.classList.toggle("full", tl.total>0 && tl.done===tl.total);
  $("ringPct").textContent = Math.round(pct*100)+"%";
  $("ringSub").textContent = tl.done+" de "+tl.total;
  $("stPend").textContent = tl.total-tl.done;
  const ws = weekStart(date); let wd=0, wt=0;
  for(let i=0;i<7;i++){ const x = tally(dayTasks(addDays(ws,i), state.scope)); wd+=x.done; wt+=x.total; }
  $("stWeek").textContent = wt ? Math.round(wd/wt*100)+"%" : "—";
  $("stStreak").textContent = streak();
  $("todayBtn").hidden = date===t0;

  setHTML($("strip"), Array.from({length:7},(_,i)=>{
    const s = addDays(ws,i), dd = parse(s), x = tally(dayTasks(s, state.scope));
    return `<button class="dbtn ${s===t0?"today":""}" data-date="${s}" aria-pressed="${s===date}" aria-label="${WD[dd.getDay()]} ${dd.getDate()}${x.total?`, ${x.done} de ${x.total} cumplidas`:", sin actividades"}">
      <small>${WD3[dd.getDay()]}</small><b>${dd.getDate()}</b><span class="mini"><i style="width:${x.total?Math.round(x.done/x.total*100):0}%"></i></span></button>`;
  }).join(""));
  setHTML($("agenda"), agendaHTML(list, date));

  const showClose = date <= t0;
  $("closeCard").hidden = !showClose;
  if(showClose && document.activeElement!==$("dayNote")) $("dayNote").value = (state.days[date]||{}).note || "";
  $("noteHint").textContent = tl.total && tl.done<tl.total ? `Te quedan ${tl.total-tl.done} sin cumplir. Escribe qué los frenó.` : "";

  if(date===t0 && state.just && lastPct!==null && lastPct<1 && tl.total && tl.done===tl.total) burst();
  lastPct = tl.total ? tl.done/tl.total : null;
}

function burst(){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = $("confetti"); box.replaceChildren();
  const E = ["🎉","✨","🔥","⭐","💪","🚀"];
  for(let i=0;i<16;i++){
    const s = document.createElement("span"); s.textContent = E[i%E.length];
    s.style.setProperty("--x", (Math.random()*260-130).toFixed(0)+"px");
    s.style.setProperty("--y", (-60-Math.random()*190).toFixed(0)+"px");
    s.style.setProperty("--r", (Math.random()*60-30).toFixed(0)+"deg");
    s.style.animationDelay = (Math.random()*.15).toFixed(2)+"s";
    box.append(s);
  }
  clearTimeout(burst._t); burst._t = setTimeout(()=>box.replaceChildren(), 1600);
}

function renderSemana(){
  const t0 = today(), ws = weekStart(state.date), we = addDays(ws,6), a = parse(ws), b = parse(we);
  $("wLbl").textContent = a.getDate()+" "+MONTHS[a.getMonth()].slice(0,3)+" – "+b.getDate()+" "+MONTHS[b.getMonth()].slice(0,3);
  $("wSub").textContent = ws===weekStart(t0) ? "Esta semana" : b.getFullYear();
  const days = Array.from({length:7},(_,i)=>{ const s = addDays(ws,i); return {s, d:parse(s), list:dayTasks(s, state.scope), all:dayTasks(s,"todo")}; });
  setHTML($("wBars"), days.map(({s,d,list})=>{
    const x = tally(list), p = x.total ? Math.round(x.done/x.total*100) : 0;
    return `<button class="bar ${s===t0?"today":""} ${x.total&&p>=70?"good":""}" data-date="${s}" aria-label="${WD[d.getDay()]} ${d.getDate()}: ${x.total?p+"% cumplido":"sin actividades"}">
      <em>${x.total?p+"%":"·"}</em><span class="bar-col"><i style="height:${Math.max(p,x.total?6:0)}%"></i></span><small>${WD3[d.getDay()]}</small></button>`;
  }).join(""));
  const all = days.flatMap(x=>x.all);
  const row = (emo,label,list,cls) => { const x = tally(list), p = x.total ? Math.round(x.done/x.total*100) : 0;
    return `<div class="sum-i ${cls}"><div class="sum-h"><span>${emo} ${label}</span><b>${x.total?p+"%":"—"}</b></div><div class="track"><i style="width:${p}%"></i></div><small>${x.done} de ${x.total} cumplidas</small></div>`; };
  setHTML($("wSum"), row("💼","Trabajo",all.filter(t=>t.scope==="trabajo"),"trabajo")+row("🌿","Vida personal",all.filter(t=>t.scope==="personal"),"personal"));
  setHTML($("wDays"), days.map(({s,d,list})=>{
    const x = tally(list);
    return `<section class="wk-card ${s===t0?"today":""}"><button class="wk-head" data-date="${s}" aria-label="Abrir ${WD[d.getDay()]} ${d.getDate()}"><b>${WD[d.getDay()]} ${d.getDate()}${s===t0?" · hoy":""}</b><span>${x.total?x.done+"/"+x.total:"libre"} ›</span></button>
      ${list.length ? `<div class="cards">${list.map(t=>taskCard(t,{compact:true})).join("")}</div>` : '<p class="free">Día libre. 🌴</p>'}</section>`;
  }).join(""));
}

function dayText(days){
  const s = [...days].sort((x,y)=>((x+6)%7)-((y+6)%7)).join(",");
  return s==="1,2,3,4,5,6,0" ? "Todos los días" : s==="1,2,3,4,5" ? "Lun a vie" : s==="1,2,3,4,5,6" ? "Lun a sáb" : s==="6,0" ? "Fin de semana" : "";
}
function renderHorario(){
  setHTML($("rDays"), DAY_CHIPS.map(([v,l,n])=>`<button type="button" class="chip-d" data-d="${v}" aria-pressed="${state.rDays.includes(v)}" aria-label="${n}">${l}</button>`).join(""));
  const rs = state.routines.slice().sort((a,b)=>(a.start||"99").localeCompare(b.start||"99"));
  setHTML($("rtWeek"), !state.routinesReady ? "" : rs.length ? rs.map(r=>{
    const {emoji,text} = splitTitle(r);
    return `<article class="rt ${r.scope}"><div class="emo" aria-hidden="true">${emoji}</div>
      <div class="t-main"><div class="t-title">${esc(text)}</div><div class="t-meta"><span class="t-time">${r.start?fmtTime(r.start)+(r.end?" → "+fmtTime(r.end):""):"Sin hora"}</span><span class="chip ${r.scope}">${r.scope==="trabajo"?"Trabajo":"Personal"}</span>${dayText(r.days||"")?`<span class="chip">${dayText(r.days)}</span>`:""}</div>
      <div class="pips" aria-hidden="true">${DAY_CHIPS.map(([v,l])=>`<i class="${(r.days||[]).includes(v)?"on":""}">${l}</i>`).join("")}</div></div>
      <button class="x-btn" data-rdel="${esc(r.id)}" aria-label="Quitar del horario: ${esc(text)}">✕</button></article>`;
  }).join("") : `<div class="empty">${SPR("illo-routine")}<h3>Aún no tienes horario fijo</h3><p>Lo que repites cada semana aparece solo en tu agenda. Empieza con una plantilla para e-commerce y edítala a tu medida.</p><button class="btn-primary" id="tplBtn" type="button">✨ Cargar plantilla sugerida</button></div>`);
}
function renderAjustes(){
  if(document.activeElement!==$("cfgMode")) $("cfgMode").value = state.cfg.planMode;
  if(document.activeElement!==$("cfgTime")) $("cfgTime").value = state.cfg.planTime;
  let th = "auto"; try { th = localStorage.getItem("cronodia.theme") || "auto"; } catch {}
  if(document.activeElement!==$("themeSel")) $("themeSel").value = th;
}

/* ---------- hoja de actividad (crear / editar) ---------- */
const sheet = $("sheet");
let editing = null, afterSave = false;
function setFScope(v){ state.fScope = v; $$("#fScopeSeg [data-v]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.v===v)); updateEmoPrev(); }
function updateEmoPrev(){ const v = $("fTitle").value.trim(); $("emoPrev").textContent = splitTitle({title:v||" ", scope:state.fScope}).emoji; }
function openSheet(id, o={}){
  editing = id ? state.tasks.find(t=>t.id===id) || null : null;
  const e = editing;
  $("sheetTitle").textContent = e ? "Editar actividad" : "Nueva actividad";
  $("againBtn").hidden = !!e; $("editActs").hidden = !e; $("pushBtn").hidden = !!(e && e.routineId);
  $("saveBtn").textContent = e ? "Guardar cambios" : "Guardar";
  setFScope(e ? e.scope : (state.scope!=="todo" ? state.scope : state.fScope));
  $("fTitle").value = e ? e.title : ""; $("fStart").value = e ? e.start||"" : ""; $("fEnd").value = e ? e.end||"" : "";
  $("fDate").value = e ? e.date : (o.date || state.date); $("fDate").disabled = !!(e && e.routineId);
  updateEmoPrev();
  if(!sheet.open) sheet.showModal();
  if(!e) setTimeout(()=>$("fTitle").focus(), 60);
}
function closeSheet(){ if(sheet.open) sheet.close(); }
sheet.addEventListener("click", e => { if(e.target===sheet) closeSheet(); });
$("sheetX").onclick = closeSheet;
$("fTitle").addEventListener("input", updateEmoPrev);
$("fScopeSeg").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if(b) setFScope(b.dataset.v); });
$("qToday").onclick = () => { $("fDate").value = today(); };
$("qTomorrow").onclick = () => { $("fDate").value = addDays(today(),1); };
$("saveBtn").addEventListener("click", () => { afterSave = false; });
$("againBtn").addEventListener("click", () => { afterSave = true; });

$("taskForm").addEventListener("submit", async e => {
  e.preventDefault();
  const title = $("fTitle").value.trim(), start = $("fStart").value, end = $("fEnd").value;
  if(!title){ toast("Escribe qué vas a hacer"); $("fTitle").focus(); return; }
  if(start && end && end<=start){ toast("La hora de fin debe ser después del inicio"); $("fEnd").focus(); return; }
  if(!store){ toast("Conectando, intenta en un segundo"); return; }
  const date = $("fDate").value || today();
  const btns = [$("saveBtn"), $("againBtn")]; btns.forEach(b=>b.disabled = true);
  try {
    if(editing) await store.setTask({...editing, title, scope:state.fScope, start, end, date: editing.routineId ? editing.date : date});
    else await store.setTask({id:uuid(), title, scope:state.fScope, date, start, end, done:false, ts:Date.now()});
    toast(editing ? "Cambios guardados" : "Guardada para "+(date===today()?"hoy":date===addDays(today(),1)?"mañana":date.slice(8,10)+"/"+date.slice(5,7)));
    if(!editing && afterSave){ $("fTitle").value=""; $("fStart").value=""; $("fEnd").value=""; updateEmoPrev(); $("fTitle").focus(); }
    else closeSheet();
    if(date!==state.date && !editing){ state.date = date; state.view = "hoy"; }
    sync();
  } catch(err){ fail(err); }
  finally { btns.forEach(b=>b.disabled = false); }
});
$("pushBtn").onclick = async () => {
  if(!editing || !store) return;
  try { await store.setTask({...editing, date:addDays(editing.date,1), carried:true}); closeSheet(); toast("Pasada al día siguiente"); } catch(err){ fail(err); }
};
$("delBtn").onclick = async () => {
  const t = editing; if(!t || !store) return;
  try {
    if(t.routineId) await store.setTask({...t, skipped:true}); else await store.delTask(t.id);
    closeSheet();
    toast("Actividad eliminada", {label:"Deshacer", fn: async () => { try { await store.setTask({...t, skipped:false}); } catch(err){ fail(err); } }});
  } catch(err){ fail(err); }
};

/* ---------- navegación y eventos ---------- */
function go(view){ state.view = view; sync(); if(innerWidth<860) scrollTo({top:0}); const v = $("v-"+view); animate(v, "enter"); }
$$("[data-view]").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
$("addBtn").onclick = () => openSheet(null);
$$(".scope-seg").forEach(seg => seg.addEventListener("click", e => { const b = e.target.closest("[data-v]"); if(!b) return; state.scope = b.dataset.v; if(b.dataset.v!=="todo") state.fScope = b.dataset.v; render(); }));
function shiftDate(k, anim){ state.date = addDays(state.date,k); sync(); if(anim) animate($("agenda"), k>0?"swap-l":"swap-r"); }
$("wkPrev").onclick = () => shiftDate(-7); $("wkNext").onclick = () => shiftDate(7);
$("wPrev").onclick = () => shiftDate(-7); $("wNext").onclick = () => shiftDate(7);
$("todayBtn").onclick = () => { state.date = today(); sync(); animate($("agenda"),"swap-r"); };
$("strip").addEventListener("click", e => { const b = e.target.closest("[data-date]"); if(!b) return; const k = b.dataset.date > state.date ? 1 : -1; state.date = b.dataset.date; sync(); animate($("agenda"), k>0?"swap-l":"swap-r"); });
$("wBars").addEventListener("click", e => { const b = e.target.closest("[data-date]"); if(b){ state.date = b.dataset.date; state.view = "hoy"; sync(); animate($("v-hoy"),"enter"); scrollTo({top:0}); } });
$("wDays").addEventListener("click", e => {
  const h = e.target.closest(".wk-head");
  if(h){ state.date = h.dataset.date; state.view = "hoy"; sync(); animate($("v-hoy"),"enter"); scrollTo({top:0}); return; }
  taskClick(e);
});
$("agenda").addEventListener("click", e => { if(e.target.closest("[data-open]")) { openSheet(null); return; } taskClick(e); });
const onKey = e => { if((e.key==="Enter"||e.key===" ") && e.target.classList?.contains("task")){ e.preventDefault(); openSheet(e.target.dataset.id); } };
$("agenda").addEventListener("keydown", onKey); $("wDays").addEventListener("keydown", onKey);

async function taskClick(e){
  const card = e.target.closest(".task"); if(!card || card.classList.contains("sk")) return;
  const t = state.tasks.find(x=>x.id===card.dataset.id); if(!t) return;
  if(e.target.closest(".chk")){
    if(!store) return;
    state.just = t.done ? null : t.id;
    try { await store.setTask({...t, done:!t.done, doneAt:!t.done ? Date.now() : null}); } catch(err){ fail(err); }
    return;
  }
  openSheet(t.id);
}

/* swipe horizontal para cambiar de día */
{
  let sx = 0, sy = 0, tracking = false;
  const v = $("v-hoy");
  v.addEventListener("touchstart", e => { if(e.touches.length!==1 || e.target.closest("input,textarea,.strip")) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true; }, {passive:true});
  v.addEventListener("touchend", e => {
    if(!tracking) return; tracking = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if(Math.abs(dx)>80 && Math.abs(dy)<50) shiftDate(dx<0 ? 1 : -1, true);
  }, {passive:true});
}

$("banners").addEventListener("click", async e => {
  const b = e.target.closest("[data-b]"); if(!b || !store) return;
  const t0 = today(), yest = addDays(t0,-1);
  try {
    if(b.dataset.b==="plan"){ state.view = "hoy"; state.date = b.dataset.date; sync(); openSheet(null, {date:b.dataset.date}); return; }
    if(b.dataset.b==="carry"){
      const mv = state.tasks.filter(t=>t.date===yest && live(t) && !t.done && !t.routineId);
      for(const t of mv) await store.setTask({...t, date:t0, carried:true});
      toast(mv.length+" pasada"+(mv.length>1?"s":"")+" a hoy");
    }
    await store.setDay(yest, {...(state.days[yest]||{}), reviewed:true});
    render();
  } catch(err){ fail(err); }
});

$("dayNote").addEventListener("change", async () => {
  if(!store) return;
  try { await store.setDay(state.date, {...(state.days[state.date]||{}), note:$("dayNote").value.trim()}); toast("Cierre guardado"); } catch(err){ fail(err); }
});

/* ---------- horario fijo ---------- */
$("rDays").addEventListener("click", e => {
  const b = e.target.closest(".chip-d"); if(!b) return;
  const v = Number(b.dataset.d);
  state.rDays = state.rDays.includes(v) ? state.rDays.filter(x=>x!==v) : [...state.rDays, v];
  render();
});
$("rtForm").addEventListener("submit", async e => {
  e.preventDefault();
  const title = $("rTitle").value.trim(), start = $("rStart").value, end = $("rEnd").value;
  if(!title) return;
  if(!state.rDays.length){ toast("Elige al menos un día"); return; }
  if(start && end && end<=start){ toast("La hora de fin debe ser después del inicio"); return; }
  if(!store) return;
  try { await store.setRoutine({id:uuid(), title, scope:$("rScope").value, start, end, days:[...state.rDays], from:today()}); $("rTitle").value=""; $("rForm").open = false; toast("Agregado al horario fijo"); } catch(err){ fail(err); }
});
$("rtWeek").addEventListener("click", async e => {
  if(e.target.closest("#tplBtn") && store){
    const T = [
      ["Revisar Meta Ads: ROAS, CPA y creativos","trabajo","09:00","10:00",[1,2,3,4,5]],
      ["Pedidos, confirmaciones y despacho","trabajo","10:00","12:30",[1,2,3,4,5,6]],
      ["Probar creativos nuevos","trabajo","15:00","16:30",[1,2,3,4,5]],
      ["Cierre: números del día","trabajo","18:00","18:30",[1,2,3,4,5]],
      ["Gym","personal","07:00","08:00",[1,2,3,4,5]],
      ["Lectura o aprendizaje (30 min)","personal","21:30","22:00",[1,2,3,4,5,6,0]],
      ["Planificar mañana","personal","22:45","23:00",[1,2,3,4,5,6,0]]
    ];
    try { for(const [title,scope,start,end,days] of T) await store.setRoutine({id:uuid(), title, scope, start, end, days, from:today()}); toast("Plantilla cargada: edítala a tu medida"); } catch(err){ fail(err); }
    return;
  }
  const b = e.target.closest("[data-rdel]"); if(!b || !store) return;
  const r = state.routines.find(x=>x.id===b.dataset.rdel); if(!r) return;
  try {
    const t0 = today(), gone = state.tasks.filter(t=>t.routineId===r.id && t.date>=t0 && !t.done);
    for(const t of gone) await store.delTask(t.id);
    await store.delRoutine(r.id);
    toast("Quitado del horario fijo", {label:"Deshacer", fn: async () => { try { await store.setRoutine(r); } catch(err){ fail(err); } }});
  } catch(err){ fail(err); }
});

/* ---------- ajustes ---------- */
async function saveCfg(){
  if(!store) return;
  const planTime = $("cfgTime").value || (($("cfgMode").value==="am") ? "08:00" : "23:00");
  try { await store.setCfg({planMode:$("cfgMode").value, planTime}); toast("Aviso guardado"); } catch(err){ fail(err); }
}
$("cfgMode").addEventListener("change", () => { $("cfgTime").value = $("cfgMode").value==="am" ? "08:00" : "23:00"; saveCfg(); });
$("cfgTime").addEventListener("change", saveCfg);
$("themeSel").addEventListener("change", () => {
  const v = $("themeSel").value;
  try { localStorage.setItem("cronodia.theme", v); } catch {}
  if(v==="auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", v);
});
$("exportBtn").onclick = () => {
  const rows = state.tasks.filter(live).sort((a,b)=>a.date.localeCompare(b.date)||(a.start||"").localeCompare(b.start||""));
  if(!rows.length){ toast("No hay actividades para exportar"); return; }
  const q = s => { s = String(s??""); if(/^[=+\-@]/.test(s)) s = "'"+s; return '"'+s.replace(/"/g,'""')+'"'; };  // evita fórmulas al abrir en Excel
  const csv = "fecha,ambito,actividad,inicio,fin,cumplida\n" + rows.map(t=>[t.date,t.scope,q(t.title),t.start||"",t.end||"",t.done?"si":"no"].join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿"+csv], {type:"text/csv;charset=utf-8"})); a.download = "crono-dia-todo.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
};

/* ---------- acceso ---------- */
let authMode = "login";
function authMsg(text, bad=true){ const m = $("aMsg"); m.textContent = text; m.hidden = !text; m.classList.toggle("bad", bad); }
function setAuthMode(m){
  authMode = m;
  $$("#aTabs [data-m]").forEach(b => b.setAttribute("aria-pressed", b.dataset.m===m));
  $("aSubmit").textContent = m==="login" ? "Entrar" : "Crear mi cuenta";
  $("aPass").autocomplete = m==="login" ? "current-password" : "new-password";
  $("aTitle").textContent = m==="login" ? "Qué bueno verte de vuelta" : "Crea tu cuenta";
  authMsg("");
}
$("aTabs").addEventListener("click", e => { const b = e.target.closest("[data-m]"); if(b) setAuthMode(b.dataset.m); });
const AUTH_ES = { "Invalid login credentials":"Correo o contraseña incorrectos.", "User already registered":"Ese correo ya tiene cuenta. Usa Entrar.", "Email not confirmed":"Confirma tu correo con el enlace que te enviamos y vuelve a entrar." };
const authErr = e => AUTH_ES[e?.message] || (e?.message?.includes("at least") ? "La contraseña debe tener al menos 6 caracteres." : "No se pudo completar. Revisa tus datos e intenta de nuevo.");
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  if(!sb) return;
  const email = $("aEmail").value.trim(), password = $("aPass").value;
  if(!email || password.length<6){ authMsg("Escribe tu correo y una contraseña de al menos 6 caracteres."); return; }
  authMsg(""); $("aSubmit").disabled = true;
  try {
    if(authMode==="login"){
      const { error } = await sb.auth.signInWithPassword({email,password});
      if(error) authMsg(authErr(error));
    } else {
      const { data, error } = await sb.auth.signUp({email,password});
      if(error) authMsg(authErr(error));
      else if(!data.session) authMsg("Cuenta creada. Revisa tu correo y confirma el enlace; luego entra aquí.", false);
    }
  } catch { authMsg("Sin conexión. Intenta de nuevo."); }
  finally { $("aSubmit").disabled = false; }
});
$("logoutBtn").addEventListener("click", async () => { if(sb) await sb.auth.signOut(); });

/* ---------- arranque ---------- */
setInterval(() => { if(!document.hidden && state.tasksReady && state.view==="hoy") render(); }, 30000);
setAuthMode("login");
boot();
