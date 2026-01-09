## Metodologia
- Fonte principal: `manifest.json` (ordem de carga) e varredura de dependências implícitas via `window.*` e EventBus.
- Busca assistida por scripts (`rg`/Python) para identificar emissores/ouvintes do EventBus e módulos não referenciados.
- Foco na extensão (`whatshybrid-extension/`); backend não incluído nesta etapa.

## Mapa global de dependências (alto nível)
- **Contracto de eventos:** `modules/event-bus-central.js` cria `window.EventBus`, `WHL_EVENTS`. Quase todos os módulos conversam via esse barramento.
- **Config/estado inicial:** `api-config.js` e `state-manager.js` definem defaults consumidos por vários módulos (IA, CRM, init).
- **Backend:** `lib/socket.io.min.js` → `modules/backend-client.js` (expõe `window.BackendClient` com request/AI/sync). Usado por AIService, CopilotEngine, DataSyncManager, CampaignManager, Autopilot v2, Recover, SubscriptionManager.
- **IA core:** `modules/ai-service.js` expõe `window.AIService`; depende de `AIGateway` (quando presente) e `BackendClient` para rota soberana.
- **Gateway:** `modules/ai-gateway.js` expõe `window.AIGateway`; consulta AIService para chaves/fallback.
- **Copilot:** `modules/copilot-engine.js` usa AIGateway (prioritário) e AIService (fallback), consome BackendClient para contexto/feedback, e emite eventos (`copilot:*`, `chat:changed`, `suggestion:shown`).
- **Sugestões/UI:** `modules/smart-replies.js` e `modules/suggestion-injector.js` dependem de CopilotEngine e AIService; publicam/consomem `suggestion:*`.
- **Automação:** `modules/automation-engine.js` consome EventBus (`message:*`, `contact:*`, `deal:*`) e emite automações; depende de AI/Sentiment via eventos.
- **Init:** `modules/init.js` valida carregamento de EventBus/StateManager e dispara `system:ready`; assume todos os módulos carregados antes dele.

## Principais dependências entre módulos (resumo textual)
- `backend-client.js` → usado por `ai-service.js`, `copilot-engine.js`, `ai-gateway.js` (fallback), `data-sync-manager.js`, `campaign-manager.js`, `recover-advanced.js`, `subscription-manager.js`, `smartbot-autopilot-v2.js`, `ai-suggestion-fixed.js`.
- `ai-service.js` → usa `AIGateway` (se disponível) e `BackendClient` para IA soberana; emite eventos `ai:*` no EventBus.
- `ai-gateway.js` → consulta `AIService` para chaves e fallback; fornece `AIGateway.complete` para Copilot/AIService.
- `copilot-engine.js` → depende de `AIGateway` (principal), `AIService` (fallback), `BackendClient` (contexto/feedback), `KnowledgeBase`, `MemorySystem`, `FewShotLearning`, `AIResponseCache`; emite `copilot:*`, `chat:changed`, `suggestion:shown`.
- `smart-replies.js` → prioriza `CopilotEngine` (backend), cai para `AIService`; sincroniza config com AIService; emite `MODULE_LOADED`, usa EventBus.
- `smartbot-autopilot-v2.js` → backend-first via `CopilotEngine`; fallbacks para `AIService` e `BackendClient`; emite `autopilot:*`; consome `message:received`.
- `ai-suggestion-fixed.js` → gera sugestões via `AIService` e `BackendClient.ai.chat`; usa storage compartilhado com Quick Replies.
- `ai-auto-learner.js` → ouve `suggestion:*`, `feedback:received`, `message:sent`; ajusta modelos/estatísticas locais.
- `ai-feedback-system.js` → ouve `suggestion:*`, `conversion:completed`, `issue:resolved`; emite `feedback:received`, `client:sentiment`.
- `ai-analytics.js` → ouve `autopilot:auto-responded`, `conversion:completed`, `suggestion:used/shown`; consolida métricas IA.
- `ai-memory-advanced.js` → usa `MemorySystem` e sincroniza perfis via `BackendClient`.
- `ai-response-cache.js` → cache consultado por Copilot/AI pipeline (uso interno).
- `few-shot-learning.js` → gerencia exemplos e emite `few-shot:example-added`; usado como fonte de contexto para IA.
- `smartbot-ia.js`/`smartbot-extended.js`/`smartbot-ai-plus.js` → módulos de IA legados/avançados; expõem funcionalidades de bot, armazenam estado em `chrome.storage` e emitem eventos `smartbot:*`; `smartbot-ia.js` usa AIService.

