const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const ymd = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (s,k) => { const d=parse(s); d.setDate(d.getDate()+k); return ymd(d); };
const today = () => ymd(new Date());
const weekStart = s => addDays(s, -((parse(s).getDay()+6)%7));
const WD = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const WD3 = ["dom","lun","mar","mié","jue","vie","sáb"];
const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DAY_CHIPS = [[1,"L","Lunes"],[2,"M","Martes"],[3,"X","Miércoles"],[4,"J","Jueves"],[5,"V","Viernes"],[6,"S","Sábado"],[0,"D","Domingo"]];
const SCOPE_NAME = {trabajo:"Trabajo", personal:"Personal"};
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtTime = hhmm => { if(!hhmm) return ""; const [h,m]=hhmm.split(":").map(Number); return (h%12||12)+":"+pad(m)+" "+(h<12?"am":"pm"); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==="x"?r:(r&3|8)).toString(16)}));

const state = { tasks:[], routines:[], days:{}, cfg:{planMode:"pm",planTime:"23:00"}, date:today(), view:"dia", scope:"todo", fScope:"trabajo", rDays:[1,2,3,4,5], tasksReady:false, routinesReady:false, userId:null, mode:null };

/* ---------- storage: Supabase (synced) with local fallback ---------- */
let store = null, sb = null, channel = null, reloadTimer = null;
const LS_KEY = "cronodia.v1";
const pendingKeys = new Set();
const hhmm = v => v ? String(v).slice(0,5) : "";
const rKey = (routineId,date) => routineId+"|"+date;

/* row <-> app object mapping */
const taskFromRow = r => ({ id:r.id, title:r.title, scope:r.scope, date:r.date, start:hhmm(r.start_time), end:hhmm(r.end_time), done:r.done, doneAt:r.done_at?Date.parse(r.done_at):null, skipped:r.skipped, carried:r.carried, routineId:r.routine_id, ts:Date.parse(r.created_at)||0 });
const taskToRow = t => ({ id:t.id, title:t.title, scope:t.scope, date:t.date, start_time:t.start||null, end_time:t.end||null, done:!!t.done, done_at:t.doneAt?new Date(t.doneAt).toISOString():null, skipped:!!t.skipped, carried:!!t.carried, routine_id:t.routineId||null });
const routineFromRow = r => ({ id:r.id, title:r.title, scope:r.scope, start:hhmm(r.start_time), end:hhmm(r.end_time), days:r.days||[], from:r.from_date });
const routineToRow = r => ({ id:r.id, title:r.title, scope:r.scope, start_time:r.start||null, end_time:r.end||null, days:r.days, from_date:r.from });

