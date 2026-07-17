import { firebaseConfig, allowedEmails } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getDatabase, ref, onValue, push, set, update, remove, runTransaction, get
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

const $ = (s) => document.querySelector(s);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const loginView = $("#loginView");
const appView = $("#appView");
const calendarView = $("#calendarView");
const overviewView = $("#overviewView");
const loginError = $("#loginError");
const itemsEl = $("#items");
const emptyState = $("#emptyState");
const addBtn = $("#addBtn");
const accountBtn = $("#accountBtn");
const themeBtn = $("#themeBtn");
const calendarBtn = $("#calendarBtn");
const overviewBtn = $("#overviewBtn");
const addDialog = $("#addDialog");
const editDialog = $("#editDialog");
const accountDialog = $("#accountDialog");

let currentItems = {};
let todayValues = {};
let unsubscribeItems = null;
let unsubscribeToday = null;
let unsubscribeActiveTimers = null;
let unsubscribeTimerSessions = null;
let deferredInstallPrompt = null;
let activePeriod = "week";
let periodAnchor = new Date();
let chartDataCache = [];
let overviewRows = [];
let overviewExercises = [];
let selectedExerciseIndex = 0;
let activeChartType = "bar";
let activeTimers = {};
let timerSessionsToday = {};
let timerTickHandle = null;
const expandedItems = new Set();


function applyTheme(theme) {
  const dark = theme === "dark";
  document.body.classList.toggle("dark", dark);
  themeBtn.textContent = dark ? "☀" : "◐";
  themeBtn.setAttribute("aria-label", dark ? "Světlý režim" : "Tmavý režim");
  themeBtn.title = dark ? "Světlý režim" : "Tmavý režim";
  localStorage.setItem("pocitadlo-theme", dark ? "dark" : "light");
}

const savedTheme = localStorage.getItem("pocitadlo-theme");
applyTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
themeBtn.addEventListener("click", () => {
  applyTheme(document.body.classList.contains("dark") ? "light" : "dark");
});

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h > 0 ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function formatLastChange(change, type = "count") {
  if (!change || !change.at || !change.delta) return "";
  const date = new Date(Number(change.at)), sign = Number(change.delta) > 0 ? "+" : "−";
  const amount = type === "timer" ? formatDuration(Math.abs(Number(change.delta))) : Math.abs(Number(change.delta));
  const when = date.toLocaleString("cs-CZ",{day:"numeric",month:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"});
  return `Naposledy ${when}: ${sign}${amount}`;
}

function allowed(user) {
  return !!user?.email && allowedEmails.map(x => x.toLowerCase()).includes(user.email.toLowerCase());
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [y,m,d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function showView(view) {
  [appView, calendarView, overviewView].forEach(v => v.classList.add("hidden"));
  view.classList.remove("hidden");
  addBtn.classList.toggle("hidden", view !== appView);
}

$("#loginBtn").addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"].includes(error.code)) {
      await signInWithRedirect(auth, provider);
    } else if (error.code !== "auth/popup-closed-by-user") {
      loginError.textContent = "Přihlášení se nepodařilo.";
      console.error(error);
    }
  }
});

getRedirectResult(auth).catch(console.error);

onAuthStateChanged(auth, async (user) => {
  [unsubscribeItems,unsubscribeToday,unsubscribeActiveTimers,unsubscribeTimerSessions].forEach(u=>{if(u)u();});
  unsubscribeItems=unsubscribeToday=unsubscribeActiveTimers=unsubscribeTimerSessions=null;
  if(!user){loginView.classList.remove("hidden");[appView,calendarView,overviewView,addBtn,accountBtn,calendarBtn,overviewBtn].forEach(el=>el.classList.add("hidden"));return;}
  if(!allowed(user)){loginError.textContent=`Účet ${user.email} nemá povolený přístup.`;await signOut(auth);return;}
  loginView.classList.add("hidden");accountBtn.classList.remove("hidden");calendarBtn.classList.remove("hidden");overviewBtn.classList.remove("hidden");$("#userEmail").textContent=user.email;showView(appView);
  unsubscribeItems=onValue(ref(db,"shared/items"),s=>{currentItems=s.val()||{};renderItems();});
  unsubscribeToday=onValue(ref(db,`shared/daily/${localDateKey()}`),s=>{todayValues=s.val()||{};renderItems();});
  unsubscribeActiveTimers=onValue(ref(db,"shared/activeTimers"),s=>{activeTimers=s.val()||{};renderItems();startTimerTicker();});
  unsubscribeTimerSessions=onValue(ref(db,`shared/timerSessions/${localDateKey()}`),s=>{timerSessionsToday=s.val()||{};renderItems();});
});

