## Metodologia
- Varredura automática de `fetch()` (aspas e template literals) em `whatshybrid-extension/*.js`.
- Identificação de chamadas indiretas via `window.BackendClient.*` (cliente REST/socket) e `AIGateway`.
- Escopo: extensão; não cobre chamadas originadas no backend.

## Endpoints chamados diretamente via `fetch`
- `background.js`
  - `${backendUrl}/api/v1/ai/learn/feedback`
  - `${backendUrl}/api/v1/ai/learn/sync`
  - `${backendUrl}/api/v1/examples/add`
  - `${backendUrl}/api/v1/examples/list`
  - `${backendUrl}/api/v1/memory/batch`
  - `${backendUrl}/api/v1/memory/query?chatKey=${encodeURIComponent(message.chatKey)}`
- `modules/copilot-engine.js`
  - `${backendUrl}/api/v1/ai/learn/context/${encodeURIComponent(chatId)}?includeExamples=true&maxMessages=30&maxExamples=3`
  - `${backendUrl}/api/v1/ai/learn/feedback`
- `modules/message-capture.js`
  - `${backendUrl}/api/v1/ai/learn/ingest`
- `modules/recover-advanced.js`
  - `${CONFIG.BACKEND_URL}/api/recover/sync`
  - `${CONFIG.BACKEND_URL}/api/v1/recover/media/download`
  - `${CONFIG.BACKEND_URL}/api/v1/recover/ocr`
  - `${CONFIG.BACKEND_URL}/api/v1/recover/transcribe`
  - `${baseUrl}/health`
- `modules/subscription-manager.js`
  - `${backendUrl}${CONFIG.validationEndpoint}`
  - `${backendUrl}/api/v1/subscription/sync`
- `modules/text-to-speech.js`
  - `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1` (Azure TTS)
  - `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}` (Google TTS)
- `modules/whatsapp-business-api.js`
  - `${CONFIG.BASE_URL}/${CONFIG.API_VERSION}/${state.config.phoneNumberId}/media`
- `training/modules/external-kb.js`
  - `https://api.notion.com/v1/databases/${databaseId}/query`

## Chamadas via `BackendClient` (endpoints dinâmicos)
- `modules/backend-client.js` define `BackendClient.request` (REST) e `BackendClient.ai.complete` (IA), além de syncs `/api/v1/sync/*` e websocket (`socket.io`).
- Consumidores diretos:
  - `modules/ai-service.js` (rota soberana de IA via `BackendClient.ai.complete`).
  - `modules/ai-suggestion-fixed.js` (`BackendClient.ai.chat` como fallback).
  - `modules/copilot-engine.js` (contexto/feedback quando backend conectado).
  - `modules/data-sync-manager.js` (`BackendClient.request` para `/api/v1/sync/status` e endpoints de módulos configurados).
  - `modules/campaign-manager.js` (`BackendClient.campaigns.*`).
  - `modules/recover-advanced.js` (conexão/socket + download via backendUrl).
  - `modules/subscription-manager.js` (validação/sync via backendUrl).
  - `modules/ai-backend-handlers.js` (login/register/logout, sync de contatos/deals/tasks via `BackendClient`).
  - `modules/smartbot-autopilot-v2.js` e `modules/smartbot-autopilot.js` (fallbacks de resposta via backend).
  - `modules/ai-memory-advanced.js` (`BackendClient.syncClientProfiles`).

## Observações
- Nenhuma chamada direta encontrada para `http://localhost` ou `/api/` absoluta; todas usam `backendUrl`/`CONFIG.BACKEND_URL` dinâmicos ou hosts externos.
- Endpoints de IA de provedores (OpenAI/Anthropic/Groq/etc.) são configurados dentro de `ai-service.js` e não aparecem como literais aqui.
- Recomenda-se cruzar estes endpoints com o backend para identificar rotas não utilizadas ou duplicadas.
