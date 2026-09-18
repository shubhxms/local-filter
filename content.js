// Local Filter - Content Script
// Element-level extraction + scroll-driven classification: blocks enter the
// queue via IntersectionObserver a few scroll units before they appear.
// Sentences are the measurement unit (Jev scores them); block elements are
// the action unit (the whole block blurs when enough of its sentences agree).

const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dd, dt, pre";
const SKIP_ANCESTORS = 'nav, header, footer, aside, [aria-hidden="true"]';
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
    censorMode = "blur",
  } = await chrome.storage.sync.get(["topics", "strictness", "censorMode"]);

  // Another FILTER arrived while we were reading storage — it wins.
  if (seq !== filterSeq) return;

  if (topics.length === 0) {
    console.log(
      "[LocalFilter] No topics configured. Add topics in the extension options.",
    );
    return;
  }

  if (censorMode === "pixelate") ensurePixelateFilter();

  currentMode = censorMode;

  if (run) run.stop();
  run = new Run(topics, thresholdsFor(strictness));
  run.start();
  showToast("Filtering…");
}

class Run {
  constructor(topics, thresholds) {
    this.topics = topics;
    this.thresholds = thresholds;
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

      const response = await chrome.runtime.sendMessage({
        action: "classifySentences",
        requestId: this.id,
        sentences,
        topics: this.topics,
      });

      // A newer FILTER started meanwhile — drop stale results.
      if (this.stopped || response?.requestId !== this.id) return;
      if (!response?.success)
        throw new Error(response?.error || "No response from background");

      this.apply(el, sentences, response.classifications);
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

  // Blur the whole block when enough of its sentences match any topic.
  apply(el, sentences, classifications) {
    const { sentence, paragraphFraction } = this.thresholds;
    const matched = classifications.filter((c) =>
      c.scores.some((score) => score >= sentence),
    ).length;
    const best = Math.max(...classifications.flatMap((c) => c.scores));

    this.classified++;
    console.log(
      `[LocalFilter] <${el.tagName.toLowerCase()}> ${matched}/${sentences.length} matched, best score ${best.toFixed(2)} (threshold ${sentence.toFixed(2)})`,
    );
    if (this.classified === 1) {
      console.log(
        "[LocalFilter] First block sample:",
        JSON.stringify(classifications).slice(0, 300),
      );
    }

    if (matched > 0 && matched / sentences.length >= paragraphFraction) {
      this.blurred++;
      el.classList.add(MODE_CLASSES[currentMode] ?? MODE_CLASSES.blur);
      censoredElements.add(el);
      showToast(`${this.blurred} censored`);
      console.log(
        `[LocalFilter] Censored <${el.tagName.toLowerCase()}> (${currentMode}) — ${matched}/${sentences.length} sentences matched`,
      );
    }

    if (this.classified % 25 === 0) {
      console.log(
        `[LocalFilter] Progress: ${this.classified} classified, ${this.blurred} blurred`,
      );
    }
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
    '<path d="M20 33 L29 42 L45 24"/></svg></div>';
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
