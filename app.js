const STORAGE_KEY = "guardar_senhas_vault";
const AUTO_LOCK_MS = 5 * 60 * 1000;
const SESSION_PASSWORD_KEY = "guardar_senhas_session_password";
const KDF_ITERATIONS = 310000;

const state = {
  mode: "unlock",
  sourceVault: null,
  key: null,
  entries: [],
  lockTimer: null,
  search: "",
};

const el = {
  status: document.querySelector("#status"),
  lockScreen: document.querySelector("#lock-screen"),
  lockTitle: document.querySelector("#lock-title"),
  lockHelp: document.querySelector("#lock-help"),
  unlockForm: document.querySelector("#unlock-form"),
  masterPassword: document.querySelector("#master-password"),
  masterConfirm: document.querySelector("#master-confirm"),
  confirmWrap: document.querySelector("#confirm-wrap"),
  unlockBtn: document.querySelector("#unlock-btn"),
  appScreen: document.querySelector("#app-screen"),
  search: document.querySelector("#search"),
  addEntry: document.querySelector("#add-entry"),
  logoutBtn: document.querySelector("#logout-btn"),
  entries: document.querySelector("#entries"),
  exportJson: document.querySelector("#export-json"),
  importJson: document.querySelector("#import-json"),
  entryDialog: document.querySelector("#entry-dialog"),
  entryForm: document.querySelector("#entry-form"),
  entryTitle: document.querySelector("#entry-title"),
  entryId: document.querySelector("#entry-id"),
  entryName: document.querySelector("#entry-name"),
  entryUser: document.querySelector("#entry-user"),
  entryPass: document.querySelector("#entry-pass"),
  entryUrl: document.querySelector("#entry-url"),
  entryNotes: document.querySelector("#entry-notes"),
  togglePass: document.querySelector("#toggle-pass"),
  genPass: document.querySelector("#gen-pass"),
  cancelEntry: document.querySelector("#cancel-entry"),
  entryTemplate: document.querySelector("#entry-template"),
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

boot().catch((error) => {
  setStatus(`Erro na inicializacao: ${safeMessage(error)}`, true);
});

async function boot() {
  wireEvents();
  const [repoVault, localVault] = await Promise.all([loadRepoVault(), loadLocalVault()]);
  const selectedVault = chooseNewestVault(repoVault, localVault);

  if (selectedVault) {
    state.sourceVault = selectedVault;
    setUnlockMode();
    const restored = await tryRestoreSession();
    if (!restored) {
      setStatus("Cofre criptografado carregado. Digite a senha mestra para login.");
    }
  } else {
    setCreateMode();
    setStatus("Nenhum cofre encontrado. Crie a senha mestra para iniciar.");
  }
}

function wireEvents() {
  el.unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onUnlockSubmit();
  });

  el.search.addEventListener("input", () => {
    state.search = el.search.value.trim().toLowerCase();
    renderEntries();
  });

  el.addEntry.addEventListener("click", () => openEntryDialog());
  el.logoutBtn.addEventListener("click", logoutApp);
  el.exportJson.addEventListener("click", exportVault);

  el.importJson.addEventListener("change", async (event) => {
    await importVaultFromFile(event.target.files?.[0]);
    event.target.value = "";
  });

  el.entries.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const card = button.closest(".entry-card");
    if (!card) {
      return;
    }

    const id = card.dataset.id;
    const action = button.dataset.action;
    const entry = state.entries.find((item) => item.id === id);
    if (!entry) {
      return;
    }

    if (action === "copy-user") {
      await copyToClipboard(entry.username || "");
      setStatus("Usuario copiado.");
      return;
    }
    if (action === "copy-pass") {
      await copyToClipboard(entry.password);
      setStatus("Senha copiada.");
      return;
    }
    if (action === "toggle-pass") {
      const passEl = card.querySelector(".entry-pass");
      if (!passEl) {
        return;
      }
      const visible = card.dataset.passVisible === "1";
      if (visible) {
        passEl.textContent = `Senha: ${maskPassword(entry.password)}`;
        card.dataset.passVisible = "0";
        button.textContent = "Mostrar senha";
      } else {
        passEl.textContent = `Senha: ${entry.password}`;
        card.dataset.passVisible = "1";
        button.textContent = "Ocultar senha";
      }
      return;
    }
    if (action === "edit") {
      openEntryDialog(entry);
      return;
    }
    if (action === "delete") {
      const confirmed = window.confirm(`Excluir senha de "${entry.name}"?`);
      if (confirmed) {
        state.entries = state.entries.filter((item) => item.id !== id);
        await saveEncryptedState("Senha excluida.");
      }
    }
  });

  el.togglePass.addEventListener("click", () => {
    const visible = el.entryPass.type === "text";
    el.entryPass.type = visible ? "password" : "text";
    el.togglePass.textContent = visible ? "Mostrar" : "Ocultar";
  });

  el.genPass.addEventListener("click", () => {
    el.entryPass.value = generateStrongPassword(20);
  });

  el.entryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onSaveEntry();
  });

  el.cancelEntry.addEventListener("click", () => {
    if (el.entryDialog.open) {
      el.entryDialog.close();
    }
  });

  ["click", "keydown", "pointerdown", "touchstart"].forEach((name) => {
    document.addEventListener(name, resetLockTimer, { passive: true });
  });
}