function lsLoad(){ try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function lsSave(){ try { localStorage.setItem(LS_KEY, JSON.stringify({tasks:state.tasks,routines:state.routines,days:state.days,cfg:state.cfg})); } catch {} }
const upsertLocal = (arr, item) => { const i=arr.findIndex(x=>x.id===item.id); if(i>=0) arr[i]=item; else arr.push(item); };

function showApp(on){
  $("appView").hidden = !on;
  $("authView").hidden = on;
}

function useLocal(msg){
  const d = lsLoad();
  state.tasks = d.tasks||[]; state.routines = d.routines||[]; state.days = d.days||{}; state.cfg = {...state.cfg, ...(d.cfg||{})};
  state.tasksReady = state.routinesReady = true; state.mode = "local";
  $("storeBanner").textContent = msg; $("storeBanner").hidden = false;
  showApp(true);
  store = {
    setTask: async t => { upsertLocal(state.tasks, t); lsSave(); sync(); },
    ensureTask: async t => { upsertLocal(state.tasks, t); lsSave(); sync(); },
    delTask: async id => { state.tasks = state.tasks.filter(t=>t.id!==id); lsSave(); sync(); },
    setRoutine: async r => { upsertLocal(state.routines, r); lsSave(); sync(); },
    delRoutine: async id => { state.routines = state.routines.filter(r=>r.id!==id); lsSave(); sync(); },
    setDay: async (date,body) => { state.days[date]=body; lsSave(); render(); },
    setCfg: async c => { state.cfg=c; lsSave(); render(); }
  };
  sync();
}

/* Supabase store: optimistic local update first, then write; on failure reload the truth from the server. */
function makeSupabaseStore(){
  const run = async (promise) => { const { error } = await promise; if(error){ scheduleReload(0); throw error; } };
  return {
    setTask: async t => { upsertLocal(state.tasks, t); render(); await run(sb.from("tasks").upsert(taskToRow(t))); },
    ensureTask: async t => { upsertLocal(state.tasks, t); await run(sb.from("tasks").upsert(taskToRow(t), {onConflict:"user_id,routine_id,date", ignoreDuplicates:true})); },
    delTask: async id => { state.tasks = state.tasks.filter(t=>t.id!==id); render(); await run(sb.from("tasks").delete().eq("id", id)); },
    setRoutine: async r => { upsertLocal(state.routines, r); sync(); await run(sb.from("routines").upsert(routineToRow(r))); },
    delRoutine: async id => { state.routines = state.routines.filter(r=>r.id!==id); render(); await run(sb.from("routines").delete().eq("id", id)); },
    setDay: async (date, body) => { state.days[date] = body; render(); await run(sb.from("days").upsert({user_id:state.userId, date, note:body.note||"", reviewed:!!body.reviewed})); },
    setCfg: async c => { state.cfg = c; render(); await run(sb.from("settings").upsert({user_id:state.userId, plan_mode:c.planMode, plan_time:c.planTime})); }
  };
}

async function loadAll(){
  const [t, r, d, c] = await Promise.all([
    sb.from("tasks").select("*").order("date",{ascending:false}).limit(5000),
    sb.from("routines").select("*"),
    sb.from("days").select("*"),
    sb.from("settings").select("*").maybeSingle()
  ]);
  const err = t.error || r.error || d.error || c.error;
  if(err) throw err;
  state.tasks = t.data.map(taskFromRow);
  state.routines = r.data.map(routineFromRow);
  state.days = Object.fromEntries(d.data.map(x => [x.date, {note:x.note, reviewed:x.reviewed}]));
  if(c.data) state.cfg = {planMode:c.data.plan_mode, planTime:hhmm(c.data.plan_time)};
  state.tasksReady = state.routinesReady = true;
}
function scheduleReload(ms=400){
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async ()=>{ if(!state.userId) return; try { await loadAll(); sync(); } catch {} }, ms);
}

async function startSession(session){
  if(state.userId===session.user.id) return;
  state.userId = session.user.id; state.mode = "supabase";
  $("acct").textContent = "Sesión: "+session.user.email; $("acct").hidden = false; $("logoutBtn").hidden = false;
  store = makeSupabaseStore();
  showApp(true);
  render();
  try { await loadAll(); }
  catch { $("storeBanner").textContent = "No se pudieron cargar tus datos. Revisa tu conexión y que hayas ejecutado schema.sql en Supabase."; $("storeBanner").hidden = false; return; }
  $("storeBanner").hidden = true;
  sync();
  channel = sb.channel("cronodia")
    .on("postgres_changes", {event:"*", schema:"public"}, () => scheduleReload())
    .subscribe();
}
function endSession(){
  state.userId = null; state.tasks = []; state.routines = []; state.days = {}; state.tasksReady = state.routinesReady = false;
  store = null;
  if(channel){ sb.removeChannel(channel); channel = null; }
  $("acct").hidden = true; $("logoutBtn").hidden = true;
  showApp(false);
}

async function boot(){
  const cfg = window.CRONODIA_CONFIG || {};
  if(!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase){
    useLocal("Modo local: los datos se guardan solo en este navegador. Para sincronizar, completa config.js con tu proyecto de Supabase.");
    return;
  }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  // No hacer llamadas a Supabase dentro de este callback: se difieren con setTimeout.
  sb.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => { if(session) startSession(session); else endSession(); }, 0);
  });
  document.addEventListener("visibilitychange", () => { if(!document.hidden && state.userId) scheduleReload(0); });
}

