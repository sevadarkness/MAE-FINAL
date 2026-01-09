- Contexto: identificar arquivos `.js` em `whatshybrid-extension/modules/` não referenciados no `manifest.json` (content scripts, web_accessible_resources ou background).
- Método: varredura automática (Python) listando todos os módulos vs. entradas de script do manifest.

## Arquivos não referenciados no manifest.json
- `modules/ai-backend-handlers.js`
- `modules/ai-service-fix.js`
- `modules/ai-service-unified.js`
- `modules/ai-suggestion-button.js`
- `modules/audio-file-handler.js`
- `modules/autopilot-handlers.js`
- `modules/contact-manager-ui.js`
- `modules/event-bus-v3.js`
- `modules/event-bus.js`
- `modules/quick-commands.js`
- `modules/quick-replies-v3.js`
- `modules/quick-replies.js`
- `modules/smartbot-autopilot.js`
- `modules/subscription.js`
- `modules/ui-panel-shadow.js`

## Outros apontamentos de “dead code”
- `whatshybrid-extension/sidepanel-router.js.bak` **não está presente no repositório** (provavelmente já removido antes desta auditoria).
- `background/extractor-v6.js` está referenciado por `background.js` via `importScripts`, portanto **não** é considerado morto.

## Próximos passos
- Validar se algum dos módulos acima é carregado dinamicamente pelo sidepanel ou popup antes de eventual remoção.
- Cruzar com o inventário de duplicados (ORDEM 0.3) e com o audit de Event Bus (ORDEM 0.2) antes de qualquer exclusão.
