const STORAGE_KEY = "tasks_v1";
const ENABLE_FILE_SYNC = false;
const BASE_FILE_NAME = "atividades-base.json";
const HANDLE_DB_NAME = "atividades_sync_db";
const HANDLE_STORE_NAME = "kv";
const HANDLE_KEY = "json_file_handle";

const form = document.getElementById("task-form");
const toggleFormBtn = document.getElementById("toggle-form-btn");
const syncJsonBtn = document.getElementById("sync-json-btn");
const storageSourceEl = document.getElementById("storage-source");
const syncStatusEl = document.getElementById("sync-status");
const jsonFileInputEl = document.getElementById("json-file-input");

const titleInput = document.getElementById("title");
const dueDateInput = document.getElementById("dueDate");
const recurrenceInput = document.getElementById("recurrence");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");

const openListEl = document.getElementById("task-list-open");
const doneListEl = document.getElementById("task-list-done");
const deletedListEl = document.getElementById("task-list-deleted");
const template = document.getElementById("task-template");
const statsEl = document.getElementById("stats");
const monthLabelEl = document.getElementById("month-label");
const monthGridEl = document.getElementById("month-grid");
const monthPrevBtn = document.getElementById("month-prev");
const monthNextBtn = document.getElementById("month-next");

const todayIso = () => new Date().toISOString().slice(0, 10);
dueDateInput.value = todayIso();

let tasks = loadTasks();
let editingTaskId = null;
let formOpen = false;
let taskNumberMap = {};
let sameDateMetaMap = {};
let monthCursor = new Date();
monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);

let syncedFileHandle = null;
let fileSyncTimer = null;
let isWritingFile = false;

function setSyncStatus(text) {
  syncStatusEl.textContent = text;
}

function setStorageSource(text) {
  storageSourceEl.textContent = text;
}

function supportsFileSync() {
  return typeof window.showSaveFilePicker === "function";
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        db.createObjectStore(HANDLE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key, value) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
    tx.objectStore(HANDLE_STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE_NAME, "readonly");
    const req = tx.objectStore(HANDLE_STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandleForAutoReconnect(handle) {
  if (!("indexedDB" in window)) return;
  try {
    await idbSet(HANDLE_KEY, handle);
  } catch {
    // Some browsers may block storing handles; app still works without auto reconnect.
  }
}

async function readSavedHandle() {
  if (!("indexedDB" in window)) return null;
  try {
    return await idbGet(HANDLE_KEY);
  } catch {
    return null;
  }
}

async function hasReadWritePermission(handle) {
  const current = await handle.queryPermission({ mode: "readwrite" });
  return current === "granted";
}

async function ensureReadWritePermission(handle) {
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") return true;
  const requested = await handle.requestPermission({ mode: "readwrite" });
  return requested === "granted";
}

async function readTasksFromHandle(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  if (!text.trim()) return [];

  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON invalido");
  return normalizeTasks(data);
}

async function writeTasksToHandle(handle) {
  if (!handle || isWritingFile) return;
  isWritingFile = true;

  try {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(tasks, null, 2));
    await writable.close();
    setSyncStatus(`Sincronizado em arquivo JSON (${new Date().toLocaleTimeString("pt-BR")}).`);
  } catch {
    setSyncStatus("Falha ao gravar no arquivo. Verifique permissoes.");
  } finally {
    isWritingFile = false;
  }
}

function scheduleFileSync() {
  if (!syncedFileHandle) return;
  if (fileSyncTimer) clearTimeout(fileSyncTimer);

  fileSyncTimer = setTimeout(() => {
    fileSyncTimer = null;
    void writeTasksToHandle(syncedFileHandle);
  }, 300);
}

async function connectHandle(handle, options = {}) {
  const { requestPermission = true } = options;

  try {
    const allowed = requestPermission
      ? await ensureReadWritePermission(handle)
      : await hasReadWritePermission(handle);

    if (!allowed) {
      setSyncStatus("Permissao negada para o arquivo JSON.");
      return false;
    }

    const loaded = await readTasksFromHandle(handle);
    syncedFileHandle = handle;
    setStorageSource(`Base: ${handle.name}`);

    if (loaded.length > 0 || tasks.length === 0) {
      tasks = loaded;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      render();
      setSyncStatus("Arquivo conectado. Dados carregados e sincronizacao ativa.");
    } else {
      setSyncStatus("Arquivo vazio conectado. Mantidos dados atuais e sincronizacao ativa.");
    }

    await saveHandleForAutoReconnect(handle);
    return true;
  } catch {
    setSyncStatus("Nao foi possivel conectar esse arquivo JSON.");
    return false;
  }
}

async function tryAutoReconnectSavedHandle() {
  if (!supportsFileSync()) return false;

  const savedHandle = await readSavedHandle();
  if (!savedHandle) return false;

  const connected = await connectHandle(savedHandle, { requestPermission: false });
  if (!connected) {
    setSyncStatus("Base salva encontrada, mas o navegador pediu nova permissao. Clique em Sincronizar JSON.");
    return false;
  }

  await writeTasksToHandle(savedHandle);
  setStorageSource(`Base: ${savedHandle.name}`);
  setSyncStatus("Base JSON reconectada automaticamente.");
  return true;
}

async function chooseJsonBase() {
  if (supportsFileSync() && typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Arquivo JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });

      const connected = await connectHandle(handle);
      if (connected) {
        await writeTasksToHandle(handle);
      }
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setSyncStatus("Falha ao abrir seletor de arquivo. Tente novamente.");
      return;
    }
  }

  if (supportsFileSync()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: BASE_FILE_NAME,
        types: [
          {
            description: "Arquivo JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });

      const connected = await connectHandle(handle);
      if (connected) {
        await writeTasksToHandle(handle);
      }
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setSyncStatus("Falha ao abrir seletor de arquivo. Tente novamente.");
      return;
    }
  }

  if (jsonFileInputEl) {
    jsonFileInputEl.value = "";
    jsonFileInputEl.click();
  }
}

