// background.js — Trinetra.net v5.0
// Auto-detects T&C pages and triggers content script

const TNC_URL_PATTERNS = [
  "terms", "privacy", "policy", "legal", "tos", "eula",
  "agreement", "conditions", "gdpr", "consent", "cookies"
];

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || tab.url.startsWith("chrome://")) return;

  const url = tab.url.toLowerCase();
  const isTnC = TNC_URL_PATTERNS.some(p => url.includes(p));

  if (isTnC) {
    chrome.tabs.sendMessage(tabId, { type: "TNC_PAGE_DETECTED" }).catch(() => {});
  }
});
