- Fonte: `whatshybrid-extension/manifest.json` (`content_scripts[0].js`).
- Sequência atual (84 scripts, em ordem de carregamento):
  1. content/utils/constants.js
  2. content/utils/logger.js
  3. content/utils/phone-validator.js
  4. content/utils/selectors.js
  5. content/utils/version-detector.js
  6. content/utils/compatibility-manager.js
  7. content/worker-content.js
  8. content/content.js
  9. modules/performance-budget.js
  10. modules/event-bus-central.js
  11. modules/scheduler-global.js
  12. modules/smoke-test.js
  13. modules/graceful-degradation.js
  14. modules/anti-break-system.js
  15. modules/onboarding-tour.js
  16. modules/api-config.js
  17. modules/selector-engine.js
  18. modules/state-manager.js
  19. modules/text-to-speech.js
  20. modules/subscription-manager.js
  21. modules/feature-gate.js
  22. modules/modern-ui.js
  23. modules/text-monitor.js
  24. modules/knowledge-base.js
  25. modules/memory-system.js
  26. modules/ai-memory-advanced.js
  27. modules/few-shot-learning.js
  28. modules/message-capture.js
  29. modules/confidence-system.js
  30. modules/ai-response-cache.js
  31. modules/ai-feedback-system.js
  32. modules/ai-auto-learner.js
  33. modules/ai-analytics.js
  34. modules/training-stats.js
  35. modules/ai-gateway.js
  36. modules/ai-service.js
  37. modules/copilot-engine.js
  38. modules/smart-replies.js
  39. modules/suggestion-injector.js
  40. modules/trust-system.js
  41. modules/team-system.js
  42. modules/team-system-simple.js
  43. lib/socket.io.min.js
  44. modules/backend-client.js
  45. modules/notifications.js
  46. modules/labels.js
  47. modules/contact-manager.js
  48. modules/chart-engine.js
  49. modules/analytics.js
  50. modules/crm.js
  51. modules/tasks.js
  52. modules/campaign-manager.js
  53. modules/crm-badge-injector.js
  54. modules/task-markers-injector.js
  55. modules/quick-actions-injector.js
  56. modules/smartbot-ia.js
  57. modules/smartbot-integration.js
  58. modules/smartbot-extended.js
  59. modules/smartbot-ai-plus.js
  60. modules/smartbot-autopilot-v2.js
  61. modules/escalation-system.js
  62. modules/escalation-integration.js
  63. modules/human-typing.js
  64. modules/recover-advanced.js
  65. modules/recover-visual-injector.js
  66. modules/audio-sender.js
  67. modules/document-sender.js
  68. modules/business-intelligence.js
  69. modules/training-debug-tools.js
  70. modules/quick-replies-fixed.js
  71. modules/ai-suggestion-fixed.js
  72. modules/team-system-ui.js
  73. modules/media-sender-fixed.js
  74. modules/smart-suggestions.js
  75. modules/recover-dom.js
  76. modules/data-sync-manager.js
  77. modules/automation-engine.js
  78. modules/whatsapp-business-api.js
  79. modules/init.js
  80. content/top-panel-injector.js
  81. content/extractor-v6-optimized.js
  82. content/waextractor.v6.js
  83. content/label-button-injector.js
  84. chatbackup/content.js

## Dependências quebradas ou frágeis
- **AIService antes do BackendClient:** `modules/ai-service.js` depende de `window.BackendClient.isConnected()` para rota soberana de backend, mas o cliente só carrega no slot #44. Risco: primeira chamada IA pode cair em fallback local e falhar se `FORCE_BACKEND` continuar ativo.
- **AIGateway antes do AIService:** `modules/ai-gateway.js` (slot #35) consulta `window.AIService` como fonte de chaves e fallback; como o AIService está depois (#36), a integração só funciona se AIService já tiver inicializado manualmente.
- **CopilotEngine exige AIService/BackendClient:** `modules/copilot-engine.js` (slot #37) chama `AIGateway` e usa `AIService` como fallback; também depende de contexto do Backend (`backendUrl`/`BackendClient`). Se AIService/BackendClient não estiverem prontos, o motor fica sem provedor.
- **SmartReplies/SuggestionInjector dependem do CopilotEngine:** `modules/smart-replies.js` (#38) e `modules/suggestion-injector.js` (#39) esperam `window.CopilotEngine` carregado e conectado ao backend. Qualquer atraso no CopilotEngine quebra sugestões.
- **Smartbot Autopilot v2 depende de CopilotEngine/AIService:** `modules/smartbot-autopilot-v2.js` (#60) é backend-first; se CopilotEngine/AIService falhar, gera erro bloqueante.
- **Sockets e BackendClient:** `modules/backend-client.js` requer `lib/socket.io.min.js` (slot #43). Manter essa precedência é obrigatório.
- **Injectors de CRM/Tarefas:** `modules/task-markers-injector.js` (#54) e `modules/crm-badge-injector.js` (#53) assumem `CRMModule`/`TasksModule` já carregados (#50/#51); ordem atual respeita mas é sensível.

## Ordem sugerida (não aplicar agora; apenas registrar)
- Carregar `lib/socket.io.min.js` → `modules/backend-client.js` **antes** de `ai-gateway.js` e `ai-service.js`.
- Sequência recomendada de IA: `ai-service.js` → `ai-gateway.js` (usa AIService) → `copilot-engine.js` (usa ambos) → `smart-replies.js` / `suggestion-injector.js` → `smartbot-autopilot-v2.js`.
- Manter base: constants → logger → selectors → version-detector → compatibility-manager → **event-bus-central** → scheduler-global → api-config → state-manager.
- `modules/init.js` deve permanecer entre os últimos carregados (depois de todos os módulos que registra).
- Preservar ordem dos injetores dependentes (CRM/Tasks/HumanTyping) após os módulos que eles estendem.

## Observações
- Não alterar o manifest nesta fase; itens acima são recomendações para etapa de correção.
- O grafo detalhado dos módulos de IA e demais dependências está em `DEPENDENCY_MAP.md` para orientar uma futura reordenação controlada.
