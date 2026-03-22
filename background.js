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
