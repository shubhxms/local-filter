// Local Filter - Content Script
// Element-level extraction + scroll-driven classification: blocks enter the
// queue via IntersectionObserver a few scroll units before they appear.
// Sentences are the measurement unit (Jev scores them); block elements are
// the action unit (the whole block blurs when enough of its sentences agree).

const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dd, dt, pre";
// NOTE: header/aside are deliberately NOT skipped — page H1s and section
// headings often live inside them; site chrome is covered by nav/footer.
const SKIP_ANCESTORS = 'nav, footer, [aria-hidden="true"]';
// Censor style applied to matched blocks; keys match storage.censorMode.
const MODE_CLASSES = {
  blur: "local-filter-blur",
  black: "local-filter-black",
  pixelate: "local-filter-pixelate",
  hide: "local-filter-hide",
};
const MAX_SENTENCES_PER_ELEMENT = 20; // sanity cap for pathological blocks
const CONCURRENCY = 4; // blocks classified in parallel
const OBSERVER_MARGIN = "50% 0px 250% 0px"; // classify a few scroll units ahead

const SEGMENTER = new Intl.Segmenter("en", { granularity: "sentence" });

let run = null;
let filterSeq = 0; // guards against stacked FILTER clicks racing through startRun
let currentMode = "blur"; // live censor mode; updated by storage changes too
const censoredElements = new Set(); // already-censored blocks, for instant restyling

// Switching censor mode restyles already-censored blocks instantly — no
// re-classification. (Registered before the message listener; keep it
// top-level so range edits to the listener cannot clobber it again.)
chrome.storage.onChanged.addListener(async (changes, area) => {
  const siteKey = `lf-site:${location.origin}`;
  const relevant =
    (area === "sync" && changes.censorMode) ||
    (area === "local" && changes[siteKey]);
  if (!relevant) return;

  currentMode = await effectiveMode();
  if (currentMode === "pixelate") ensurePixelateFilter();
  const cls = MODE_CLASSES[currentMode] ?? MODE_CLASSES.blur;
  for (const el of censoredElements) {
    el.classList.remove(...Object.values(MODE_CLASSES));
    el.classList.add(cls);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "FILTER") {
    showAck();
    startRun(++filterSeq);
  }

  // Popup asks for the current page's numbers.
  if (message.type === "GET_STATS") {
    sendResponse(
      run
        ? {
            watching: run.blocks.size,
            classified: run.classified,
            censored: run.blurred,
          }
        : null,
    );
  }
});

// One user knob: 0 = permissive (blur only near-certain blocks),
// 1 = restrictive (blur aggressively). Keep in sync with options.js.
function thresholdsFor(strictness) {
  return {
    sentence: 0.75 - 0.5 * strictness, // 0.75 → 0.25; default 0.5 → 0.50 (matches the old fixed threshold)
    paragraphFraction: 0.8 - 0.4 * strictness, // 0.80 → 0.40; default 0.5 → 0.60
  };
}

async function startRun(seq) {
  const {
    topics = [],
    strictness = 0.5,
    qualities = [],
    mercy = 1,
  } = await chrome.storage.sync.get([
    "topics",
    "strictness",
    "qualities",
    "mercy",
  ]);

  // Another FILTER arrived while we were reading storage — it wins.
  if (seq !== filterSeq) return;

  if (topics.length === 0) {
    console.log(
      "[LocalFilter] No topics configured. Add topics in the extension options.",
    );
    return;
  }

  currentMode = await effectiveMode();
  if (currentMode === "pixelate") ensurePixelateFilter();

  // Per-page verdict cache, keyed by URL + topics + strictness, so
  // re-filtering or revisiting a page costs no API calls.
  // Per-page verdict cache, keyed by everything a verdict depends on,
  // so re-filtering or revisiting a page costs no API calls.
  const cacheKey = `lf:${location.origin}${location.pathname}|${topics.join(",")}|${strictness}|${qualities.join(",")}|${mercy}`;
  const stored = await chrome.storage.local.get(cacheKey);

  if (run) run.stop();
  run = new Run(
    topics,
    thresholdsFor(strictness),
    cacheKey,
    stored[cacheKey] ?? {},
    qualities,
    mercy,
  );
  run.start();
  showToast("Filtering…");
}

