// Shared settings wiring — included by popup.html and options.html.
//
// Censor style scope: the popup (body.popup) writes a per-site override
// for the tab it was opened on (window.LF_SITE_ORIGIN, set by popup.js
// before initSettings runs); every other page writes the global default.
//
// Every wire is defensive — either page can carry any subset of controls.

const $ = (id) => document.getElementById(id);

// ---- Word lists (topics, redeeming qualities) ----------------------------

// Click an entry to edit it in place: Enter commits, Escape reverts,
// blur commits (empty or duplicate values are ignored).
function editEntry(label, item, storageKey, reload) {
  const editor = document.createElement("input");
  editor.type = "text";
  editor.value = item;
  label.replaceWith(editor);
  editor.focus();
  editor.select();

  const commit = async () => {
    const value = editor.value.trim();
    const { [storageKey]: current = [] } =
      await chrome.storage.sync.get(storageKey);
    const next =
      !value || value === item || current.includes(value)
        ? current
        : current.map((t) => (t === item ? value : t));
    await chrome.storage.sync.set({ [storageKey]: next });
    reload();
  };

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter") editor.blur();
    if (event.key === "Escape") {
      editor.value = item;
      editor.blur();
    }
  });
  editor.addEventListener("blur", commit);
}

function wireWordList({ listId, inputId, addId, storageKey }) {
  const list = $(listId);
  const input = $(inputId);
  const addButton = $(addId);
  if (!list || !input) return;

  const load = async () => {
    const { [storageKey]: items = [] } =
      await chrome.storage.sync.get(storageKey);
    list.innerHTML = "";

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "topic";

      const label = document.createElement("span");
      label.className = "value";
      label.textContent = item;
      label.title = "Click to edit";
      label.tabIndex = 0;
      label.addEventListener("click", () =>
        editEntry(label, item, storageKey, load),
      );
      label.addEventListener("keydown", (event) => {
        if (event.key === "Enter") editEntry(label, item, storageKey, load);
      });

      const remove = document.createElement("button");
      remove.className = "ghost";
      remove.textContent = "Remove";
      remove.onclick = async () => {
        const { [storageKey]: current = [] } =
          await chrome.storage.sync.get(storageKey);
        await chrome.storage.sync.set({
          [storageKey]: current.filter((t) => t !== item),
        });
        load();
      };

      row.append(label, remove);
      list.append(row);
    }
  };

  const add = async () => {
    const value = input.value.trim();
    if (!value) return;
    const { [storageKey]: current = [] } =
      await chrome.storage.sync.get(storageKey);
    await chrome.storage.sync.set({ [storageKey]: [...current, value] });
    input.value = "";
    load();
  };

  addButton?.addEventListener("click", add);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") add();
  });
  load();
}

// ---- Censor mode, strictness, mercy, API key -------------------------------

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

function wireSlider(id, labelId, labelFor, storageKey) {
  const slider = $(id);
  if (!slider) return;

  slider.addEventListener("input", () => {
    $(labelId).textContent = labelFor(parseFloat(slider.value));
  });
  slider.addEventListener("change", () => {
    chrome.storage.sync.set({ [storageKey]: parseFloat(slider.value) });
  });
}

function wireApiKey() {
  const form = $("keyForm");
  if (!form) return;

  // Saved state shows just 'Change key'; the form only appears then,
  // and only Save commits — no accidental overwrites.
  $("changeKey")?.addEventListener("click", () => {
    $("keySaved").hidden = true;
    form.hidden = false;
    $("apiKey").focus();
  });

  $("apiKey").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $("apiKey").value = "";
      refreshKeyStatus(); // restore whichever state is true
    }
  });

  $("saveKey").addEventListener("click", async () => {
    const input = $("apiKey");
    const key = input.value.trim();
    if (!key) return;
    await chrome.storage.local.set({ jevApiKey: key });
    input.value = "";
    refreshKeyStatus();
  });
}

async function refreshKeyStatus() {
  const savedRow = $("keySaved");
  if (!savedRow) return;

  const { jevApiKey } = await chrome.storage.local.get("jevApiKey");
  const hasKey = Boolean(jevApiKey);
  savedRow.hidden = !hasKey;
  $("keyForm").hidden = hasKey;
}

async function loadSettings() {
  const scoped =
    document.body.classList.contains("popup") && window.LF_SITE_ORIGIN;
  const { censorMode, strictness, mercy } = await getSettings();
  const mode = scoped
    ? await getEffectiveCensorMode(window.LF_SITE_ORIGIN)
    : censorMode;

  const modeInput = document.querySelector(
    `#censorMode input[value="${mode}"]`,
  );
  if (modeInput) modeInput.checked = true;

  const slider = $("strictness");
  if (slider) {
    slider.value = strictness;
    $("strictnessLabel").textContent = strictnessLabel(strictness);
  }

  const mercySlider = $("mercy");
  if (mercySlider) {
    mercySlider.value = mercy;
    $("mercyLabel").textContent = mercyLabel(mercy);
  }

  refreshKeyStatus();
}

// ---- Init ----------------------------------------------------------------

function initSettings() {
  document.querySelector("[data-about]")?.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("about.html") });
  });

  wireWordList({
    listId: "topicsList",
    inputId: "newTopic",
    addId: "addTopic",
    storageKey: "topics",
  });
  wireWordList({
    listId: "qualitiesList",
    inputId: "newQuality",
    addId: "addQuality",
    storageKey: "qualities",
  });
  wireSlider("strictness", "strictnessLabel", strictnessLabel, "strictness");
  wireSlider("mercy", "mercyLabel", mercyLabel, "mercy");
  wireCensorMode();
  wireApiKey();
  loadSettings();
}

// The options page boots itself; the popup resolves the current tab's
// origin first (async) and then calls initSettings from popup.js.
if (!document.body.classList.contains("popup")) {
  document.addEventListener("DOMContentLoaded", initSettings);
}