/* ---------- auth ---------- */
function authMsg(text, bad=true){ const m=$("aMsg"); m.textContent=text; m.hidden=!text; m.classList.toggle("bad", bad); }
const AUTH_ES = { "Invalid login credentials":"Correo o contraseña incorrectos.", "User already registered":"Ese correo ya tiene cuenta. Usa Entrar.", "Email not confirmed":"Confirma tu correo con el enlace que te enviamos y vuelve a entrar." };
const authErr = e => AUTH_ES[e?.message] || (e?.message?.includes("at least")?"La contraseña debe tener al menos 6 caracteres.":"No se pudo completar. Revisa tus datos e intenta de nuevo.");
async function doAuth(kind){
  if(!sb) return;
  const email=$("aEmail").value.trim(), password=$("aPass").value;
  if(!email || password.length<6){ authMsg("Escribe tu correo y una contraseña de al menos 6 caracteres."); return; }
  authMsg(""); $("aLogin").disabled = $("aSignup").disabled = true;
  try {
    if(kind==="login"){
      const { error } = await sb.auth.signInWithPassword({email,password});
      if(error) authMsg(authErr(error));
    } else {
      const { data, error } = await sb.auth.signUp({email,password});
      if(error) authMsg(authErr(error));
      else if(!data.session) authMsg("Cuenta creada. Revisa tu correo y confirma el enlace; luego entra aquí.", false);
    }
  } catch { authMsg("Sin conexión. Intenta de nuevo."); }
  finally { $("aLogin").disabled = $("aSignup").disabled = false; }
}
$("authForm").addEventListener("submit", e=>{ e.preventDefault(); doAuth("login"); });
$("aSignup").addEventListener("click", ()=>doAuth("signup"));
$("logoutBtn").addEventListener("click", async ()=>{ if(sb) await sb.auth.signOut(); });

/* ---------- routines -> tasks (one per routine and day) ---------- */
function ensureRoutines(){
  if(!store || !state.tasksReady || !state.routinesReady) return;
  const t0 = today();
  const dates = new Set([t0, addDays(t0,1), state.date]);
  const ws = weekStart(state.date);
  for(let i=0;i<7;i++) dates.add(addDays(ws,i));
  const have = new Set(state.tasks.filter(t=>t.routineId).map(t=>rKey(t.routineId,t.date)));
  dates.forEach(date => {
    if(date < t0) return;
    const wd = parse(date).getDay();
    state.routines.forEach(r => {
      if(!(r.days||[]).includes(wd) || (r.from && date < r.from)) return;
      const key = rKey(r.id,date);
      if(have.has(key) || pendingKeys.has(key)) return;
      pendingKeys.add(key);
      Promise.resolve(store.ensureTask({id:uuid(), title:r.title, scope:r.scope, date, start:r.start||"", end:r.end||"", done:false, routineId:r.id, ts:Date.now()}))
        .catch(()=>{});  // si falla, la clave sigue bloqueada para no reintentar en bucle hasta recargar
    });
  });
}
function sync(){ ensureRoutines(); render(); }