function renderItems(){
  itemsEl.replaceChildren();
  const entries=Object.entries(currentItems).sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0));
  emptyState.classList.toggle("hidden",entries.length>0);
  for(const [id,item] of entries){
    const type=item.type==="timer"?"timer":"count";
    const node=$("#itemTemplate").content.firstElementChild.cloneNode(true); node.dataset.itemId=id;
    if(expandedItems.has(id)){node.classList.remove("collapsed");node.querySelector(".toggle-details").setAttribute("aria-expanded","true");}
    node.querySelector(".item-name").textContent=item.name||"Bez názvu";
    const today=Number(todayValues[id]||0);
    node.querySelector(".today-value").textContent=type==="timer"?formatDuration(getDisplayedTimerTotal(id)):today.toLocaleString("cs-CZ");
    const lc=node.querySelector(".last-change"), lct=formatLastChange(item.lastChange,type); if(lct){lc.textContent=lct;lc.classList.remove("hidden");}
    const toggle=node.querySelector(".toggle-details");toggle.addEventListener("click",e=>{e.stopPropagation();const c=node.classList.toggle("collapsed");c?expandedItems.delete(id):expandedItems.add(id);toggle.setAttribute("aria-expanded",String(!c));});
    const ca=node.querySelector(".collapsed-actions");
    if(type==="count"){
      node.querySelector(".timer-details").classList.add("hidden");node.querySelector(".count-details").classList.remove("hidden");node.querySelector(".count").textContent=Number(item.count||0).toLocaleString("cs-CZ");
      const q=Array.isArray(item.quick)?item.quick:[1,3,5];
      q.slice(0,3).forEach(v=>{const bt=document.createElement("button");bt.type="button";bt.textContent=`+${v}`;bt.addEventListener("click",e=>{e.stopPropagation();addValue(id,Number(v),bt)});ca.appendChild(bt);});
      const nb=node.querySelector(".item-name-button");nb.addEventListener("click",()=>addValue(id,1,nb));
      const qw=node.querySelector(".quick-buttons");const minus=document.createElement("button");minus.type="button";minus.textContent="−1";minus.className="secondary";minus.onclick=()=>addValue(id,-1,minus);qw.appendChild(minus);
      q.slice(0,3).forEach(v=>{const bt=document.createElement("button");bt.type="button";bt.textContent=`+${v}`;bt.onclick=()=>addValue(id,Number(v),bt);qw.appendChild(bt)});qw.style.gridTemplateColumns="repeat(4,1fr)";
      node.querySelector(".custom-form").addEventListener("submit",async e=>{e.preventDefault();const inp=node.querySelector(".custom-value"),v=Number(inp.value);if(!Number.isInteger(v)||v===0)return;await addValue(id,v,e.submitter);inp.value="";});
    }else{
      node.querySelector(".count-details").classList.add("hidden");node.querySelector(".timer-details").classList.remove("hidden");node.querySelector(".detail-total-label").textContent="Celkem za všechny dny";node.querySelector(".count").textContent=formatDuration(item.count||0);
      const play=document.createElement("button"),running=!!activeTimers[id]?.startedAt;play.type="button";play.className="timer-play";play.textContent=running?"■ Stop":"▶";play.classList.toggle("running",running);play.onclick=e=>{e.stopPropagation();running?stopTimer(id,play):startTimer(id,play)};ca.appendChild(play);
      node.querySelector(".item-name-button").onclick=()=>running?stopTimer(id):startTimer(id);
      node.querySelector(".timer-day-total").textContent=formatDuration(getDisplayedTimerTotal(id));node.querySelector(".edit-today-time").onclick=()=>editTodayTimerTotal(id);renderTimerSessions(node,id);
    }
    node.querySelector(".edit").onclick=()=>openEdit(id);itemsEl.appendChild(node);
  }
}
function getDisplayedTimerTotal(id){const saved=Number(todayValues[id]||0),a=activeTimers[id];return a?.startedAt?saved+Math.max(0,Math.floor((Date.now()-Number(a.startedAt))/1000)):saved;}
function startTimerTicker(){if(timerTickHandle)clearInterval(timerTickHandle);if(!Object.keys(activeTimers).length)return;timerTickHandle=setInterval(()=>document.querySelectorAll(".item[data-item-id]").forEach(node=>{const id=node.dataset.itemId;if(!activeTimers[id]?.startedAt)return;const v=formatDuration(getDisplayedTimerTotal(id));node.querySelector(".today-value").textContent=v;const d=node.querySelector(".timer-day-total");if(d)d.textContent=v;}),1000);}
function renderTimerSessions(node,id){const sessions=Object.entries(timerSessionsToday[id]||{}).map(([sessionId,s])=>({sessionId,...s})).sort((a,b)=>Number(b.startedAt||0)-Number(a.startedAt||0));const list=node.querySelector(".session-list");node.querySelector(".no-sessions").classList.toggle("hidden",sessions.length>0);sessions.forEach(s=>{const row=document.createElement("div"),st=new Date(Number(s.startedAt)),en=new Date(Number(s.endedAt));row.className="session-row";row.innerHTML=`<div><div>${st.toLocaleTimeString("cs-CZ",{hour:"2-digit",minute:"2-digit",second:"2-digit"})} – ${en.toLocaleTimeString("cs-CZ",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div><div class="session-time">${st.toLocaleDateString("cs-CZ")}</div></div><div class="session-duration">${formatDuration(s.duration||0)}</div><button class="session-delete" type="button">Smazat</button>`;row.querySelector(".session-delete").onclick=()=>deleteTimerSession(id,s.sessionId,Number(s.duration||0));list.appendChild(row);});}

