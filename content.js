// Local Filter - Content Script
// Element-level extraction + scroll-driven classification.
// Sentences are the measurement unit (Jev scores them); block elements are
// the action unit (the whole block blurs when enough of its sentences agree).

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dd, dt, pre';
const SKIP_ANCESTORS = 'nav, header, footer, aside, [aria-hidden="true"]';
const BLUR_CLASS = 'local-filter-blur';
const MAX_SENTENCES_PER_ELEMENT = 20;  // sanity cap for pathological blocks
const CONCURRENCY = 4;                 // blocks classified in parallel
const OBSERVER_MARGIN = '50% 0px 250% 0px';  // classify a few scroll units ahead

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' });

let run = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'FILTER') {
    startRun();
  }
});

// One user knob: 0 = permissive (blur only near-certain blocks),
// 1 = restrictive (blur aggressively). Keep in sync with options.js.
function thresholdsFor(strictness) {
  return {
    sentence: 0.85 - 0.45 * strictness,           // 0.85 → 0.40
    paragraphFraction: 0.90 - 0.40 * strictness   // 0.90 → 0.50
  };
}

async function startRun() {
  const { topics = [] } = await chrome.storage.sync.get('topics');
  const { strictness = 0.5 } = await chrome.storage.sync.get('strictness');

  if (topics.length === 0) {
    console.log('[LocalFilter] No topics configured. Add topics in the extension options.');
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
    this.id = crypto.randomUUID();
    this.blocks = new Map();      // Element -> { status: 'queued' | 'inflight' | 'done' }
    this.queue = [];
    this.inFlight = 0;
    this.observer = null;
    this.stopped = false;
  }

  start() {
    for (const el of collectBlocks()) {
      this.blocks.set(el, { status: 'queued' });
    }

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.observer.unobserve(entry.target);
        this.queue.push(entry.target);
        this.pump();
      }
    }, { rootMargin: OBSERVER_MARGIN });

    for (const el of this.blocks.keys()) this.observer.observe(el);
    console.log(`[LocalFilter] Watching ${this.blocks.size} blocks (run ${this.id.slice(0, 8)})`);
  }

  stop() {
    this.stopped = true;
    this.observer?.disconnect();
    this.queue = [];
    for (const el of this.blocks.keys()) el.classList.remove(BLUR_CLASS);
  }

  // Keep at most CONCURRENCY requests to the background in flight.
  pump() {
    while (!this.stopped && this.inFlight < CONCURRENCY && this.queue.length > 0) {
      const el = this.queue.shift();
      const state = this.blocks.get(el);
      if (!state || state.status !== 'queued') continue;

      state.status = 'inflight';
      this.inFlight++;
      this.classify(el)
        .finally(() => {
          this.inFlight--;
          this.pump();
        });
    }
  }

  async classify(el) {
    try {
      const sentences = segment(el.innerText);
      if (sentences.length === 0) return;

      const response = await chrome.runtime.sendMessage({
        action: 'classifySentences',
        requestId: this.id,
        sentences,
        topics: this.topics
      });

      // A newer FILTER started meanwhile — drop stale results.
      if (this.stopped || response?.requestId !== this.id) return;
      if (!response?.success) throw new Error(response?.error || 'No response from background');

      this.apply(el, sentences, response.classifications);
    } catch (error) {
      console.error('[LocalFilter] Classification failed:', error);
    } finally {
      const state = this.blocks.get(el);
      if (state) state.status = 'done';
    }
  }

  // Blur the whole block when enough of its sentences match any topic.
  apply(el, sentences, classifications) {
    const { sentence, paragraphFraction } = this.thresholds;
    const matched = classifications.filter(
      c => c.scores.some(score => score >= sentence)
    ).length;

    if (matched > 0 && matched / sentences.length >= paragraphFraction) {
      el.classList.add(BLUR_CLASS);
      console.log(`[LocalFilter] Blurred <${el.tagName.toLowerCase()}> — ${matched}/${sentences.length} sentences matched`);
    }
  }
}

function collectBlocks() {
  const blocks = [];
  for (const el of document.querySelectorAll(BLOCK_SELECTOR)) {
    if (el.closest(SKIP_ANCESTORS)) continue;             // nav/footer boilerplate
    if (el.querySelector(BLOCK_SELECTOR)) continue;       // innermost block wins (li > p)
    if (!isVisible(el)) continue;
    if (segment(el.innerText).length === 0) continue;     // nothing worth classifying
    blocks.push(el);
  }
  return blocks;
}

function isVisible(el) {
  if (getComputedStyle(el).position === 'fixed') return true;
  return el.offsetParent !== null;
}

function segment(text) {
  return Array.from(SEGMENTER.segment(text), s => s.segment.trim())
    .filter(s => s.length > 10)
    .slice(0, MAX_SENTENCES_PER_ELEMENT);
}

console.log('Local Filter content script loaded (element pipeline)');