function setCreateMode() {
  state.mode = "create";
  el.lockTitle.textContent = "Criar novo cofre";
  el.lockHelp.textContent = "Defina uma senha mestra forte. Ela e obrigatoria para abrir o cofre.";
  el.confirmWrap.classList.remove("hidden");
  el.unlockBtn.textContent = "Criar cofre";
}

function setUnlockMode() {
  state.mode = "unlock";
  el.lockTitle.textContent = "Login no cofre";
  el.lockHelp.textContent = "Digite sua senha mestra para abrir o cofre criptografado.";
  el.confirmWrap.classList.add("hidden");
  el.unlockBtn.textContent = "Login";
}

async function onUnlockSubmit() {
  const password = el.masterPassword.value;
  if (password.length < 12) {
    setStatus("Senha mestra muito curta. Use pelo menos 12 caracteres.", true);
    return;
  }

  if (state.mode === "create") {
    if (password !== el.masterConfirm.value) {
      setStatus("As senhas mestras nao conferem.", true);
      return;
    }
    await createVault(password);
    return;
  }

  await unlockVault(password);
}

async function createVault(password) {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt, KDF_ITERATIONS);

    state.entries = [];
    state.key = key;
    state.sourceVault = {
      version: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: KDF_ITERATIONS,
        salt: uint8ToBase64(salt),
      },
      cipher: {
        name: "AES-GCM",
        iv: "",
      },
      data: "",
      updatedAt: new Date().toISOString(),
    };

    await saveEncryptedState("Cofre criado. Agora baixe o vault.json e envie ao GitHub.");
    setSessionPassword(password);
    showApp();
  } catch (error) {
    setStatus(`Nao foi possivel criar o cofre: ${safeMessage(error)}`, true);
  } finally {
    clearUnlockFields();
  }
}

async function unlockVault(password, options = {}) {
  const { persistSession = true, showError = true, statusMessage = "" } = options;
  try {
    if (!state.sourceVault) {
      throw new Error("Cofre nao encontrado.");
    }

    const salt = base64ToUint8(state.sourceVault.kdf?.salt || "");
    const iterations = Number(state.sourceVault.kdf?.iterations) || KDF_ITERATIONS;
    const key = await deriveKey(password, salt, iterations);
    const decrypted = await decryptVault(state.sourceVault, key);
    if (!Array.isArray(decrypted.entries)) {
      throw new Error("Formato invalido do cofre.");
    }

    state.key = key;
    state.entries = decrypted.entries;
    if (persistSession) {
      setSessionPassword(password);
    }
    if (statusMessage) {
      setStatus(statusMessage);
    } else {
      setStatus(`Login realizado: ${state.entries.length} item(ns).`);
    }
    showApp();
    return true;
  } catch {
    if (showError) {
      setStatus("Senha incorreta ou arquivo corrompido.", true);
    }
    return false;
  } finally {
    clearUnlockFields();
  }
}

function showApp() {
  el.lockScreen.classList.add("hidden");
  el.appScreen.classList.remove("hidden");
  renderEntries();
  resetLockTimer();
}

function lockApp(options = {}) {
  const { clearSession = false, message = "Cofre bloqueado." } = options;
  if (clearSession) {
    clearSessionPassword();
  }
  state.key = null;
  state.entries = [];
  state.search = "";
  el.search.value = "";
  el.lockScreen.classList.remove("hidden");
  el.appScreen.classList.add("hidden");
  if (state.lockTimer) {
    clearTimeout(state.lockTimer);
    state.lockTimer = null;
  }
  if (isEncryptedVault(state.sourceVault)) {
    setUnlockMode();
  } else {
    setCreateMode();
  }
  setStatus(message);
}

function logoutApp() {
  lockApp({ clearSession: true, message: "Logout realizado. Faca login novamente." });
}

