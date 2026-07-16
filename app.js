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
const calendarBtn = $("#calendarBtn");
const overviewBtn = $("#overviewBtn");
const addDialog = $("#addDialog");
const editDialog = $("#editDialog");
const accountDialog = $("#accountDialog");

let currentItems = {};
let todayValues = {};
let unsubscribeItems = null;
let unsubscribeToday = null;
let deferredInstallPrompt = null;
let activePeriod = "week";
let periodAnchor = new Date();
let chartDataCache = [];

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
  if (unsubscribeItems) unsubscribeItems();
  if (unsubscribeToday) unsubscribeToday();
  unsubscribeItems = unsubscribeToday = null;

  if (!user) {
    loginView.classList.remove("hidden");
    [appView, calendarView, overviewView, addBtn, accountBtn, calendarBtn, overviewBtn]
      .forEach(el => el.classList.add("hidden"));
    return;
  }
  if (!allowed(user)) {
    loginError.textContent = `Účet ${user.email} nemá povolený přístup.`;
    await signOut(auth);
    return;
  }

  loginView.classList.add("hidden");
  accountBtn.classList.remove("hidden");
  calendarBtn.classList.remove("hidden");
  overviewBtn.classList.remove("hidden");
  $("#userEmail").textContent = user.email;
  showView(appView);

  unsubscribeItems = onValue(ref(db, "shared/items"), snap => {
    currentItems = snap.val() || {};
    renderItems();
  });

  unsubscribeToday = onValue(ref(db, `shared/daily/${localDateKey()}`), snap => {
    todayValues = snap.val() || {};
    renderItems();
  });
});

function renderItems() {
  itemsEl.replaceChildren();
  const entries = Object.entries(currentItems).sort((a,b) =>
    (a[1].createdAt || 0) - (b[1].createdAt || 0)
  );
  emptyState.classList.toggle("hidden", entries.length > 0);

  for (const [id, item] of entries) {
    const node = $("#itemTemplate").content.firstElementChild.cloneNode(true);
    node.querySelector(".item-name").textContent = item.name || "Bez názvu";
    node.querySelector(".count").textContent = Number(item.count || 0).toLocaleString("cs-CZ");
    node.querySelector(".today-count").textContent =
      `Dnes: ${Number(todayValues[id] || 0).toLocaleString("cs-CZ")}`;

    const quicks = Array.isArray(item.quick) ? item.quick : [1,3,5];
    const quickWrap = node.querySelector(".quick-buttons");

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−1";
    minus.className = "secondary";
    minus.addEventListener("click", () => addValue(id, -1, minus));
    quickWrap.appendChild(minus);

    quicks.slice(0,3).forEach(value => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `+${value}`;
      b.addEventListener("click", () => addValue(id, Number(value), b));
      quickWrap.appendChild(b);
    });
    quickWrap.style.gridTemplateColumns = "repeat(4,1fr)";

    node.querySelector(".custom-form").addEventListener("submit", async e => {
      e.preventDefault();
      const input = node.querySelector(".custom-value");
      const value = Number(input.value);
      if (!Number.isInteger(value) || value === 0) return;
      await addValue(id, value, e.submitter);
      input.value = "";
    });

    const customInput = node.querySelector(".custom-value");
    customInput.min = "-99999";
    customInput.placeholder = "Jiná hodnota";

    node.querySelector(".edit").addEventListener("click", () => openEdit(id));
    itemsEl.appendChild(node);
  }
}

async function addValue(id, value, button) {
  if (!Number.isInteger(value) || value === 0) return;
  button?.classList.add("syncing");
  const day = localDateKey();
  const totalRef = ref(db, `shared/items/${id}/count`);
  const dailyRef = ref(db, `shared/daily/${day}/${id}`);

  try {
    const beforeSnap = await get(totalRef);
    const beforeTotal = Number(beforeSnap.val() || 0);
    const effectiveDelta = value < 0 ? -Math.min(Math.abs(value), beforeTotal) : value;
    if (effectiveDelta === 0) return;

    const totalResult = await runTransaction(totalRef, current => {
      const next = Number(current || 0) + effectiveDelta;
      return Math.max(0, next);
    });
    if (!totalResult.committed) return;

    await runTransaction(dailyRef, current => {
      const next = Number(current || 0) + effectiveDelta;
      return Math.max(0, next);
    });
    await set(ref(db, `shared/items/${id}/updatedAt`), Date.now());
  } catch (error) {
    console.error(error);
    alert("Hodnotu se nepodařilo uložit.");
  } finally {
    button?.classList.remove("syncing");
  }
}

