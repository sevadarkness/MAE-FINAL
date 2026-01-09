/**
 * 🤖 AI Suggestion Button - Botão de Sugestões de IA (CORRIGIDO)
 *
 * Botão azul posicionado acima do botão enviar do WhatsApp.
 * Ao clicar: gera sugestão baseada na conversa atual.
 *
 * @version 2.0.0 - CORRIGIDO
 */

(function() {
  'use strict';

  if (window.__AI_SUGGESTION_FIXED__) return;
  window.__AI_SUGGESTION_FIXED__ = true;

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[AI-Btn]', ...args); }

  const CONFIG = {
    BUTTON_ID: 'whl-ai-btn-fixed',
    PANEL_ID: 'whl-ai-panel-fixed',
    BUTTON_SIZE: 42,
    CHECK_INTERVAL: 2000
  };

  let state = {
    injected: false,
    panelVisible: false,
    generating: false,
    suggestion: null
  };

  // ============================================
  // HELPERS (Robust package: memória + exemplos + prompt completo)
  // ============================================

  function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\u0000/g, '').trim();
  }

  function getActiveChatId() {
    try {
      if (window.Store?.Chat?.getActive) {
        const id = window.Store.Chat.getActive()?.id?._serialized;
        if (safeText(id)) return id;
      }
    } catch (_) {}
    return null;
  }

  function buildTranscriptFromMessages(msgs) {
    if (!Array.isArray(msgs) || msgs.length === 0) return '';
    return msgs
      .filter(m => safeText(m?.content))
      .map(m => `${m.role === 'assistant' ? 'Atendente' : (m.role === 'system' ? 'Sistema' : 'Cliente')}: ${safeText(m.content)}`)
      .join('\n');
  }

  /**
   * Remove a última mensagem do transcript para evitar duplicação
   * @param {string} transcript - Transcript completo
   * @param {string} lastMsg - Última mensagem a remover
   * @returns {string} - Transcript sem a última mensagem
   */
  function removeLastMessageFromTranscript(transcript, lastMsg) {
    if (!transcript || !lastMsg) return transcript;
    
    const normalizedLast = lastMsg.trim().toLowerCase();
    if (normalizedLast.length < 5) return transcript; // Muito curta para comparar
    
    const lines = transcript.split('\n');
    
    // Procurar de trás para frente
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim().toLowerCase();
      // Remover prefixo "Cliente: " ou "Atendente: " antes de comparar
      const cleanLine = line.replace(/^(cliente|atendente):\s*/i, '');
      
      if (cleanLine.includes(normalizedLast) || normalizedLast.includes(cleanLine)) {
        return lines.slice(0, i).join('\n').trim();
      }
    }
    
    return transcript;
  }

  /**
   * Classifica o tipo de erro para decisão inteligente de fallback
   * @param {Error} error - Erro a classificar
   * @returns {string} - Tipo do erro
   */
  function classifyError(error) {
    if (!error) return 'unknown';
    
    const msg = (error.message || '').toLowerCase();
    const code = error.code || error.status || '';
    
    // Erros de rede
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch') ||
        msg.includes('net::') || msg.includes('connection') || msg.includes('offline')) {
      return 'network';
    }
    
    // Timeout
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
      return 'timeout';
    }
    
    // Erros de API (quota, auth, rate limit)
    if (code === 401 || code === 403 || code === 429 || 
        msg.includes('quota') || msg.includes('rate limit') || 
        msg.includes('unauthorized') || msg.includes('api key')) {
      return 'api_error';
    }
    
    // Sem provider configurado
    if (msg.includes('no provider') || msg.includes('provider not configured')) {
      return 'no_provider';
    }
    
    return 'unknown';
  }

  /**
   * Estado de componentes ativos (para UI)
   */
  const activeComponents = {
    kb: false,
    fewShot: false,
    memory: false,
    persona: false
  };

  function getActiveComponents() {
    return { ...activeComponents };
  }

  // Expor para UI
  window.WHLAIComponents = { getActiveComponents };

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
      return '';
    } catch (_) {
      return '';
    }
  }

  function getMemoryForChat(chatId) {
    try {
      const ms = window.memorySystem;
      if (!ms || typeof ms.getChatKey !== 'function' || typeof ms.getMemory !== 'function') return null;

      if (safeText(chatId)) {
        const k1 = ms.getChatKey(chatId);
        const m1 = ms.getMemory(k1);
        if (m1) return m1;
      }

      const title = getChatTitleFromDOM();
      if (safeText(title)) {
        const k2 = ms.getChatKey(title);
        const m2 = ms.getMemory(k2);
        if (m2) return m2;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Obtém memória do chat aguardando inicialização (com timeout).
   * Não quebra o fluxo: se expirar, retorna null.
   */
  async function getMemoryForChatSafe(chatId, timeoutMs = 2000) {
    try {
      // Se já está pronto, usar imediatamente
      if (window.memorySystem?.initialized) {
        return getMemoryForChat(chatId);
      }

      // Tentar iniciar se existir init()
      if (window.memorySystem && typeof window.memorySystem.init === 'function' && !window.memorySystem.initialized) {
        try { await window.memorySystem.init(); } catch (_) {}
      }

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (window.memorySystem?.initialized) {
          return getMemoryForChat(chatId);
        }
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (_) {}
    return null;
  }

  function formatMemoryForPrompt(memory) {
    if (!memory || typeof memory !== 'object') return '';
    const parts = [];
    if (safeText(memory.profile)) parts.push(`Perfil: ${safeText(memory.profile)}`);
    if (Array.isArray(memory.preferences) && memory.preferences.length) {
      parts.push(`Preferências: ${memory.preferences.map(safeText).filter(Boolean).slice(0, 8).join('; ')}`);
    }
    if (Array.isArray(memory.context) && memory.context.length) {
      parts.push(`Contexto confirmado: ${memory.context.map(safeText).filter(Boolean).slice(0, 8).join('; ')}`);
    }
    if (Array.isArray(memory.open_loops) && memory.open_loops.length) {
      parts.push(`Pendências: ${memory.open_loops.map(safeText).filter(Boolean).slice(0, 8).join('; ')}`);
    }
    if (Array.isArray(memory.next_actions) && memory.next_actions.length) {
      parts.push(`Próximas ações: ${memory.next_actions.map(safeText).filter(Boolean).slice(0, 6).join('; ')}`);
    }
    if (safeText(memory.tone)) parts.push(`Tom recomendado: ${safeText(memory.tone)}`);
    const txt = parts.join('\n');
    return txt.length > 900 ? (txt.slice(0, 900) + '...') : txt;
  }

  function buildRobustPromptMessages({ chatId, transcript, lastUserMsg }) {
    const messages = [];

    const baseRules = `Você é um assistente de atendimento no WhatsApp.\nObjetivo: responder rápido, claro, profissional e humano, sem inventar informações.\n\nRegras:\n- Nunca invente dados (preços, prazos, políticas). Se não souber, pergunte objetivamente ou diga que precisa confirmar.\n- Não peça dados sensíveis desnecessários.\n- Leia o histórico e responda à ÚLTIMA mensagem do cliente.\n- Seja direto e útil. Se necessário, use lista curta (máximo 4 itens).\n- Use linguagem natural em pt-BR.\n- Responda SOMENTE com o texto final pronto para enviar (sem markdown, sem explicações).`;

    const systemParts = [baseRules];

    // Persona (se CopilotEngine estiver disponível)
    try {
      const persona = window.CopilotEngine?.getActivePersona?.();
      if (safeText(persona?.systemPrompt)) {
        systemParts.push(`PERSONA (regras extras):\n${safeText(persona.systemPrompt)}`);
      }
    } catch (_) {}

    // Contexto robusto do negócio (KB)
    let kbLoaded = false;
    try {
      if (window.knowledgeBase && typeof window.knowledgeBase.buildSystemPrompt === 'function') {
        const personaId = window.CopilotEngine?.getActivePersona?.()?.id || 'professional';
        const kbPrompt = safeText(window.knowledgeBase.buildSystemPrompt({ persona: personaId, businessContext: true }));
        if (kbPrompt) {
          systemParts.push(`CONTEXTO DO NEGÓCIO (use como verdade):\n${kbPrompt}`);
          kbLoaded = true;
        }
      } else {
        log('⚠️ KnowledgeBase não disponível - FAQs e produtos não serão usados');
        if (window.EventBus) {
          window.EventBus.emit('ai:kb:unavailable', { reason: 'module_not_loaded' });
        }
      }
    } catch (kbError) {
      log('⚠️ Erro ao carregar KnowledgeBase:', kbError.message);
      if (window.EventBus) {
        window.EventBus.emit('ai:kb:error', { error: kbError.message });
      }
    }

    // Memória do contato - preferir memória já carregada; o wait com timeout é feito em generateSuggestion()
    let memory = null;
    try {
      if (window.memorySystem?.initialized) {
        memory = getMemoryForChat(chatId);
      }
    } catch (_) {}
    const memText = formatMemoryForPrompt(memory);
    if (memText) systemParts.push(`MEMÓRIA deste contato:\n${memText}`);

    messages.push({ role: 'system', content: systemParts.filter(Boolean).join('\n\n') });

    // Few-shot (exemplos) para coerência - COM VALIDAÇÃO E WARNING
    let fewShotLoaded = false;
    try {
      const fsl = window.fewShotLearning;
      if (fsl) {
        const picked = fsl?.pickRelevantExamples?.(transcript, 3) || fsl?.pickExamples?.(null, transcript, 3) || [];
        if (Array.isArray(picked) && picked.length) {
          picked.forEach(ex => {
            const u = safeText(ex?.user || ex?.input);
            const a = safeText(ex?.assistant || ex?.output);
            if (u && a) {
              messages.push({ role: 'user', content: u });
              messages.push({ role: 'assistant', content: a });
            }
          });
          fewShotLoaded = true;
        }
      } else {
        log('⚠️ FewShotLearning não disponível - exemplos de treinamento não serão usados');
        if (window.EventBus) {
          window.EventBus.emit('ai:fewshot:unavailable', { reason: 'module_not_loaded' });
        }
      }
    } catch (e) {
      log('⚠️ Erro ao carregar Few-Shot:', e.message);
      if (window.EventBus) {
        window.EventBus.emit('ai:fewshot:error', { error: e.message });
      }
    }
    
    // v7.9.13: Log consolidado de status do treinamento
    if (!kbLoaded && !fewShotLoaded) {
      log('⚠️ ATENÇÃO: Sugestão será gerada SEM treinamento (KB e Few-Shot indisponíveis)');
    }

    // CORREÇÃO v7.9.13: Evitar duplicação usando removeLastMessageFromTranscript
    const cleanTranscript = safeText(transcript);
    const cleanLastMsg = safeText(lastUserMsg);
    
    // Histórico da conversa - removendo a última mensagem para evitar duplicação
    if (cleanTranscript && cleanLastMsg) {
      // Usar a nova função de remoção segura
      const transcriptWithoutLast = removeLastMessageFromTranscript(cleanTranscript, cleanLastMsg);
      
      if (transcriptWithoutLast && transcriptWithoutLast.length > 50) {
        messages.push({ 
          role: 'user', 
          content: `HISTÓRICO (resumo linear):\n${transcriptWithoutLast.slice(-4000)}` 
        });
      }
    } else if (cleanTranscript) {
      // Sem lastUserMsg, usar transcript completo
      messages.push({ 
        role: 'user', 
        content: `HISTÓRICO (resumo linear):\n${cleanTranscript.slice(-4000)}` 
      });
    }

    // Última mensagem do cliente por último (destaque para contexto imediato)
    // Agora SEM duplicação pois foi removida do transcript
    if (cleanLastMsg) {
      messages.push({ role: 'user', content: `ÚLTIMA MENSAGEM DO CLIENTE:\n${cleanLastMsg}` });
    }

    // Atualizar estado de componentes
    activeComponents.kb = kbLoaded;
    activeComponents.fewShot = fewShotLoaded;
    activeComponents.memory = !!memText;
    activeComponents.persona = !!(window.CopilotEngine?.getActivePersona?.());

    return messages;
  }

  // ============================================
  // ESTILOS
  // ============================================

  function injectStyles() {
    if (document.getElementById('whl-ai-btn-styles')) return;

    const style = document.createElement('style');
    style.id = 'whl-ai-btn-styles';
    style.textContent = `
      #${CONFIG.BUTTON_ID} {
        position: absolute;
        bottom: 54px;
        right: 12px;
        width: ${CONFIG.BUTTON_SIZE}px;
        height: ${CONFIG.BUTTON_SIZE}px;
        border-radius: 50%;
        background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
        border: 2px solid rgba(255,255,255,0.2);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 16px rgba(59, 130, 246, 0.5);
        transition: all 0.3s ease;
        z-index: 1000;
        font-size: 20px;
      }

      #${CONFIG.BUTTON_ID}:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 20px rgba(59, 130, 246, 0.6);
      }

      #${CONFIG.BUTTON_ID}:active {
        transform: scale(0.95);
      }

      #${CONFIG.BUTTON_ID}.generating {
        animation: ai-pulse 1.2s ease-in-out infinite;
      }

      @keyframes ai-pulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(59, 130, 246, 0.5); }
        50% { box-shadow: 0 4px 24px rgba(59, 130, 246, 0.8); }
      }

      #${CONFIG.PANEL_ID} {
        position: absolute;
        bottom: 100px;
        right: 12px;
        width: 340px;
        max-height: 250px;
        background: rgba(20, 20, 40, 0.98);
        border: 1px solid rgba(139, 92, 246, 0.4);
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(20px);
        opacity: 0;
        transform: translateY(10px) scale(0.95);
        pointer-events: none;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 999;
        overflow: hidden;
      }

      #${CONFIG.PANEL_ID}.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      .whl-ai-header {
        background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .whl-ai-title {
        color: white;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .whl-ai-close {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .whl-ai-close:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .whl-ai-body {
        padding: 14px;
        color: #e5e7eb;
        font-size: 13px;
        line-height: 1.6;
        max-height: 180px;
        overflow-y: auto;
      }

      .whl-ai-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        gap: 12px;
        color: #9ca3af;
      }

      .whl-ai-spinner {
        width: 22px;
        height: 22px;
        border: 3px solid rgba(59, 130, 246, 0.3);
        border-top-color: #3B82F6;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .whl-ai-suggestion {
        cursor: pointer;
        padding: 12px;
        background: rgba(59, 130, 246, 0.1);
        border-radius: 10px;
        border: 1px solid rgba(59, 130, 246, 0.3);
        transition: all 0.2s;
      }

      .whl-ai-suggestion:hover {
        background: rgba(59, 130, 246, 0.2);
        border-color: rgba(59, 130, 246, 0.5);
      }

      .whl-ai-error {
        color: #f87171;
        text-align: center;
        padding: 24px;
      }

      .whl-ai-hint {
        font-size: 11px;
        color: rgba(255,255,255,0.5);
        text-align: center;
        padding: 8px;
        background: rgba(0,0,0,0.2);
      }
    `;

    document.head.appendChild(style);
  }

  // ============================================
  // CRIAR ELEMENTOS
  // ============================================

  function createButton() {
    const btn = document.createElement('button');
    btn.id = CONFIG.BUTTON_ID;
    btn.innerHTML = '🤖';
    btn.title = 'Gerar Sugestão de IA';
    btn.addEventListener('click', handleClick);
    return btn;
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = CONFIG.PANEL_ID;
    panel.innerHTML = `
      <div class="whl-ai-header">
        <div class="whl-ai-title">
          <span>🤖</span>
          <span>Sugestão de IA</span>
        </div>
        <button class="whl-ai-close" id="whl-ai-close">✕</button>
      </div>
      <div class="whl-ai-body" id="whl-ai-body">
        <div class="whl-ai-loading">
          <div class="whl-ai-spinner"></div>
          <span>Pronto para gerar</span>
        </div>
      </div>
    `;

    panel.querySelector('#whl-ai-close').addEventListener('click', hidePanel);
    return panel;
  }

  // ============================================
  // INJEÇÃO NO DOM
  // ============================================

  function inject() {
    // Remover existentes
    document.getElementById(CONFIG.BUTTON_ID)?.remove();
    document.getElementById(CONFIG.PANEL_ID)?.remove();

    // Encontrar footer do WhatsApp
    const footerSelectors = [
      '#main footer',
      'footer[data-testid]',
      '#main > div:last-child',
      'footer'
    ];

    let footer = null;
    for (const sel of footerSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth) {
        footer = el;
        log('Footer encontrado:', sel);
        break;
      }
    }

    // Fallback: encontrar via input
    if (!footer) {
      const input = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                    document.querySelector('footer div[contenteditable="true"]');
      if (input) {
        footer = input.closest('footer') || input.closest('#main')?.querySelector('div:last-child');
      }
    }

    if (!footer) {
      log('Footer não encontrado');
      return false;
    }

    // Garantir position relative
    if (window.getComputedStyle(footer).position === 'static') {
      footer.style.position = 'relative';
    }

    // Injetar
    injectStyles();
    footer.appendChild(createButton());
    footer.appendChild(createPanel());

    state.injected = true;
    log('✅ Botão de IA injetado');
    return true;
  }

  // ============================================
  // HANDLERS
  // ============================================

  async function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (state.panelVisible) {
      hidePanel();
    } else {
      await generateSuggestion();
    }
  }

  async function generateSuggestion() {
    if (state.generating) return;

    state.generating = true;
    showPanel();
    showLoading('Analisando conversa...');

    const btn = document.getElementById(CONFIG.BUTTON_ID);
    if (btn) btn.classList.add('generating');

    try {
      // Extrair mensagens do DOM
      const messages = extractMessages();

      if (messages.length === 0) {
        showError('Nenhuma mensagem encontrada');
        return;
      }

      const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
      let suggestion = null;

      // ChatKey consistente (id do WhatsApp quando disponível, senão título)
      const chatId = getActiveChatId();
      const chatKey = safeText(chatId) || safeText(getChatTitleFromDOM()) || 'active_chat';
      const transcript = buildTranscriptFromMessages(messages);

      // Atualizar memória rapidamente (não bloqueante)
      try {
        const autoMem = window.MemorySystem?.autoUpdateMemory || window.autoUpdateMemory;
        if (typeof autoMem === 'function' && safeText(transcript).length >= 60) {
          autoMem(transcript, chatKey, 150);
        }
      } catch (_) {}

      const hasProviders = window.AIService?.getConfiguredProviders?.()?.length > 0;

      // v7.9.13: Garantir que a memória tenha chance de carregar antes de montar prompt robusto
      // (não trava: timeout curto)
      try {
        await getMemoryForChatSafe(chatKey, 2000);
      } catch (_) {}

      // MÉTODO 1 (PRIORIDADE): CopilotEngine (robusto: memória + exemplos + prompt completo)
      if (!suggestion && hasProviders && window.CopilotEngine?.analyzeMessage && window.CopilotEngine?.generateResponse) {
        try {
          // Garantir contexto atualizado no CopilotEngine
          if (window.CopilotEngine.loadConversationContext) {
            await window.CopilotEngine.loadConversationContext(chatKey, true);
          }

          const analysis = await window.CopilotEngine.analyzeMessage(lastUserMsg, chatKey);
          const resp = await window.CopilotEngine.generateResponse(chatKey, analysis, { maxTokens: 260 });
          if (resp?.content) {
            suggestion = resp.content.trim();
            log('✅ Sugestão via CopilotEngine (robusto)');
          }
        } catch (e) {
          log('CopilotEngine falhou:', e);
        }
      }

      // MÉTODO 2: AIService direto com prompt robusto (fallback)
      if (!suggestion && hasProviders && window.AIService?.complete) {
        try {
          const promptMessages = buildRobustPromptMessages({ chatId: chatKey, transcript, lastUserMsg });
          const result = await window.AIService.complete(promptMessages, {
            temperature: 0.7,
            maxTokens: 260
          });
          if (result?.content) {
            suggestion = result.content.trim();
            log('✅ Sugestão via AIService (prompt robusto)');
          }
        } catch (e) {
          log('AIService (robusto) falhou:', e);
        }
      }

      // MÉTODO 3: SmartSuggestions (local, sem API) — somente se não houver IA
      if (!suggestion && window.SmartSuggestions?.getSuggestion) {
        try {
          const result = window.SmartSuggestions.getSuggestion(lastUserMsg, messages);
          if (result?.text) {
            suggestion = result.text;
            log('✅ Sugestão via SmartSuggestions:', result.category);
          }
        } catch (e) {
          log('SmartSuggestions falhou:', e);
        }
      }

      // MÉTODO 4: BackendClient
      if (!suggestion && window.BackendClient?.isConnected?.()) {
        try {
          const result = await window.BackendClient.ai.chat({
            messages: [
              { role: 'system', content: 'Você é um assistente de atendimento profissional. Gere respostas úteis e concisas em português.' },
              { role: 'user', content: `Última mensagem do cliente: ${lastUserMsg}\n\nGere uma resposta profissional.` }
            ]
          });
          if (result?.text) {
            suggestion = result.text.trim();
            log('✅ Sugestão via BackendClient');
          }
        } catch (e) {
          log('BackendClient falhou:', e);
        }
      }

      // MÉTODO 5: Decisão inteligente sobre fallback vs erro
      // v7.9.13: Usar classifyError para decisão mais precisa
      if (!suggestion) {
        if (hasProviders) {
          // Providers configurados mas todos falharam - mostrar erro com retry
          log('❌ Todos os providers de IA falharam');
          
          // Mostrar UI de erro com opção de retry
          showErrorWithRetry('IA temporariamente indisponível', lastUserMsg);
          
          // Emitir evento para UI
          if (window.EventBus) {
            window.EventBus.emit('ai:all-providers-failed', { chatKey, lastUserMsg });
          }
          return;
        } else {
          // Nenhum provider configurado - usar fallback local (esperado)
          suggestion = generateFallbackSuggestion(lastUserMsg);
          log('✅ Sugestão via fallback local (sem providers configurados)');
        }
      }

      if (suggestion) {
        showSuggestion(suggestion);
      } else {
        showError('Não foi possível gerar sugestão');
      }

    } catch (error) {
      console.error('[AI-Btn] Erro:', error);
      // Usar fallback em caso de erro
      const lastMsg = extractMessages().filter(m => m.role === 'user').pop()?.content || '';
      const fallback = generateFallbackSuggestion(lastMsg);
      showSuggestion(fallback);
    } finally {
      state.generating = false;
      const btn = document.getElementById(CONFIG.BUTTON_ID);
      if (btn) btn.classList.remove('generating');
    }
  }

  function buildPrompt(context, lastMsg) {
    return `Você é um assistente de atendimento profissional e amigável. Baseado na conversa abaixo, gere UMA resposta apropriada para a última mensagem do cliente.

CONVERSA:
${context}

ÚLTIMA MENSAGEM DO CLIENTE: ${lastMsg}

INSTRUÇÕES:
- Seja profissional mas cordial
- Responda em português brasileiro
- Máximo 2-3 frases
- Não use saudações se a conversa já começou
- Seja útil e objetivo

Responda APENAS com o texto da sugestão:`;
  }

  function generateFallbackSuggestion(msg) {
    const lower = (msg || '').toLowerCase();

    // Saudações
    if (lower.match(/\b(oi|olá|ola|bom dia|boa tarde|boa noite|eai|e ai|hey|opa)\b/)) {
      return 'Olá! Como posso ajudar você hoje? 😊';
    }
    
    // Agradecimentos
    if (lower.match(/\b(obrigad|valeu|thanks|brigad|grato|agradec)\b/)) {
      return 'Por nada! Se precisar de mais alguma coisa, estou à disposição 😊';
    }
    
    // Preço/valor
    if (lower.match(/\b(preço|preco|valor|quanto custa|quanto é|quanto e|custo|orçamento|orcamento)\b/)) {
      return 'O valor varia de acordo com o produto/serviço escolhido. Posso detalhar as opções disponíveis para você. Qual item específico gostaria de saber?';
    }
    
    // Entrega/prazo
    if (lower.match(/\b(entrega|prazo|envio|chega|demora|tempo|frete)\b/)) {
      return 'O prazo de entrega é de 5 a 7 dias úteis após confirmação do pagamento. Para sua região, posso verificar opções mais rápidas se preferir.';
    }
    
    // Pagamento
    if (lower.match(/\b(pix|pagamento|pagar|cartão|cartao|boleto|parcel)\b/)) {
      return 'Aceitamos PIX (com desconto), cartão de crédito em até 12x e boleto bancário. Qual forma de pagamento prefere?';
    }
    
    // Disponibilidade
    if (lower.match(/\b(disponível|disponivel|tem|estoque|ainda tem|acabou)\b/)) {
      return 'Vou verificar a disponibilidade para você. Um momento, por favor!';
    }
    
    // Dúvidas/ajuda
    if (lower.match(/\b(dúvida|duvida|ajuda|help|não sei|nao sei|como funciona)\b/)) {
      return 'Claro, estou aqui para ajudar! Pode me explicar melhor sua dúvida que respondo com prazer.';
    }
    
    // Problema/reclamação
    if (lower.match(/\b(problema|erro|não funciona|nao funciona|defeito|quebr|estrago)\b/)) {
      return 'Lamento pelo inconveniente! Vou verificar isso imediatamente. Pode me dar mais detalhes sobre o problema?';
    }
    
    // Espera/aguardar
    if (lower.match(/\b(espera|aguard|demora|responde|online)\b/)) {
      return 'Desculpe pela espera! Estou verificando sua solicitação e já retorno com uma resposta.';
    }
    
    // Tchau/encerramento
    if (lower.match(/\b(tchau|adeus|até mais|ate mais|obg|flw|falou|bye)\b/)) {
      return 'Foi um prazer atendê-lo! Qualquer coisa, estamos à disposição. Tenha um ótimo dia! 😊';
    }
    
    // Horário
    if (lower.match(/\b(horário|horario|funciona|atend|abre|fecha)\b/)) {
      return 'Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Aos sábados das 9h às 13h.';
    }
    
    // Localização
    if (lower.match(/\b(endereço|endereco|onde fica|localiza|mapa)\b/)) {
      return 'Posso enviar nossa localização. Você prefere retirar pessoalmente ou prefere que façamos a entrega?';
    }

    // Fallback genérico baseado no tipo de pergunta
    if (lower.includes('?')) {
      return 'Entendi sua dúvida. Deixa eu verificar isso e já te respondo com mais detalhes.';
    }

    // Fallback final
    return 'Entendi! Posso ajudar com mais alguma informação?';
  }

  // ============================================
  // EXTRAÇÃO DE MENSAGENS
  // ============================================

  function extractMessages() {
    const messages = [];

    try {
      // Encontrar container de mensagens
      const containerSelectors = [
        '[data-testid="conversation-panel-messages"]',
        'div[data-testid="msg-container"]',
        '#main div[role="application"]',
        '#main .copyable-area'
      ];

      let container = null;
      for (const sel of containerSelectors) {
        container = document.querySelector(sel);
        if (container) break;
      }

      if (!container) {
        container = document.querySelector('#main');
      }

      if (!container) return messages;

      // Buscar mensagens (inclui mensagens de sistema)
      const msgElements = container.querySelectorAll(
        '[data-testid="msg-container"], .message-in, .message-out, .message-system, [data-testid*="system-message"]'
      );

      const isSystemMessage = (el) => {
        try {
          if (el.classList?.contains('message-system')) return true;
          const testId = (el.getAttribute && el.getAttribute('data-testid')) ? el.getAttribute('data-testid') : '';
          if (testId && testId.toLowerCase().includes('system')) return true;
          if (el.querySelector?.('[data-testid*="system-message"]')) return true;
        } catch (_) {}
        return false;
      };

      const extractSystemMessageText = (el) => {
        try {
          const selectors = [
            '[data-testid="system-message-text"]',
            '[data-testid*="system-message"]',
            '.copyable-text span',
            'span.selectable-text',
            'span[dir="ltr"]'
          ];
          for (const sel of selectors) {
            const t = el.querySelector?.(sel)?.textContent?.trim();
            if (t) return t;
          }
          const raw = el.textContent?.trim();
          return raw || '';
        } catch (_) {
          return '';
        }
      };

      const detectNonTextType = (el) => {
        try {
          if (el.querySelector('video')) return 'video';
          if (el.querySelector('audio') || el.querySelector('[data-testid*="audio"]')) return 'audio';
          if (el.querySelector('[data-testid*="ptt"]') || el.querySelector('[data-icon*="ptt"]')) return 'ptt';
          if (el.querySelector('[data-testid*="sticker"]') || el.querySelector('img[alt*="sticker" i]')) return 'sticker';
          if (el.querySelector('[data-testid*="document"]') || el.querySelector('[data-icon*="document"]')) return 'document';
          // Imagem genérica (muito comum em mídia/sticker)
          if (el.querySelector('img')) return 'image';
        } catch (_) {}
        return null;
      };

      const placeholderForType = (type) => {
        switch (type) {
          case 'image': return '[MÍDIA: imagem]';
          case 'video': return '[MÍDIA: vídeo]';
          case 'audio': return '[MÍDIA: áudio]';
          case 'ptt': return '[MÍDIA: áudio (PTT)]';
          case 'sticker': return '[MÍDIA: figurinha]';
          case 'document': return '[MÍDIA: documento]';
          default: return '[MÍDIA]';
        }
      };

      for (const el of msgElements) {
        // Mensagens de sistema
        if (isSystemMessage(el)) {
          const sysText = extractSystemMessageText(el);
          if (sysText) {
            messages.push({ role: 'system', content: `[SISTEMA: ${sysText}]` });
          }
          continue;
        }

        // Detectar se é mensagem enviada ou recebida
        const isOutgoing = el.classList.contains('message-out') ||
                          el.querySelector('[data-testid="msg-dblcheck"]') ||
                          el.querySelector('[data-icon="msg-dblcheck"]') ||
                          el.querySelector('[data-icon="msg-check"]') ||
                          el.querySelector('[data-icon="tail-out"]');

        // Extrair texto
        const textEl = el.querySelector('[data-testid="msg-text"], .copyable-text span, .selectable-text span, span.selectable-text');
        const text = textEl?.textContent?.trim();

        if (text && text.length > 0) {
          messages.push({
            role: isOutgoing ? 'assistant' : 'user',
            content: text
          });
        } else {
          // Se a última mensagem for mídia/áudio/figurinha sem texto, incluir placeholder
          const mediaType = detectNonTextType(el);
          if (mediaType) {
            messages.push({
              role: isOutgoing ? 'assistant' : 'user',
              content: placeholderForType(mediaType)
            });
          }
        }
      }

      // Limitar a últimas 20 mensagens
      if (messages.length > 20) {
        return messages.slice(-20);
      }

      log(`Extraídas ${messages.length} mensagens`);
    } catch (e) {
      console.error('[AI-Btn] Erro ao extrair:', e);
    }

    return messages;
  }

  // ============================================
  // UI DO PAINEL
  // ============================================

  function showPanel() {
    const panel = document.getElementById(CONFIG.PANEL_ID);
    if (panel) {
      panel.classList.add('visible');
      state.panelVisible = true;
    }
  }

  function hidePanel() {
    const panel = document.getElementById(CONFIG.PANEL_ID);
    if (panel) {
      panel.classList.remove('visible');
      state.panelVisible = false;
    }
  }

  function showLoading(text = 'Gerando...') {
    const body = document.getElementById('whl-ai-body');
    if (!body) return;

    body.innerHTML = `
      <div class="whl-ai-loading">
        <div class="whl-ai-spinner"></div>
        <span>${text}</span>
      </div>
    `;
  }

  function showSuggestion(text) {
    const body = document.getElementById('whl-ai-body');
    if (!body) return;

    state.suggestion = text;

    body.innerHTML = `
      <div class="whl-ai-suggestion" id="whl-ai-sug-text">
        ${escapeHtml(text)}
      </div>
      <div class="whl-ai-hint">
        Clique para inserir no chat
      </div>
    `;

    body.querySelector('#whl-ai-sug-text').addEventListener('click', useSuggestion);
  }

  function showError(message) {
    const body = document.getElementById('whl-ai-body');
    if (!body) return;

    body.innerHTML = `
      <div class="whl-ai-error">
        <div style="font-size: 24px; margin-bottom: 8px;">❌</div>
        <div>${escapeHtml(message)}</div>
      </div>
    `;
  }

  /**
   * Mostra erro com opções de retry e fallback
   * @param {string} message - Mensagem de erro
   * @param {string} lastUserMsg - Última mensagem do usuário para fallback
   */
  function showErrorWithRetry(message, lastUserMsg) {
    const body = document.getElementById('whl-ai-body');
    if (!body) return;

    body.innerHTML = `
      <div style="padding: 16px; text-align: center;">
        <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
        <div style="color: #EF4444; margin-bottom: 16px; font-size: 14px;">${escapeHtml(message)}</div>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button id="whl-ai-retry" style="
            background: #3B82F6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
          ">🔄 Tentar Novamente</button>
          <button id="whl-ai-use-fallback" style="
            background: #6B7280;
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
          ">Usar Sugestão Básica</button>
        </div>
      </div>
    `;

    // Handler para retry
    document.getElementById('whl-ai-retry')?.addEventListener('click', () => {
      generateSuggestion();
    });

    // Handler para usar fallback
    document.getElementById('whl-ai-use-fallback')?.addEventListener('click', () => {
      const fallback = generateFallbackSuggestion(lastUserMsg);
      showSuggestion(fallback);
    });
  }

  async function useSuggestion() {
    if (!state.suggestion) return;

    try {
      await insertText(state.suggestion);
      hidePanel();

      if (window.NotificationsModule?.toast) {
        window.NotificationsModule.toast('✅ Sugestão inserida', 'success', 1500);
      }
      
      // Registrar uso de sugestão no ConfidenceSystem
      if (window.confidenceSystem?.recordSuggestionUsed) {
        window.confidenceSystem.recordSuggestionUsed(false);
      }
    } catch (e) {
      console.error('[AI-Btn] Erro ao inserir:', e);
    }
  }

  async function insertText(text) {
    const composer = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                     document.querySelector('footer div[contenteditable="true"][data-lexical-editor="true"]') ||
                     document.querySelector('footer div[contenteditable="true"]');

    if (!composer) throw new Error('Campo de mensagem não encontrado');

    composer.focus();
    await sleep(50);

    // Limpar campo antes de digitar
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await sleep(30);
    } catch (_) {
      composer.textContent = '';
    }

    // Usar digitação humana se disponível
    if (window.HumanTyping?.type) {
      try {
        log('Usando HumanTyping para digitação...');
        await window.HumanTyping.type(composer, text, {
          minDelay: 18,
          maxDelay: 45,
          chunkSize: 2
        });
        composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return;
      } catch (e) {
        log('HumanTyping falhou, usando fallback:', e.message);
      }
    }

    // Fallback: inserção direta
    try {
      document.execCommand('insertText', false, text);
    } catch (_) {
      composer.textContent = text;
    }

    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  let checkInterval = null;

  function init() {
    log('Inicializando AI Suggestion Button...');

    // Verificar periodicamente se precisa reinjetar
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(() => {
      const btn = document.getElementById(CONFIG.BUTTON_ID);
      const footer = document.querySelector('#main footer');

      if (footer && !btn) {
        inject();
      }
    }, CONFIG.CHECK_INTERVAL);

    // Primeira tentativa
    setTimeout(() => {
      if (!state.injected) {
        inject();
      }
    }, 2000);
  }

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });

  // Expor API
  window.AISuggestionFixed = {
    init,
    inject,
    generateSuggestion
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  log('Módulo AI Suggestion Button carregado');
})();
