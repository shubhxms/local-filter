


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // process extracted text
})

chrome.tabs.sendMessage(request.tabId, {
    action: 'classificationResults',
    classifications: classifications
})





async function processExtractedText(text, topics) {
    try {

        // split text into sentences
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
        const sentences = Array.from(segmenter.segment(text), s => s.segment.trim())

        // For very large texts, limit the number of sentences to process
        const sentencesToProcess = sentences

        console.log(`Processing ${sentencesToProcess.length} sentences out of ${sentences.length} total`);

        // process each sentence
        const outputs = {};
        for (let i = 0; i < sentencesToProcess.length; i++) {
            const sentence = sentencesToProcess[i];
            try {
                outputs[i] = await classifier(sentence, topics, { multi_label: true });
            } catch (sentenceError) {
                console.error(`Error classifying sentence ${i}:`, sentenceError);
                outputs[i] = { error: sentenceError.message };
            }

            // progress update on every 10th sentence
            if (i % 10 === 0 && i > 0) {
                self.postMessage({
                    type: 'progress',
                    processed: i,
                    total: sentencesToProcess.length
                });
            }
        }

        console.log("Classification complete:", outputs);
        return outputs;
    } catch (error) {
        console.error("Error in text processing:", error);
        throw error;
    }
}
self.onerror = (error) => {
    console.error("Worker global error:", error);
    self.postMessage({
        type: 'error',
        error: 'Worker encountered an error',
        details: error.toString()
    });
};
