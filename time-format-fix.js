import { firebaseConfig } from "./config.js";
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, get, onValue, ref, runTransaction, set } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

let items = {};

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatMinutesSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseMinutesSeconds(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d+)\s*:\s*([0-5]?\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function orderedExercises() {
  return Object.entries(items)
    .sort((a, b) => Number(a[1]?.createdAt || 0) - Number(b[1]?.createdAt || 0))
    .filter(([, item]) => item?.type !== "tape")
    .map(([id, item]) => ({ id, name: item?.name || "Bez názvu", type: item?.type || "count" }));
}

function formatOverviewTable() {
  const exercises = orderedExercises();
  document.querySelectorAll("#overviewTable tr").forEach(row => {
    const cells = row.querySelectorAll("td");
    exercises.forEach((exercise, index) => {
      if (exercise.type !== "timer") return;
      const cell = cells[index + 1];
      if (!cell) return;
      const raw = cell.dataset.rawSeconds ?? cell.textContent.replace(/\s/g, "");
      const seconds = Number(raw);
      if (!Number.isFinite(seconds)) return;
      const formatted = formatMinutesSeconds(seconds);
      cell.dataset.rawSeconds = String(seconds);
      if (cell.textContent !== formatted) cell.textContent = formatted;
    });
  });
}

function formatCalendarRows() {
  const timerNames = new Set(
    Object.values(items)
      .filter(item => item?.type === "timer")
      .map(item => item?.name || "Bez názvu")
  );

  document.querySelectorAll("#calendarDayRows .summary-row").forEach(row => {
    const name = row.querySelector("span")?.textContent || "";
    const value = row.querySelector("strong");
    if (!value || !timerNames.has(name)) return;
    const raw = value.dataset.rawSeconds ?? value.textContent.replace(/\s/g, "");
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) return;
    const formatted = formatMinutesSeconds(seconds);
    value.dataset.rawSeconds = String(seconds);
    if (value.textContent !== formatted) value.textContent = formatted;
  });
}

function refreshFormattedTimes() {
  formatOverviewTable();
  formatCalendarRows();
}

onValue(ref(db, "shared/items"), snapshot => {
  items = snapshot.val() || {};
  refreshFormattedTimes();
});

const observer = new MutationObserver(refreshFormattedTimes);
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener("click", async event => {
  const button = event.target.closest(".edit-today-time");
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const itemId = button.closest(".item")?.dataset.itemId;
  if (!itemId) return;

  const activeSnapshot = await get(ref(db, `shared/activeTimers/${itemId}`));
  if (activeSnapshot.val()?.startedAt) {
    alert("Nejdřív zastav časovač.");
    return;
  }

  const day = localDateKey();
  const dailyRef = ref(db, `shared/daily/${day}/${itemId}`);
  const currentSnapshot = await get(dailyRef);
  const current = Number(currentSnapshot.val() || 0);
  const input = prompt("Celkový dnešní čas (minuty:sekundy):", formatMinutesSeconds(current));
  if (input === null) return;

  const next = parseMinutesSeconds(input);
  if (next === null) {
    alert("Zadej čas ve formátu minuty:sekundy, například 8:15.");
    return;
  }

  const delta = next - current;
  if (!delta) return;

  const now = Date.now();
  await set(dailyRef, next);
  await runTransaction(ref(db, `shared/items/${itemId}`), currentItem => currentItem ? {
    ...currentItem,
    count: Math.max(0, Number(currentItem.count || 0) + delta),
    updatedAt: now,
    lastChange: { at: now, delta }
  } : undefined);
}, true);