async function startTimer(id,button){button?.classList.add("syncing");try{await runTransaction(ref(db,`shared/activeTimers/${id}`),c=>c?.startedAt?undefined:{startedAt:Date.now()});}catch(e){console.error(e);alert("Časovač se nepodařilo spustit.");}finally{button?.classList.remove("syncing");}}
async function stopTimer(id,button){button?.classList.add("syncing");const ar=ref(db,`shared/activeTimers/${id}`);try{const s=await get(ar),a=s.val();if(!a?.startedAt)return;const startedAt=Number(a.startedAt),endedAt=Date.now(),duration=Math.max(1,Math.floor((endedAt-startedAt)/1000));const r=await runTransaction(ar,c=>(c?.startedAt&&Number(c.startedAt)===startedAt)?null:undefined);if(!r.committed)return;const sr=push(ref(db,`shared/timerSessions/${localDateKey()}/${id}`));await set(sr,{startedAt,endedAt,duration});await runTransaction(ref(db,`shared/daily/${localDateKey()}/${id}`),c=>Number(c||0)+duration);await runTransaction(ref(db,`shared/items/${id}`),c=>c?{...c,count:Number(c.count||0)+duration,updatedAt:endedAt,lastChange:{at:endedAt,delta:duration}}:undefined);}catch(e){console.error(e);alert("Časovač se nepodařilo zastavit.");}finally{button?.classList.remove("syncing");}}
async function editTodayTimerTotal(id){if(activeTimers[id]?.startedAt){alert("Nejdřív zastav časovač.");return;}const cur=Number(todayValues[id]||0),inp=prompt("Celkový dnešní čas v sekundách:",String(cur));if(inp===null)return;const next=Number(inp);if(!Number.isInteger(next)||next<0){alert("Zadej celé nezáporné číslo v sekundách.");return;}const delta=next-cur;if(!delta)return;const now=Date.now();await set(ref(db,`shared/daily/${localDateKey()}/${id}`),next);await runTransaction(ref(db,`shared/items/${id}`),c=>c?{...c,count:Math.max(0,Number(c.count||0)+delta),updatedAt:now,lastChange:{at:now,delta}}:undefined);}
async function deleteTimerSession(id,sessionId,duration){if(!confirm("Smazat toto měření?"))return;const sr=ref(db,`shared/timerSessions/${localDateKey()}/${id}/${sessionId}`),s=await get(sr);if(!s.exists())return;const d=Number(s.val()?.duration||duration||0);await remove(sr);await runTransaction(ref(db,`shared/daily/${localDateKey()}/${id}`),c=>Math.max(0,Number(c||0)-d));const now=Date.now();await runTransaction(ref(db,`shared/items/${id}`),c=>c?{...c,count:Math.max(0,Number(c.count||0)-d),updatedAt:now,lastChange:{at:now,delta:-d}}:undefined);}
async function addValue(id, value, button) {
  if (!Number.isInteger(value) || value === 0) return;
  button?.classList.add("syncing");

  const day = localDateKey();
  const itemRef = ref(db, `shared/items/${id}`);
  const dailyRef = ref(db, `shared/daily/${day}/${id}`);
  const now = Date.now();

  try {
    let appliedDelta = 0;

    const result = await runTransaction(itemRef, current => {
      if (!current) return; // Nikdy nevytváří nebo nepřepisuje neexistující položku.
      const before = Number(current.count || 0);
      const after = Math.max(0, before + value);
      appliedDelta = after - before;
      if (appliedDelta === 0) return current;

      return {
        ...current,
        count: after,
        updatedAt: now,
        lastChange: {
          at: now,
          delta: appliedDelta
        }
      };
    });

    if (!result.committed || appliedDelta === 0) return;

    await runTransaction(dailyRef, current => {
      const next = Math.max(0, Number(current || 0) + appliedDelta);
      return next;
    });
  } catch (error) {
    console.error(error);
    alert("Hodnotu se nepodařilo uložit.");
  } finally {
    button?.classList.remove("syncing");
  }
}

