// Local Filter - Background Service Worker (MV3)
// jev-api branch: classifies sentences via TypeSafe AI's Jev (System One) API.
// Wire format verified against @typesafe-ai/sdk v0.6.0 (client.ts, questions.ts):
// POST /v1/systemone { model, state, questions } -> { answers: { [name]: { type, noul } } }

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
const CONCURRENCY = 5;   // sentences classified in parallel
const MAX_SENTENCES = 50;

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'classifyText') {
    console.log('[Background] Received classifyText request, routing to Jev');

    handleClassification(message)
      .then(result => {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'classificationResults',
          classifications: result
        });
      })
      .catch(error => {
        console.error('[Background] Classification failed:', error);
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'classificationError',
          error: error.message
        });
      });

    sendResponse({ success: true, message: 'Processing started' });
    return true;
  }

  return false;
});

async function handleClassification(message) {
  const { jevApiKey: apiKey } = await chrome.storage.local.get('jevApiKey');
  if (!apiKey) {
    throw new Error('No Jev API key configured. Add one in the extension options.');
  }

  const sentences = segmentSentences(message.text);
  console.log(`[Background] Classifying ${sentences.length} sentences with ${message.topics.length} topics each`);

  // One request per sentence; a worker pool keeps a few in flight at a time.
  const outputs = {};
  let cursor = 0;

  const worker = async () => {
    while (cursor < sentences.length) {
      const i = cursor++;
      try {
        outputs[i] = await classifySentence(sentences[i], message.topics, apiKey);
      } catch (sentenceError) {
        console.error(`[Background] Error classifying sentence ${i}:`, sentenceError);
        outputs[i] = { error: sentenceError.message, sequence: sentences[i] };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sentences.length) }, worker)
  );

  console.log('[Background] Classification complete');
  return outputs;
}

// Ask Jev one noul question per topic — a 0..1 yes-probability each, which maps
// straight onto the multi-label scores the content script already consumes.
async function classifySentence(sentence, topics, apiKey) {
  const questions = {};
  topics.forEach((topic, j) => {
    questions[`topic_${j}`] = {
      type: 'noul',
      instructions: `Is this sentence about ${topic}?`,
      criteria: null
    };
  });

  const response = await fetch(JEV_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: { sentence },
      questions
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jev API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();

  return {
    sequence: sentence,
    labels: topics,
    scores: topics.map((_, j) => data.answers[`topic_${j}`].noul)
  };
}

function segmentSentences(text) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const sentences = Array.from(segmenter.segment(text), s => s.segment.trim())
    .filter(sentence => sentence.length > 10);

  return sentences.slice(0, MAX_SENTENCES);
}

console.log('[Background] Local Filter service worker loaded (jev-api)');