/* ---------- derived ---------- */
const byTime = (a,b) => (a.start||"99:99").localeCompare(b.start||"99:99") || (a.ts||0)-(b.ts||0);
const live = t => !t.skipped;
function dayTasks(date, scope){ return state.tasks.filter(t=>t.date===date && live(t) && (scope==="todo"||t.scope===scope)).sort(byTime); }
function tally(list){ const done=list.filter(t=>t.done).length; return {done, total:list.length, pct:list.length?done/list.length:null}; }
function streak(){
  let n=0, d=today();
  const t = tally(dayTasks(d,"todo"));
  if(t.pct!==null && t.pct>=0.7) n++;
  for(let i=0;i<120;i++){
    d = addDays(d,-1);
    const x = tally(dayTasks(d,"todo"));
    if(x.pct!==null && x.pct>=0.7) n++; else break;
  }
  return n;
}
function planTarget(){
  const now = new Date(), h = now.getHours()+now.getMinutes()/60;
  const [ph,pm] = (state.cfg.planTime||"23:00").split(":").map(Number), p = ph+pm/60;
  if(state.cfg.planMode==="am") return (h>=p && h<14) ? today() : null;
  if(h>=p) return addDays(today(),1);
  if(h<4) return today();
  return null;
}
function rangeText(t){ return t.start ? (fmtTime(t.start)+(t.end?" – "+fmtTime(t.end):"")) : ""; }
function isNow(t){
  if(t.date!==today() || !t.start || t.done) return false;
  const n = pad(new Date().getHours())+":"+pad(new Date().getMinutes());
  return t.start<=n && (t.end ? n<t.end : n<addMinutes(t.start,60));
}
function addMinutes(hhmm,m){ const [h,mi]=hhmm.split(":").map(Number); const t=h*60+mi+m; return pad(Math.floor(t/60)%24)+":"+pad(t%60); }

/* ---------- render ---------- */
function taskRow(t, opts={}){
  const past = t.date < today();
  const miss = past && !t.done;
  const now = isNow(t);
  const tm = rangeText(t);
  return `<div class="task ${t.done?"done":""} ${now?"now":""}">
    <button class="chk" data-act="toggle" data-id="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="${t.done?"Marcar como pendiente":"Marcar como cumplida"}: ${esc(t.title)}">✓</button>
    <div class="t-main"><div class="t-title">${esc(t.title)}</div>
      <small><span class="tag ${t.scope}">${t.scope==="trabajo"?"Trabajo":"Personal"}</span>${tm?`<span class="t-time">${tm}</span>`:""}${t.routineId?"<span>↻ fijo</span>":""}${t.carried?"<span>↪ de ayer</span>":""}${now?'<span class="tag now">Ahora</span>':""}${miss?'<span class="tag miss">No cumplida</span>':""}</small></div>
    ${opts.compact || t.done ? "<span></span>" : `<button class="push" data-act="push" data-id="${esc(t.id)}" aria-label="Pasar a mañana" title="Pasar al día siguiente">→</button>`}
    <button class="del" data-act="del" data-id="${esc(t.id)}" aria-label="Eliminar">✕</button></div>`;
}

function render(){
  // view + scope toggles
  $("dayView").hidden = state.view!=="dia";
  $("weekView").hidden = state.view!=="semana";
  [...$("viewSeg").children].forEach(b=>b.setAttribute("aria-pressed", b.dataset.v===state.view));
  [...$("scopeSeg").children].forEach(b=>b.setAttribute("aria-pressed", b.dataset.v===state.scope));
  [...$("fScopeSeg").children].forEach(b=>b.setAttribute("aria-pressed", b.dataset.v===state.fScope));
  renderBanners();
  if(state.view==="dia") renderDay(); else renderWeek();
  renderSettings();
}

function renderBanners(){
  const out = [];
  const t0 = today(), yest = addDays(t0,-1);
  // yesterday not completed
  const yMiss = state.tasks.filter(t=>t.date===yest && live(t) && !t.done);
  if(yMiss.length && !(state.days[yest]||{}).reviewed && state.tasksReady){
    const movable = yMiss.filter(t=>!t.routineId).length;
    out.push(`<div class="banner bad"><span><b>Ayer dejaste ${yMiss.length} sin cumplir.</b> ${yMiss.slice(0,3).map(t=>esc(t.title)).join(" · ")}${yMiss.length>3?" …":""}</span>
      <div class="acts">${movable?`<button class="ghost sm" data-b="carry">Pasar ${movable===yMiss.length?"a hoy":movable+" a hoy"}</button>`:""}<button class="ghost sm" data-b="review">Entendido</button></div></div>`);
  }
  // planning prompt
  const target = planTarget();
  if(target && state.tasksReady && state.routinesReady){
    const real = dayTasks(target,"todo").filter(t=>!t.routineId);
    if(!real.length){
      const when = target===t0 ? "hoy" : "mañana";
      out.push(`<div class="banner warn"><span><b>Hora de planificar ${when}.</b> Todavía no agregaste actividades para ${when}.</span><div class="acts"><button class="ghost sm" data-b="plan" data-date="${target}">Planificar ${when}</button></div></div>`);
    }
  }
  $("banners").innerHTML = out.join("");
}

