
// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACTED_TEXT') {
    processExtractedText(message.payload);
  }
  return true;
});

async function processExtractedText(text) {
  // Get user topics from storage
  const { topics = [] } = await chrome.storage.sync.get('topics');
  
  // Send topics to content script for underlining
  chrome.tabs.sendMessage(tabId, {
    type: 'UNDERLINE_TOPICS',
    topics: topics
  });
}