addBtn.addEventListener("click", () => {
  $("#newName").value = "";
  const dt=document.querySelector('input[name="itemType"][value="count"]');if(dt)dt.checked=true;
  addDialog.showModal();
  setTimeout(() => $("#newName").focus(), 50);
});

$("#addForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#newName").value.trim();
  if (!name) return;
  const newRef = push(ref(db, "shared/items"));
  const type=document.querySelector('input[name="itemType"]:checked')?.value||"count";
  await set(newRef,{name,type,count:0,quick:[1,3,5],createdAt:Date.now(),updatedAt:Date.now()});
  addDialog.close();
});

function openEdit(id) {
  const item = currentItems[id];
  if (!item) return;
  const quick = Array.isArray(item.quick) ? item.quick : [1,3,5];
  $("#editId").value = id;
  $("#editDialog .quick-grid").classList.toggle("hidden",item.type==="timer");
  $("#editName").value = item.name || "";
  $("#quick1").value = quick[0] ?? 1;
  $("#quick2").value = quick[1] ?? 3;
  $("#quick3").value = quick[2] ?? 5;
  editDialog.showModal();
}

$("#editForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("#editId").value;
  const name = $("#editName").value.trim();
  const item=currentItems[id]||{},quick=[$("#quick1"),$("#quick2"),$("#quick3")].map(el=>Number(el.value));
  if(!name)return;if(item.type!=="timer"&&quick.some(v=>!Number.isInteger(v)||v<=0))return;
  const changes={name,updatedAt:Date.now()};if(item.type!=="timer")changes.quick=quick;
  await update(ref(db,`shared/items/${id}`),changes);
  editDialog.close();
});

$("#deleteBtn").addEventListener("click", async () => {
  const id = $("#editId").value;
  if (!confirm("Opravdu položku smazat?")) return;
  await remove(ref(db, `shared/items/${id}`));
  editDialog.close();
});

calendarBtn.addEventListener("click", () => {
  $("#calendarDate").value = localDateKey();
  showView(calendarView);
  loadCalendarDay();
});
$("#calendarBack").addEventListener("click", () => showView(appView));
$("#calendarDate").addEventListener("change", loadCalendarDay);

async function loadCalendarDay() {
  const key = $("#calendarDate").value || localDateKey();
  const snap = await get(ref(db, `shared/daily/${key}`));
  const data = snap.val() || {};
  const wrap = $("#calendarDayRows");
  wrap.replaceChildren();

  const rows = Object.entries(currentItems).map(([id,item]) => ({
    name: item.name || "Bez názvu",
    value: Number(data[id] || 0)
  })).filter(row => row.value !== 0);

  $("#calendarEmpty").classList.toggle("hidden", rows.length > 0);
  rows.forEach(row => {
    const el = document.createElement("div");
    el.className = "summary-row";
    el.innerHTML = `<span>${escapeHtml(row.name)}</span><strong>${row.value.toLocaleString("cs-CZ")}</strong>`;
    wrap.appendChild(el);
  });
}