addBtn.addEventListener("click", () => {
  $("#newName").value = "";
  addDialog.showModal();
  setTimeout(() => $("#newName").focus(), 50);
});

$("#addForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#newName").value.trim();
  if (!name) return;
  const newRef = push(ref(db, "shared/items"));
  await set(newRef, { name, count: 0, quick: [1,3,5], createdAt: Date.now(), updatedAt: Date.now() });
  addDialog.close();
});

function openEdit(id) {
  const item = currentItems[id];
  if (!item) return;
  const quick = Array.isArray(item.quick) ? item.quick : [1,3,5];
  $("#editId").value = id;
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
  const quick = [$("#quick1"), $("#quick2"), $("#quick3")].map(el => Number(el.value));
  if (!name || quick.some(v => !Number.isInteger(v) || v <= 0)) return;
  await update(ref(db, `shared/items/${id}`), { name, quick, updatedAt: Date.now() });
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
  const rows = [];

  if (activePeriod === "year") {
    for (let m = 0; m < 12; m++) {
      let total = 0;
      Object.entries(all).forEach(([key, values]) => {
        const d = parseDateKey(key);
        if (d.getFullYear() === start.getFullYear() && d.getMonth() === m) {
          total += Object.values(values || {}).reduce((s,v) => s + Number(v || 0), 0);
        }
      });
      rows.push({
        label: new Date(start.getFullYear(), m, 1).toLocaleDateString("cs-CZ",{month:"short"}),
        total
      });
    }
  } else {
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = localDateKey(cursor);
      const total = Object.values(all[key] || {}).reduce((s,v) => s + Number(v || 0), 0);
      rows.push({
        label: activePeriod === "week"
          ? cursor.toLocaleDateString("cs-CZ",{weekday:"short",day:"numeric",month:"numeric"})
          : cursor.toLocaleDateString("cs-CZ",{day:"numeric",month:"numeric"}),
        total
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  chartDataCache = rows;
  renderOverviewTable(rows);
  drawChart(rows);
}

function renderOverviewTable(rows) {
  const body = $("#overviewTable");
  body.replaceChildren();
  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(row.label)}</td><td>${row.total.toLocaleString("cs-CZ")}</td>`;
    body.appendChild(tr);
  });
}

function drawChart(rows) {
  const canvas = $("#overviewChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth - 16;
  const cssHeight = 300;
  canvas.width = Math.max(320, cssWidth) * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = `${Math.max(320, cssWidth)}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr,0,0,dpr,0,0);

  const w = Math.max(320, cssWidth), h = cssHeight;
  ctx.clearRect(0,0,w,h);
  const pad = {l:42,r:12,t:18,b:48};
  const cw = w-pad.l-pad.r, ch = h-pad.t-pad.b;
  const max = Math.max(1, ...rows.map(r => r.total));

  ctx.strokeStyle = "#d1d5db";
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui";
  ctx.lineWidth = 1;

  for (let i=0;i<=4;i++) {
    const y = pad.t + ch - ch*i/4;
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(w-pad.r,y); ctx.stroke();
    const val = Math.round(max*i/4);
    ctx.fillText(String(val), 4, y+4);
  }

  const gap = 4;
  const bw = Math.max(2, cw/rows.length-gap);
  rows.forEach((row,i) => {
    const x = pad.l + i*cw/rows.length + gap/2;
    const bh = ch*(row.total/max);
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(x, pad.t+ch-bh, bw, bh);

    const showEvery = rows.length > 14 ? Math.ceil(rows.length/8) : 1;
    if (i % showEvery === 0) {
      ctx.save();
      ctx.translate(x+bw/2, h-10);
      ctx.rotate(-0.55);
      ctx.fillStyle = "#374151";
      ctx.textAlign = "right";
      ctx.fillText(row.label,0,0);
      ctx.restore();
    }
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
