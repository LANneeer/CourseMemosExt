// ============================================================
// popup.js — CourseMemos AI: Login + No-Access + Main logic
// ============================================================

const BACKEND_URL = "https://coursememos.com";

const $ = (id) => document.getElementById(id);

// ---- Screens ----

const screenLogin = $("screenLogin");
const screenNoAccess = $("screenNoAccess");
const screenMain = $("screenMain");

function showScreen(name) {
  screenLogin.classList.toggle("active", name === "login");
  screenNoAccess.classList.toggle("active", name === "noAccess");
  screenMain.classList.toggle("active", name === "main");
}

// ---- Status helpers ----

function setStatus(elId, text, type = "loading") {
  const el = $(elId);
  el.className = `status-bar visible ${type}`;
  el.innerHTML = type === "loading"
    ? `<span class="spinner"></span><span>${text}</span>`
    : `<span>${text}</span>`;
}

function hideStatus(elId) {
  $(elId).className = "status-bar";
}

// ---- Session storage ----
// { token, email, name }

const SESSION_KEY = "session";

async function getSession() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return data[SESSION_KEY] || null;
}

async function saveSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

// ---- Status check ----
// Validates token AND returns can_use_extension flag.
// Returns { can_use_extension, email, name } or null if token is invalid.

async function statusCheck(session) {
  if (!session?.token) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/status`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (res.ok) return await res.json();
    if (res.status === 401) return null;
    // Server / network error — keep session alive, assume access granted
    return { can_use_extension: true, email: session.email, name: session.name };
  } catch {
    return { can_use_extension: true, email: session.email, name: session.name };
  }
}

// ---- User bars ----

function showUser(session) {
  const name = session.name || session.email?.split("@")[0] || "User";
  const email = session.email || "";
  $("userName").textContent = name;
  $("userEmail").textContent = email;
  $("userAvatar").textContent = (name[0] || "U").toUpperCase();
}

function showNoAccessUser(session) {
  const name = session.name || session.email?.split("@")[0] || "User";
  const email = session.email || "";
  $("noAccessName").textContent = name;
  $("noAccessEmail").textContent = email;
  $("noAccessAvatar").textContent = (name[0] || "U").toUpperCase();
}

// ---- Courses ----

async function loadCourses(session) {
  const sel = $("courseSlug");
  sel.innerHTML = '<option value="">— Loading… —</option>';

  try {
    const res = await fetch(`${BACKEND_URL}/api/courses/`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });

    if (!res.ok) {
      sel.innerHTML = '<option value="">— Failed to load courses —</option>';
      return;
    }

    const data = await res.json();
    const courses = data.courses || [];

    if (courses.length === 0) {
      sel.innerHTML = '<option value="">— No courses available —</option>';
      return;
    }

    sel.innerHTML = '<option value="">— Select a course —</option>';
    for (const c of courses) {
      const opt = document.createElement("option");
      opt.value = c.slug;
      opt.textContent = `${c.title} (${c.chunks_count} chunks)`;
      sel.appendChild(opt);
    }

    chrome.storage.local.get("mainFields", ({ mainFields }) => {
      if (mainFields?.courseSlug) sel.value = mainFields.courseSlug;
    });
  } catch {
    sel.innerHTML = '<option value="">— Cannot reach server —</option>';
  }
}

// ---- Init ----

(async () => {
  const session = await getSession();

  if (session?.token) {
    const status = await statusCheck(session);
    if (status) {
      const updated = { token: session.token, email: status.email || session.email, name: status.name || session.name };
      await saveSession(updated);

      if (!status.can_use_extension) {
        showNoAccessUser(updated);
        showScreen("noAccess");
        return;
      }

      showUser(updated);
      loadMainFields();
      await loadCourses(updated);
      showScreen("main");
      return;
    }
    await clearSession();
  }

  showScreen("login");
})();

// ---- LOGIN ----

$("btnLogin").addEventListener("click", async () => {
  const btn = $("btnLogin");
  btn.disabled = true;
  hideStatus("loginStatus");

  const identifier = $("loginIdentifier").value.trim();
  const password = $("loginPassword").value;

  if (!identifier || !password) {
    setStatus("loginStatus", "Enter identifier and password", "error");
    btn.disabled = false;
    return;
  }

  setStatus("loginStatus", "Signing in…");

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus("loginStatus", err.detail || `HTTP ${res.status}`, "error");
      btn.disabled = false;
      return;
    }

    const data = await res.json();
    const session = {
      token: data.access_token,
      email: data.user?.email || identifier,
      name: data.user?.name || identifier,
    };
    await saveSession(session);

    // Check extension permission right after login
    const status = await statusCheck(session);
    const updated = { ...session, email: status?.email || session.email, name: status?.name || session.name };
    await saveSession(updated);

    if (!status || !status.can_use_extension) {
      setStatus("loginStatus", "Signed in — no extension access", "error");
      setTimeout(() => {
        showNoAccessUser(updated);
        showScreen("noAccess");
        hideStatus("loginStatus");
      }, 600);
      btn.disabled = false;
      return;
    }

    setStatus("loginStatus", "Success!", "success");
    setTimeout(async () => {
      showUser(updated);
      loadMainFields();
      await loadCourses(updated);
      showScreen("main");
      hideStatus("loginStatus");
    }, 400);

  } catch {
    setStatus("loginStatus", "Cannot connect to server", "error");
  } finally {
    btn.disabled = false;
  }
});

["loginIdentifier", "loginPassword"].forEach((id) => {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnLogin").click();
  });
});

// ---- LOGOUT (shared logic) ----

async function doLogout() {
  const session = await getSession();
  if (session?.token) {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch { /* ignore */ }
  }
  await clearSession();
  $("loginIdentifier").value = "";
  $("loginPassword").value = "";
  showScreen("login");
}

$("btnLogout").addEventListener("click", async () => {
  hideStatus("mainStatus");
  $("stats").classList.remove("visible");
  await doLogout();
});

$("btnLogoutNoAccess").addEventListener("click", doLogout);

// ---- Main screen: persist fields ----

const MAIN_DEFAULTS = { selectors: "p, h1, h2, h3, li", courseSlug: "" };

function loadMainFields() {
  chrome.storage.local.get("mainFields", ({ mainFields }) => {
    const saved = mainFields || {};
    $("selectors").value = saved.selectors ?? MAIN_DEFAULTS.selectors;
  });
}

$("selectors").addEventListener("input", () => {
  chrome.storage.local.get("mainFields", ({ mainFields }) => {
    chrome.storage.local.set({ mainFields: { ...(mainFields || {}), selectors: $("selectors").value } });
  });
});

$("courseSlug").addEventListener("change", () => {
  chrome.storage.local.get("mainFields", ({ mainFields }) => {
    chrome.storage.local.set({ mainFields: { ...(mainFields || {}), courseSlug: $("courseSlug").value } });
  });
});

// ---- Helpers ----

function showStats(s) {
  $("stats").classList.add("visible");
  $("nAns").textContent = s.answered || 0;
  $("nUnk").textContent = s.unknown || 0;
  $("nErr").textContent = s.error || 0;
}

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(action, extra = {}) {
  const tab = await getTab();
  return chrome.tabs.sendMessage(tab.id, { action, ...extra });
}

// ---- ANALYZE ----

$("btnAnalyze").addEventListener("click", async () => {
  const btn = $("btnAnalyze");
  btn.disabled = true;
  $("stats").classList.remove("visible");
  hideStatus("mainStatus");

  let session = await getSession();
  if (!session?.token) {
    showScreen("login");
    btn.disabled = false;
    return;
  }

  const status = await statusCheck(session);
  if (!status) {
    await clearSession();
    setStatus("mainStatus", "Session expired. Please sign in again.", "error");
    setTimeout(() => showScreen("login"), 1500);
    btn.disabled = false;
    return;
  }
  if (!status.can_use_extension) {
    showNoAccessUser(session);
    showScreen("noAccess");
    btn.disabled = false;
    return;
  }

  const courseSlug = $("courseSlug").value;
  if (!courseSlug) {
    setStatus("mainStatus", "Please select a course first", "error");
    btn.disabled = false;
    return;
  }

  const selectors = $("selectors").value.split(",").map((s) => s.trim()).filter(Boolean);

  const config = {
    backendUrl: BACKEND_URL,
    courseSlug,
    targetSelectors: selectors.length ? selectors : MAIN_DEFAULTS.selectors.split(", "),
    maxElements: 5,
    token: session.token,
  };

  try {
    await sendToContent("updateConfig", { config });
    setStatus("mainStatus", "Scanning and asking CourseMemos AI…");

    const result = await sendToContent("analyze");

    if (result.success && result.stats && Object.keys(result.stats).length) {
      setStatus("mainStatus", `Done — ${result.total} element(s) analysed`, "success");
      showStats(result.stats);
    } else if (result.success) {
      setStatus("mainStatus", result.message || "No elements found", "success");
    } else {
      if (result.error?.includes("401") || result.error?.includes("403")) {
        await clearSession();
        setStatus("mainStatus", "Session expired", "error");
        setTimeout(() => showScreen("login"), 1500);
      } else {
        setStatus("mainStatus", `Error: ${result.error}`, "error");
      }
    }
  } catch {
    setStatus("mainStatus", "Cannot reach page. Reload and retry.", "error");
  } finally {
    btn.disabled = false;
  }
});

// ---- RESET ----

$("btnReset").addEventListener("click", async () => {
  try { await sendToContent("reset"); } catch { }
  hideStatus("mainStatus");
  $("stats").classList.remove("visible");
});
