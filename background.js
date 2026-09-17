// Local Filter - Background Service Worker (MV3)
// Creates offscreen document and routes messages

let creatingOffscreen = null;

async function setupOffscreenDocument() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // Avoid race condition by tracking creation
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Run ML model for text classification'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
  console.log('[Background] Offscreen document created');
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'classifyText') {
    console.log('[Background] Received classifyText request, routing to offscreen');

    handleClassification(message, sender.tab.id)
      .then(result => {
        // Send results back to content script
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

    // Let the content script know we're processing
    sendResponse({ success: true, message: 'Processing started' });
    return true;
  }

  return false;
});

async function handleClassification(message, tabId) {
  // Ensure offscreen document is ready
  await setupOffscreenDocument();

  // Send to offscreen document for processing
  const response = await chrome.runtime.sendMessage({
    action: 'classify',
    text: message.text,
    topics: message.topics
  });

  if (response.success) {
    return response.classifications;
  } else {
    throw new Error(response.error);
  }
}

console.log('[Background] Local Filter service worker loaded');