async function loadFromImportedFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      setSyncStatus("JSON invalido. O arquivo precisa conter uma lista de atividades.");
      return;
    }

    tasks = normalizeTasks(parsed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    setStorageSource(`Base: importada (${file.name})`);
    setSyncStatus("Arquivo importado. Neste navegador, a gravacao continua local.");
    render();
  } catch {
    setSyncStatus("Erro ao ler/importar o JSON.");
  }
}

if (syncJsonBtn) {
  syncJsonBtn.addEventListener("click", () => {
    if (!ENABLE_FILE_SYNC) {
      setStorageSource("Base: local");
      setSyncStatus("Sincronizacao por arquivo desativada nesta versao. Dados salvos localmente.");
      return;
    }
    void chooseJsonBase();
  });
}

if (jsonFileInputEl && ENABLE_FILE_SYNC) {
  jsonFileInputEl.addEventListener("change", () => {
    const file = jsonFileInputEl.files && jsonFileInputEl.files[0];
    void loadFromImportedFile(file);
  });
}

function captureTaskPositions() {
  const map = new Map();
  document.querySelectorAll(".task-item[data-id]").forEach((el) => {
    map.set(el.dataset.id, el.getBoundingClientRect());
  });
  return map;
}

function animateTaskReorder(beforePositions) {
  if (!beforePositions || beforePositions.size === 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  document.querySelectorAll(".task-item[data-id]").forEach((el) => {
    const oldBox = beforePositions.get(el.dataset.id);
    if (!oldBox) return;

    const newBox = el.getBoundingClientRect();
    const dx = oldBox.left - newBox.left;
    const dy = oldBox.top - newBox.top;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  });
}

function setFormOpen(open) {
  formOpen = open;
  form.hidden = !open;
  toggleFormBtn.textContent = open ? "Fechar formulario" : "Nova atividade";
}

toggleFormBtn.addEventListener("click", () => {
  setFormOpen(!formOpen);
  if (formOpen) titleInput.focus();
});

monthPrevBtn.addEventListener("click", () => {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
  renderMonthlyPanel();
});

monthNextBtn.addEventListener("click", () => {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
  renderMonthlyPanel();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const fd = new FormData(form);

  const payload = {
    title: String(fd.get("title") || "").trim(),
    dueDate: String(fd.get("dueDate") || todayIso()),
    recurrence: String(fd.get("recurrence") || "none"),
  };

  if (!payload.title) return;

  if (editingTaskId) {
    tasks = tasks.map((task) => {
      if (task.id !== editingTaskId) return task;
      return {
        ...task,
        title: payload.title,
        dueDate: payload.dueDate,
        recurrence: payload.recurrence,
        deleted: false,
        deletedAt: null,
        nextDueDate: task.completed && payload.recurrence !== "none"
          ? task.nextDueDate || advanceDate(payload.dueDate, payload.recurrence)
          : null,
      };
    });
  } else {
    tasks.push({
      id: crypto.randomUUID(),
      title: payload.title,
      dueDate: payload.dueDate,
      recurrence: payload.recurrence,
      completed: false,
      completedAt: null,
      nextDueDate: null,
      deleted: false,
      deletedAt: null,
      rank: Date.now(),
      createdAt: Date.now(),
    });
  }

  persist();
  resetFormMode();
  render();
});

cancelEditBtn.addEventListener("click", () => {
  resetFormMode();
});

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeTasks(parsed);
  } catch {
    return [];
  }
}

