// Local Filter - Content Script
// Element-level extraction, classify everything on FILTER (scroll gating
// removed while debugging; the queue still limits in-flight requests).
// Sentences are the measurement unit (Jev scores them); block elements are
// the action unit (the whole block blurs when enough of its sentences agree).

const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dd, dt, pre";
const SKIP_ANCESTORS = 'nav, header, footer, aside, [aria-hidden="true"]';
const BLUR_CLASS = "local-filter-blur";
const MAX_SENTENCES_PER_ELEMENT = 20; // sanity cap for pathological blocks
const CONCURRENCY = 4; // blocks classified in parallel

const SEGMENTER = new Intl.Segmenter("en", { granularity: "sentence" });

let run = null;
let filterSeq = 0; // guards against stacked FILTER clicks racing through startRun

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "FILTER") {
    startRun(++filterSeq);
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
  const { topics = [] } = await chrome.storage.sync.get("topics");
  const { strictness = 0.5 } = await chrome.storage.sync.get("strictness");

  // Another FILTER arrived while we were reading storage — it wins.
  if (seq !== filterSeq) return;

  if (topics.length === 0) {
    console.log(
      "[LocalFilter] No topics configured. Add topics in the extension options.",
    );
    return;
  }

  if (run) run.stop();
  run = new Run(topics, thresholdsFor(strictness));
  run.start();
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
    this.stopped = false;
  }

  start() {
    for (const el of collectBlocks()) {
      this.blocks.set(el, { status: "queued" });
    }

    // TEMPORARY debugging aid: cap the blast radius until the pipeline is stable.
    const DEBUG_MAX_BLOCKS = 20;
    const targets = [...this.blocks.keys()].slice(0, DEBUG_MAX_BLOCKS);
    this.queue.push(...targets);
    this.errors = 0;
    console.log(
      `[LocalFilter] Classifying ${targets.length}/${this.blocks.size} blocks (run ${this.id.slice(0, 8)})`,
    );
    this.pump();
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    for (const el of this.blocks.keys()) el.classList.remove(BLUR_CLASS);
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
            `[LocalFilter] Run complete: ${this.classified} classified, ${this.blurred} blurred, ${this.errors} errors`,
          );
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
      console.error("[LocalFilter] Classification failed:", error.message + hint);
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
      el.classList.add(BLUR_CLASS);
      console.log(
        `[LocalFilter] Blurred <${el.tagName.toLowerCase()}> — ${matched}/${sentences.length} sentences matched`,
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

function isVisible(el) {
  if (getComputedStyle(el).position === "fixed") return true;
  return el.offsetParent !== null;
}

function segment(text) {
  return Array.from(SEGMENTER.segment(text), (s) => s.segment.trim())
    .filter((s) => s.length > 10)
    .slice(0, MAX_SENTENCES_PER_ELEMENT);
}

console.log("Local Filter content script loaded (element pipeline)");
