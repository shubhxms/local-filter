# Local Filter

## Features
Add topics you want to avoid and reedeming topics that save them. Every (sentence, topic) pair is sent to Jev's noul API and then a weighted sum is calculated.

## Details
This is a MV3 (sigh) chromium extension that filters out sentences that are about topics you do not wish to engage with ("focus on what you want to see more of"!)

The initial idea was to use a 100% local model (such as [Xenova/DistilBERT](https://huggingface.co/Xenova/distilbert-base-cased)) but that was too slow and clunky to setup in an extension.

After Jev's launch I thought this was a perfect fit - a good, general purpose classifier that can zero-shot topics.


I am looking at open, local alternatives that are blazing fast even (especially) on a CPU. Feel free to reach out to talk about that. :)