function normalizeTasks(list) {
  return list.map((task) => ({
    ...task,
    id: task.id || crypto.randomUUID(),
    title: String(task.title || "").trim(),
    dueDate: task.dueDate || todayIso(),
    recurrence: task.recurrence || "none",
    completed: Boolean(task.completed),
    completedAt: task.completedAt || null,
    nextDueDate: task.nextDueDate || null,
    deleted: Boolean(task.deleted),
    deletedAt: task.deletedAt || null,
    rank: task.rank ?? task.createdAt ?? Date.now(),
    createdAt: task.createdAt ?? Date.now(),
  }));
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  if (ENABLE_FILE_SYNC) {
    scheduleFileSync();
  }
}

function sortOpenTasks(list) {
  return [...list].sort(compareByDateThenRank);
}

function splitOpenTasks(openTasks) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endThisWeek = new Date(today);
  endThisWeek.setDate(endThisWeek.getDate() + (7 - endThisWeek.getDay()));
  endThisWeek.setHours(23, 59, 59, 999);

  const endNextWeek = new Date(endThisWeek);
  endNextWeek.setDate(endNextWeek.getDate() + 7);
  endNextWeek.setHours(23, 59, 59, 999);

  const endThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

  const buckets = {
    thisWeek: [],
    nextWeek: [],
    thisMonth: [],
    nextMonths: [],
  };

  for (const task of openTasks) {
    const [y, m, d] = task.dueDate.split("-").map(Number);
    const due = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);

    if (due <= endThisWeek) {
      buckets.thisWeek.push(task);
    } else if (due <= endNextWeek) {
      buckets.nextWeek.push(task);
    } else if (due <= endThisMonth) {
      buckets.thisMonth.push(task);
    } else {
      buckets.nextMonths.push(task);
    }
  }

  return buckets;
}

function sortDoneTasks(list) {
  return [...list].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
}

function sortDeletedTasks(list) {
  return [...list].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

function compareByDateThenRank(a, b) {
  const dateA = getTaskCalendarDate(a);
  const dateB = getTaskCalendarDate(b);
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const rankA = a.rank ?? a.createdAt ?? 0;
  const rankB = b.rank ?? b.createdAt ?? 0;
  if (rankA !== rankB) return rankA - rankB;

  const createdA = a.createdAt ?? 0;
  const createdB = b.createdAt ?? 0;
  if (createdA !== createdB) return createdA - createdB;
  return String(a.id).localeCompare(String(b.id));
}

function createTaskNumberMap(activeTasks) {
  const ordered = [...activeTasks].sort(compareByDateThenRank);

  const map = {};
  ordered.forEach((task, index) => {
    map[task.id] = index + 1;
  });
  return map;
}

function createSameDateMetaMap(activeTasks) {
  const grouped = {};
  for (const task of activeTasks) {
    const key = getTaskCalendarDate(task);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(task);
  }

  const map = {};
  for (const key of Object.keys(grouped)) {
    const ordered = grouped[key].sort(compareByDateThenRank);
    ordered.forEach((task, index) => {
      map[task.id] = { index, total: ordered.length };
    });
  }
  return map;
}

function recurrenceLabel(key) {
  switch (key) {
    case "daily":
      return "Diaria";
    case "weekly":
      return "Semanal";
    case "monthly":
      return "Mensal";
    default:
      return "Nao recorrente";
  }
}

function advanceDate(isoDate, recurrence) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return todayIso();

  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);

  return d.toISOString().slice(0, 10);
}

function postpone(id, days = 1) {
  tasks = tasks.map((t) => {
    if (t.id !== id || t.deleted) return t;

    const baseIso = t.completed && t.nextDueDate ? t.nextDueDate : t.dueDate;
    const base = new Date(`${baseIso}T12:00:00`);
    if (Number.isNaN(base.getTime())) return t;
    base.setDate(base.getDate() + days);

    const shifted = base.toISOString().slice(0, 10);

    if (t.completed && t.recurrence !== "none") {
      return {
        ...t,
        nextDueDate: shifted,
      };
    }

    return {
      ...t,
      dueDate: shifted,
      completed: false,
      completedAt: null,
      nextDueDate: null,
    };
  });
  persist();
  render();
}

