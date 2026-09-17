// Local Filter - Content Script
// Handles text extraction and highlighting

let userTopics = [];
let isProcessing = false;

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  // Handle the FILTER command from popup
  if (message.type === 'FILTER') {
    userTopics = message.topics || [];
    console.log('Received topics:', userTopics);

    if (userTopics.length === 0) {
      console.log('No topics configured. Please add topics in the extension options.');
      sendResponse({ success: false, error: 'No topics configured' });
      return;
    }

    processPage();
    sendResponse({ success: true });
    return true;
  }

  // Handle classification results from background script
  if (message.action === 'classificationResults') {
    console.log('Received classification results');
    const classifications = message.classifications;
    if (classifications) {
      markText(classifications);
    } else {
      console.error('Received empty classification results');
    }
    isProcessing = false;
    return;
  }

  // Handle classification errors from background script
  if (message.action === 'classificationError') {
    console.error('Classification error:', message.error);
    isProcessing = false;
    return;
  }
});

async function processPage() {
  if (isProcessing) {
    console.log('Already processing, please wait...');
    return;
  }

  if (userTopics.length === 0) {
    console.log('No topics to filter. Skipping classification.');
    return;
  }

  isProcessing = true;
  console.log('Starting page processing...');

  // Extract all text from the page
  const text = document.body.innerText;

  console.log(`Sending text for classification with topics: ${userTopics.join(', ')}`);

  // Send to background script for classification
  chrome.runtime.sendMessage({
    action: 'classifyText',
    text: text,
    topics: userTopics
  }, response => {
    if (response && response.success) {
      console.log('Classification request sent successfully');
    } else {
      console.error('Failed to send classification request:', response?.error || 'Unknown error');
      isProcessing = false;
    }
  });
}

function markText(outputs) {
  const instance = new Mark(document.querySelector('body'));

  // Remove existing highlights first
  instance.unmark({
    className: 'local-filter-highlight',
    done: function () {
      applyHighlights(instance, outputs);
    }
  });
}

function applyHighlights(instance, outputs) {
  // Collect sentences that match any topic above threshold
  let toHighlight = [];
  const THRESHOLD = 0.5; // Confidence threshold

  for (const [key, value] of Object.entries(outputs)) {
    // Skip error entries
    if (value.error) {
      console.log(`Skipping entry ${key} due to error:`, value.error);
      continue;
    }

    // Check if any score is above threshold
    if (value.scores && value.scores.some(score => score > THRESHOLD)) {
      // The 'sequence' is the original sentence text
      if (value.sequence) {
        // Find which topic matched
        const maxScoreIndex = value.scores.indexOf(Math.max(...value.scores));
        const matchedTopic = value.labels ? value.labels[maxScoreIndex] : 'unknown';
        const maxScore = value.scores[maxScoreIndex];

        console.log(`Match found: "${value.sequence.substring(0, 50)}..." matches "${matchedTopic}" with score ${maxScore.toFixed(2)}`);
        toHighlight.push(value.sequence);
      }
    }
  }

  console.log(`Found ${toHighlight.length} sentences to highlight out of ${Object.keys(outputs).length} processed`);

  if (toHighlight.length === 0) {
    console.log('No matches found above threshold.');
    return;
  }

  // Highlight each matching sentence
  toHighlight.forEach((sentence, index) => {
    // Clean up the sentence for better matching
    const cleanSentence = sentence.trim();

    instance.mark(cleanSentence, {
      accuracy: "partially",
      separateWordSearch: false,
      caseSensitive: false,
      className: "local-filter-highlight",
      acrossElements: true,
      done: function (count) {
        if (count > 0) {
          console.log(`Highlighted sentence ${index + 1}: ${count} occurrence(s)`);
        }
      }
    });
  });
}

console.log('Local Filter content script loaded');