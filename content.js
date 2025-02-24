
chrome.runtime.onMessage.addListener((message) => {
  const topics = message.topics;
  if (!topics.length) return;
  markText(topics);
})



function markText(topics) {
  var instance = new Mark(document.querySelector('body'));


  // Remove existing highlights
  document.querySelectorAll('mark.topic-highlight').forEach(el => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
  });

  // Loop through each topic and highlight it
  topics.forEach(topic => {
    instance.mark(topic, {
      accuracy: "partially",
      separateWordSearch: false,
      caseSensitive: false,
      className: "topic-highlight",
      acrossElements: true,
      done: function (count) {
        console.log(`Highlighted ${count} matches for topic: ${topic}`);
      },
      filter: function (node, term, totalCounter) {
        // Optional filter function to control which matches get highlighted
        // Return true to highlight, false to skip
        return true;
      }
    });
  });
}