overviewBtn.addEventListener("click", () => {
  periodAnchor = new Date();
  showView(overviewView);
  loadOverview();
});
$("#overviewBack").addEventListener("click", () => showView(appView));

document.querySelectorAll("[data-period]").forEach(btn => {
  btn.addEventListener("click", () => {
    activePeriod = btn.dataset.period;
    document.querySelectorAll("[data-period]").forEach(b => b.classList.toggle("active", b === btn));
    periodAnchor = new Date();
    loadOverview();
  });
});
$("#periodPrev").addEventListener("click", () => shiftPeriod(-1));
$("#periodNext").addEventListener("click", () => shiftPeriod(1));

$("#exercisePrev").addEventListener("click", () => shiftExercise(-1));
$("#exerciseNext").addEventListener("click", () => shiftExercise(1));

document.querySelectorAll("[data-chart-type]").forEach(btn => {
  btn.addEventListener("click", () => {
    activeChartType = btn.dataset.chartType;
    document.querySelectorAll("[data-chart-type]").forEach(b =>
      b.classList.toggle("active", b === btn)
    );
    drawSelectedExerciseChart();
  });
});

function shiftExercise(direction) {
  if (!overviewExercises.length) return;
  selectedExerciseIndex =
    (selectedExerciseIndex + direction + overviewExercises.length) % overviewExercises.length;
  drawSelectedExerciseChart();
}

function shiftPeriod(direction) {
  if (activePeriod === "week") periodAnchor.setDate(periodAnchor.getDate() + 7 * direction);
  if (activePeriod === "month") periodAnchor.setMonth(periodAnchor.getMonth() + direction);
  if (activePeriod === "year") periodAnchor.setFullYear(periodAnchor.getFullYear() + direction);
  loadOverview();
}

function periodRange() {
  const a = new Date(periodAnchor);
  a.setHours(0,0,0,0);
  let start, end, label;

  if (activePeriod === "week") {
    const day = (a.getDay() + 6) % 7;
    start = new Date(a); start.setDate(a.getDate() - day);
    end = new Date(start); end.setDate(start.getDate() + 6);
    label = `${start.toLocaleDateString("cs-CZ")} – ${end.toLocaleDateString("cs-CZ")}`;
  } else if (activePeriod === "month") {
    start = new Date(a.getFullYear(), a.getMonth(), 1);
    end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    label = start.toLocaleDateString("cs-CZ", { month:"long", year:"numeric" });
  } else {
    start = new Date(a.getFullYear(), 0, 1);
    end = new Date(a.getFullYear(), 11, 31);
    label = String(a.getFullYear());
  }
  return { start, end, label };
}

