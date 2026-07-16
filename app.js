import { firebaseConfig, allowedEmails } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getDatabase, ref, onValue, push, set, update, remove, runTransaction
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

const $ = (s) => document.querySelector(s);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const loginView = $("#loginView");
const appView = $("#appView");
const loginError = $("#loginError");
const itemsEl = $("#items");
const emptyState = $("#emptyState");
const addBtn = $("#addBtn");
const accountBtn = $("#accountBtn");
const addDialog = $("#addDialog");
const editDialog = $("#editDialog");
const accountDialog = $("#accountDialog");
let currentItems = {};
let unsubscribe = null;
let deferredInstallPrompt = null;

function allowed(user) {
  return !!user?.email && allowedEmails.map(x => x.toLowerCase()).includes(user.email.toLowerCase());
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
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!user) {
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
    addBtn.classList.add("hidden");
    accountBtn.classList.add("hidden");
    return;
  }
  if (!allowed(user)) {
    loginError.textContent = `Účet ${user.email} nemá povolený přístup.`;
    await signOut(auth);
    return;
  }
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  addBtn.classList.remove("hidden");
  accountBtn.classList.remove("hidden");
  $("#userEmail").textContent = user.email;
  unsubscribe = onValue(ref(db, "shared/items"), snap => {
    currentItems = snap.val() || {};
    renderItems();
  }, error => {
    console.error(error);
    alert("Data se nepodařilo načíst.");
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

    const quicks = Array.isArray(item.quick) ? item.quick : [1,3,5];
    const quickWrap = node.querySelector(".quick-buttons");
    quicks.slice(0,3).forEach(value => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `+${value}`;
      b.addEventListener("click", () => addValue(id, Number(value), b));
      quickWrap.appendChild(b);
    });

    node.querySelector(".custom-form").addEventListener("submit", async e => {
      e.preventDefault();
      const input = node.querySelector(".custom-value");
      const value = Number(input.value);
      if (!Number.isInteger(value) || value <= 0) return;
      await addValue(id, value, e.submitter);
      input.value = "";
    });

    node.querySelector(".edit").addEventListener("click", () => openEdit(id));
    itemsEl.appendChild(node);
  }
}

async function addValue(id, value, button) {
  if (!Number.isFinite(value) || value <= 0) return;
  button?.classList.add("syncing");
  try {
    await runTransaction(ref(db, `shared/items/${id}/count`), current => Number(current || 0) + value);
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
