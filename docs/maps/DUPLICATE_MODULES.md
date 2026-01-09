## Quick Replies (3 versões)
- `quick-replies.js` (v1.0) — armazenamento `whl_quick_replies`, mapeia `/trigger` simples, UI básica; sem integração com painel lateral ou migração.
- `quick-replies-v3.js` (v3.0) — fonte única de verdade com `replyId` imutável, storage `whl_quick_replies_v3`, suggestion box moderna, API `window.quickReplies`.
- `quick-replies-fixed.js` (v2.0 corrigido) — usa o **mesmo storage do v3** (`whl_quick_replies_v3`), migra chaves legadas (`v2`/`v1`), sincroniza via `chrome.storage.onChanged`, expõe `window.QuickRepliesFixed`/`window.quickReplies`, e é o único listado no manifest (slot #70).
- **Uso no manifest:** somente `quick-replies-fixed.js`.
- **Versão canônica sugerida:** `quick-replies-fixed.js` (mantém compatibilidade com v3 e painel; v1/v3 não carregam).

## AI Service (3 versões)
- `ai-service.js` (v1.0) — multi-provider (OpenAI/Anthropic/Venice/Groq/Google/Ollama), backend soberano (AIGateway/BackendClient), cache, rate limit, eventos `ai:*`; carregado no manifest (slot #36).
- `ai-service-unified.js` (v2.0) — backend-primeiro + fallback OpenAI com **API key pré-configurada** (`PRECONFIGURED_API_KEY`), sanitização contra prompt injection, redefine `window.AIService` para unified; **não** está no manifest.
- `ai-service-fix.js` (patch) — aguarda `AIService` e `BackendClient`, injeta logs e tenta carregar chaves antigas; **não** está no manifest.
- **Uso no manifest:** somente `ai-service.js`.
- **Versão canônica sugerida:** `ai-service.js` (evita chave hardcoded do unified e mantém compatibilidade com CopilotEngine/Autopilot).

## Smartbot Autopilot (2 versões)
- `smartbot-autopilot.js` (v1.0) — monitora chats, gera resposta via Copilot/Backend/AIService, UI mínima, sem integração profunda com ConfidenceSystem; **não** está no manifest.
- `smartbot-autopilot-v2.js` (v7.6.0+) — backend obrigatório (`CopilotEngine` → Backend), integra ConfidenceSystem, HumanTyping, SubscriptionManager, eventos `autopilot:*`; carregado no manifest (slot #60).
- **Uso no manifest:** `smartbot-autopilot-v2.js`.
- **Versão canônica sugerida:** `smartbot-autopilot-v2.js` (versão ativa e compatível com fluxo atual).
