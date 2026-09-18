// Local Filter - Background Service Worker (MV3)
// jev-api branch: classifies sentences via TypeSafe AI's Jev (System One) API.
// One request per message: every sentence x topic becomes a named noul
// question, answered in a single parallel pass.

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const FETCH_TIMEOUT_MS = 20000; // must stay under the SW 30s idle kill

// A hanging fetch does NOT reset the service worker's idle timer, so without
// a timeout the SW gets killed mid-request and the message channel closes.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Jev API request timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
      );
    }
    throw new Error(`Jev API request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// NOTE: the listener signature is positional (message, sender, sendResponse) —
// do NOT drop the middle parameter to satisfy the unused-variable lint;
// that shifts sendResponse into sender's slot and every reply throws.
// Keyboard shortcut (⌘⌃B on macOS) — same as clicking the popup button.
// NOTE: query lastFocusedWindow here — 'currentWindow' has no meaning in a
// service worker and silently matches no tab.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "run-filter") return;
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "FILTER" });
  } catch {
    console.log(
      "[Background] No content script on this page — nothing to filter.",
    );
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "classifySentences") {
    classifyBatch(message)
      .then((classifications) => {
        sendResponse({
          success: true,
          requestId: message.requestId,
          classifications,
        });
      })
      .catch((error) => {
        console.error("[Background] Classification failed:", error);
        sendResponse({
          success: false,
          requestId: message.requestId,
          error: error.message,
        });
      });

    return true; // async sendResponse
  }

  return false;
});

async function classifyBatch({ sentences, topics, qualities = [] }) {
  if (!Array.isArray(sentences) || sentences.length === 0) {
    throw new Error("Sentences must be a non-empty array");
  }
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error("Topics must be a non-empty array");
  }

  const { jevApiKey: apiKey } = await chrome.storage.local.get("jevApiKey");
  if (!apiKey) {
    throw new Error(
      "No Jev API key configured. Add one in the extension options.",
    );
  }

  // Self-contained structured instructions bind each question to its sentence
  // unambiguously; state carries the list for shared context.
  const questions = {};
  sentences.forEach((sentence, i) => {
    topics.forEach((topic, j) => {
      questions[`s${i}_t${j}`] = {
        type: "noul",
        instructions: {
          question: `Is this sentence about ${topic}?`,
          sentence,
        },
        criteria: null,
      };
    });
    qualities.forEach((quality, k) => {
      questions[`s${i}_q${k}`] = {
        type: "noul",
        instructions: {
          question: `Does this sentence read as ${quality}?`,
          sentence,
        },
        criteria: null,
      };
    });
  });

  const response = await fetchWithTimeout(JEV_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: { sentences },
      questions,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jev API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();

  // Array aligned with the input sentences; content.js consumes by index.
  // Validate every answer so a shape mismatch fails loudly instead of
  // silently producing undefined scores.
  // Every answer is validated so a shape mismatch fails loudly instead of
  // silently producing undefined scores.
  const answerFor = (key) => {
    const answer = data.answers?.[key];
    if (typeof answer?.noul !== "number" || !Number.isFinite(answer.noul)) {
      throw new Error(
        `Jev response missing answer ${key}: ${JSON.stringify(answer).slice(0, 200)}`,
      );
    }
    return answer.noul;
  };

  // Array aligned with the input sentences; content.js consumes by index.
  // redeem = strongest quality probability for the sentence (0 when no
  // qualities are configured).
  return sentences.map((sentence, i) => ({
    sequence: sentence,
    labels: topics,
    scores: topics.map((_, j) => answerFor(`s${i}_t${j}`)),
    redeem: qualities.length
      ? Math.max(...qualities.map((_, k) => answerFor(`s${i}_q${k}`)))
      : 0,
  }));
}

console.log("[Background] Local Filter service worker loaded (jev-api)");
