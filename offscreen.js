// Local Filter - Offscreen Document Script
// This runs in a hidden document context where WASM/dynamic imports work

import { pipeline } from './libs/transformers.min.js';

let classifier = null;
let isModelLoading = false;
let modelLoadingPromise = null;

async function initializeModel() {
    if (classifier !== null) {
        return classifier;
    }

    if (isModelLoading) {
        return await modelLoadingPromise;
    }

    try {
        isModelLoading = true;
        console.log('[Offscreen] Loading zero-shot classification model...');

        modelLoadingPromise = pipeline('zero-shot-classification', 'Xenova/nli-deberta-v3-xsmall');
        classifier = await modelLoadingPromise;

        console.log('[Offscreen] Model loaded successfully!');
        return classifier;
    } catch (error) {
        console.error('[Offscreen] Error loading model:', error);
        isModelLoading = false;
        throw error;
    } finally {
        isModelLoading = false;
    }
}

async function classifyText(text, topics) {
    // Initialize the model
    await initializeModel();

    // Split text into sentences
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    const sentences = Array.from(segmenter.segment(text), s => s.segment.trim())
        .filter(sentence => sentence.length > 10);

    // Limit sentences for performance
    const MAX_SENTENCES = 50;
    const sentencesToProcess = sentences.length > MAX_SENTENCES
        ? sentences.slice(0, MAX_SENTENCES)
        : sentences;

    console.log(`[Offscreen] Processing ${sentencesToProcess.length} sentences out of ${sentences.length} total`);

    // Process each sentence
    const outputs = {};
    for (let i = 0; i < sentencesToProcess.length; i++) {
        const sentence = sentencesToProcess[i];

        try {
            const result = await classifier(sentence, topics, { multi_label: true });
            outputs[i] = result;
        } catch (error) {
            console.error(`[Offscreen] Error classifying sentence ${i}:`, error);
            outputs[i] = { error: error.message, sequence: sentence };
        }

        // Log progress every 10 sentences
        if ((i + 1) % 10 === 0) {
            console.log(`[Offscreen] Progress: ${i + 1}/${sentencesToProcess.length}`);
        }
    }

    console.log('[Offscreen] Classification complete');
    return outputs;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'classify') {
        console.log('[Offscreen] Received classify request');

        classifyText(message.text, message.topics)
            .then(results => {
                sendResponse({ success: true, classifications: results });
            })
            .catch(error => {
                console.error('[Offscreen] Classification error:', error);
                sendResponse({ success: false, error: error.message });
            });

        // Return true to indicate async response
        return true;
    }
});

console.log('[Offscreen] Local Filter offscreen script loaded');