function renderDay(){
  const date = state.date, t0 = today();
  const d = parse(date);
  const rel = date===t0?"Hoy":date===addDays(t0,1)?"Mañana":date===addDays(t0,-1)?"Ayer":WD[d.getDay()];
  $("dLbl").textContent = rel;
  $("dSub").textContent = WD[d.getDay()]+" "+d.getDate()+" de "+MONTHS[d.getMonth()]+" de "+d.getFullYear();
  $("todayBtn").hidden = date===t0;

  // week strip
  const ws = weekStart(date);
  $("strip").innerHTML = Array.from({length:7},(_,i)=>{
    const s = addDays(ws,i), dd = parse(s), tl = tally(dayTasks(s,state.scope));
    return `<button class="dbtn ${s===t0?"today":""}" data-date="${s}" aria-pressed="${s===date}" aria-label="${WD[dd.getDay()]} ${dd.getDate()}${tl.total?`, ${tl.done} de ${tl.total} cumplidas`:", sin actividades"}">
      <small>${WD3[dd.getDay()]}</small><b>${dd.getDate()}</b><span class="mini"><i style="width:${tl.total?Math.round(tl.done/tl.total*100):0}%"></i></span></button>`;
  }).join("");

  // progress
  const list = dayTasks(date, state.scope), tl = tally(list);
  $("progBig").innerHTML = tl.done+"<small>/"+tl.total+"</small>";
  const f = $("progFill"); f.style.width = (tl.total?tl.done/tl.total*100:0)+"%"; f.classList.toggle("full", tl.total>0 && tl.done===tl.total);
  $("kPend").textContent = tl.total-tl.done;
  let wd=0, wt=0; for(let i=0;i<7;i++){ const x = tally(dayTasks(addDays(ws,i),state.scope)); wd+=x.done; wt+=x.total; }
  $("kWeek").textContent = wt ? Math.round(wd/wt*100)+"%" : "—";
  const st = streak(); $("kStreak").textContent = st+(st===1?" día":" días");

  // agenda
  const timed = list.filter(t=>t.start), untimed = list.filter(t=>!t.start);
  let html = "";
  if(!state.tasksReady) html = `<div class="empty">Cargando tu agenda…</div>`;
  else if(!list.length) html = `<div class="empty">${date<t0?"No registraste actividades este día.":"Sin actividades "+(date===t0?"hoy":"para este día")+". Agrega la primera abajo: qué vas a hacer y a qué hora."}</div>`;
  else {
    html = timed.map(t=>taskRow(t)).join("");
    if(untimed.length) html += (timed.length?`<div class="group-lbl">Sin hora</div>`:"") + untimed.map(t=>taskRow(t)).join("");
  }
  $("list").innerHTML = html;

  // add form defaults
  if(document.activeElement!==$("fDate")) $("fDate").value = date;

  // close-of-day
  const showClose = date<=t0;
  $("closeCard").hidden = !showClose;
  if(showClose && document.activeElement!==$("dayNote")) $("dayNote").value = (state.days[date]||{}).note||"";
  $("noteHint").textContent = tl.total && tl.done<tl.total && date<=t0 ? `Te quedan ${tl.total-tl.done} sin cumplir. Escribe qué los frenó.` : "";
}