function updateTaskDate(id, newDate) {
  tasks = tasks.map((t) => {
    if (t.id !== id || t.deleted) return t;

    if (t.completed && t.recurrence !== "none") {
      return {
        ...t,
        nextDueDate: newDate,
      };
    }

    return {
      ...t,
      dueDate: newDate,
      nextDueDate: null,
    };
  });

  persist();
  render();
}

function completeTask(task) {
  if (task.recurrence !== "none") {
    return {
      ...task,
      dueDate: advanceDate(task.dueDate, task.recurrence),
      completed: false,
      completedAt: null,
      nextDueDate: null,
    };
  }

  return {
    ...task,
    completed: true,
    completedAt: Date.now(),
    nextDueDate: null,
  };
}

function reopenTask(task) {
  if (task.recurrence !== "none") {
    return {
      ...task,
      dueDate: task.nextDueDate || advanceDate(task.dueDate, task.recurrence),
      completed: false,
      completedAt: null,
      nextDueDate: null,
    };
  }

  return {
    ...task,
    completed: false,
    completedAt: null,
    nextDueDate: null,
  };
}

function toggleComplete(id) {
  tasks = tasks.map((task) => {
    if (task.id !== id || task.deleted) return task;
    return task.completed ? reopenTask(task) : completeTask(task);
  });

  persist();
  render();
}

function slowScrollToTop(durationMs = 900) {
  const startY = window.scrollY || window.pageYOffset;
  if (startY <= 0) return;

  const startTime = performance.now();

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = easeInOutCubic(progress);
    const nextY = startY * (1 - eased);
    window.scrollTo(0, nextY);

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

function startEdit(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.deleted) return;

  editingTaskId = id;
  titleInput.value = task.title;
  dueDateInput.value = task.dueDate;
  recurrenceInput.value = task.recurrence;
  submitBtn.textContent = "Salvar edicao";
  cancelEditBtn.hidden = false;
  setFormOpen(true);
  slowScrollToTop(1000);
  titleInput.focus();
}

function reuseTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  resetFormMode();
  titleInput.value = task.title;
  dueDateInput.value = todayIso();
  recurrenceInput.value = task.recurrence || "none";
  setFormOpen(true);
  slowScrollToTop(1000);
  titleInput.focus();
}

function resetFormMode() {
  editingTaskId = null;
  submitBtn.textContent = "Adicionar";
  cancelEditBtn.hidden = true;
  form.reset();
  dueDateInput.value = todayIso();
  setFormOpen(false);
}

function removeTask(id) {
  tasks = tasks.map((task) => {
    if (task.id !== id) return task;
    return {
      ...task,
      deleted: true,
      deletedAt: Date.now(),
      completed: false,
      completedAt: null,
      nextDueDate: null,
    };
  });

  persist();

  if (editingTaskId === id) {
    resetFormMode();
  }

  render();
}

function moveTaskWithinDate(id, direction) {
  const baseTask = tasks.find((task) => task.id === id);
  if (!baseTask || baseTask.deleted) return;

  const dateKey = getTaskCalendarDate(baseTask);
  const sameDate = tasks
    .filter((task) => !task.deleted && getTaskCalendarDate(task) === dateKey)
    .sort(compareByDateThenRank);

  const index = sameDate.findIndex((task) => task.id === id);
  if (index < 0) return;

  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= sameDate.length) return;

  const current = sameDate[index];
  const target = sameDate[newIndex];
  const currentRank = current.rank ?? current.createdAt ?? 0;
  const targetRank = target.rank ?? target.createdAt ?? 0;

  tasks = tasks.map((task) => {
    if (task.id === current.id) return { ...task, rank: targetRank };
    if (task.id === target.id) return { ...task, rank: currentRank };
    return task;
  });

  persist();
  render();
}

function purgeTask(id) {
  tasks = tasks.filter((task) => task.id !== id);
  persist();

  if (editingTaskId === id) {
    resetFormMode();
  }

  render();
}

