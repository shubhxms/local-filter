// Local Filter - Background Service Worker (MV3)
// jev-api branch: classifies sentences via TypeSafe AI's Jev (System One) API.
// One request per message: every sentence x topic becomes a named noul
// question, answered in a single parallel pass.

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';

chrome.runtime.onMessage.addListener((message, sendResponse) => {
  if (message.action === 'classifySentences') {
    classifyBatch(message)
      .then(classifications => {
        sendResponse({ success: true, requestId: message.requestId, classifications });
      })
      .catch(error => {
        console.error('[Background] Classification failed:', error);
        sendResponse({ success: false, requestId: message.requestId, error: error.message });
      });

    return true;  // async sendResponse
  }

  return false;
});

async function classifyBatch({ sentences, topics }) {
  if (!Array.isArray(sentences) || sentences.length === 0) {
    throw new Error('Sentences must be a non-empty array');
  }
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error('Topics must be a non-empty array');
  }

  const { jevApiKey: apiKey } = await chrome.storage.local.get('jevApiKey');
  if (!apiKey) {
    throw new Error('No Jev API key configured. Add one in the extension options.');
  }

  // Self-contained structured instructions bind each question to its sentence
  // unambiguously; state carries the list for shared context.
  const questions = {};
  sentences.forEach((sentence, i) => {
    topics.forEach((topic, j) => {
      questions[`s${i}_t${j}`] = {
        type: 'noul',
        instructions: { question: `Is this sentence about ${topic}?`, sentence },
        criteria: null
      };
    });
  });

  const response = await fetch(JEV_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: { sentences },
      questions
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jev API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();

  // Array aligned with the input sentences; content.js consumes by index.
  return sentences.map((sentence, i) => ({
    sequence: sentence,
    labels: topics,
    scores: topics.map((_, j) => data.answers[`s${i}_t${j}`].noul)
  }));
}

console.log('[Background] Local Filter service worker loaded (jev-api)');
