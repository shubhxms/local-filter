// Shared settings wiring — included by popup.html and options.html.
//
// Censor style scope: the popup (body.popup) writes a per-site override
// for the tab it was opened on (window.LF_SITE_ORIGIN, set by popup.js
// before initSettings runs); every other page writes the global default.
//
// Every wire is defensive — either page can carry any subset of controls.

const $ = (id) => document.getElementById(id);

// ---- Topics (options page) ----------------------------------------------

async function loadTopics() {
  const list = $("topicsList");
  if (!list) return;

  const { topics } = await getSettings();
  list.innerHTML = "";

  for (const topic of topics) {
    const row = document.createElement("div");
    row.className = "topic";

    const label = document.createElement("span");
    label.textContent = topic;

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Remove";
    remove.onclick = async () => {
      const { topics: current } = await getSettings();
      await chrome.storage.sync.set({
        topics: current.filter((t) => t !== topic),
      });
      loadTopics();
    };

    row.append(label, remove);
    list.append(row);
  }
}

async function addTopic() {
  const input = $("newTopic");
  if (!input) return;
  const topic = input.value.trim();
  if (!topic) return;

  const { topics } = await getSettings();
  await chrome.storage.sync.set({ topics: [...topics, topic] });
  input.value = "";
  loadTopics();
}

// ---- Censor mode, strictness, API key ------------------------------------

function wireCensorMode() {
  const scoped = document.body.classList.contains("popup");

  document.querySelectorAll("#censorMode input").forEach((input) => {
    input.addEventListener("change", async () => {
      if (scoped && window.LF_SITE_ORIGIN) {
        await chrome.storage.local.set({
          [`lf-site:${window.LF_SITE_ORIGIN}`]: input.value,
        });
      } else {
        await chrome.storage.sync.set({ censorMode: input.value });
      }
    });
  });
}

function wireStrictness() {
  const slider = $("strictness");
  if (!slider) return;

  slider.addEventListener("input", () => {
    $("strictnessLabel").textContent = strictnessLabel(
      parseFloat(slider.value),
    );
  });
  slider.addEventListener("change", () => {
    chrome.storage.sync.set({ strictness: parseFloat(slider.value) });
  });
}

function wireApiKey() {
  const saveButton = $("saveKey");
  if (!saveButton) return;

  saveButton.addEventListener("click", async () => {
    const input = $("apiKey");
    const key = input.value.trim();
    if (!key) return;
    await chrome.storage.local.set({ jevApiKey: key });
    input.value = "";
    refreshKeyStatus();
  });
}

async function refreshKeyStatus() {
  const status = $("keyStatus");
  if (!status) return;

  const { jevApiKey } = await chrome.storage.local.get("jevApiKey");
  status.textContent = jevApiKey ? "Key saved" : "No key saved yet";
  status.classList.toggle("ok", Boolean(jevApiKey));
}

async function loadSettings() {
  const scoped = document.body.classList.contains("popup") &&
    window.LF_SITE_ORIGIN;
  const mode = scoped
    ? await getEffectiveCensorMode(window.LF_SITE_ORIGIN)
    : (await getSettings()).censorMode;

  const modeInput = document.querySelector(
    `#censorMode input[value="${mode}"]`,
  );
  if (modeInput) modeInput.checked = true;

  const slider = $("strictness");
  if (slider) {
    const { strictness } = await getSettings();
    slider.value = strictness;
    $("strictnessLabel").textContent = strictnessLabel(strictness);
  }

  refreshKeyStatus();
}

// ---- Init ----------------------------------------------------------------

function initSettings() {
  $("addTopic")?.addEventListener("click", addTopic);
  $("newTopic")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addTopic();
  });
  wireCensorMode();
  wireStrictness();
  wireApiKey();
  loadTopics();
  loadSettings();
}

// The options page boots itself; the popup resolves the current tab's
// origin first (async) and then calls initSettings from popup.js.
if (!document.body.classList.contains("popup")) {
  document.addEventListener("DOMContentLoaded", initSettings);
}
