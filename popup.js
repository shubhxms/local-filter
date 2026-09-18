// Popup extras: filter button, page stats, shortcut hint, open-in-tab.
// Everything else lives in settings.js, shared with options.html.

$("filterBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: "FILTER" });
  window.close();
});

$("openOptions").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.commands.getAll().then(([command]) => {
  if (command?.shortcut) {
    $("shortcutHint").textContent = command.shortcut;
  }
});

// Live count for this page — ask the content script how the run is going.
async function loadPageStats() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const stats = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATS" });
    $("pageStats").textContent = stats?.censored
      ? `${stats.censored} censored on this page`
      : "";
  } catch {
    $("pageStats").textContent = "";
  }
}

loadPageStats();
