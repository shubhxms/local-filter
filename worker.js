// Local Filter - Web Worker (ES Module)
// Runs the zero-shot classification model

// Import the transformers library using ES module syntax
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

    // Notify that model is loading
    self.postMessage({ type: 'modelLoading' });

    console.log('Loading zero-shot classification model...');
    modelLoadingPromise = pipeline('zero-shot-classification', 'Xenova/nli-deberta-v3-xsmall');
    classifier = await modelLoadingPromise;

    console.log('Model loaded successfully');
    self.postMessage({ type: 'modelReady' });

    return classifier;
  } catch (error) {
    console.error('Error loading model:', error);
    isModelLoading = false;
    throw error;
  } finally {
    isModelLoading = false;
  }
}

// Process messages from the content script
self.onmessage = async (event) => {
  try {
    const { text, topics, requestId } = event.data;

    if (!text || !topics) {
      throw new Error('Missing text or topics in message');
    }

    if (!Array.isArray(topics) || topics.length === 0) {
      throw new Error('Topics must be a non-empty array');
    }

    console.log(`Processing text with topics: ${topics.join(', ')}`);
    const results = await processExtractedText(text, topics);

    // Send results back to content script
    self.postMessage({
      type: 'results',
      classifications: results,
      requestId: requestId
    });
  } catch (error) {
    console.error('Error in worker:', error);
    self.postMessage({
      type: 'error',
      error: error.message,
      requestId: event.data?.requestId
    });
  }
};

async function processExtractedText(text, topics) {
  // Initialize the model first
  await initializeModel();

  // Split text into sentences using Intl.Segmenter
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const sentences = Array.from(segmenter.segment(text), s => s.segment.trim())
    .filter(sentence => sentence.length > 10); // Filter out very short segments

  // Limit sentences for performance
  const MAX_SENTENCES = 50;
  const sentencesToProcess = sentences.length > MAX_SENTENCES
    ? sentences.slice(0, MAX_SENTENCES)
    : sentences;

  console.log(`Processing ${sentencesToProcess.length} sentences out of ${sentences.length} total`);

  // Process each sentence
  const outputs = {};
  for (let i = 0; i < sentencesToProcess.length; i++) {
    const sentence = sentencesToProcess[i];

    try {
      const result = await classifier(sentence, topics, { multi_label: true });
      outputs[i] = result;
    } catch (sentenceError) {
      console.error(`Error classifying sentence ${i}:`, sentenceError);
      outputs[i] = { error: sentenceError.message, sequence: sentence };
    }

    // Progress update every 5 sentences
    if ((i + 1) % 5 === 0 || i === sentencesToProcess.length - 1) {
      self.postMessage({
        type: 'progress',
        processed: i + 1,
        total: sentencesToProcess.length
      });
    }
  }

  console.log('Classification complete');
  return outputs;
}

// Global error handler
self.onerror = (error) => {
  console.error('Worker global error:', error);
  self.postMessage({
    type: 'error',
    error: 'Worker encountered an unexpected error',
    details: error?.toString?.() || 'Unknown error'
  });
};

console.log('Local Filter worker loaded');
