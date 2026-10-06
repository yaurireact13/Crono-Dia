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

const state = { tasks:[], routines:[], days:{}, cfg:{planMode:"pm",planTime:"23:00"}, date:today(), view:"hoy", scope:"todo", fScope:"trabajo", rDays:[1,2,3,4,5], tasksReady:false, routinesReady:false, userId:null, mode:null, just:null };

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
