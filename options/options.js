async function loadTopics() {
  const { topics = [] } = await chrome.storage.sync.get('topics');
  const topicsList = document.getElementById('topicsList');
  topicsList.innerHTML = '';
  
  topics.forEach(topic => {
    const div = document.createElement('div');
    div.className = 'topic';
    div.textContent = topic;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => deleteTopic(topic);
    
    div.appendChild(deleteBtn);
    topicsList.appendChild(div);
  });
}

async function addTopic() {
  const input = document.getElementById('newTopic');
  const topic = input.value.trim();
  
  if (topic) {
    const { topics = [] } = await chrome.storage.sync.get('topics');
    await chrome.storage.sync.set({ 
      topics: [...topics, topic]
    });
    input.value = '';
    loadTopics();
  }
}

async function deleteTopic(topicToDelete) {
  const { topics = [] } = await chrome.storage.sync.get('topics');
  await chrome.storage.sync.set({
    topics: topics.filter(topic => topic !== topicToDelete)
  });
  loadTopics();
}

document.getElementById('addTopic').addEventListener('click', addTopic);

document.getElementById('saveKey').addEventListener('click', async () => {
  const input = document.getElementById('apiKey');
  const key = input.value.trim();
  if (key) {
    await chrome.storage.local.set({ jevApiKey: key });
    input.value = '';
    input.placeholder = 'Saved ✓';
  }
});
document.addEventListener('DOMContentLoaded', loadTopics);