function renderTask(task, mode) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  node.classList.toggle("done", task.completed);
  node.classList.toggle("deleted", mode === "deleted");

  const toggleBtn = node.querySelector(".btn-toggle");
  const datePicker = node.querySelector(".date-picker-inline");
  const dateBtn = node.querySelector(".btn-calendar");
  const minusBtn = node.querySelector(".btn-postpone-minus");
  const plusBtn = node.querySelector(".btn-postpone");
  const editBtn = node.querySelector(".btn-edit");
  const deleteBtn = node.querySelector(".btn-delete");
  const moveUpBtn = node.querySelector(".btn-move-up");
  const moveDownBtn = node.querySelector(".btn-move-down");
  const restoreBtn = node.querySelector(".btn-restore");

  toggleBtn.classList.toggle("checked", task.completed);

  const displayDate = task.completed && task.nextDueDate
    ? `${formatDateWithWeekday(task.dueDate)} -> ${formatDateWithWeekday(task.nextDueDate)}`
    : formatDateWithWeekday(task.dueDate);
  const editableDate = task.completed && task.recurrence !== "none" && task.nextDueDate ? task.nextDueDate : task.dueDate;

  const number = taskNumberMap[task.id];
  const h3 = node.querySelector("h3");
  h3.textContent = "";
  if (number) {
    const numberSpan = document.createElement("span");
    numberSpan.className = "task-number";
    numberSpan.textContent = `#${number} `;
    h3.appendChild(numberSpan);
  }
  h3.appendChild(document.createTextNode(task.title));
  node.querySelector(".meta-date").textContent = `Data: ${displayDate}`;

  const extra = [
    `Recorrencia: ${recurrenceLabel(task.recurrence)}`,
    mode === "deleted" ? "Status: excluida" : task.completed ? "Status: concluida" : "Status: ativa",
  ];
  node.querySelector(".meta-extra").textContent = extra.join(" | ");

  datePicker.value = editableDate;

  if (mode === "deleted") {
    toggleBtn.classList.add("is-hidden");
    minusBtn.classList.add("is-hidden");
    plusBtn.classList.add("is-hidden");
    dateBtn.classList.add("is-hidden");
    datePicker.classList.add("is-hidden");
    editBtn.classList.add("is-hidden");
    moveUpBtn.classList.add("is-hidden");
    moveDownBtn.classList.add("is-hidden");
    deleteBtn.textContent = "Excluir de vez";
    deleteBtn.title = "Excluir permanentemente";
    deleteBtn.addEventListener("click", () => purgeTask(task.id));
  } else {
    restoreBtn.classList.add("is-hidden");
    const sameDateMeta = sameDateMetaMap[task.id] || { index: 0, total: 1 };
    if (sameDateMeta.total <= 1) {
      moveUpBtn.classList.add("is-hidden");
      moveDownBtn.classList.add("is-hidden");
    } else {
      moveUpBtn.disabled = sameDateMeta.index === 0;
      moveDownBtn.disabled = sameDateMeta.index === sameDateMeta.total - 1;
      moveUpBtn.addEventListener("click", () => moveTaskWithinDate(task.id, -1));
      moveDownBtn.addEventListener("click", () => moveTaskWithinDate(task.id, 1));
    }

    toggleBtn.addEventListener("click", () => toggleComplete(task.id));
    dateBtn.addEventListener("click", () => {
      datePicker.classList.add("show");
      try {
        datePicker.showPicker();
      } catch {
        datePicker.focus();
        datePicker.click();
      }
    });

    datePicker.addEventListener("change", () => {
      if (!datePicker.value) return;
      updateTaskDate(task.id, datePicker.value);
      datePicker.classList.remove("show");
    });

    datePicker.addEventListener("blur", () => {
      datePicker.classList.remove("show");
    });

    minusBtn.addEventListener("click", () => postpone(task.id, -1));
    plusBtn.addEventListener("click", () => postpone(task.id, 1));
    editBtn.addEventListener("click", () => startEdit(task.id));
    deleteBtn.addEventListener("click", () => removeTask(task.id));
  }

  restoreBtn.addEventListener("click", () => reuseTask(task.id));

  return node;
}

function getTaskCalendarDate(task) {
  if (task.completed && task.recurrence !== "none" && task.nextDueDate) {
    return task.nextDueDate;
  }
  return task.dueDate;
}

function buildDateCountMap(monthDate) {
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth();
  const counts = {};

  for (const task of tasks) {
    if (task.deleted) continue;
    const dateKey = getTaskCalendarDate(task);
    const [ty, tm] = dateKey.split("-").map(Number);
    if (ty !== y || ((tm || 1) - 1) !== m) continue;
    if (!counts[dateKey]) counts[dateKey] = [];
    const number = taskNumberMap[task.id];
    if (number) counts[dateKey].push(number);
  }

  for (const key of Object.keys(counts)) {
    counts[key].sort((a, b) => a - b);
  }

  return counts;
}

