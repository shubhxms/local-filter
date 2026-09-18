const $ = (id) => document.getElementById(id);

async function load() {
  const { censorMode, strictness } = await getSettings();
  document.querySelector(`#censorMode input[value="${censorMode}"]`).checked =
    true;
  $("strictness").value = strictness;
  $("strictnessLabel").textContent = strictnessLabel(strictness);

  const [command] = await chrome.commands.getAll();
  if (command?.shortcut) $("shortcutHint").textContent = command.shortcut;
}

document.querySelectorAll("#censorMode input").forEach((input) => {
  input.addEventListener("change", () =>
    chrome.storage.sync.set({ censorMode: input.value }),
  );
});

$("strictness").addEventListener("input", (event) => {
  $("strictnessLabel").textContent = strictnessLabel(
    parseFloat(event.target.value),
  );
});

$("strictness").addEventListener("change", (event) => {
  chrome.storage.sync.set({ strictness: parseFloat(event.target.value) });
});

$("filterBtn").addEventListener("click", async () => {
  chrome.action.setBadgeBackgroundColor({ color: "#1c1a16" });
  chrome.action.setBadgeText({ text: "•" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: "FILTER" });
  window.close();
});

$("openOptions").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