function renderWeek(){
  const t0 = today(), ws = weekStart(state.date), we = addDays(ws,6);
  const a = parse(ws), b = parse(we);
  $("wLbl").textContent = a.getDate()+" "+MONTHS[a.getMonth()].slice(0,3)+" – "+b.getDate()+" "+MONTHS[b.getMonth()].slice(0,3);
  $("wSub").textContent = ws===weekStart(t0) ? "Esta semana" : b.getFullYear();
  const all = []; for(let i=0;i<7;i++) all.push(...dayTasks(addDays(ws,i),"todo"));
  const row = (label,list) => { const x=tally(list); return `<div><div class="prog-lbl">${label}</div><b>${x.total?Math.round(x.done/x.total*100)+"%":"—"}</b> <span class="note">${x.done}/${x.total}</span><div class="track"><div class="fill ${x.total&&x.done===x.total?"full":""}" style="width:${x.total?x.done/x.total*100:0}%"></div></div></div>`; };
  $("wSum").innerHTML = row("Trabajo", all.filter(t=>t.scope==="trabajo")) + row("Vida personal", all.filter(t=>t.scope==="personal"));
  $("wDays").innerHTML = Array.from({length:7},(_,i)=>{
    const s = addDays(ws,i), dd = parse(s), list = dayTasks(s,state.scope), tl = tally(list);
    return `<section class="card wk-card ${s===t0?"today":""}">
      <button class="wk-head" data-date="${s}" aria-label="Abrir ${WD[dd.getDay()]} ${dd.getDate()}"><b>${WD[dd.getDay()]} ${dd.getDate()}${s===t0?" · hoy":""}</b><span>${tl.total?tl.done+"/"+tl.total:"libre"} ›</span></button>
      ${list.length ? `<div class="list">${list.map(t=>taskRow(t,{compact:true})).join("")}</div>` : `<div class="note">Sin actividades.</div>`}
    </section>`;
  }).join("");
}

function dayText(days){
  const s = [...days].sort((x,y)=>((x+6)%7)-((y+6)%7)).join(",");
  if(s==="1,2,3,4,5,6,0") return "Todos los días";
  if(s==="1,2,3,4,5") return "Lun a vie";
  if(s==="1,2,3,4,5,6") return "Lun a sáb";
  if(s==="6,0") return "Fin de semana";
  return [...days].sort((x,y)=>((x+6)%7)-((y+6)%7)).map(d=>WD3[d]).join(" · ");
}
function renderSettings(){
  if(document.activeElement!==$("cfgMode")) $("cfgMode").value = state.cfg.planMode;
  if(document.activeElement!==$("cfgTime")) $("cfgTime").value = state.cfg.planTime;
  $("rDays").innerHTML = DAY_CHIPS.map(([v,l,n])=>`<button type="button" class="chip" data-d="${v}" aria-pressed="${state.rDays.includes(v)}" aria-label="${n}">${l}</button>`).join("");
  const rs = state.routines.slice().sort((a,b)=>(a.start||"99").localeCompare(b.start||"99"));
  $("rtList").innerHTML = !state.routinesReady ? "" : rs.length ? rs.map(r=>`<div class="rt">
      <div class="t-main"><div class="t-title">${esc(r.title)}</div><small><span class="tag ${r.scope}">${r.scope==="trabajo"?"Trabajo":"Personal"}</span><span class="t-time">${r.start?fmtTime(r.start)+(r.end?" – "+fmtTime(r.end):""):"Sin hora"}</span><span>${dayText(r.days||[])}</span></small></div>
      <button class="del" data-rdel="${esc(r.id)}" aria-label="Eliminar del horario">✕</button></div>`).join("")
    : `<div class="empty">Aún no tienes horario fijo. Agrega uno arriba o empieza con una plantilla que puedes editar.<br><button class="ghost" id="tplBtn" type="button" style="margin-top:10px">Cargar plantilla sugerida</button></div>`;
}

function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2000); }
function fail(e){ toast(e?.code==="quota_exceeded" ? "Límite de almacenamiento lleno: exporta y borra actividades antiguas" : "No se pudo guardar. Revisa tu conexión e intenta de nuevo"); }

