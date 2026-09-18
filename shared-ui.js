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

// Censor style resolution: a per-site override (lf-site:<origin> in
// storage.local) wins over the global default (censorMode in sync).
async function getEffectiveCensorMode(siteOrigin) {
  if (siteOrigin) {
    const key = `lf-site:${siteOrigin}`;
    const site = (await chrome.storage.local.get(key))[key];
    if (site) return site;
  }
  const { censorMode = "blur" } = await chrome.storage.sync.get("censorMode");
  return censorMode;
}