async function loadOverview() {
  const { start, end, label } = periodRange();
  $("#periodLabel").textContent = label;

  const snap = await get(ref(db, "shared/daily"));
  const all = snap.val() || {};

  overviewExercises = Object.entries(currentItems)
    .sort((a,b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))
    .map(([id,item]) => ({ id, name: item.name || "Bez názvu" }));

  if (selectedExerciseIndex >= overviewExercises.length) selectedExerciseIndex = 0;

  const rows = [];

  if (activePeriod === "year") {
    for (let m = 0; m < 12; m++) {
      const values = {};
      overviewExercises.forEach(ex => values[ex.id] = 0);

      Object.entries(all).forEach(([key, dayValues]) => {
        const d = parseDateKey(key);
        if (d.getFullYear() === start.getFullYear() && d.getMonth() === m) {
          overviewExercises.forEach(ex => {
            values[ex.id] += Number(dayValues?.[ex.id] || 0);
          });
        }
      });

      rows.push({
        label: new Date(start.getFullYear(), m, 1)
          .toLocaleDateString("cs-CZ", {month:"short"}),
        values
      });
    }
  } else {
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = localDateKey(cursor);
      const dayValues = all[key] || {};
      const values = {};
      overviewExercises.forEach(ex => values[ex.id] = Number(dayValues[ex.id] || 0));

      rows.push({
        label: activePeriod === "week"
          ? cursor.toLocaleDateString("cs-CZ",{weekday:"short",day:"numeric",month:"numeric"})
          : cursor.toLocaleDateString("cs-CZ",{day:"numeric",month:"numeric"}),
        values
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  overviewRows = rows;
  renderOverviewTable();
  drawSelectedExerciseChart();
}

function renderOverviewTable() {
  const head = $("#overviewHead");
  const body = $("#overviewTable");
  head.replaceChildren();
  body.replaceChildren();

  const headerRow = document.createElement("tr");
  const dateTh = document.createElement("th");
  dateTh.textContent = activePeriod === "year" ? "Měsíc" : "Datum";
  headerRow.appendChild(dateTh);

  overviewExercises.forEach(ex => {
    const th = document.createElement("th");
    th.textContent = ex.name;
    headerRow.appendChild(th);
  });
  head.appendChild(headerRow);

  overviewRows.forEach(row => {
    const tr = document.createElement("tr");
    const labelTd = document.createElement("td");
    labelTd.textContent = row.label;
    tr.appendChild(labelTd);

    overviewExercises.forEach(ex => {
      const td = document.createElement("td");
      td.textContent = Number(row.values[ex.id] || 0).toLocaleString("cs-CZ");
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function drawSelectedExerciseChart() {
  const title = $("#chartExerciseTitle");
  if (!overviewExercises.length) {
    title.textContent = "Žádný cvik";
    drawChart([]);
    return;
  }

  const exercise = overviewExercises[selectedExerciseIndex];
  title.textContent = exercise.name;

  const rows = overviewRows.map(row => ({
    label: row.label,
    total: Number(row.values[exercise.id] || 0)
  }));

  chartDataCache = rows;
  drawChart(rows);
}

function drawChart(rows) {
  const canvas = $("#overviewChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth - 16;
  const cssHeight = 300;
  const width = Math.max(320, cssWidth);

  canvas.width = width * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr,0,0,dpr,0,0);

  const w = width, h = cssHeight;
  ctx.clearRect(0,0,w,h);

  const dark = document.body.classList.contains("dark");
  const gridColor = dark ? "#4b5563" : "#d1d5db";
  const textColor = dark ? "#d1d5db" : "#374151";
  const dataColor = "#2563eb";
  const pad = {l:42,r:14,t:18,b:52};
  const cw = w-pad.l-pad.r;
  const ch = h-pad.t-pad.b;
  const max = Math.max(1, ...rows.map(r => r.total));

  ctx.strokeStyle = gridColor;
  ctx.fillStyle = textColor;
  ctx.font = "12px system-ui";
  ctx.lineWidth = 1;

  for (let i=0;i<=4;i++) {
    const y = pad.t + ch - ch*i/4;
    ctx.beginPath();
    ctx.moveTo(pad.l,y);
    ctx.lineTo(w-pad.r,y);
    ctx.stroke();
    ctx.fillText(String(Math.round(max*i/4)), 4, y+4);
  }

  if (!rows.length) return;

  const xAt = i => pad.l + (rows.length === 1 ? cw/2 : i*cw/(rows.length-1));
  const yAt = value => pad.t + ch - ch*(value/max);
  const showEvery = rows.length > 14 ? Math.ceil(rows.length/8) : 1;

  rows.forEach((row,i) => {
    if (i % showEvery === 0) {
      const x = xAt(i);
      ctx.save();
      ctx.translate(x, h-10);
      ctx.rotate(-0.55);
      ctx.fillStyle = textColor;
      ctx.textAlign = "right";
      ctx.fillText(row.label,0,0);
      ctx.restore();
    }
  });

  if (activeChartType === "bar") {
    const slot = cw / Math.max(rows.length, 1);
    const bw = Math.max(3, slot * 0.68);
    rows.forEach((row,i) => {
      const x = pad.l + i*slot + (slot-bw)/2;
      const y = yAt(row.total);
      ctx.fillStyle = dataColor;
      ctx.fillRect(x, y, bw, pad.t+ch-y);
    });
    return;
  }

  if (activeChartType === "line") {
    ctx.beginPath();
    rows.forEach((row,i) => {
      const x = xAt(i), y = yAt(row.total);
      if (i === 0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = dataColor;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  rows.forEach((row,i) => {
    const x = xAt(i), y = yAt(row.total);
    ctx.beginPath();
    ctx.arc(x,y,5,0,Math.PI*2);
    ctx.fillStyle = dataColor;
    ctx.fill();
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

accountBtn.addEventListener("click", () => accountDialog.showModal());
$("#logoutBtn").addEventListener("click", () => signOut(auth));
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => document.getElementById(btn.dataset.close).close());
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("#installBtn").classList.remove("hidden");
});
$("#installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("#installBtn").classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