function renderMonthlyPanel() {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = firstDay.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const dateCount = buildDateCountMap(monthCursor);
  const today = new Date();

  monthLabelEl.textContent = monthName;
  monthGridEl.innerHTML = "";

  for (let i = 0; i < startWeekday; i += 1) {
    const empty = document.createElement("div");
    empty.className = "month-day empty";
    monthGridEl.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cell = document.createElement("div");
    cell.className = "month-day";

    if (
      today.getFullYear() === year &&
      today.getMonth() === month &&
      today.getDate() === day
    ) {
      cell.classList.add("today");
    }

    const num = document.createElement("div");
    num.className = "day-number";
    num.textContent = String(day);
    cell.appendChild(num);

    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const numbers = dateCount[dateKey] || [];
    if (numbers.length > 0) {
      const dots = document.createElement("div");
      dots.className = "day-dots";
      const shown = Math.min(numbers.length, 3);
      for (let i = 0; i < shown; i += 1) {
        const tag = document.createElement("span");
        tag.className = "day-tag";
        tag.textContent = `#${numbers[i]}`;
        dots.appendChild(tag);
      }
      if (numbers.length > shown) {
        const more = document.createElement("small");
        more.textContent = `+${numbers.length - shown}`;
        dots.appendChild(more);
      }
      cell.appendChild(dots);
    }

    monthGridEl.appendChild(cell);
  }
}

function render() {
  const beforePositions = captureTaskPositions();

  openListEl.innerHTML = "";
  doneListEl.innerHTML = "";
  deletedListEl.innerHTML = "";

  const activeTasks = tasks.filter((t) => !t.deleted);
  taskNumberMap = createTaskNumberMap(activeTasks);
  sameDateMetaMap = createSameDateMetaMap(activeTasks);
  const openTasks = sortOpenTasks(activeTasks.filter((t) => !t.completed));
  const doneTasks = sortDoneTasks(activeTasks.filter((t) => t.completed));
  const deletedTasks = sortDeletedTasks(tasks.filter((t) => t.deleted));

  if (openTasks.length === 0) {
    openListEl.innerHTML = '<li class="empty-state">Nenhuma atividade em aberto.</li>';
  } else {
    const buckets = splitOpenTasks(openTasks);
    const groups = [
      { title: "Esta semana (Até Domingo)", items: buckets.thisWeek },
      { title: "Proxima semana", items: buckets.nextWeek },
      { title: "Este mes", items: buckets.thisMonth },
      { title: "Proximos meses", items: buckets.nextMonths },
    ];

    for (const group of groups) {
      if (group.items.length === 0) continue;

      const groupItem = document.createElement("li");
      groupItem.className = "open-subgroup";

      const heading = document.createElement("h4");
      heading.className = "open-subgroup-title";
      heading.textContent = group.title;

      const list = document.createElement("ul");
      list.className = "open-subgroup-list";

      for (const task of group.items) {
        list.appendChild(renderTask(task, "open"));
      }

      groupItem.appendChild(heading);
      groupItem.appendChild(list);
      openListEl.appendChild(groupItem);
    }
  }

  if (doneTasks.length === 0) {
    doneListEl.innerHTML = '<li class="empty-state">Nenhuma atividade concluida.</li>';
  } else {
    for (const task of doneTasks) {
      doneListEl.appendChild(renderTask(task, "done"));
    }
  }

  if (deletedTasks.length === 0) {
    deletedListEl.innerHTML = '<li class="empty-state">Nenhuma atividade excluida.</li>';
  } else {
    for (const task of deletedTasks) {
      deletedListEl.appendChild(renderTask(task, "deleted"));
    }
  }

  statsEl.textContent = `${openTasks.length} em aberto - ${doneTasks.length} concluidas - ${deletedTasks.length} excluidas`;
  renderMonthlyPanel();
  animateTaskReorder(beforePositions);
}

function formatDateWithWeekday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  return `${dt.toLocaleDateString("pt-BR")} (${weekdays[dt.getDay()]})`;
}

setStorageSource("Base: local");
setSyncStatus("Dados salvos neste navegador (modo local).");
render();
if (ENABLE_FILE_SYNC) {
  void tryAutoReconnectSavedHandle();
}

