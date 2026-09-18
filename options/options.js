async function loadTopics() {
  const { topics = [] } = await chrome.storage.sync.get("topics");
  const topicsList = document.getElementById("topicsList");
  topicsList.innerHTML = "";

  topics.forEach((topic) => {
    const div = document.createElement("div");
    div.className = "topic";
    div.textContent = topic;

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.onclick = () => deleteTopic(topic);

    div.appendChild(deleteBtn);
    topicsList.appendChild(div);
  });
}

async function addTopic() {
  const input = document.getElementById("newTopic");
  const topic = input.value.trim();

  if (topic) {
    const { topics = [] } = await chrome.storage.sync.get("topics");
    await chrome.storage.sync.set({
      topics: [...topics, topic],
    });
    input.value = "";
    loadTopics();
  }
}

async function deleteTopic(topicToDelete) {
  const { topics = [] } = await chrome.storage.sync.get("topics");
  await chrome.storage.sync.set({
    topics: topics.filter((topic) => topic !== topicToDelete),
  });
  loadTopics();
}

document.getElementById("addTopic").addEventListener("click", addTopic);

document.getElementById("saveKey").addEventListener("click", async () => {
  const input = document.getElementById("apiKey");
  const key = input.value.trim();
  if (key) {
    await chrome.storage.local.set({ jevApiKey: key });
    input.value = "";
    document.getElementById("keyStatus").textContent = "API key saved ✓";
  }
});

// Keep this label mapping in sync with content.js (thresholdsFor).
function strictnessLabel(value) {
  if (value < 0.34) return "Permissive — blur only near-certain blocks";
  if (value < 0.67) return "Balanced";
  return "Restrictive — blur aggressively";
}

const strictnessSlider = document.getElementById("strictness");
const strictnessLabelEl = document.getElementById("strictnessLabel");

strictnessSlider.addEventListener("input", () => {
  strictnessLabelEl.textContent = strictnessLabel(
    parseFloat(strictnessSlider.value),
  );
});

strictnessSlider.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    strictness: parseFloat(strictnessSlider.value),
  });
});

async function loadSettings() {
  const { strictness = 0.5 } = await chrome.storage.sync.get("strictness");
  strictnessSlider.value = strictness;
  strictnessLabelEl.textContent = strictnessLabel(strictness);

  const { jevApiKey } = await chrome.storage.local.get("jevApiKey");
  document.getElementById("keyStatus").textContent = jevApiKey
    ? "API key saved ✓"
    : "No API key saved";
}
document.addEventListener("DOMContentLoaded", loadSettings);
document.addEventListener("DOMContentLoaded", loadTopics);