async function tryRestoreSession() {
  const sessionPassword = sessionStorage.getItem(SESSION_PASSWORD_KEY);
  if (!sessionPassword) {
    return false;
  }

  const restored = await unlockVault(sessionPassword, {
    persistSession: false,
    showError: false,
    statusMessage: "Sessao restaurada apos atualizar a pagina.",
  });
  if (!restored) {
    clearSessionPassword();
  }
  return restored;
}

async function saveEncryptedState(successMessage) {
  if (!state.key || !state.sourceVault) {
    throw new Error("Estado criptografico indisponivel.");
  }

  const payload = {
    entries: state.entries.map((item) => ({ ...item })),
  };

  const encrypted = await encryptVault(payload, state.key, state.sourceVault);
  state.sourceVault = encrypted;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
  renderEntries();
  setStatus(`${successMessage} Salvo localmente em formato criptografado.`);
  resetLockTimer();
}

function renderEntries() {
  const fragment = document.createDocumentFragment();
  const search = state.search;

  const filtered = state.entries
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" }))
    .filter((entry) => {
      if (!search) {
        return true;
      }
      const joined = [entry.name, entry.username, entry.url, entry.notes].join(" ").toLowerCase();
      return joined.includes(search);
    });

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhuma senha encontrada.";
    fragment.append(empty);
  } else {
    for (const entry of filtered) {
      const node = el.entryTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.id = entry.id;
      node.dataset.passVisible = "0";
      node.querySelector(".entry-name").textContent = entry.name;
      node.querySelector(".entry-user").textContent = entry.username ? `Usuario: ${entry.username}` : "Usuario:";
      node.querySelector(".entry-pass").textContent = `Senha: ${maskPassword(entry.password)}`;

      const updatedEl = node.querySelector(".entry-updated");
      updatedEl.textContent = `Atualizado em: ${formatDate(entry.updatedAt)}`;
      fragment.append(node);
    }
  }

  el.entries.replaceChildren(fragment);
}

function openEntryDialog(entry) {
  const editing = Boolean(entry);
  el.entryTitle.textContent = editing ? "Editar senha" : "Nova senha";
  el.entryId.value = entry?.id || "";
  el.entryName.value = entry?.name || "";
  el.entryUser.value = entry?.username || "";
  el.entryPass.value = entry?.password || "";
  el.entryUrl.value = entry?.url || "";
  el.entryNotes.value = entry?.notes || "";
  el.entryPass.type = "password";
  el.togglePass.textContent = "Mostrar";
  el.entryDialog.showModal();
}

async function onSaveEntry() {
  const name = el.entryName.value.trim();
  const username = el.entryUser.value.trim();
  const password = el.entryPass.value;
  const url = el.entryUrl.value.trim();
  const notes = el.entryNotes.value.trim();

  if (!name || !password) {
    setStatus("Nome e senha sao obrigatorios.", true);
    return;
  }

  const now = new Date().toISOString();
  const existingId = el.entryId.value;

  if (existingId) {
    state.entries = state.entries.map((entry) => {
      if (entry.id !== existingId) {
        return entry;
      }
      return {
        ...entry,
        name,
        username,
        password,
        url,
        notes,
        updatedAt: now,
      };
    });
    await saveEncryptedState("Senha atualizada.");
  } else {
    state.entries.push({
      id: newId(),
      name,
      username,
      password,
      url,
      notes,
      createdAt: now,
      updatedAt: now,
    });
    await saveEncryptedState("Senha adicionada.");
  }

  el.entryDialog.close();
}

async function exportVault() {
  if (!state.sourceVault) {
    setStatus("Nenhum cofre disponivel para exportar.", true);
    return;
  }

  const fileName = "vault.json";
  const content = JSON.stringify(state.sourceVault, null, 2);

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      setStatus("vault.json exportado e salvo.");
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Exportacao cancelada.");
        return;
      }
      forceDownloadVault(fileName, content);
      setStatus("Exportado via download. Salve o arquivo na sua pasta da nuvem.");
      return;
    }
  }

  forceDownloadVault(fileName, content);
  setStatus("Exportado via download. Salve o arquivo na sua pasta da nuvem.");
}

function forceDownloadVault(fileName, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importVaultFromFile(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const vault = JSON.parse(text);
    assertVaultShape(vault);
    state.sourceVault = vault;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
    state.key = null;
    state.entries = [];
    lockApp({ clearSession: true, message: "Arquivo importado. Digite a senha mestra para login." });
  } catch (error) {
    setStatus(`Falha ao importar JSON: ${safeMessage(error)}`, true);
  }
}

