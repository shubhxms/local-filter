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

  // Live count and topic breakdown for this page.
  try {
    const stats = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATS" });
    $("pageStats").textContent = stats?.censored
      ? `${stats.censored} ${stats.censored === 1 ? "block" : "blocks"} censored on this page`
      : "";
    renderMatchStats(stats?.topics);
  } catch {
    $("pageStats").textContent = "";
    $("matchStats").hidden = true;
  }
})();

// What matched most: top topics by censored-block count, hairline bars.
function renderMatchStats(topics) {
  const entries = Object.entries(topics ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  $("matchStats").hidden = entries.length === 0;
  if (entries.length === 0) return;

  const max = entries[0][1];
  const rows = entries.map(([topic, count]) => {
    const row = document.createElement("div");
    row.className = "stat-row";

    const name = document.createElement("span");
    name.className = "stat-name";
    name.textContent = topic;

    const wrap = document.createElement("div");
    wrap.className = "stat-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "stat-bar";
    bar.style.width = `${Math.round((100 * count) / max)}%`;
    wrap.append(bar);

    const tally = document.createElement("span");
    tally.className = "stat-count";
    tally.textContent = count;

    row.append(name, wrap, tally);
    return row;
  });
  $("matchRows").replaceChildren(...rows);
}
