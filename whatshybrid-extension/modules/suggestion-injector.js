/**
 * 💡 Suggestion Injector - Exibe sugestões de IA na interface do WhatsApp
 *
 * Sistema completo de sugestões com painel lateral, feedback e integração com IA.
 *
 * @version 7.8.0
 */

(function() {
  'use strict';

  const CONFIG = {
    PANEL_ID: 'whl-suggestions-panel',
    MAX_SUGGESTIONS: 1, // Show only ONE best suggestion
    MAX_CONTEXT_MESSAGES: 10, // Maximum number of messages to extract from DOM for context
    FOCUS_DELAY_MS: 100, // Delay to ensure input field focus is established
    DOM_CLEANUP_DELAY_MS: 100, // Delay to allow browser to complete DOM reflow after clearing
    ANIMATION_DURATION: 300
  };

  const state = {
    isVisible: false,
    currentSuggestions: [],
    currentChatId: null,
    initialized: false
  };

  // ============================================================
  // HELPERS (Robust package: memória + exemplos + prompt completo)
  // ============================================================

  function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\u0000/g, '').trim();
  }

  function getChatTitleFromDOM() {
    try {
      const headerSpan = document.querySelector('header span[title]');
      const headerDiv = document.querySelector('[data-testid="conversation-info-header"] span');
      const mainPanel = document.querySelector('#main header');
      if (headerSpan) return headerSpan.getAttribute('title') || headerSpan.textContent || '';
      if (headerDiv) return headerDiv.textContent || '';
      if (mainPanel) {
        const nameEl = mainPanel.querySelector('span[dir="auto"]');
        return nameEl?.textContent || '';
      }
    } catch (_) {}
    return '';
  }

  function buildTranscriptFromMessages(msgs) {
    if (!Array.isArray(msgs) || msgs.length === 0) return '';
    return msgs
      .filter(m => safeText(m?.content))
      .map(m => `${m.role === 'assistant' ? 'Atendente' : 'Cliente'}: ${safeText(m.content)}`)
      .join('\n');
  }

  // ============================================================
  // ESTILOS
  // ============================================================

  function injectStyles() {
    if (document.getElementById('whl-suggestion-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'whl-suggestion-styles';
    styles.textContent = `
      #${CONFIG.PANEL_ID} {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 360px;
        max-height: 420px;
        background: rgba(26, 26, 46, 0.98);
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(139, 92, 246, 0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 99998;
        overflow: hidden;
        transform: translateX(400px);
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(20px);
      }

      #${CONFIG.PANEL_ID}.visible {
        transform: translateX(0);
        opacity: 1;
      }

      #${CONFIG.PANEL_ID} * {
        box-sizing: border-box;
      }

      .whl-sug-header {
        background: linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%);
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }

      .whl-sug-title {
        color: white;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .whl-sug-badge {
        background: rgba(255,255,255,0.2);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
      }

      .whl-sug-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .whl-sug-close:hover {
        background: rgba(255,255,255,0.3);
        transform: scale(1.1);
      }

      .whl-sug-body {
        padding: 12px;
        max-height: 320px;
        overflow-y: auto;
      }

      .whl-sug-item {
        background: rgba(40, 40, 70, 0.9);
        border-radius: 12px;
        padding: 14px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: all 0.2s;
        border: 1px solid rgba(255,255,255,0.1);
      }

      .whl-sug-item:hover {
        background: rgba(102,126,234,0.15);
        border-color: rgba(102,126,234,0.3);
        transform: translateX(-4px);
      }

      .whl-sug-item:last-child {
        margin-bottom: 0;
      }

      .whl-sug-text {
        color: rgba(255,255,255,0.9);
        font-size: 13px;
        line-height: 1.5;
        margin-bottom: 8px;
      }

      .whl-sug-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .whl-sug-confidence {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: rgba(255,255,255,0.5);
      }

      .whl-sug-confidence-bar {
        width: 40px;
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        overflow: hidden;
      }

      .whl-sug-confidence-fill {
        height: 100%;
        background: linear-gradient(90deg, #667eea, #764ba2);
        border-radius: 2px;
        transition: width 0.3s;
      }

      .whl-sug-actions {
        display: flex;
        gap: 6px;
      }

      .whl-sug-btn {
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
      }

      .whl-sug-btn-use {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
      }

      .whl-sug-btn-use:hover {
        transform: scale(1.05);
      }

      .whl-sug-btn-edit {
        background: rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.8);
      }

      .whl-sug-btn-edit:hover {
        background: rgba(255,255,255,0.2);
      }

      .whl-sug-empty {
        text-align: center;
        padding: 20px;
        color: rgba(255,255,255,0.5);
        font-size: 13px;
      }

      .whl-sug-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 20px;
        color: rgba(255,255,255,0.7);
      }

      .whl-sug-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255,255,255,0.2);
        border-top-color: #667eea;
        border-radius: 50%;
        animation: whl-spin 0.8s linear infinite;
      }

      @keyframes whl-spin {
        to { transform: rotate(360deg); }
      }

      /* Toast de confirmação */
      .whl-sug-toast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: #10b981;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 99999;
        opacity: 0;
        transition: all 0.3s;
      }

      .whl-sug-toast.visible {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
      }
    `;
    document.head.appendChild(styles);
  }

  // ============================================================
  // CRIAÇÃO DO PAINEL
  // ============================================================

  function createPanel() {
    if (document.getElementById(CONFIG.PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = CONFIG.PANEL_ID;
    panel.innerHTML = `
      <div class="whl-sug-header">
        <div class="whl-sug-title">
          <span>💡</span>
          <span>Sugestões de IA</span>
          <span class="whl-sug-badge" id="whl-sug-count">0</span>
        </div>
        <button class="whl-sug-close" id="whl-sug-close" title="Fechar">×</button>
      </div>
      <div class="whl-sug-body" id="whl-sug-body">
        <div class="whl-sug-empty">
          As sugestões aparecerão aqui quando você receber mensagens.
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Event listeners
    document.getElementById('whl-sug-close')?.addEventListener('click', hidePanel);

    console.log('[SuggestionInjector] 💡 Painel de sugestões criado');
  }

  // ============================================================
  // EXIBIÇÃO DE SUGESTÕES
  // ============================================================

  function showSuggestions(suggestions, chatId = null) {
    if (!suggestions || suggestions.length === 0) return;

    state.currentSuggestions = suggestions;
    state.currentChatId = chatId;

    const body = document.getElementById('whl-sug-body');
    const count = document.getElementById('whl-sug-count');

    if (!body) return;

    // Atualiza contador
    if (count) count.textContent = suggestions.length;

    // Renderiza sugestões
    body.innerHTML = suggestions.slice(0, CONFIG.MAX_SUGGESTIONS).map((sug, i) => {
      const text = typeof sug === 'string' ? sug : (sug.text || sug.content || sug.message || '');
      const confidence = sug.confidence || sug.score || 0.8;
      const confidencePercent = Math.round(confidence * 100);

      return `
        <div class="whl-sug-item" data-index="${i}">
          <div class="whl-sug-text">${escapeHtml(text)}</div>
          <div class="whl-sug-meta">
            <div class="whl-sug-confidence">
              <div class="whl-sug-confidence-bar">
                <div class="whl-sug-confidence-fill" style="width: ${confidencePercent}%"></div>
              </div>
              <span>${confidencePercent}%</span>
            </div>
            <div class="whl-sug-actions">
              <button class="whl-sug-btn whl-sug-btn-edit" data-action="edit" data-index="${i}">✏️</button>
              <button class="whl-sug-btn whl-sug-btn-use" data-action="use" data-index="${i}">Usar</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Event listeners para botões
    body.querySelectorAll('.whl-sug-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const index = parseInt(btn.dataset.index);
        handleAction(action, index);
      });
    });

    // Clique no item inteiro para usar
    body.querySelectorAll('.whl-sug-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        handleAction('use', index);
      });
    });

    // Mostra o painel
    showPanel();

    // v7.5.0: NO auto-hide - user closes manually via X or toggle button
    // resetAutoHide(); // REMOVED

    console.log('[SuggestionInjector] 💡', suggestions.length, 'sugestões exibidas');
  }

  function handleAction(action, index) {
    const suggestion = state.currentSuggestions[index];
    if (!suggestion) return;

    const text = typeof suggestion === 'string' ? suggestion : (suggestion.text || suggestion.content || suggestion.message || '');

    if (action === 'use') {
      insertIntoChat(text);
      showToast('✅ Sugestão inserida!');
      hidePanel();
      
      // Registrar uso de sugestão no ConfidenceSystem
      if (window.confidenceSystem?.recordSuggestionUsed) {
        window.confidenceSystem.recordSuggestionUsed(false); // false = não editado
      }
    } else if (action === 'edit') {
      insertIntoChat(text);
      showToast('✏️ Edite a mensagem');
      hidePanel();
      
      // Registrar sugestão editada no ConfidenceSystem
      if (window.confidenceSystem?.recordSuggestionUsed) {
        window.confidenceSystem.recordSuggestionUsed(true); // true = editado
      }
    }
  }

  async function insertIntoChat(text) {
    try {
      const input = findChatInput();
      if (!input) throw new Error('Input não encontrado');

      input.focus();

      // Limpar antes de digitar
      if (window.HumanTyping?.clear) {
        window.HumanTyping.clear(input);
      } else {
        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        } catch (_) {}
      }

      // Digitar como humano
      if (window.HumanTyping?.type) {
        console.log('[SuggestionInjector][HUMAN_TYPE_START] len=', (text || '').length);
        await window.HumanTyping.type(input, text, {
          minDelay: 18,
          maxDelay: 45,
          chunkSize: 2
        });
        console.log('[SuggestionInjector][HUMAN_TYPE_END]');
      } else {
        // Fallback: inserção direta
        document.execCommand('insertText', false, text);
      }

      // Evento de input para o WhatsApp registrar
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Manter foco e cursor no fim
      try {
        const sel = window.getSelection?.();
        if (sel && input.childNodes.length) {
          sel.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(input);
          range.collapse(false);
          sel.addRange(range);
        }
      } catch (_) {}

    } catch (error) {
      console.error('[SuggestionInjector] Erro ao inserir:', error);
      showToast('Erro ao inserir sugestão', 'error');
    }
  }

  // ============================================================
  // CONTROLE DO PAINEL
  // ============================================================

  function showPanel() {
    const panel = document.getElementById(CONFIG.PANEL_ID);

    if (panel) {
      panel.classList.add('visible');
      state.isVisible = true;
    }
  }

  function hidePanel() {
    const panel = document.getElementById(CONFIG.PANEL_ID);

    if (panel) {
      panel.classList.remove('visible');
      state.isVisible = false;
    }
  }

  function togglePanel() {
    if (state.isVisible) {
      hidePanel();
    } else {
      showPanel();
      // Generate suggestion immediately when opening
      requestSuggestionGeneration();
    }
  }

  // Extract messages from WhatsApp Web DOM (ONLY from active chat)
  function extractMessagesFromDOM() {
    const messages = [];
    try {
      // CORREÇÃO CRÍTICA: Verificar chat ativo antes de extrair
      const currentChatId = getCurrentChatId();
      if (!currentChatId) {
        console.warn('[SuggestionInjector] Nenhum chat ativo - não é possível extrair mensagens');
        return messages;
      }

      // CORREÇÃO CRÍTICA: Buscar apenas dentro do container do chat ativo
      // O WhatsApp Web renderiza mensagens dentro do elemento [data-tab="1"] ou similar
      const chatContainer = document.querySelector('[data-tab="1"]') ||
                            document.querySelector('[role="application"]') ||
                            document.querySelector('div[class*="conversation-panel"]');

      if (!chatContainer) {
        console.warn('[SuggestionInjector] Container de chat não encontrado');
        return messages;
      }

      // Seletores para mensagens do WhatsApp Web (dentro do container ativo)
      const messageSelectors = [
        '[data-testid="msg-container"]',
        '.message-in, .message-out',
        '[data-id][class*="message"]'
      ];

      let msgElements = null;
      for (const sel of messageSelectors) {
        // CORREÇÃO CRÍTICA: querySelectorAll APENAS dentro do chatContainer
        msgElements = chatContainer.querySelectorAll(sel);
        if (msgElements && msgElements.length > 0) break;
      }

      if (!msgElements || msgElements.length === 0) {
        console.warn('[SuggestionInjector] Nenhuma mensagem encontrada no chat ativo');
        return messages;
      }

      // Pegar as últimas N mensagens configuradas
      const lastMessages = Array.from(msgElements).slice(-CONFIG.MAX_CONTEXT_MESSAGES);

      for (const el of lastMessages) {
        // Detectar se é mensagem recebida ou enviada
        const dataId = el.getAttribute('data-id') || '';
        const isOutgoing =
          el.classList.contains('message-out') ||
          !!el.querySelector('.message-out') ||
          !!el.closest?.('.message-out') ||
          !!el.closest?.('[data-testid="msg-container"]')?.querySelector('span[data-icon="tail-out"]') ||
          !!el.querySelector('span[data-icon="tail-out"]') ||
          !!el.querySelector('[data-testid="msg-dblcheck"], [data-testid="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-check"], [data-icon="msg-time"]') ||
          dataId.startsWith('true_');

        // Extrair texto
        const textEl = el.querySelector('[data-testid="msg-text"], .copyable-text span, .selectable-text span');
        const text = textEl?.textContent?.trim() || '';

        if (text) {
          messages.push({
            role: isOutgoing ? 'assistant' : 'user',
            content: text,
            chatId: currentChatId  // NOVO: Marcar com chatId para rastreabilidade
          });
        }
      }

      console.log(`[SuggestionInjector] Extraídas ${messages.length} mensagens do chat ativo: ${currentChatId}`);
    } catch (e) {
      console.error('[SuggestionInjector] Erro ao extrair mensagens:', e);
    }

    return messages;
  }

  // Request suggestion generation from AI
  async function requestSuggestionGeneration() {
    const chatId = state.currentChatId || getCurrentChatId();
    
    // Mostrar loading
    const body = document.getElementById('whl-sug-body');
    if (body) {
      body.innerHTML = `
        <div class="whl-sug-loading">
          <div class="whl-sug-spinner"></div>
          <span>Analisando conversa...</span>
        </div>
      `;
    }
    
    try {
      // CRÍTICO: Extrair mensagens REAIS do chat
      const domMessages = extractMessagesFromDOM();
      console.log('[SuggestionInjector] Mensagens extraídas:', domMessages.length);

      // Obter última mensagem do cliente
      let lastUserMessage = '';
      for (let i = domMessages.length - 1; i >= 0; i--) {
        if (domMessages[i].role === 'user' && safeText(domMessages[i].content)) {
          lastUserMessage = domMessages[i].content;
          break;
        }
      }

      // ChatKey consistente (id do WhatsApp quando disponível, senão título)
      const chatKey = safeText(chatId) || safeText(getChatTitleFromDOM()) || 'active_chat';
      const transcript = buildTranscriptFromMessages(domMessages);

      // Atualizar memória rapidamente (não bloqueante)
      try {
        const autoMem = window.MemorySystem?.autoUpdateMemory || window.autoUpdateMemory;
        if (typeof autoMem === 'function' && safeText(transcript).length >= 60) {
          autoMem(transcript, chatKey, 150);
        }
      } catch (_) {}

      const hasProviders = window.AIService?.getConfiguredProviders && window.AIService.getConfiguredProviders().length > 0;

      // MÉTODO 1 (PRIORIDADE): CopilotEngine (robusto: memória + exemplos + prompt completo)
      if (hasProviders && window.CopilotEngine?.analyzeMessage && window.CopilotEngine?.generateResponse) {
        try {
          if (window.CopilotEngine.loadConversationContext) {
            await window.CopilotEngine.loadConversationContext(chatKey, true);
          }

          const analysis = await window.CopilotEngine.analyzeMessage(lastUserMessage || 'Olá', chatKey);
          const resp = await window.CopilotEngine.generateResponse(chatKey, analysis, { maxTokens: 240 });

          if (resp?.content) {
            showSuggestions([
              { text: resp.content.trim(), type: 'ai', confidence: resp.confidence || 0.85 }
            ], chatKey);
            return;
          }
        } catch (e) {
          console.warn('[SuggestionInjector] CopilotEngine falhou, usando fallback:', e);
        }
      }
      
      // MÉTODO 2: SmartRepliesModule com contexto real (fallback)
      if (window.SmartRepliesModule?.isConfigured?.()) {
        console.log('[SuggestionInjector] Gerando via SmartRepliesModule...');
        
        // Passar as mensagens extraídas do DOM
        const contextMessages = domMessages.length > 0 ? domMessages : [];
        const suggestions = await window.SmartRepliesModule.generateSuggestions(chatKey, contextMessages);
        
        if (suggestions?.length > 0) {
          showSuggestions(suggestions, chatKey);
          return;
        }
      }
      
      // MÉTODO 3: AIService direto com contexto do DOM (fallback simples)
      if (hasProviders && window.AIService?.generateText) {
        console.log('[SuggestionInjector] Gerando via AIService...');
        
        // Formatar contexto
        const contextText = domMessages.length > 0 
          ? domMessages.map(m => `${m.role === 'user' ? 'Cliente' : 'Você'}: ${m.content}`).join('\n')
          : 'Nova conversa - cliente acabou de enviar primeira mensagem.';
        
        const lastMsg = lastUserMessage || 'Mensagem não detectada';
        
        const prompt = `Baseado na conversa abaixo, gere UMA sugestão de resposta profissional e contextualizada.

CONVERSA:

${contextText}

ÚLTIMA MENSAGEM DO CLIENTE: ${lastMsg}

INSTRUÇÕES:
- Responda de forma profissional e útil
- Seja conciso (máximo 2-3 frases)
- Responda em português brasileiro
- NÃO inclua saudações se a conversa já começou

Responda APENAS com o texto da sugestão, sem formatação adicional.`;
        
        const result = await window.AIService.generateText(prompt, {
          temperature: 0.7,
          maxTokens: 200
        });
        
        if (result?.content) {
          showSuggestions([{ text: result.content, type: 'ai' }], chatKey);
          return;
        }
      }
      
      // Nenhum método disponível
      showConfigurationNeeded();
      
    } catch (error) {
      console.error('[SuggestionInjector] Erro:', error);
      showErrorSuggestion(error.message);
    }
  }

  // Nova função auxiliar para obter contexto
  async function getConversationContext(chatId) {
    try {
      // PRIORIDADE 1: Extrair mensagens DIRETAMENTE do DOM (mais confiável)
      const domMessages = extractMessagesFromDOM();
      if (domMessages.length > 0) {
        console.log('[SuggestionInjector] Usando contexto do DOM');
        return domMessages.slice(-5).map(m => `${m.role === 'user' ? 'Cliente' : 'Você'}: ${m.content}`).join('\n');
      }
      
      // PRIORIDADE 2: Tentar Store do WhatsApp (FILTRADO por chat ativo)
      if (window.Store?.Msg && chatId) {
        // CORREÇÃO CRÍTICA: Filtrar apenas mensagens do chat ativo
        const allMsgs = window.Store.Msg.getModelsArray ? window.Store.Msg.getModelsArray() : [];
        const chatMessages = allMsgs.filter(m => m.id?.remote === chatId);
        const lastMsgs = chatMessages.slice(-CONFIG.MAX_CONTEXT_MESSAGES);

        if (lastMsgs.length > 0) {
          console.log(`[SuggestionInjector] Usando ${lastMsgs.length} mensagens filtradas do Store (chat: ${chatId})`);
          return lastMsgs.map(m => `${m.fromMe ? 'Você' : 'Cliente'}: ${m.body || ''}`).join('\n');
        }
      }
      
      // PRIORIDADE 3: CopilotEngine
      if (window.CopilotEngine?.getConversationContext) {
        const ctx = window.CopilotEngine.getConversationContext(chatId);
        if (ctx?.messages?.length > 0) {
          return ctx.messages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
        }
      }
      
      // PRIORIDADE 4: SmartRepliesModule history
      if (window.SmartRepliesModule?.getHistory) {
        const history = window.SmartRepliesModule.getHistory(chatId);
        if (history?.length > 0) {
          return history.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
        }
      }
      
      return 'Sem contexto disponível. Gere uma saudação profissional.';
    } catch (e) {
      console.error('[SuggestionInjector] Erro ao obter contexto:', e);
      return 'Sem contexto disponível. Gere uma saudação profissional.';
    }
  }

  // Nova função para mostrar que precisa configurar
  function showConfigurationNeeded() {
    const body = document.getElementById('whl-sug-body');
    if (!body) return;
    
    body.innerHTML = `
      <div style="padding: 16px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 8px;">⚙️</div>
        <div style="color: #fbbf24; font-weight: 500; margin-bottom: 8px;">Configure a IA</div>
        <div style="color: rgba(255,255,255,0.6); font-size: 12px; margin-bottom: 12px;">
          Abra o painel lateral e configure o provider de IA nas Configurações.
        </div>
      </div>
    `;
  }

  // Nova função para mostrar erro
  function showErrorSuggestion(errorMessage) {
    const body = document.getElementById('whl-sug-body');
    if (!body) return;
    
    body.innerHTML = `
      <div style="padding: 16px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 8px;">❌</div>
        <div style="color: #ef4444; font-weight: 500; margin-bottom: 4px;">Erro ao gerar</div>
        <div style="color: rgba(255,255,255,0.5); font-size: 11px;">${errorMessage || 'Tente novamente'}</div>
      </div>
    `;
  }

  function extractChatIdFromRows() {
    try {
      const container = document.querySelector('#main') || document;
      const rows = Array.from(container.querySelectorAll('[data-id^="true_"], [data-id^="false_"]'));
      for (let i = rows.length - 1; i >= 0; i--) {
        const dataId = rows[i].getAttribute('data-id') || '';
        const m = dataId.match(/_(\d+@(?:c\.us|g\.us|lid|s\.whatsapp\.net))/);
        if (m && m[1]) return m[1];
      }
    } catch (_) {}
    return null;
  }

  function getCurrentChatId() {
    // Prefer Store
    try {
      if (window.Store?.Chat?.getActive) {
        const id = window.Store.Chat.getActive()?.id?._serialized;
        if (safeText(id)) return id;
      }
    } catch (e) {}

    // Fallback DOM
    const domId = extractChatIdFromRows();
    if (safeText(domId)) return domId;

    return null;
  }

  function showEmptySuggestion() {
    const body = document.getElementById('whl-sug-body');
    if (body) {
      body.innerHTML = '<div class="whl-sug-empty">Configure a IA no painel de configurações para ver sugestões.</div>';
    }
  }

  // v7.5.0: resetAutoHide() removed - no auto-hide behavior

  // ============================================================
  // UTILIDADES
  // ============================================================

  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showToast(message, type = 'success') {
    if (window.NotificationsModule?.toast) {
      window.NotificationsModule.toast(String(message ?? ''), type, 3000);
      return;
    }

    // Remove toast existente
    const existing = document.querySelector('.whl-sug-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'whl-sug-toast';
    toast.textContent = message;
    toast.style.background = type === 'error' ? '#ef4444' : '#10b981';
    document.body.appendChild(toast);

    // Anima entrada
    setTimeout(() => toast.classList.add('visible'), 10);

    // Remove após 3 segundos
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function showLoading() {
    const body = document.getElementById('whl-sug-body');
    if (body) {
      body.innerHTML = `
        <div class="whl-sug-loading">
          <div class="whl-sug-spinner"></div>
          <span>Gerando sugestões...</span>
        </div>
      `;
    }
    showPanel();
  }

  // ============================================================
  // INTEGRAÇÃO COM EVENTOS
  // ============================================================

  function setupEventListeners() {
    // DESABILITADO: Auto-show de sugestões via EventBus
    // O painel agora só aparece quando o usuário clica no botão do robozinho
    // Isso evita duplicação de caixas de sugestão
    
    if (window.EventBus) {
      // REMOVIDO: window.EventBus.on('copilot:suggestions', ...)
      // O AISuggestionButton já cuida de mostrar as sugestões

      window.EventBus.on('copilot:loading', () => {
        // Não mostrar loading automaticamente
        // showLoading();
      });

      window.EventBus.on('chat:changed', () => {
        // Limpa sugestões ao trocar de chat
        state.currentSuggestions = [];
        hidePanel();
      });
    }

    // REMOVIDO: Custom event listener que causava duplicação
    // window.addEventListener('whl:suggestions', ...);

    // Atalho de teclado (Ctrl+Shift+S)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        togglePanel();
      }
    });
  }

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  function init() {
    if (state.initialized) return;

    console.log('[SuggestionInjector] 💡 Inicializando...');

    injectStyles();
    createPanel();
    setupEventListeners();

    state.initialized = true;
    console.log('[SuggestionInjector] ✅ Inicializado');
  }

  // Aguarda DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }

  // ============================================================
  // EXPORTAÇÃO GLOBAL
  // ============================================================

  window.SuggestionInjector = {
    show: showSuggestions,
    hide: hidePanel,
    toggle: togglePanel,
    showPanel: showPanel,
    showLoading,
    isVisible: () => state.isVisible,
    getSuggestions: () => state.currentSuggestions
  };

})();
