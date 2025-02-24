
// popup.js
document.getElementById('extractBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TEXT' }, response => {
    if (response && response.status === 'success') {
      document.getElementById('result').textContent = 'Text extracted!';
    }
  });
});
