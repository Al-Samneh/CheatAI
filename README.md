### cheatAI overlay (Cluely-like)

Invisible click-through overlay that records mic audio, transcribes with Deepgram, and asks OpenRouter DeepSeek. Global hotkeys:

- Ctrl+Alt+Space: Start/stop recording
- Ctrl+Alt+M: Toggle mouse passthrough (click-through)

#### Setup

1. Install Node.js LTS.
2. Copy `.env.example` to `.env` and fill keys:
   - `DEEPGRAM_API_KEY`
   - `OPENROUTER_API_KEY`
   - optional: `OPENROUTER_MODEL` (default `deepseek/deepseek-r1:free`)
3. Install deps and run:

```bash
npm install
npm run dev
```

On first record, grant microphone permission. The overlay is mouse-invisible by default; toggle with Ctrl+Alt+M if you need to interact.

#### Notes

- Overlay uses `BrowserWindow#setIgnoreMouseEvents(true, { forward: true })` and CSS `pointer-events: none` for hidden-by-mouse behavior.
- Audio recorded as `audio/webm;codecs=opus` and posted to Deepgram `listen` API.
- OpenRouter called with `chat/completions` using your chosen DeepSeek model.

#### OpenRouter models and providers

- You can set a single model via `OPENROUTER_MODEL` or a prioritized list via `OPENROUTER_MODELS` (comma-separated). The app will try each model in order until one works.
  - Example: `OPENROUTER_MODELS=deepseek/deepseek-r1:free, openai/gpt-oss-120b:free, deepseek/deepseek-chat`
- Optional metadata to include with requests (helps OpenRouter rankings):
  - `OPENROUTER_SITE_URL=https://your-site.example`
  - `OPENROUTER_SITE_TITLE=cheatAI overlay`

##### Provider/Privacy 404s
- 404: No allowed providers are available for the selected model
  - Cause: Your OpenRouter account has no providers enabled for this model.
  - Fix: Enable at least one provider for that model in OpenRouter, or choose another model. You can also list multiple models in `OPENROUTER_MODELS` to auto-fallback.
- 404: No endpoints found matching your data policy (Free model publication)
  - Cause: Privacy setting blocks free models.
  - Fix: Enable “Free model publication” in OpenRouter privacy settings, or switch to a non-free model.

### Troubleshooting

- OpenRouter 404: No endpoints found matching your data policy (Free model publication)
  - Cause: Your privacy setting blocks requests to free models.
  - Fix: Enable “Free model publication” in OpenRouter privacy settings, then retry.
    - Settings: https://openrouter.ai/settings/privacy
  - Or switch to a non-free or different model by setting `OPENROUTER_MODEL` in `.env`.
    - Example: `OPENROUTER_MODEL=deepseek/deepseek-chat`

