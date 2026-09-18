// Popup: resolves this tab's site, then boots the shared settings with
// site-scoped censor style. Everything else lives in settings.js.

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = null;
  try {
    origin = tab.url?.startsWith("http") ? new URL(tab.url).origin : null;
  } catch {
    origin = null;
  }
  window.LF_SITE_ORIGIN = origin;

  initSettings();

  $("filterBtn").addEventListener("click", async () => {
    chrome.tabs.sendMessage(tab.id, { type: "FILTER" });
    window.close();
  });

  $("openOptions").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Push the effective style to every site: set the global default and
  // drop this site's override (the effective value is unchanged here).
  $("setGlobalMode").addEventListener("click", async () => {
    const mode = document.querySelector("#censorMode input:checked")?.value;
    if (!mode) return;
    await chrome.storage.sync.set({ censorMode: mode });
    if (window.LF_SITE_ORIGIN) {
      await chrome.storage.local.remove(`lf-site:${window.LF_SITE_ORIGIN}`);
    }
    const button = $("setGlobalMode");
    button.textContent = "Set as global ✓";
    setTimeout(() => (button.textContent = "Set as global"), 1500);
  });

  chrome.commands.getAll().then(([command]) => {
    if (command?.shortcut) {
      $("shortcutHint").textContent = command.shortcut;
    }
  });

  // Live count for this page — ask the content script how the run went.
  try {
    const stats = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATS" });
    $("pageStats").textContent = stats?.censored
      ? `${stats.censored} ${stats.censored === 1 ? "block" : "blocks"} censored on this page`
      : "";
  } catch {
    $("pageStats").textContent = "";
  }
})();