class Run {
  constructor(
    topics,
    thresholds,
    cacheKey,
    cache = {},
    qualities = [],
    mercy = 1,
  ) {
    this.topics = topics;
    this.thresholds = thresholds;
    this.qualities = qualities; // redeeming qualities; empty = feature off
    this.mercy = mercy; // redeem weight: override when redeemMean >= mercy * censorMean
    this.cacheKey = cacheKey;
    this.cache = cache; // text fingerprint -> censored (bool)
    this.saveTimer = null;
    this.classified = 0;
    this.blurred = 0;
    this.id = crypto.randomUUID();
    this.blocks = new Map(); // Element -> { status: 'queued' | 'inflight' | 'done' }
    this.queue = [];
    this.inFlight = 0;
    this.observer = null;
    this.stopped = false;
  }

  start() {
    for (const el of collectBlocks()) {
      this.blocks.set(el, { status: "queued" });
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer.unobserve(entry.target);
          this.queue.push(entry.target);
          this.pump();
        }
      },
      { rootMargin: OBSERVER_MARGIN },
    );

    for (const el of this.blocks.keys()) this.observer.observe(el);
    this.errors = 0;
    console.log(
      `[LocalFilter] Watching ${this.blocks.size} blocks (run ${this.id.slice(0, 8)})`,
    );
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.saveTimer);
    this.observer?.disconnect();
    this.queue = [];
    for (const el of this.blocks.keys()) {
      censoredElements.delete(el);
      el.classList.remove(...Object.values(MODE_CLASSES));
    }
  }

  // Keep at most CONCURRENCY requests to the background in flight.
  pump() {
    while (
      !this.stopped &&
      this.inFlight < CONCURRENCY &&
      this.queue.length > 0
    ) {
      const el = this.queue.shift();
      const state = this.blocks.get(el);
      if (!state || state.status !== "queued") continue;

      state.status = "inflight";
      this.inFlight++;
      this.classify(el).finally(() => {
        this.inFlight--;
        if (!this.stopped && this.queue.length === 0 && this.inFlight === 0) {
          console.log(
            `[LocalFilter] Queue drained: ${this.classified} classified, ${this.blurred} blurred, ${this.errors} errors`,
          );
          clearTimeout(this.saveTimer);
          this.save();
          if (this.blurred === 0 && this.errors === 0) {
            showToast("Nothing matched");
          }
        }
        this.pump();
      });
    }
  }

  async classify(el) {
    try {
      const sentences = segment(el.innerText);
      if (sentences.length === 0) return;

      // Cached verdict for this exact text? Skip the API entirely.
      const fp = fingerprint(el.innerText.trim());
      if (Object.hasOwn(this.cache, fp)) {
        this.finish(el, this.cache[fp]);
        return;
      }

      const response = await chrome.runtime.sendMessage({
        action: "classifySentences",
        requestId: this.id,
        sentences,
        topics: this.topics,
        qualities: this.qualities,
      });

      // A newer FILTER started meanwhile — drop stale results.
      if (this.stopped || response?.requestId !== this.id) return;
      if (!response?.success)
        throw new Error(response?.error || "No response from background");

      if (this.classified === 0) {
        console.log(
          "[LocalFilter] First block sample:",
          JSON.stringify(response.classifications).slice(0, 300),
        );
      }

      const censored = this.verdictFor(sentences, response.classifications);
      this.cache[fp] = censored;
      this.scheduleSave();
      this.finish(el, censored);
    } catch (error) {
      this.errors++;
      const hint = error.message.includes("message channel closed")
        ? " (service worker died mid-request — see chrome://extensions → Local Filter → service worker console)"
        : "";
      console.error(
        "[LocalFilter] Classification failed:",
        error.message + hint,
      );
    } finally {
      const state = this.blocks.get(el);
      if (state) state.status = "done";
    }
  }

  // Fresh result: threshold + agreement gate decide the verdict.
  verdictFor(sentences, classifications) {
    const { sentence, paragraphFraction } = this.thresholds;
    const matched = classifications.filter((c) =>
      c.scores.some((score) => score >= sentence),
    ).length;
    const best = Math.max(...classifications.flatMap((c) => c.scores));

    console.log(
      `[LocalFilter] block ${matched}/${sentences.length} matched, best score ${best.toFixed(2)} (threshold ${sentence.toFixed(2)})`,
    );

    const gate = matched > 0 && matched / sentences.length >= paragraphFraction;
    if (!gate) return false;

    // Redeeming qualities override the censor: spare the block when mean
    // redeem evidence keeps up with mean censor evidence, weighted by mercy.
    if (this.qualities.length > 0 && this.mercy > 0) {
      const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const censorMean = mean(
        classifications.map((c) => Math.max(...c.scores)),
      );
      const redeemMean = mean(classifications.map((c) => c.redeem));
      if (redeemMean >= this.mercy * censorMean) {
        console.log(
          `[LocalFilter] Redeemed block (redeem ${redeemMean.toFixed(2)} ≥ mercy × censor ${(this.mercy * censorMean).toFixed(2)})`,
        );
        return false;
      }
    }

    return true;
  }

  // Style a block per its verdict (fresh or cached).
  finish(el, censored) {
    this.classified++;

    if (censored) {
      this.blurred++;
      el.classList.add(MODE_CLASSES[currentMode] ?? MODE_CLASSES.blur);
      censoredElements.add(el);
      showToast(
        `${this.blurred} ${this.blurred === 1 ? "block" : "blocks"} censored`,
      );
      console.log(
        `[LocalFilter] Censored <${el.tagName.toLowerCase()}> (${currentMode})`,
      );
    }

    if (this.classified % 25 === 0) {
      console.log(
        `[LocalFilter] Progress: ${this.classified} classified, ${this.blurred} censored`,
      );
    }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 1000);
  }

  async save() {
    if (this.stopped) return;
    try {
      await chrome.storage.local.set({ [this.cacheKey]: this.cache });
      await pruneResultCache(this.cacheKey);
    } catch (error) {
      console.error("[LocalFilter] Failed to save page results:", error);
    }
  }
}

