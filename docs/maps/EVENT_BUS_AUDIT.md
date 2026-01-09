## Versões e onde são usadas
- `modules/event-bus-central.js` (v2.0) — carregado como content script no manifest (slot #10). Fornece `window.EventBus`, `WHL_EVENTS`.
- `modules/event-bus.js` (v2.0 - legacy) — incluído apenas em `sidepanel.html` (script tag); não carregado no fluxo principal de content scripts.
- `modules/event-bus-v3.js` — **não referenciado** no manifest nem em HTML; permanece inativo.

## Arquivos que importam/consomem cada versão
- **Event Bus central (principal):** todos os content scripts após o slot #10 assumem `window.EventBus` existente. Ouvintes/emissores listados abaixo usam essa instância.
- **Event Bus legacy (sidepanel):** `sidepanel.html` inclui `modules/event-bus.js`; handlers do sidepanel (`sidepanel.js`, `sidepanel-ai-handlers.js`) escutam/emitem usando o objeto global criado ali.
- **Event Bus v3:** nenhum arquivo consumindo.

## Emissores identificados (EventBus.emit/emitAsync/emitDebounced)
- `content/content.js`: `message:received`
- `content/utils/version-detector.js`: `WHL_VERSION_DETECTED`
- `content/wpp-hooks.js`: `recover:new_message`
- `modules/quick-actions-injector.js`: `crm:label_added`, `crm:note_added`, `crm:stage_changed`, `navigate`, `tasks:task_created`
- `modules/team-system.js`: `teamsystem:broadcast_completed`, `teamsystem:chat_assigned`, `teamsystem:chat_unassigned`, `teamsystem:initialized`, `teamsystem:member_added`, `teamsystem:note_added`, `teamsystem:status_changed`, `teamsystem:user_changed`
- `modules/whatsapp-business-api.js`: `whatsapp_api:bulk_complete`, `whatsapp_api:configured`, `whatsapp_api:message_received`, `whatsapp_api:message_sent`, `whatsapp_api:status_updated`, `whatsapp_api:template_sent`
- `modules/knowledge-base.js`: `knowledge-base:updated`, `knowledge:faq_used`, `knowledge:product_used`, `knowledge:unanswered_question`
- `modules/data-sync-manager.js`: `dataSync:error`, `dataSync:ready`, `dataSync:synced`
- `modules/few-shot-learning.js`: `few-shot:example-added`
- `modules/copilot-engine.js`: `chat:changed`, `copilot:analysis`, `copilot:auto_send`, `copilot:backend:error`, `copilot:context:loaded`, `copilot:feedback:recorded`, `copilot:mode:changed`, `copilot:persona:changed`, `copilot:queued`, `copilot:ready`, `copilot:suggestions`, `suggestion:shown`
- `modules/smoke-test.js`: `smoketest:completed`
- `modules/performance-budget.js`: `module:ready`, `performance:throttle_changed`, `performance:violation`
- `modules/automation-engine.js`: `automation:event_emitted`, `automation:notification`, `automation:rule_created`, `automation:rule_deleted`, `automation:rule_executed`, `automation:rule_updated`, `campaign:add_contact`, `escalation:required`
- `modules/recover-advanced.js`: `recover:cleaned`, `recover:cleared`, `recover:filter_changed`, `recover:message_added`
- `modules/training-stats.js`: `training-stats:updated`
- `modules/memory-system.js`: `memory-system:updated`, `memory:fact_added`
- `modules/ai-service.js`: `ai:completion:error`, `ai:completion:success`, `ai:health:updated`, `ai:provider:configured`, `ai:service:ready`
- `modules/confidence-system.js`: `confidence:copilot-toggled`, `confidence:feedback`, `confidence:level-changed`, `confidence:threshold-changed`
- `modules/ai-backend-handlers.js`: `copilot:feedback`
- `modules/ai-feedback-system.js`: `client:sentiment`, `feedback:received`
- `modules/text-monitor.js`: `text-monitor:auto-response`, `text-monitor:message-analyzed`, `text-monitor:started`, `text-monitor:stopped`, `text-monitor:typing`
- `modules/smartbot-autopilot-v2.js`: `autopilot:auto-responded`, `autopilot:backend:error`, `autopilot:suggestion-only`
- `modules/recover-dom.js`: `recover:message_recovered`, `recover:ready`
- `modules/smartbot-ia.js`: `smartbot:chat-changed`, `smartbot:escalate`, `smartbot:typing`
- `modules/anti-break-system.js`: `health:issue_detected`
- `modules/team-system-ui.js`: `teamsystem:user_changed`
- `modules/backend-client.js`: `backend:authenticated`, `backend:disconnected`, `backend:initialized`, `backend:socket:connected`, `backend:socket:disconnected`, `backend:sync:complete`, `backend:sync:contacts`, `socket:status`
- `modules/campaign-manager.js`: `campaign:completed`, `message:sent`
- `modules/trust-system.js`: `trustsystem:initialized`, `trustsystem:level_up`, `trustsystem:points_added`
- `modules/graceful-degradation.js`: `degradation:status_updated`, `module:ready`
- `modules/message-capture.js`: `capture:message`
- `modules/quick-commands.js`: `quick_command:used`
- `training/modules/sentiment-tracker.js`: `sentiment:alert`

## Ouvintes identificados (EventBus.on/once)
- `sidepanel.js` (sidepanel bus): `recover:message_added`, `recover:message_edited`, `recover:message_removed`
- `sidepanel-ai-handlers.js` (sidepanel bus): `confidence:feedback`, `confidence:level-changed`, `knowledge-base:updated`, `training-stats:updated`
- `content/top-panel-injector.js`: `subscription:credits_consumed`, `subscription:initialized`, `subscription:subscription_activated`
- `modules/ai-analytics.js`: `autopilot:auto-responded`, `conversion:completed`, `escalation:triggered`, `example:added`, `feedback:received`, `issue:resolved`, `suggestion:shown`, `suggestion:used`
- `modules/copilot-engine.js`: `chat:changed`, `copilot:feedback`, `knowledge-base:updated`, `message:received`
- `modules/automation-engine.js`: `ai:suggestion_used`, `chat:opened`, `contact:added`, `deal:created`, `deal:stage_changed`, `message:received`, `message:sent`, `sentiment:analyzed`
- `modules/recover-advanced.js`: `recover:export`, `recover:new_message`, `recover:set_filter`, `recover:sync`
- `modules/ai-auto-learner.js`: `conversation:completed`, `feedback:received`, `message:sent`, `suggestion:edited`, `suggestion:shown`, `suggestion:used`
- `modules/ai-backend-handlers.js`: `copilot:analysis`, `copilot:mode:changed`, `copilot:persona:changed`, `copilot:suggestions`, `view:changed`
- `modules/ai-feedback-system.js`: `client:responded`, `conversion:completed`, `issue:resolved`, `suggestion:edited`, `suggestion:shown`, `suggestion:used`
- `modules/smartbot-autopilot-v2.js`: `message:received`
- `modules/campaign-manager.js`: `backend:connected`, `backend:disconnected`
- `modules/suggestion-injector.js`: `chat:changed`, `copilot:loading`, `copilot:suggestions`
- `modules/trust-system.js`: `auto_response:failed`, `auto_response:success`, `conversation:resolved`, `suggestion:edited_and_used`, `suggestion:feedback_negative`, `suggestion:feedback_positive`, `suggestion:ignored`, `suggestion:used`
- `modules/message-capture.js`: `message:received`, `message:send`

## Observações
- O tráfego de eventos IA passa por `copilot-engine.js`, `ai-service.js`, `smart-replies.js`, `smartbot-autopilot-v2.js` e consumidores de `suggestion:*`/`feedback:*` (`ai-auto-learner.js`, `ai-feedback-system.js`, `ai-analytics.js`, `trust-system.js`).
- A única carga fora do fluxo principal é o sidepanel (usa `event-bus.js` legacy). Nenhum módulo aponta para `event-bus-v3.js`, indicando código morto.