## Grafo (15 módulos de IA) – adjacência
- **ai-gateway.js** → depende de: `AIService` (fallback/config). Consumido por: `ai-service`, `copilot-engine`.
- **ai-service.js** → depende de: `AIGateway`, `BackendClient`, `EventBus`. Consumido por: `copilot-engine` (fallback), `smart-replies`, `smartbot-autopilot-v2`, `ai-suggestion-fixed`, `ai-gateway`.
- **copilot-engine.js** → depende de: `AIGateway`, `AIService`, `BackendClient`, `KnowledgeBase`, `MemorySystem`, `FewShotLearning`, `AIResponseCache`, `EventBus`. Consumido por: `smart-replies`, `suggestion-injector`, `smartbot-autopilot-v2`.
- **smart-replies.js** → depende de: `CopilotEngine`, `AIService`, `EventBus`. Consumido por: UI (init) e handlers de sugestões.
- **ai-suggestion-fixed.js** → depende de: `AIService`, `BackendClient`, storage de Quick Replies. Consumido por: pipeline de sugestões (manifest slot #123).
- **ai-auto-learner.js** → depende de: `EventBus` (`suggestion:*`, `feedback:received`, `message:sent`). Consumido por: estatísticas IA.
- **ai-feedback-system.js** → depende de: `EventBus` (`suggestion:*`, `conversion:*`); emite `client:sentiment`, `feedback:received`. Consumido por: `ai-analytics`, dashboards.
- **ai-analytics.js** → depende de: `EventBus` (`autopilot:auto-responded`, `suggestion:*`, `conversion:*`, `issue:resolved`). Consumido por: relatórios/telemetria.
- **ai-response-cache.js** → depende de: storage local; usado por: `copilot-engine`/IA para caching.
- **ai-memory-advanced.js** → depende de: `MemorySystem`, `BackendClient.syncClientProfiles`. Consumido por: `copilot-engine` (contexto).
- **few-shot-learning.js** → depende de: EventBus para emitir `few-shot:example-added`; consumido por: `copilot-engine`/treino.
- **smartbot-ia.js** → depende de: `AIService` e EventBus (`smartbot:*`). Consumido por: `smartbot-extended.js`, `smartbot-ai-plus.js`, integrações smartbot.
- **smartbot-extended.js** → depende de: `smartbot-ia.js` (estado/base), storage local. Consumido por: smartbot UI.
- **smartbot-ai-plus.js** → depende de: storage local; expande smartbot (RAG, scoring, cache). Consumido por: smartbot pipeline.
- **smartbot-autopilot-v2.js** → depende de: `CopilotEngine`, `AIService`, `BackendClient`, `SmartReplies`, `ConfidenceSystem`, EventBus. Consumido por: automação de resposta automática (manifest slot #60).

## Observações rápidas
- Módulos legados não carregados pelo manifest (`ai-service-unified.js`, `ai-service-fix.js`, `smartbot-autopilot.js`, `quick-replies.js/v3`, `event-bus.js/v3`) permanecem fora do grafo principal; listados em `UNUSED_MODULES.md`.
- Comunicações entre módulos ocorrem majoritariamente via EventBus; alterações no bus devem considerar ouvintes/emissores descritos em `EVENT_BUS_AUDIT.md`.