async function loadRepoVault() {
  try {
    const response = await fetch("./vault.json", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const vault = await response.json();
    if (!isEncryptedVault(vault)) {
      return null;
    }
    return vault;
  } catch {
    return null;
  }
}

async function loadLocalVault() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!isEncryptedVault(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function chooseNewestVault(repoVault, localVault) {
  if (!repoVault && !localVault) {
    return null;
  }
  if (!repoVault) {
    setStatus("Usando a copia local criptografada.");
    return localVault;
  }
  if (!localVault) {
    return repoVault;
  }

  const repoDate = Date.parse(repoVault.updatedAt || "");
  const localDate = Date.parse(localVault.updatedAt || "");

  if (Number.isNaN(repoDate) && !Number.isNaN(localDate)) {
    setStatus("Usando a versao local mais recente do cofre.");
    return localVault;
  }
  if (!Number.isNaN(localDate) && localDate > repoDate) {
    setStatus("Usando a versao local mais recente do cofre.");
    return localVault;
  }
  return repoVault;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "-";
  }
  return date.toLocaleString("pt-BR");
}

function maskPassword(password) {
  const source = String(password || "");
  if (!source) {
    return "-";
  }
  const size = Math.min(Math.max(source.length, 8), 16);
  return "*".repeat(size);
}

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.style.color = isError ? "#8b2d2d" : "var(--primary)";
}

function clearUnlockFields() {
  el.masterPassword.value = "";
  el.masterConfirm.value = "";
}

function setSessionPassword(password) {
  sessionStorage.setItem(SESSION_PASSWORD_KEY, password);
}

function clearSessionPassword() {
  sessionStorage.removeItem(SESSION_PASSWORD_KEY);
}

function resetLockTimer() {
  if (!state.key) {
    return;
  }
  if (state.lockTimer) {
    clearTimeout(state.lockTimer);
  }
  state.lockTimer = setTimeout(() => {
    lockApp({ message: "Cofre bloqueado automaticamente por inatividade." });
  }, AUTO_LOCK_MS);
}

function generateStrongPassword(length = 20) {
  const lettersLower = "abcdefghijkmnopqrstuvwxyz";
  const lettersUpper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*()-_=+?";

  const required = [
    randomChar(lettersLower),
    randomChar(lettersUpper),
    randomChar(digits),
    randomChar(symbols),
  ];

  const all = lettersLower + lettersUpper + digits + symbols;
  const values = [];

  while (required.length + values.length < length) {
    values.push(randomChar(all));
  }

  const full = [...required, ...values];
  for (let i = full.length - 1; i > 0; i -= 1) {
    const r = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [full[i], full[r]] = [full[r], full[i]];
  }
  return full.join("");
}

function randomChar(source) {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] % source.length;
  return source[random];
}

function assertVaultShape(vault) {
  if (!isEncryptedVault(vault)) {
    throw new Error("Formato invalido de vault.json");
  }
}

function isEncryptedVault(vault) {
  const iterations = Number(vault?.kdf?.iterations);
  return Boolean(
    vault &&
      typeof vault === "object" &&
      vault.version === 1 &&
      typeof vault.data === "string" &&
      vault.data.length > 0 &&
      typeof vault.kdf?.salt === "string" &&
      vault.kdf.salt.length > 0 &&
      Number.isFinite(iterations) &&
      iterations >= 100000 &&
      typeof vault.cipher?.name === "string" &&
      typeof vault.cipher?.iv === "string" &&
      vault.cipher.iv.length > 0
  );
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    material,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptVault(payload, key, template) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = textEncoder.encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);

  return {
    version: 1,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: Number(template.kdf?.iterations) || KDF_ITERATIONS,
      salt: template.kdf?.salt,
    },
    cipher: {
      name: "AES-GCM",
      iv: uint8ToBase64(iv),
    },
    data: arrayBufferToBase64(encrypted),
    updatedAt: new Date().toISOString(),
  };
}

async function decryptVault(vault, key) {
  const iv = base64ToUint8(vault.cipher.iv);
  const encrypted = base64ToArrayBuffer(vault.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return JSON.parse(textDecoder.decode(decrypted));
}

function uint8ToBase64(value) {
  return arrayBufferToBase64(value.buffer);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64ToArrayBuffer(base64) {
  return base64ToUint8(base64).buffer;
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();

  if (!copied) {
    throw new Error("Clipboard nao disponivel");
  }
}

function newId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const parts = [4, 2, 2, 2, 6];
  let offset = 0;
  return parts
    .map((length) => {
      const chunk = bytes.slice(offset, offset + length);
      offset += length;
      return [...chunk].map((item) => item.toString(16).padStart(2, "0")).join("");
    })
    .join("-");
}

function safeMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
