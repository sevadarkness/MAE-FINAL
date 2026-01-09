/**
 * 📨 Message Capture System - Pilar 1 do Aprendizado Contínuo
 * WhatsHybrid v7.10.0
 * 
 * Sistema unificado de captura de mensagens do WhatsApp Web.
 * Captura todas as mensagens (enviadas, recebidas, apagadas, editadas)
 * e envia para o backend para aprendizado contínuo.
 * 
 * Funcionalidades:
 * - Hook de eventos do WhatsApp Web (Store.Msg)
 * - Captura de mensagens via MutationObserver
 * - Normalização de dados (quem falou, contexto, grupo, reply, mídia)
 * - Envio em batch para o backend
 * - Fila offline com retry
 * - Integração com EventBus
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const CONFIG = {
    // Configuração de envio
    BATCH_SIZE: 10,           // Mensagens por batch
    FLUSH_INTERVAL: 30000,    // Intervalo de flush (30s)
    MAX_QUEUE_SIZE: 500,      // Máximo de mensagens na fila
    
    // Retry
    MAX_RETRIES: 3,
    RETRY_DELAY: 5000,
    
    // Storage
    STORAGE_KEY: 'whl_message_queue',
    SETTINGS_KEY: 'whl_capture_settings'
  };

  // Estado interno
  const state = {
    queue: [],
    isProcessing: false,
    initialized: false,
    settings: {
      enabled: true,
      captureIncoming: true,
      captureOutgoing: true,
      captureDeleted: true,
      captureEdited: true,
      captureMedia: true,
      syncWithBackend: true
    },
    stats: {
      captured: 0,
      sent: 0,
      failed: 0,
      lastSync: null
    }
  };

  // Referências
  let flushInterval = null;
  let storeObserver = null;
  let domObserver = null;

  /**
   * Inicializa o sistema de captura
   */
  async function init() {
    if (state.initialized) return;

    console.log('[MessageCapture] 🚀 Inicializando sistema de captura...');

    // Carregar configurações
    await loadSettings();

    // Carregar fila persistida
    await loadQueue();

    // Configurar hooks do WhatsApp
    setupWhatsAppHooks();

    // Configurar MutationObserver como fallback
    setupDOMObserver();

    // Iniciar intervalo de flush
    if (flushInterval) clearInterval(flushInterval);
    flushInterval = setInterval(flushQueue, CONFIG.FLUSH_INTERVAL);

    // Listener para fechamento da página
    window.addEventListener('beforeunload', () => {
      saveQueue();
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
      if (domObserver) {
        try { domObserver.disconnect(); } catch (_) {}
        domObserver = null;
      }
      if (storeObserver && typeof storeObserver.disconnect === 'function') {
        try { storeObserver.disconnect(); } catch (_) {}
        storeObserver = null;
      }
    });

    // Integrar com EventBus
    if (window.EventBus) {
      window.EventBus.on('message:send', handleOutgoingMessage);
      window.EventBus.on('message:received', handleIncomingMessage);
    }

    state.initialized = true;
    console.log('[MessageCapture] ✅ Sistema inicializado');
  }

  /**
   * Carrega configurações do storage
   */
  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get(CONFIG.SETTINGS_KEY);
      if (data[CONFIG.SETTINGS_KEY]) {
        state.settings = { ...state.settings, ...data[CONFIG.SETTINGS_KEY] };
      }
    } catch (e) {
      console.warn('[MessageCapture] Erro ao carregar settings:', e);
    }
  }

  /**
   * Salva configurações
   */
  async function saveSettings() {
    try {
      await chrome.storage.local.set({
        [CONFIG.SETTINGS_KEY]: state.settings
      });
    } catch (e) {
      console.warn('[MessageCapture] Erro ao salvar settings:', e);
    }
  }

  /**
   * Carrega fila do storage (para continuar após reload)
   */
  async function loadQueue() {
    try {
      const data = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      if (data[CONFIG.STORAGE_KEY]) {
        state.queue = JSON.parse(data[CONFIG.STORAGE_KEY]);
        console.log('[MessageCapture] Fila carregada:', state.queue.length, 'mensagens');
      }
    } catch (e) {
      state.queue = [];
    }
  }

  /**
   * Salva fila no storage
   */
  async function saveQueue() {
    try {
      await chrome.storage.local.set({
        [CONFIG.STORAGE_KEY]: JSON.stringify(state.queue.slice(-CONFIG.MAX_QUEUE_SIZE))
      });
    } catch (e) {
      console.warn('[MessageCapture] Erro ao salvar fila:', e);
    }
  }

  /**
   * Configura hooks do WhatsApp via Store
   */
  function setupWhatsAppHooks() {
    // Aguardar Store estar disponível
    const checkStore = () => {
      if (window.Store?.Msg) {
        console.log('[MessageCapture] 📡 Store.Msg detectado, configurando hooks...');
        
        // Hook para novas mensagens
        if (window.Store.Msg.on) {
          window.Store.Msg.on('add', (msg) => {
            try {
              const normalized = normalizeStoreMessage(msg);
              if (normalized) {
                captureMessage(normalized);
              }
            } catch (e) {
              console.warn('[MessageCapture] Erro ao processar mensagem:', e);
            }
          });
          console.log('[MessageCapture] ✅ Hook Store.Msg.add configurado');
        }

        // Hook para mensagens modificadas (editadas, apagadas)
        if (window.Store.Msg.on) {
          window.Store.Msg.on('change', (msg) => {
            try {
              if (msg.isRevoked || msg.type === 'revoked') {
                const normalized = normalizeStoreMessage(msg);
                if (normalized) {
                  normalized.action = 'revoked';
                  captureMessage(normalized);
                }
              }
            } catch (e) {
              console.warn('[MessageCapture] Erro ao processar mudança:', e);
            }
          });
        }

        return true;
      }
      return false;
    };

    // Tentar imediatamente
    if (!checkStore()) {
      // Tentar novamente após delays
      [1000, 3000, 5000, 10000].forEach(delay => {
        setTimeout(checkStore, delay);
      });
    }
  }

  /**
   * Configura MutationObserver como fallback/complemento
   */
  function setupDOMObserver() {
    const targetNode = document.querySelector('#main, #pane-side');
    if (!targetNode) {
      // Tentar novamente após delay
      setTimeout(setupDOMObserver, 2000);
      return;
    }

    if (domObserver) {
      try { domObserver.disconnect(); } catch (_) {}
      domObserver = null;
    }

    domObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Detectar containers de mensagem
              const msgContainers = node.querySelectorAll ?
                node.querySelectorAll('[data-testid="msg-container"]') : [];
              
              msgContainers.forEach(container => {
                const msgData = extractMessageFromDOM(container);
                if (msgData) {
                  captureMessage(msgData);
                }
              });
            }
          }
        }
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[MessageCapture] 👁️ MutationObserver configurado');
  }

  /**
   * Normaliza mensagem do Store para formato padrão
   */
  function normalizeStoreMessage(msg) {
    if (!msg) return null;

    // Extrair chatId
    let chatId = '';
    try {
      chatId = msg.id?.remote?._serialized || 
               msg.id?.remote?.toString?.() || 
               msg.chat?.id?._serialized ||
               msg.from?._serialized ||
               msg.to?._serialized ||
               '';
    } catch (e) {
      chatId = '';
    }

    // Extrair conteúdo
    let body = '';
    try {
      body = msg.body || msg.text || msg.caption || '';
      if (typeof body !== 'string') body = '';
    } catch (e) {
      body = '';
    }

    // Se não tem conteúdo nem chatId, ignorar
    if (!body && !chatId) return null;

    // Detectar tipo de mensagem
    let type = 'text';
    if (msg.type) {
      type = msg.type;
    } else if (msg.mimetype) {
      if (msg.mimetype.includes('image')) type = 'image';
      else if (msg.mimetype.includes('video')) type = 'video';
      else if (msg.mimetype.includes('audio')) type = 'audio';
      else if (msg.mimetype.includes('document') || msg.mimetype.includes('pdf')) type = 'document';
    }

    // Determinar se é mensagem própria
    const isFromMe = msg.id?.fromMe || msg.fromMe || false;

    // Extrair informações do remetente
    let sender = '';
    try {
      if (isFromMe) {
        sender = 'me';
      } else {
        sender = msg.author?._serialized || 
                 msg.from?._serialized?.replace(/@c\.us|@s\.whatsapp\.net/g, '') || 
                 msg.notifyName ||
                 msg.senderName ||
                 '';
      }
    } catch (e) {
      sender = '';
    }

    // Extrair nome do contato
    let contactName = '';
    try {
      contactName = msg.chat?.contact?.pushname || 
                    msg.chat?.contact?.name ||
                    msg.chat?.name ||
                    msg.notifyName ||
                    '';
    } catch (e) {
      contactName = '';
    }

    // Verificar se é grupo
    let groupName = null;
    try {
      if (chatId.includes('@g.us') || msg.isGroup) {
        groupName = msg.chat?.name || '';
      }
    } catch (e) {
      groupName = null;
    }

    // Verificar reply
    let replyTo = null;
    try {
      if (msg.quotedMsg || msg.quotedMsgId) {
        replyTo = {
          id: msg.quotedMsgId || msg.quotedMsg?.id?.id,
          body: msg.quotedMsg?.body || ''
        };
      }
    } catch (e) {
      replyTo = null;
    }

    return {
      id: msg.id?.id || msg.id?._serialized || Date.now().toString(),
      chatId,
      message: body,
      sender,
      contactName,
      groupName,
      type,
      isFromMe,
      replyTo,
      mediaType: msg.mimetype || null,
      timestamp: msg.t ? msg.t * 1000 : Date.now(),
      action: msg.isRevoked ? 'revoked' : 'new'
    };
  }

  /**
   * Extrai dados de mensagem do DOM
   */
  function extractMessageFromDOM(container) {
    if (!container) return null;

    try {
      // Extrair texto
      const textEl = container.querySelector('.selectable-text, [data-testid="msg-text"]');
      const body = textEl?.innerText || textEl?.textContent || '';

      if (!body.trim()) return null;

      // Determinar se é mensagem enviada
      const isFromMe = !!container.querySelector('[data-testid="msg-dblcheck"], [data-testid="msg-check"]');

      // Extrair chatId do data-id
      const dataId = container.getAttribute('data-id') || '';
      const chatIdMatch = dataId.match(/^(?:true|false)_([^_]+)_/);
      const chatId = chatIdMatch ? chatIdMatch[1] : '';

      if (!chatId) return null;

      return {
        id: dataId.split('_').pop() || Date.now().toString(),
        chatId,
        message: body,
        sender: isFromMe ? 'me' : 'user',
        contactName: '',
        groupName: null,
        type: 'text',
        isFromMe,
        replyTo: null,
        mediaType: null,
        timestamp: Date.now(),
        action: 'new',
        source: 'dom'
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Handler para mensagens recebidas (via EventBus)
   */
  function handleIncomingMessage(data) {
    if (!state.settings.captureIncoming) return;

    const normalized = {
      id: data.id || data.msgId || Date.now().toString(),
      chatId: data.chatId || data.chat || '',
      message: data.message || data.body || data.text || '',
      sender: data.sender || data.from || 'user',
      contactName: data.contactName || data.notifyName || '',
      groupName: data.groupName || null,
      type: data.type || 'text',
      isFromMe: false,
      replyTo: data.replyTo || null,
      mediaType: data.mediaType || null,
      timestamp: data.timestamp || Date.now(),
      action: 'new'
    };

    captureMessage(normalized);
  }

  /**
   * Handler para mensagens enviadas (via EventBus)
   */
  function handleOutgoingMessage(data) {
    if (!state.settings.captureOutgoing) return;

    const normalized = {
      id: data.id || data.msgId || Date.now().toString(),
      chatId: data.chatId || data.chat || data.to || '',
      message: data.message || data.body || data.text || '',
      sender: 'me',
      contactName: '',
      groupName: null,
      type: data.type || 'text',
      isFromMe: true,
      replyTo: null,
      mediaType: null,
      timestamp: data.timestamp || Date.now(),
      action: 'new'
    };

    captureMessage(normalized);
  }

  /**
   * Captura e enfileira mensagem para envio
   */
  function captureMessage(msgData) {
    if (!state.settings.enabled) return;
    if (!msgData || !msgData.chatId) return;

    // Verificar duplicatas (por id)
    const exists = state.queue.some(m => m.id === msgData.id);
    if (exists) return;

    // Adicionar à fila
    state.queue.push(msgData);
    state.stats.captured++;

    // Limitar tamanho da fila
    if (state.queue.length > CONFIG.MAX_QUEUE_SIZE) {
      state.queue = state.queue.slice(-CONFIG.MAX_QUEUE_SIZE);
    }

    // Emitir evento local
    if (window.EventBus) {
      window.EventBus.emit('capture:message', msgData);
    }

    // Flush se batch cheio
    if (state.queue.length >= CONFIG.BATCH_SIZE) {
      flushQueue();
    }

    console.log('[MessageCapture] 📩 Mensagem capturada:', msgData.id?.substring(0, 8) || '?');
  }

  /**
   * Envia mensagens em batch para o backend
   */
  async function flushQueue() {
    if (state.isProcessing || state.queue.length === 0) return;
    if (!state.settings.syncWithBackend) {
      // Apenas salvar localmente
      await saveQueue();
      return;
    }

    state.isProcessing = true;

    try {
      // Pegar batch
      const batch = state.queue.splice(0, CONFIG.BATCH_SIZE);

      // Obter configurações do backend (compat: múltiplos schemas)
      const settings = await chrome.storage.local.get([
        'backend_token',
        'backend_url',
        'whl_backend_config',
        'whl_backend_client'
      ]);

      const cfg = settings?.whl_backend_config || null;
      let backendUrl = cfg?.url || null;
      let token = cfg?.token || null;

      if ((!backendUrl || !token) && settings?.whl_backend_client) {
        try {
          const parsed = JSON.parse(settings.whl_backend_client);
          backendUrl = backendUrl || parsed?.baseUrl || null;
          token = token || parsed?.accessToken || null;
        } catch (_) {}
      }

      backendUrl = String(backendUrl || settings?.backend_url || 'http://localhost:3000').replace(/\/$/, '');
      token = token || settings?.backend_token || null;

      if (!token) {
        // Sem token, manter na fila local
        state.queue.unshift(...batch);
        console.log('[MessageCapture] ⚠️ Backend não configurado, mantendo local');
        await saveQueue();
        state.isProcessing = false;
        return;
      }

      // Enviar cada mensagem
      let successCount = 0;
      for (const msg of batch) {
        try {
          const response = await fetch(`${backendUrl}/api/v1/ai/learn/ingest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(msg)
          });

          if (response.ok) {
            successCount++;
            state.stats.sent++;
          } else {
            state.stats.failed++;
            // Re-enfileirar mensagens com falha (se não for erro 4xx)
            if (response.status >= 500) {
              state.queue.push(msg);
            }
          }
        } catch (e) {
          state.stats.failed++;
          state.queue.push(msg); // Re-enfileirar para retry
        }
      }

      state.stats.lastSync = Date.now();
      console.log(`[MessageCapture] 📤 Batch enviado: ${successCount}/${batch.length} sucesso`);

      // Salvar fila atualizada
      await saveQueue();

    } catch (error) {
      console.error('[MessageCapture] ❌ Erro no flush:', error);
    }

    state.isProcessing = false;
  }

  /**
   * Força sincronização imediata
   */
  async function syncNow() {
    await flushQueue();
    return {
      queued: state.queue.length,
      stats: state.stats
    };
  }

  /**
   * Atualiza configurações
   */
  function configure(options) {
    state.settings = { ...state.settings, ...options };
    saveSettings();
    console.log('[MessageCapture] ⚙️ Configurações atualizadas');
  }

  /**
   * Retorna estatísticas
   */
  function getStats() {
    return {
      ...state.stats,
      queued: state.queue.length,
      settings: state.settings
    };
  }

  /**
   * Limpa fila
   */
  async function clearQueue() {
    state.queue = [];
    await saveQueue();
    console.log('[MessageCapture] 🧹 Fila limpa');
  }

  /**
   * Para o sistema de captura
   */
  function stop() {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    if (domObserver) {
      try { domObserver.disconnect(); } catch (_) {}
      domObserver = null;
    }
    if (storeObserver && typeof storeObserver.disconnect === 'function') {
      try { storeObserver.disconnect(); } catch (_) {}
      storeObserver = null;
    }
    state.settings.enabled = false;
    saveSettings();
    console.log('[MessageCapture] ⏹️ Sistema parado');
  }

  /**
   * Reinicia o sistema
   */
  function start() {
    state.settings.enabled = true;
    saveSettings();
    
    if (!flushInterval) {
      flushInterval = setInterval(flushQueue, CONFIG.FLUSH_INTERVAL);
    }
    
    console.log('[MessageCapture] ▶️ Sistema iniciado');
  }

  // ============================================
  // EXPORT
  // ============================================
  window.MessageCapture = {
    init,
    configure,
    captureMessage,
    syncNow,
    getStats,
    clearQueue,
    start,
    stop
  };

  // Auto-inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Delay para garantir que outros módulos carregaram
    setTimeout(init, 1000);
  }

  console.log('[MessageCapture] 📦 Módulo carregado');

})();
