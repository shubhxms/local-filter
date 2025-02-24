
document.getElementById('extractBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const { topics = [] } = await chrome.storage.sync.get('topics');
  chrome.tabs.sendMessage(tab.id, { topics });
});