/* ---------- events ---------- */
$("viewSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; state.view=b.dataset.v; sync(); });
$("scopeSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; state.scope=b.dataset.v; if(b.dataset.v!=="todo") state.fScope=b.dataset.v; render(); });
$("fScopeSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; state.fScope=b.dataset.v; render(); });
$("prevD").onclick=()=>{ state.date=addDays(state.date,-1); sync(); };
$("nextD").onclick=()=>{ state.date=addDays(state.date,1); sync(); };
$("todayBtn").onclick=()=>{ state.date=today(); sync(); };
$("prevW").onclick=()=>{ state.date=addDays(state.date,-7); sync(); };
$("nextW").onclick=()=>{ state.date=addDays(state.date,7); sync(); };
$("strip").addEventListener("click",e=>{ const b=e.target.closest("[data-date]"); if(!b) return; state.date=b.dataset.date; sync(); });
$("wDays").addEventListener("click",e=>{ const h=e.target.closest(".wk-head"); if(h){ state.date=h.dataset.date; state.view="dia"; sync(); window.scrollTo({top:0}); return; } taskAction(e); });
$("list").addEventListener("click", taskAction);

async function taskAction(e){
  const b = e.target.closest("[data-act]"); if(!b || !store) return;
  const t = state.tasks.find(x=>x.id===b.dataset.id); if(!t) return;
  const act = b.dataset.act;
  try {
    if(act==="toggle"){ await store.setTask({...t, done:!t.done, doneAt:!t.done?Date.now():null}); }
    else if(act==="push"){ await store.setTask({...t, date:addDays(t.date,1), carried:true}); toast("Pasada al día siguiente"); }
    else if(act==="del"){
      if(!b.classList.contains("armed")){
        document.querySelectorAll(".del.armed").forEach(x=>{x.classList.remove("armed");x.textContent="✕"});
        b.classList.add("armed"); b.textContent="Borrar";
        setTimeout(()=>{ if(b.isConnected){ b.classList.remove("armed"); b.textContent="✕"; } },3000); return;
      }
      if(t.routineId) await store.setTask({...t, skipped:true}); else await store.delTask(t.id);
      toast("Actividad eliminada");
    }
  } catch(err){ fail(err); }
}

$("banners").addEventListener("click", async e=>{
  const b = e.target.closest("[data-b]"); if(!b || !store) return;
  const t0 = today(), yest = addDays(t0,-1);
  try {
    if(b.dataset.b==="plan"){ state.date=b.dataset.date; state.view="dia"; sync(); $("addCard").scrollIntoView({behavior:"smooth",block:"center"}); setTimeout(()=>$("fTitle").focus({preventScroll:true}),300); }
    else {
      if(b.dataset.b==="carry"){
        const mv = state.tasks.filter(t=>t.date===yest && live(t) && !t.done && !t.routineId);
        for(const t of mv) await store.setTask({...t, date:t0, carried:true});
        toast(mv.length+" pasada"+(mv.length>1?"s":"")+" a hoy");
      }
      await store.setDay(yest, {...(state.days[yest]||{}), reviewed:true});
      render();
    }
  } catch(err){ fail(err); }
});

$("taskForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const title = $("fTitle").value.trim(), start=$("fStart").value, end=$("fEnd").value;
  if(!title){ toast("Escribe qué vas a hacer"); $("fTitle").focus(); return; }
  if(start && end && end<=start){ toast("La hora de fin debe ser después del inicio"); $("fEnd").focus(); return; }
  if(!store){ toast("Conectando, intenta en un segundo"); return; }
  const date = $("fDate").value || today();
  $("saveBtn").disabled=true;
  try {
    await store.setTask({id:uuid("k"), title, scope:state.fScope, date, start, end, done:false, ts:Date.now()});
    $("fTitle").value=""; $("fStart").value=""; $("fEnd").value="";
    toast("Guardada para "+(date===today()?"hoy":date===addDays(today(),1)?"mañana":date.slice(8,10)+"/"+date.slice(5,7)));
    if(date!==state.date){ state.date=date; sync(); }
  } catch(err){ fail(err); }
  finally { $("saveBtn").disabled=false; $("fTitle").focus(); }
});

$("dayNote").addEventListener("change", async ()=>{
  if(!store) return;
  try { await store.setDay(state.date, {...(state.days[state.date]||{}), note:$("dayNote").value.trim()}); toast("Cierre guardado"); } catch(err){ fail(err); }
});

async function saveCfg(){
  if(!store) return;
  const planTime = $("cfgTime").value || (($("cfgMode").value==="am")?"08:00":"23:00");
  try { await store.setCfg({planMode:$("cfgMode").value, planTime}); toast("Aviso guardado"); } catch(err){ fail(err); }
}
$("cfgMode").addEventListener("change",()=>{ $("cfgTime").value = $("cfgMode").value==="am" ? "08:00" : "23:00"; saveCfg(); });
$("cfgTime").addEventListener("change", saveCfg);

$("rDays").addEventListener("click",e=>{
  const b=e.target.closest(".chip"); if(!b) return;
  const v=Number(b.dataset.d);
  state.rDays = state.rDays.includes(v) ? state.rDays.filter(x=>x!==v) : [...state.rDays, v];
  renderSettings();
});
$("rtForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const title=$("rTitle").value.trim(), start=$("rStart").value, end=$("rEnd").value;
  if(!title) return;
  if(!state.rDays.length){ toast("Elige al menos un día"); return; }
  if(start && end && end<=start){ toast("La hora de fin debe ser después del inicio"); return; }
  if(!store) return;
  try { await store.setRoutine({id:uuid("f"), title, scope:$("rScope").value, start, end, days:[...state.rDays], from:today()}); $("rTitle").value=""; toast("Agregado al horario fijo"); } catch(err){ fail(err); }
});
$("rtList").addEventListener("click", async e=>{
  const tpl = e.target.closest("#tplBtn");
  if(tpl && store){
    const T = [
      ["Revisar Meta Ads: ROAS, CPA y creativos","trabajo","09:00","10:00",[1,2,3,4,5]],
      ["Pedidos, confirmaciones y despacho","trabajo","10:00","12:30",[1,2,3,4,5,6]],
      ["Probar creativos nuevos","trabajo","15:00","16:30",[1,2,3,4,5]],
      ["Cierre: números del día","trabajo","18:00","18:30",[1,2,3,4,5]],
      ["Gym","personal","07:00","08:00",[1,2,3,4,5]],
      ["Lectura o aprendizaje (30 min)","personal","21:30","22:00",[1,2,3,4,5,6,0]],
      ["Planificar mañana","personal","22:45","23:00",[1,2,3,4,5,6,0]]
    ];
    try { for(const [title,scope,start,end,days] of T) await store.setRoutine({id:uuid("f"), title, scope, start, end, days, from:today()}); toast("Plantilla cargada: edítala a tu medida"); } catch(err){ fail(err); }
    return;
  }
  const b = e.target.closest("[data-rdel]"); if(!b || !store) return;
  if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Borrar"; setTimeout(()=>{ if(b.isConnected){ b.classList.remove("armed"); b.textContent="✕"; } },3000); return; }
  try {
    const id = b.dataset.rdel, t0 = today();
    for(const t of state.tasks.filter(t=>t.routineId===id && t.date>=t0 && !t.done)) await store.delTask(t.id);
    await store.delRoutine(id); toast("Quitado del horario fijo");
  } catch(err){ fail(err); }
});

$("exportBtn").onclick = async ()=>{
  const rows = state.tasks.filter(live).sort((a,b)=>a.date.localeCompare(b.date)||(a.start||"").localeCompare(b.start||""));
  if(!rows.length){ toast("No hay actividades para exportar"); return; }
  const q = s => { s = String(s??""); if(/^[=+\-@]/.test(s)) s = "'"+s; return '"'+s.replace(/"/g,'""')+'"'; };  // evita fórmulas al abrir en Excel
  const csv = "fecha,ambito,actividad,inicio,fin,cumplida\n" + rows.map(t=>[t.date,t.scope,q(t.title),t.start||"",t.end||"",t.done?"si":"no"].join(",")).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "crono-dia-todo.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
};

setInterval(()=>{ if(state.tasksReady) render(); }, 60000);
$("fDate").value = state.date;
boot();
