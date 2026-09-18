// Shared helpers for the popup and options pages.

function strictnessLabel(value) {
  if (value < 0.34) return "Permissive";
  if (value < 0.67) return "Balanced";
  return "Restrictive";
}

async function getSettings() {
  const { topics = [], strictness = 0.5, censorMode = "blur" } =
    await chrome.storage.sync.get(["topics", "strictness", "censorMode"]);
  return { topics, strictness, censorMode };
}
