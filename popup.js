// Popup-only wiring: filter button, shortcut hint, open-in-tab.
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
