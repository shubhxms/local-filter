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
  
  // Simple word matching against topics
  const matches = topics.filter(topic => 
    text.toLowerCase().includes(topic.toLowerCase())
  );


  if (matches.length > 0) {
    chrome.action.setBadgeText({ text: matches.length.toString() });
  }
}