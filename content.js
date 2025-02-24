function extractPageText() {
  const text = document.body.innerText;
  chrome.runtime.sendMessage({
    type: 'EXTRACTED_TEXT',
    payload: text
  });
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_TEXT') {
    extractPageText();
    sendResponse({ status: 'success' });
  }
  return true;
});