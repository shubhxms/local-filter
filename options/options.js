const $ = (id) => document.getElementById(id);

// ---- Topics -------------------------------------------------------------

async function loadTopics() {
  const { topics } = await getSettings();
  const list = $("topicsList");
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
  const topic = input.value.trim();
  if (!topic) return;

  const { topics } = await getSettings();
  await chrome.storage.sync.set({ topics: [...topics, topic] });
  input.value = "";
  loadTopics();
}

// ---- Settings -----------------------------------------------------------

function wireCensorMode() {
  document.querySelectorAll("#censorMode input").forEach((input) => {
    input.addEventListener("change", () =>
      chrome.storage.sync.set({ censorMode: input.value }),
    );
  });
}

function wireStrictness() {
  const slider = $("strictness");
  slider.addEventListener("input", () => {
    $("strictnessLabel").textContent = strictnessLabel(parseFloat(slider.value));
  });
  slider.addEventListener("change", () => {
    chrome.storage.sync.set({ strictness: parseFloat(slider.value) });
  });
}

function wireApiKey() {
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
  const { jevApiKey } = await chrome.storage.local.get("jevApiKey");
  const status = $("keyStatus");
  status.textContent = jevApiKey ? "Key saved" : "No key saved yet";
  status.classList.toggle("ok", Boolean(jevApiKey));
}

async function loadSettings() {
  const { censorMode, strictness } = await getSettings();
  document.querySelector(`#censorMode input[value="${censorMode}"]`).checked = true;
  $("strictness").value = strictness;
  $("strictnessLabel").textContent = strictnessLabel(strictness);
  refreshKeyStatus();
}

// ---- Wire up ------------------------------------------------------------

$("addTopic").addEventListener("click", addTopic);
$("newTopic").addEventListener("keydown", (event) => {
  if (event.key === "Enter") addTopic();
});

document.addEventListener("DOMContentLoaded", () => {
  loadTopics();
  loadSettings();
  wireCensorMode();
  wireStrictness();
  wireApiKey();
});