// Censor style: per-site override wins over the global default.
async function effectiveMode() {
  const key = `lf-site:${location.origin}`;
  const site = (await chrome.storage.local.get(key))[key];
  if (site) return site;
  const { censorMode = "blur" } = await chrome.storage.sync.get("censorMode");
  return censorMode;
}

// djb2 — cheap, stable fingerprint of block text.
function fingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (h * 33 + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// Keep only the 20 most recent pages of cached verdicts.
async function pruneResultCache(keepKey) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("lf:"));
  const excess = keys.length - 20;
  if (excess <= 0) return;
  for (const key of keys.slice(0, excess)) {
    if (key !== keepKey) await chrome.storage.local.remove(key);
  }
}

function collectBlocks() {
  const blocks = [];
  for (const el of document.querySelectorAll(BLOCK_SELECTOR)) {
    if (el.closest(SKIP_ANCESTORS)) continue; // nav/footer boilerplate
    if (el.querySelector(BLOCK_SELECTOR)) continue; // innermost block wins (li > p)
    if (!isVisible(el)) continue;
    if (segment(el.innerText).length === 0) continue; // nothing worth classifying
    blocks.push(el);
  }
  return blocks;
}

// The pixelate mode needs an SVG filter def in the page; inject it once, lazily.
// Small serif toast, bottom-right — acknowledges every filter run.
let toastEl = null;
let toastTimer = null;
// macOS-passkey-style acknowledgment: a square springs in and a check
// draws itself inside. Runs on every FILTER — shortcut or button.
let ackEl = null;
let ackTimer = null;
function showAck() {
  ackEl?.remove();
  clearTimeout(ackTimer);
  ackEl = document.createElement("div");
  ackEl.className = "local-filter-ack";
  ackEl.innerHTML =
    '<div class="box"><svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<rect x="14" y="21" width="36" height="6" rx="3"/>' +
    '<rect x="14" y="29" width="27" height="6" rx="3"/>' +
    '<rect x="14" y="37" width="32" height="6" rx="3"/>' +
    "</svg></div>";
  document.body.appendChild(ackEl);
  ackTimer = setTimeout(() => {
    ackEl?.remove();
    ackEl = null;
  }, 1200);
}

function showToast(text) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "local-filter-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove("visible"), 2500);
}

function ensurePixelateFilter() {
  if (document.getElementById("local-filter-pixelate")) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.innerHTML =
    '<filter id="local-filter-pixelate">' +
    '<feFlood x="4" y="4" height="2" width="2"/>' +
    '<feComposite width="10" height="10"/>' +
    '<feTile result="a"/>' +
    '<feComposite in="SourceGraphic" in2="a" operator="in"/>' +
    '<feMorphology operator="dilate" radius="5"/>' +
    "</filter>";
  document.body.appendChild(svg);
}

function isVisible(el) {
  if (getComputedStyle(el).position === "fixed") return true;
  return el.offsetParent !== null;
}

function segment(text) {
  const trimmed = text.trim();
  const sentences = Array.from(SEGMENTER.segment(trimmed), (s) =>
    s.segment.trim(),
  ).filter((s) => s.length > 10);

  // Short standalone text — headings, list items — has no long sentences,
  // but it is still worth classifying as a single unit.
  if (sentences.length === 0 && trimmed.length >= 3) {
    return [trimmed];
  }

  return sentences.slice(0, MAX_SENTENCES_PER_ELEMENT);
}

console.log("Local Filter content script loaded (element pipeline)");
