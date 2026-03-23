// background.js — CourseMemos AI service worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "cmAnalyze",
    title: "Ask CourseMemos AI about this page",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "cmAnalyze" && tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "analyze" });
    } catch (e) {
      console.warn("[CourseMemos AI] content script not ready:", e.message);
    }
  }
});

// ---- Fetch proxy ----
// Content scripts on HTTPS pages cannot make direct HTTP requests (mixed-content).
// They send { action:"fetch", url, options } here; the service worker performs
// the actual fetch (no mixed-content restriction) and returns the result.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "fetch") return false;

  const { url, options = {} } = msg;

  fetch(url, options)
    .then(async (res) => {
      const text = await res.text();
      sendResponse({ ok: res.ok, status: res.status, text });
    })
    .catch((err) => {
      sendResponse({ ok: false, status: 0, error: err.message });
    });

  return true; // keep message channel open for async response
});
