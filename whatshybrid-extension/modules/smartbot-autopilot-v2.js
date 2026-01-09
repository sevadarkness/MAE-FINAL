/**
 * WhatsHybrid Autopilot v7.6.0
 * Correção completa do sistema de resposta automática
 * + Integração com ConfidenceSystem
 * + Digitação humana aprimorada
 */
(function() {
  'use strict';

  const CONFIG = {
    enabled: false,
    delay: { min: 2000, max: 5000 },
    typingDelay: { min: 25, max: 65 },
    maxQueue: 50,
    processedKey: 'whl_autopilot_processed',
    useConfidenceSystem: true,  // Usar sistema de confiança
    minConfidence: 70,          // Confiança mínima para auto-send
    requireCopilotMode: true,   // Requer modo copiloto ativo

    // Configuráveis via UI (autopilot-handlers.js)
    SKIP_GROUPS: true,
    MAX_RESPONSES_PER_HOUR: 30,
    DELAY_BETWEEN_CHATS: 10000, // ms
    WORKING_HOURS: { enabled: false, start: 8, end: 22 }
  };

  const AUTOPILOT_LIMITS = {
    maxMessagesPerMinute: 3,
    maxMessagesPerHour: 30,
    minDelayBetweenChats: 10000 // 10s
  };

  const state = {
    running: false,
    paused: false,
    processing: false,
    processingLock: false, // MUTEX para evitar race conditions
    queue: [],
    processed: new Set(),
    blacklist: new Set(),
    blacklistOperationQueue: [], // Fila de operações de blacklist
    blacklistOperationRunning: false, // Lock para operações de blacklist
    currentChat: null,
    stats: {
      received: 0,
      replied: 0,
      repliedConfirmed: 0, // Novo: apenas após confirmação de envio
      failed: 0,
      skippedLowConfidence: 0,
      skippedGroups: 0,
      skippedBlacklisted: 0,
      skippedNoText: 0,
      skippedWorkingHours: 0,
      skippedRateLimit: 0
    },
    rateLimits: {
      perMinute: [],
      perHour: [],
      lastChatAt: 0
    }
  };

  // Referência do interval de binding para cleanup
  let eventBusBindingInterval = null;
  
  // ============================================
  // AsyncMutex - Previne race conditions
  // ============================================
  class AsyncMutex {
    constructor() {
      this._locked = false;
      this._queue = [];
    }

    async acquire() {
      return new Promise((resolve) => {
        if (!this._locked) {
          this._locked = true;
          resolve();
        } else {
          this._queue.push(resolve);
        }
      });
    }

    release() {
      if (this._queue.length > 0) {
        const next = this._queue.shift();
        next();
      } else {
        this._locked = false;
      }
    }

    get isLocked() {
      return this._locked;
    }
  }

  // Mutex global para processamento
  const processingMutex = new AsyncMutex();
  
  // Mutex para operações de estado (start/stop/pause)
  const stateMutex = new AsyncMutex();

  // ============================================
  // StorageQueue - Operações atômicas de storage
  // ============================================
  class StorageQueue {
    constructor() {
      this._queue = [];
      this._processing = false;
    }

    async enqueue(operation) {
      return new Promise((resolve, reject) => {
        this._queue.push({ operation, resolve, reject });
        this._processNext();
      });
    }

    async _processNext() {
      if (this._processing || this._queue.length === 0) return;
      
      this._processing = true;
      const { operation, resolve, reject } = this._queue.shift();
      
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        this._processing = false;
        if (this._queue.length > 0) {
          this._processNext();
        }
      }
    }
  }

  // Queue para operações de blacklist (evita race conditions)
  const blacklistStorageQueue = new StorageQueue();

  // ============================================
  // Helpers de Storage Híbrido (Chrome + Local)
  // ============================================
  const storage = {
    get: (key) => {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(key, (res) => resolve(res[key]));
        } else {
          try {
            const item = localStorage.getItem(key);
            resolve(item ? JSON.parse(item) : null);
          } catch (e) {
            resolve(localStorage.getItem(key));
          }
        }
      });
    },
    set: (key, value) => {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [key]: value }, resolve);
        } else {
          localStorage.setItem(key, JSON.stringify(value));
          resolve();
        }
      });
    }
  };

  const BLACKLIST_STORAGE_KEY = 'whl_autopilot_blacklist';

  /**
   * Carrega blacklist de forma thread-safe usando StorageQueue
   */
  async function loadBlacklist() {
    return blacklistStorageQueue.enqueue(async () => {
      try {
        const saved = await storage.get(BLACKLIST_STORAGE_KEY);
        if (saved) {
          const arr = Array.isArray(saved) ? saved : JSON.parse(saved);
          state.blacklist = new Set(arr);
          console.log('[Autopilot] ✅ Blacklist carregada:', state.blacklist.size, 'itens');
        }
        return state.blacklist;
      } catch (e) {
        console.error('[Autopilot] Erro ao carregar blacklist:', e);
        return state.blacklist;
      }
    });
  }

  /**
   * Adiciona item à blacklist de forma atômica
   * @param {string} chatId - ID do chat a adicionar
   */
  async function addToBlacklistAtomic(chatId) {
    return blacklistStorageQueue.enqueue(async () => {
      // Recarregar estado atual do storage
      const saved = await storage.get(BLACKLIST_STORAGE_KEY);
      const currentSet = new Set(Array.isArray(saved) ? saved : []);
      
      // Adicionar
      const normalized = normalizeChatId(chatId);
      if (!normalized) return false;
      
      currentSet.add(normalized);
      state.blacklist = currentSet;
      
      // Salvar
      await storage.set(BLACKLIST_STORAGE_KEY, [...currentSet]);
      console.log('[Autopilot] ✅ Adicionado à blacklist:', normalized);
      return true;
    });
  }

  /**
   * Remove item da blacklist de forma atômica
   * @param {string} chatId - ID do chat a remover
   */
  async function removeFromBlacklistAtomic(chatId) {
    return blacklistStorageQueue.enqueue(async () => {
      // Recarregar estado atual do storage
      const saved = await storage.get(BLACKLIST_STORAGE_KEY);
      const currentSet = new Set(Array.isArray(saved) ? saved : []);
      
      // Remover
      const normalized = normalizeChatId(chatId);
      if (!normalized) return false;
      
      const deleted = currentSet.delete(normalized);
      if (!deleted) return false;
      
      state.blacklist = currentSet;
      
      // Salvar
      await storage.set(BLACKLIST_STORAGE_KEY, [...currentSet]);
      console.log('[Autopilot] ✅ Removido da blacklist:', normalized);
      return true;
    });
  }
  
  // Alias para compatibilidade com código existente
  function enqueueBlacklistAdd(chatId) {
    addToBlacklistAtomic(chatId);
  }
  
  function enqueueBlacklistRemove(chatId) {
    removeFromBlacklistAtomic(chatId);
  }
  
  function saveBlacklist() {
    // Salvar estado atual
    storage.set(BLACKLIST_STORAGE_KEY, [...state.blacklist]);
  }

  async function loadRateLimits() {
    try {
      const saved = await storage.get('whl_autopilot_rate_limits');
      if (saved) {
        const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
        state.rateLimits.perMinute = Array.isArray(parsed.perMinute) ? parsed.perMinute : [];
        state.rateLimits.perHour = Array.isArray(parsed.perHour) ? parsed.perHour : [];
        state.rateLimits.lastChatAt = parsed.lastChatAt || 0;
      }
    } catch (e) {
      console.warn('[Autopilot] Erro ao carregar rate limits:', e);
    }
  }

  function saveRateLimits() {
    try {
      storage.set('whl_autopilot_rate_limits', {
        perMinute: state.rateLimits.perMinute,
        perHour: state.rateLimits.perHour,
        lastChatAt: state.rateLimits.lastChatAt
      });
    } catch (e) {
      console.warn('[Autopilot] Erro ao salvar rate limits:', e);
    }
  }

  function isBlacklisted(chatIdOrPhone) {
    const raw = String(chatIdOrPhone || '');
    const phone = raw.replace(/\D/g, '');
    const fullId = phone ? `${phone}@c.us` : '';
    return state.blacklist.has(raw) || (phone && state.blacklist.has(phone)) || (fullId && state.blacklist.has(fullId));
  }

  // ============================================
  // 7.1 - Reutilizar openChatByPhone do disparo
  // ============================================
  async function openChatByPhone(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    
    // Método 1: Via Store.Cmd (mais confiável)
    if (window.Store?.Chat?.find && window.Store?.Cmd?.openChatAt) {
      try {
        const chat = await window.Store.Chat.find(cleanPhone + '@c.us');
        if (chat) {
          await window.Store.Cmd.openChatAt(chat);
          console.log('[Autopilot] ✅ Chat aberto via Store.Cmd');
          return true;
        }
      } catch (e) {}
    }
    
    // Método 2: Via Store.Chat
    if (window.Store?.Chat?.find) {
      try {
        const chat = await window.Store.Chat.find(cleanPhone + '@c.us');
        if (chat) {
          chat.open?.();
          console.log('[Autopilot] ✅ Chat aberto via Store.Chat');
          return true;
        }
      } catch (e) {}
    }
    
    // Método 3: Via URL (fallback)
    try {
      const link = document.createElement('a');
      link.href = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
      link.click();
      await sleep(2000);
      return true;
    } catch (e) {}
    
    return false;
  }

  // ============================================
  // 7.2 - Reutilizar sendMessageViaInput do disparo
  // ============================================
  async function sendMessageViaInput(text) {
    const inputSelectors = [
      'footer div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][role="textbox"]',
      '[data-testid="conversation-compose-box-input"]'
    ];
    
    let input = null;
    for (const sel of inputSelectors) {
      input = document.querySelector(sel);
      if (input) break;
    }
    
    if (!input) {
      console.error('[Autopilot] ❌ Campo de input não encontrado');
      return false;
    }
    
    // 7.3/7.11 - Usar digitação humana
    await simulateTyping(input, text);
    
    // 7.12 - Clicar no botão send
    await sleep(300);
    const sendBtn = document.querySelector('[data-testid="send"]') ||
                    document.querySelector('button[aria-label*="Enviar"]') ||
                    document.querySelector('span[data-icon="send"]')?.parentElement;
    
    if (sendBtn) {
      sendBtn.click();
      console.log('[Autopilot] ✅ Mensagem enviada');
      return true;
    }
    
    // Fallback: Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  }

  // ============================================
  // 7.3/7.11 - Integrar humanTyping (aprimorado)
  // ============================================
  async function simulateTyping(input, text) {
    if (!text || !input) return;
    
    // Verificar rate limit antes de digitar
    if (window.HumanTyping?.checkRateLimit && !window.HumanTyping.checkRateLimit()) {
      console.warn('[Autopilot] ⚠️ Rate limit atingido, aguardando...');
      await sleep(5000);
    }
    
    // Pausas aleatórias antes de digitar (anti-ban)
    if (window.HumanTyping?.maybeRandomLongPause) {
      await window.HumanTyping.maybeRandomLongPause();
    }
    
    // Pausar um pouco para simular leitura
    await sleep(Math.random() * 1000 + 500);
    
    // Usar módulo HumanTyping se disponível
    if (window.HumanTyping?.type) {
      try {
        console.log('[Autopilot] ⌨️ Digitando com HumanTyping...');
        await window.HumanTyping.type(input, text, {
          minDelay: CONFIG.typingDelay.min,
          maxDelay: CONFIG.typingDelay.max,
          chunkSize: 2
        });
        
        // Registrar mensagem enviada
        if (window.HumanTyping.recordMessageSent) {
          window.HumanTyping.recordMessageSent();
        }
        return;
      } catch (e) {
        console.warn('[Autopilot] ⚠️ HumanTyping falhou, usando fallback:', e.message);
      }
    }
    
    // Fallback: digitação manual com variação humana
    console.log('[Autopilot] ⌨️ Digitando com fallback manual...');
    input.focus();
    await sleep(100);
    
    // Limpar campo antes de digitar
    input.textContent = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(50);
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Inserir caractere
      document.execCommand('insertText', false, char);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Delay variável baseado no caractere
      let delay = Math.random() * 40 + 20;
      
      // Pausas maiores após pontuação
      if ('.!?'.includes(char)) {
        delay += Math.random() * 200 + 100;
      } else if (',;:'.includes(char)) {
        delay += Math.random() * 100 + 50;
      } else if (char === ' ' && Math.random() > 0.8) {
        // Pausa ocasional entre palavras
        delay += Math.random() * 150;
      }
      
      // Simular "typo" ocasional (1% de chance)
      if (Math.random() < 0.01 && i < text.length - 1 && /[a-zA-Z]/.test(char)) {
        // Digita letra errada e corrige
        document.execCommand('insertText', false, 'x');
        await sleep(100);
        document.execCommand('delete', false, null);
        await sleep(80);
      }
      
      await sleep(delay);
    }
  }

  // ============================================
  // 7.14 - Verificar sistema de confiança
  // ============================================
  async function checkConfidenceSystem(item) {
    // Se desabilitado, permitir sempre
    if (!CONFIG.useConfidenceSystem) {
      return { canSend: true, reason: 'confidence_disabled', score: null };
    }
    
    // Verificar se ConfidenceSystem está disponível
    if (!window.confidenceSystem) {
      console.warn('[Autopilot] ⚠️ ConfidenceSystem não disponível');
      return { canSend: false, reason: 'no_confidence_system' };
    }
    
    // Garantir que está inicializado
    if (!window.confidenceSystem.initialized) {
      await window.confidenceSystem.init();
    }
    
    // Verificar se modo copiloto está ativo
    if (CONFIG.requireCopilotMode && !window.confidenceSystem.copilotEnabled) {
      console.log('[Autopilot] ⏸️ Modo copiloto desativado');
      return { canSend: false, reason: 'copilot_disabled' };
    }
    
    // Verificar score de confiança
    const score = window.confidenceSystem.getScore?.() || window.confidenceSystem.score || 0;
    if (score < CONFIG.minConfidence) {
      console.log(`[Autopilot] 📉 Confiança insuficiente: ${score}% < ${CONFIG.minConfidence}%`);
      return { canSend: false, reason: 'low_confidence', score };
    }
    
    // Usar decisão inteligente do ConfidenceSystem
    if (window.confidenceSystem.canAutoSendSmart) {
      const decision = await window.confidenceSystem.canAutoSendSmart(item.message);
      console.log('[Autopilot] 🎯 Decisão do ConfidenceSystem:', decision);
      return decision;
    }
    
    return { canSend: true, reason: 'confidence_ok', score };
  }

  // ============================================
  // 7.4/7.13 - Loop automático (com verificação de confiança)
  // ============================================

  function pruneRateLimits(now = Date.now()) {
    // Limpar janelas
    state.rateLimits.perMinute = state.rateLimits.perMinute.filter(t => now - t < 60 * 1000);
    state.rateLimits.perHour = state.rateLimits.perHour.filter(t => now - t < 60 * 60 * 1000);
  }

  function canSendRateLimited(now = Date.now()) {
    pruneRateLimits(now);

    const maxPerMinute = AUTOPILOT_LIMITS.maxMessagesPerMinute;
    const maxPerHour = Number(CONFIG.MAX_RESPONSES_PER_HOUR ?? AUTOPILOT_LIMITS.maxMessagesPerHour);
    const minDelayBetweenChats = Number(CONFIG.DELAY_BETWEEN_CHATS ?? AUTOPILOT_LIMITS.minDelayBetweenChats);

    if (state.rateLimits.perMinute.length >= maxPerMinute) {
      return { allowed: false, reason: 'rate_limit_minute', retryIn: 10000 };
    }

    if (state.rateLimits.perHour.length >= maxPerHour) {
      return { allowed: false, reason: 'rate_limit_hour', retryIn: 60 * 1000 };
    }

    if (now - state.rateLimits.lastChatAt < minDelayBetweenChats) {
      const retryIn = minDelayBetweenChats - (now - state.rateLimits.lastChatAt);
      return { allowed: false, reason: 'min_delay_between_chats', retryIn };
    }

    return { allowed: true };
  }

  function recordRateLimitSend(now = Date.now()) {
    pruneRateLimits(now);
    state.rateLimits.perMinute.push(now);
    state.rateLimits.perHour.push(now);
    state.rateLimits.lastChatAt = now;
    saveRateLimits();
  }
  
  // ============================================
  // Loop e ingestão (robusto + sem duplicação)
  // ============================================
  let processTimer = null;
  let listenersBound = false;

  function emitRuntimeEvent(event, detail) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'WHL_AUTOPILOT_EVENT', event, detail });
      }
    } catch (_) {}
  }

  function emitWindowEvent(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_) {}
  }

  function scheduleProcess(delayMs = 0, force = false) {
    if (!state.running) return;
    const ms = Math.max(0, Number(delayMs) || 0);
    if (processTimer && !force) return;
    // CORREÇÃO: sempre limpar timer anterior antes de criar um novo
    if (processTimer) {
      clearTimeout(processTimer);
      processTimer = null;
    }
    processTimer = setTimeout(() => {
      processTimer = null;
      processQueue().catch(err => {
        console.error('[Autopilot] ❌ Erro no loop:', err);
        emitRuntimeEvent('error', { error: err?.message || String(err) });
      });
    }, ms);
  }

  function stopScheduler() {
    if (processTimer) {
      clearTimeout(processTimer);
      processTimer = null;
    }
  }

  function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\u0000/g, '').trim();
  }

  function normalizeChatId(raw) {
    const s = safeText(raw);
    if (!s) return '';
    if (s.includes('@')) return s;
    const phone = s.replace(/\D/g, '');
    return phone ? `${phone}@c.us` : s;
  }

  function isGroupChatId(chatId) {
    const id = safeText(chatId);
    return id.endsWith('@g.us');
  }

  function extractPhoneFromChatId(chatId) {
    const id = safeText(chatId);
    if (!id) return '';
    if (id.endsWith('@g.us')) return '';
    return id
      .replace('@c.us', '')
      .replace('@s.whatsapp.net', '')
      .replace('@lid', '')
      .replace(/\D/g, '');
  }

  function isWithinWorkingHours(date = new Date()) {
    const wh = CONFIG.WORKING_HOURS || {};
    if (!wh.enabled) return true;

    const start = Number(wh.start ?? 8);
    const end = Number(wh.end ?? 22);
    const h = date.getHours();

    if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
    if (start === end) return true; // Sem restrição prática

    if (start < end) return h >= start && h < end;
    // Janela atravessa meia-noite
    return h >= start || h < end;
  }

  function msUntilWorkingHoursStart(date = new Date()) {
    const wh = CONFIG.WORKING_HOURS || {};
    if (!wh.enabled) return 0;
    if (isWithinWorkingHours(date)) return 0;

    const start = Number(wh.start ?? 8);
    if (!Number.isFinite(start)) return 0;

    const next = new Date(date);
    next.setMinutes(0, 0, 0);
    next.setHours(start);
    if (next <= date) next.setDate(next.getDate() + 1);
    return Math.max(0, next.getTime() - date.getTime());
  }

  async function openChatById(chatId) {
    const id = normalizeChatId(chatId);
    if (!id) return false;

    // Método 1: Store.Chat.find + Cmd.openChatAt
    if (window.Store?.Chat?.find && window.Store?.Cmd?.openChatAt) {
      try {
        const chat = await window.Store.Chat.find(id);
        if (chat) {
          await window.Store.Cmd.openChatAt(chat);
          console.log('[Autopilot] ✅ Chat aberto via Store.Cmd (id)');
          return true;
        }
      } catch (_) {}
    }

    // Método 2: chat.open (se existir)
    if (window.Store?.Chat?.find) {
      try {
        const chat = await window.Store.Chat.find(id);
        if (chat?.open) {
          chat.open();
          console.log('[Autopilot] ✅ Chat aberto via chat.open (id)');
          return true;
        }
      } catch (_) {}
    }

    return false;
  }

  async function openChatForItem(item) {
    const chatId = normalizeChatId(item?.chatId || '');
    const phone = safeText(item?.phone);

    if (isGroupChatId(chatId)) {
      return await openChatById(chatId);
    }

    const p = phone || extractPhoneFromChatId(chatId);
    if (!p) return false;

    // Preferir implementação robusta do content/content.js, se disponível
    if (typeof window.openChatByPhone === 'function') {
      try {
        return await window.openChatByPhone(p);
      } catch (_) {}
    }
    return await openChatByPhone(p);
  }

  async function processQueue() {
    if (!state.running || state.paused) return;
    if (state.queue.length === 0) return;
    
    // CORREÇÃO v7.9.13: Usar AsyncMutex para prevenir race conditions
    if (processingMutex.isLocked) {
      console.log('[Autopilot] ⏳ Processamento já em andamento');
      return;
    }
    
    await processingMutex.acquire();
    state.processing = true;

    let nextDelayOverride = null;
    const item = state.queue.shift();

    try {
      if (!item || !item.id) return;
      if (state.processed.has(item.id)) return;

      // Garantir chatId no item (necessário para blacklist e contexto)
      item.chatId = normalizeChatId(item.chatId || (item.phone ? `${item.phone}@c.us` : ''));

      // Blacklist
      if (state.blacklist && isBlacklisted(item.chatId || item.phone)) {
        console.log(`[Autopilot] 🚫 Chat ${item.chatId || item.phone} está na blacklist. Ignorando.`);
        state.stats.skippedBlacklisted++;
        emitRuntimeEvent('skipped', { reason: 'blacklist', chatId: item.chatId, phone: item.phone });
        return;
      }

      // Horário de trabalho
      if (!isWithinWorkingHours()) {
        const retryIn = Math.max(60 * 1000, msUntilWorkingHoursStart());
        state.stats.skippedWorkingHours++;
        // Recolocar item e aguardar janela
        state.queue.unshift(item);
        nextDelayOverride = retryIn;
        emitRuntimeEvent('paused', { reason: 'working_hours', retryIn });
        return;
      }

      console.log('[Autopilot] 🔄 Processando:', item.chatId || item.phone);

      // Confiança
      const confidenceCheck = await checkConfidenceSystem(item);
      if (!confidenceCheck.canSend) {
        console.log(`[Autopilot] ⏭️ Pulando mensagem: ${confidenceCheck.reason}`);
        state.stats.skippedLowConfidence++;

        if (window.EventBus) {
          window.EventBus.emit('autopilot:suggestion-only', {
            item,
            reason: confidenceCheck.reason,
            score: confidenceCheck.score
          });
        }

        emitRuntimeEvent('suggestion-only', {
          chatId: item.chatId,
          phone: item.phone,
          reason: confidenceCheck.reason,
          score: confidenceCheck.score
        });

        nextDelayOverride = Math.random() * 1000 + 500;
        return;
      }

      // Rate limit
      const rateCheck = canSendRateLimited();
      if (!rateCheck.allowed) {
        console.warn(`[Autopilot] ⏸️ Aguardando por limites (${rateCheck.reason})`);
        state.stats.skippedRateLimit++;
        state.queue.unshift(item);
        nextDelayOverride = rateCheck.retryIn || 5000;
        emitRuntimeEvent('limitReached', { reason: rateCheck.reason, retryIn: nextDelayOverride });
        return;
      }

      // Abrir chat
      const opened = await openChatForItem(item);
      if (!opened) throw new Error('Falha ao abrir chat');
      await sleep(1500);

      // Gerar resposta (backend soberano via CopilotEngine)
      const response = confidenceCheck.answer || await generateResponse(item);
      if (!response) throw new Error('Falha ao gerar resposta');

      // Enviar
      const sent = await sendMessageViaInput(response);
      if (!sent) throw new Error('Falha ao enviar');

      // Confirmação visual (melhor esforço) antes de contar como "confirmado"
      const confirmed = await confirmMessageSent(6000);

      // Registrar envio (rate limit só após sucesso)
      recordRateLimitSend();

      state.processed.add(item.id);
      state.stats.replied++; // Tentativa
      if (confirmed) {
        state.stats.repliedConfirmed++; // Apenas se confirmar ícone/check
      }
      saveProcessed();

      if (window.confidenceSystem?.recordAutoSend) {
        window.confidenceSystem.recordAutoSend();
      }

      if (window.EventBus) {
        window.EventBus.emit('autopilot:auto-responded', {
          chatId: item.chatId,
          phone: item.phone,
          response,
          confidence: confidenceCheck.score || confidenceCheck.confidence,
          confirmed
        });
      }

      emitWindowEvent('autopilot:messageSent', { chatId: item.chatId, phone: item.phone, response });
      emitRuntimeEvent('messageSent', { chatId: item.chatId, phone: item.phone, response });

      updateUI();
    } catch (error) {
      state.stats.failed++;
      console.error('[Autopilot] ❌ Erro:', error);
      emitWindowEvent('autopilot:error', { error: error?.message || String(error) });
      emitRuntimeEvent('error', {
        error: error?.message || String(error),
        chatId: item?.chatId,
        phone: item?.phone
      });
    } finally {
      // CORREÇÃO v7.9.13: Liberar AsyncMutex
      state.processing = false;
      processingMutex.release();

      if (!state.running || state.paused) return;
      if (state.queue.length === 0) return;

      const delay =
        nextDelayOverride !== null && nextDelayOverride !== undefined
          ? nextDelayOverride
          : (Math.random() * (CONFIG.delay.max - CONFIG.delay.min) + CONFIG.delay.min);

      scheduleProcess(delay, true);
    }
  }

  function setupMessageListener() {
    if (listenersBound) return;
    listenersBound = true;

    const tryBind = () => {
      if (window.EventBus?.on) {
        window.EventBus.on('message:received', handleNewMessage);
        return true;
      }
      return false;
    };

    if (tryBind()) return;

    // Fallback: EventBus pode carregar depois
    let attempts = 0;
    if (eventBusBindingInterval) clearInterval(eventBusBindingInterval);
    eventBusBindingInterval = setInterval(() => {
      attempts++;
      if (tryBind() || attempts >= 20) {
        clearInterval(eventBusBindingInterval);
        eventBusBindingInterval = null;
      }
    }, 500);
  }

  function handleNewMessage(msg) {
    if (!CONFIG.enabled) return;
    if (!msg) return;

    const fromMe = !!(msg.fromMe || msg.id?.fromMe);
    if (fromMe) return;

    const rawChatId =
      msg.chatId?._serialized ||
      msg.chatId ||
      msg.id?.remote?._serialized ||
      msg.id?.remote ||
      msg.from?._serialized ||
      msg.from ||
      '';

    const chatId = normalizeChatId(rawChatId);
    if (!chatId) return;

    // Grupos
    if (isGroupChatId(chatId) && CONFIG.SKIP_GROUPS) {
      state.stats.skippedGroups++;
      emitRuntimeEvent('skipped', { reason: 'group', chatId });
      return;
    }

    // Blacklist (mais cedo possível)
    if (state.blacklist && isBlacklisted(chatId)) {
      state.stats.skippedBlacklisted++;
      emitRuntimeEvent('skipped', { reason: 'blacklist', chatId });
      return;
    }

    const messageText = safeText(msg.message ?? msg.body ?? msg.text ?? msg.caption ?? '');
    if (!messageText) {
      state.stats.skippedNoText++;
      emitRuntimeEvent('skipped', { reason: 'no_text', chatId });
      return;
    }

    const msgId =
      safeText(msg.messageId) ||
      safeText(msg.id?._serialized) ||
      safeText(msg.id) ||
      safeText(msg.key?._serialized) ||
      '';

    const timestamp = Number(msg.timestamp ?? msg.t ?? Date.now()) || Date.now();
    const stableId = msgId || `${chatId}:${timestamp}:${messageText.slice(0, 64)}`;

    if (state.processed.has(stableId)) return;
    if (state.queue.some(i => i.id === stableId)) return;

    const phone = extractPhoneFromChatId(chatId);

    state.stats.received++;
    state.queue.push({
      id: stableId,
      chatId,
      phone,
      message: messageText,
      type: msg.type || 'chat',
      timestamp
    });

    // Limitar tamanho da fila
    if (state.queue.length > CONFIG.maxQueue) {
      state.queue = state.queue.slice(-CONFIG.maxQueue);
    }

    console.log('[Autopilot] 📩 Nova mensagem na fila:', chatId);
    updateUI();

    // Acordar loop
    scheduleProcess(Math.random() * 800 + 200, true);
  }

  // ============================================
  // 7.10 - Gerar resposta via AI ou template
  // UNIFICADO: Usa CopilotEngine para mesma lógica e complexidade
  // Garante uso de: memória, exemplos, knowledge base, contexto híbrido do servidor
  // 
  // v7.9.13: BACKEND SOBERANO - Sem fallback silencioso para templates
  // ============================================
  
  // Configuração: Backend é obrigatório
  const FORCE_BACKEND = true;
  const SHOW_BACKEND_ERRORS = true;
  
  async function generateResponse(item) {
    const chatId = item.chatId || (item.phone ? `${String(item.phone).replace(/\D/g, '')}@c.us` : '');
    const messageText = item.message || item.text || '';
    
    console.log(`[Autopilot] 🚀 [MOTOR: BACKEND] Gerando resposta para: ${chatId}`);
    
    // PRIORIDADE 1: CopilotEngine (mesma lógica robusta do copiloto e sugestões)
    if (window.CopilotEngine && typeof window.CopilotEngine.generateResponse === 'function') {
      try {
        console.log('[Autopilot] 🤖 [MOTOR: BACKEND/CopilotEngine] Iniciando...');
        
        // Carregar contexto híbrido primeiro (memória + exemplos + KB do servidor)
        if (window.CopilotEngine.loadConversationContext) {
          await window.CopilotEngine.loadConversationContext(chatId, true);
        }
        
        // Analisar mensagem (usa toda a inteligência: intent, sentiment, KB, etc)
        const analysis = await window.CopilotEngine.analyzeMessage(messageText, chatId);
        
        // Gerar resposta com contexto híbrido
        const result = await window.CopilotEngine.generateResponse(chatId, analysis);
        
        if (result && result.content) {
          console.log(`[Autopilot] ✅ [MOTOR: BACKEND] Resposta gerada | Provider: ${result.provider || 'unknown'}`);
          return result.content;
        }
      } catch (e) {
        console.error('[Autopilot] ❌ [MOTOR: BACKEND] CopilotEngine falhou:', e.message);
        
        // v7.9.13: Se FORCE_BACKEND, NÃO continuar para fallbacks
        if (FORCE_BACKEND) {
          if (SHOW_BACKEND_ERRORS && window.EventBus) {
            window.EventBus.emit('autopilot:backend:error', {
              error: e.message,
              chatId,
              reason: 'Backend obrigatório falhou'
            });
          }
          emitRuntimeEvent('backend-error', {
            error: e.message,
            chatId,
            reason: 'Backend obrigatório falhou'
          });
          throw new Error(`❌ Backend obrigatório falhou: ${e.message}`);
        }
      }
    }
    
    // v7.9.13: Se FORCE_BACKEND, não usar fallbacks locais
    if (FORCE_BACKEND) {
      console.error('[Autopilot] ❌ [MOTOR: BLOQUEADO] Backend obrigatório indisponível');
      console.error('[Autopilot] 🚨 CopilotEngine não está disponível. Verifique os módulos.');
      throw new Error('❌ Backend obrigatório indisponível. CopilotEngine não carregado.');
    }
    
    // === FALLBACKS (APENAS se FORCE_BACKEND = false) ===
    console.warn('[Autopilot] ⚠️ [MOTOR: LOCAL] Tentando fallbacks locais...');
    
    // Notificar UI sobre uso de fallback
    if (window.EventBus) {
      window.EventBus.emit('ai:fallback-used', { reason: 'backend_unavailable' });
    }
    
    // PRIORIDADE 2: AIService (fallback)
    if (window.AIService?.generate) {
      try {
        console.warn('[Autopilot] ⚠️ [MOTOR: LOCAL/AIService] Usando motor local');
        const response = await window.AIService.generate(messageText);
        if (response) return response;
      } catch (e) {
        console.error('[Autopilot] ❌ AIService falhou:', e.message);
      }
    }
    
    // PRIORIDADE 3: BackendClient direto (fallback)
    if (window.BackendClient?.generateResponse) {
      try {
        console.warn('[Autopilot] ⚠️ [MOTOR: LOCAL/BackendClient] Usando cliente direto');
        const response = await window.BackendClient.generateResponse(messageText);
        if (response) return response;
      } catch (e) {
        console.error('[Autopilot] ❌ BackendClient falhou:', e.message);
      }
    }
    
    // ÚLTIMO RECURSO: template padrão (apenas se FORCE_BACKEND = false)
    console.error('[Autopilot] ❌ [MOTOR: TEMPLATE] Usando template genérico (IA indisponível)');
    const templates = [
      '⚠️ Sistema de IA temporariamente indisponível. Retornarei em breve.',
      '⚠️ Recebi sua mensagem. Estou com dificuldades técnicas, mas logo respondo.',
      '⚠️ Olá! O sistema de IA está em manutenção. Aguarde um momento.'
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // ============================================
  // 7.5/7.6 - UI apenas no painel lateral (com confiança)
  // ============================================
  function updateUI() {
    const statusEl = document.getElementById('autopilot_status');
    const queueEl = document.getElementById('autopilot_queue');
    const statsEl = document.getElementById('autopilot_stats');
    const confidenceEl = document.getElementById('autopilot_confidence');
    
    if (statusEl) {
      const copilotActive = window.confidenceSystem?.copilotEnabled;
      const score = Number(window.confidenceSystem?.score || 0) || 0;
      
      if (!state.running) {
        statusEl.innerHTML = '<span class="wh-badge wh-badge-warning">⏸️ Pausado</span>';
      } else if (!copilotActive) {
        statusEl.innerHTML = '<span class="wh-badge wh-badge-info">👀 Modo Sugestão</span>';
      } else if (score >= CONFIG.minConfidence) {
        statusEl.innerHTML = '<span class="wh-badge wh-badge-success">🤖 Auto-Resposta Ativa</span>';
      } else {
        statusEl.innerHTML = `<span class="wh-badge wh-badge-warning">📈 Treinando (${score}%)</span>`;
      }
    }
    
    if (queueEl) {
      queueEl.textContent = state.queue.length;
    }
    
    if (statsEl) {
      const skipped = state.stats.skippedLowConfidence > 0 ? ` | ⏭️ ${state.stats.skippedLowConfidence}` : '';
      statsEl.innerHTML = `📩 ${state.stats.received} | ✅ ${state.stats.replied} | ❌ ${state.stats.failed}${skipped}`;
    }
    
    // Mostrar nível de confiança se disponível
    if (confidenceEl && window.confidenceSystem) {
      const level = window.confidenceSystem.level || 'beginner';
      const score = window.confidenceSystem.score || 0;
      const emoji = { autonomous: '🔵', copilot: '🟢', assisted: '🟡', learning: '🟠', beginner: '🔴' }[level] || '⚪';
      confidenceEl.innerHTML = `${emoji} ${score}%`;
    }
  }

  // ============================================
  // Persistência
  // ============================================
  function saveProcessed() {
    try {
      const data = [...state.processed].slice(-500);
      storage.set(CONFIG.processedKey, data);
    } catch (e) {}
  }

  function loadProcessed() {
    try {
      storage.get(CONFIG.processedKey).then(data => {
        if (data) state.processed = new Set(Array.isArray(data) ? data : JSON.parse(data));
      });
    } catch (e) {}
  }

  // ============================================
  // Utilitários
  // ============================================
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Verifica se a última mensagem enviada já aparece com ícone de status no DOM.
   * Observação: é "melhor esforço" (não garante entrega, apenas que o WA aceitou o envio).
   */
  async function confirmMessageSent(timeoutMs = 5000) {
    const start = Date.now();

    const hasAnyStatusIcon = (el) => {
      try {
        return !!el.querySelector?.(
          '[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-time"], [data-testid="msg-check"], [data-testid="msg-dblcheck"]'
        );
      } catch (_) {
        return false;
      }
    };

    while (Date.now() - start < timeoutMs) {
      const lastOut = document.querySelector('.message-out:last-child');
      if (lastOut && hasAnyStatusIcon(lastOut)) return true;
      await sleep(200);
    }
    return false;
  }

  // ============================================
  // Controle de estado com mutex (start/pause/resume/stop)
  // ============================================

  async function startAutopilot() {
    await stateMutex.acquire();
    try {
      if (state.running && CONFIG.enabled) return { success: false, reason: 'already_running' };
      CONFIG.enabled = true;
      state.paused = false;
      state.running = true;
      console.log('[Autopilot] ▶️ Iniciado');
      updateUI();
      emitWindowEvent('autopilot:started');
      emitRuntimeEvent('started', { timestamp: Date.now() });
      scheduleProcess(0, true);
      return { success: true };
    } finally {
      stateMutex.release();
    }
  }

  async function pauseAutopilot() {
    await stateMutex.acquire();
    try {
      if (!CONFIG.enabled || state.paused) return { success: false, reason: state.paused ? 'already_paused' : 'not_running' };
      state.running = false;
      state.paused = true;
      stopScheduler();
      console.log('[Autopilot] ⏸️ Pausado');
      updateUI();
      emitWindowEvent('autopilot:paused');
      emitRuntimeEvent('paused', { timestamp: Date.now() });
      return { success: true };
    } finally {
      stateMutex.release();
    }
  }

  async function resumeAutopilot() {
    await stateMutex.acquire();
    try {
      if (!CONFIG.enabled || !state.paused) return { success: false, reason: !CONFIG.enabled ? 'not_running' : 'not_paused' };
      state.paused = false;
      state.running = true;
      console.log('[Autopilot] ▶️ Retomado');
      updateUI();
      emitWindowEvent('autopilot:resumed');
      emitRuntimeEvent('resumed', { timestamp: Date.now() });
      scheduleProcess(0, true);
      return { success: true };
    } finally {
      stateMutex.release();
    }
  }

  async function stopAutopilot() {
    await stateMutex.acquire();
    try {
      if (!CONFIG.enabled && !state.running) return { success: false, reason: 'not_running' };
      CONFIG.enabled = false;
      state.running = false;
      state.paused = false;
      stopScheduler();
      console.log('[Autopilot] ⏹️ Parado');
      updateUI();
      emitWindowEvent('autopilot:stopped');
      emitRuntimeEvent('stopped', { timestamp: Date.now() });
      return { success: true };
    } finally {
      stateMutex.release();
    }
  }

  // ============================================
  // API Pública
  // ============================================
  window.AutopilotV2 = {
    start: () => startAutopilot(),
    stop: () => stopAutopilot(),
    pause: () => pauseAutopilot(),
    resume: () => resumeAutopilot(),
    getStats: () => {
      const now = Date.now();
      pruneRateLimits(now);

      const totalSkipped =
        (state.stats.skippedLowConfidence || 0) +
        (state.stats.skippedGroups || 0) +
        (state.stats.skippedBlacklisted || 0) +
        (state.stats.skippedNoText || 0) +
        (state.stats.skippedWorkingHours || 0) +
        (state.stats.skippedRateLimit || 0);

      return {
        ...state.stats,
        isRunning: !!CONFIG.enabled,
        isPaused: !!CONFIG.enabled && !!state.paused,
        pendingChats: state.queue.length,
        totalSent: state.stats.replied || 0,
        totalSentConfirmed: state.stats.repliedConfirmed || 0, // NOVO: Apenas confirmados
        totalSkipped,
        totalErrors: state.stats.failed || 0,
        responsesThisHour: state.rateLimits.perHour.length
      };
    },
    getQueue: () => [...state.queue],
    clearQueue: () => {
      state.queue = [];
      updateUI();
    },
    isRunning: () => !!CONFIG.enabled,
    isPaused: () => !!CONFIG.enabled && !!state.paused,
    setConfig: (configOrKey, value) => {
      // Aceita tanto setConfig(key, value) quanto setConfig({key: value})
      if (typeof configOrKey === 'object') {
        Object.entries(configOrKey).forEach(([k, v]) => {
          if (k in CONFIG) CONFIG[k] = v;
        });
      } else if (typeof configOrKey === 'string' && configOrKey in CONFIG) {
        CONFIG[configOrKey] = value;
      }
      updateUI();
    },
    
    // Blacklist management (via fila para evitar race conditions)
    addToBlacklist: (chatId) => {
      if (!state.blacklist) state.blacklist = new Set();
      enqueueBlacklistAdd(chatId);
      console.log('[Autopilot] 🚫 Adicionado à blacklist (via fila):', chatId);
    },
    removeFromBlacklist: (chatId) => {
      if (!state.blacklist) return;
      enqueueBlacklistRemove(chatId);
      console.log('[Autopilot] ✅ Removido da blacklist (via fila):', chatId);
    },
    getBlacklist: () => {
      return state.blacklist ? [...state.blacklist] : [];
    },
    
    // Novos métodos para integração com ConfidenceSystem
    getConfidence: () => {
      return {
        score: window.confidenceSystem?.score || 0,
        level: window.confidenceSystem?.level || 'beginner',
        copilotEnabled: window.confidenceSystem?.copilotEnabled || false,
        minRequired: CONFIG.minConfidence
      };
    },
    setMinConfidence: (value) => {
      CONFIG.minConfidence = Math.max(0, Math.min(100, value));
      console.log('[Autopilot] 📊 Confiança mínima:', CONFIG.minConfidence);
    },
    enableCopilot: () => {
      if (window.confidenceSystem?.toggleCopilot) {
        window.confidenceSystem.toggleCopilot(true);
        console.log('[Autopilot] 🤖 Modo copiloto ativado');
        updateUI();
      }
    },
    disableCopilot: () => {
      if (window.confidenceSystem?.toggleCopilot) {
        window.confidenceSystem.toggleCopilot(false);
        console.log('[Autopilot] 👀 Modo copiloto desativado (apenas sugestões)');
        updateUI();
      }
    },
    getConfig: () => ({ ...CONFIG })
  };

  // Aliases para compatibilidade com handlers e outros módulos
  window.Autopilot = window.AutopilotV2;
  window.AutoPilot = window.AutopilotV2; // Alias para autopilot-handlers.js
  window.autoPilot = window.AutopilotV2; // Alias minúsculo

  // ============================================
  // RPC (Sidepanel/UI -> Content Script)
  // Permite que o sidepanel controle o Autopilot que roda em web.whatsapp.com
  // ============================================
  function getActiveChatInfo() {
    let chatId = null;
    try {
      chatId = window.Store?.Chat?.getActive?.()?.id?._serialized || null;
    } catch (_) {}

    let name = '';
    try {
      const headerSpan = document.querySelector('header span[title]');
      const headerDiv = document.querySelector('[data-testid="conversation-info-header"] span');
      const mainHeader = document.querySelector('#main header');
      if (headerSpan) name = headerSpan.getAttribute('title') || headerSpan.textContent || '';
      else if (headerDiv) name = headerDiv.textContent || '';
      else if (mainHeader) name = mainHeader.querySelector('span[dir="auto"]')?.textContent || '';
    } catch (_) {}

    const phone = chatId ? extractPhoneFromChatId(chatId) : '';
    return { chatId, phone, name: safeText(name) };
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.action !== 'WHL_AUTOPILOT_CMD') return;

        (async () => {
          const cmd = msg.command;
          const payload = msg.payload || {};

          switch (cmd) {
            case 'start':
              window.AutopilotV2.start();
              return { stats: window.AutopilotV2.getStats(), config: window.AutopilotV2.getConfig(), blacklist: window.AutopilotV2.getBlacklist() };

            case 'pause':
              window.AutopilotV2.pause();
              return { stats: window.AutopilotV2.getStats(), config: window.AutopilotV2.getConfig(), blacklist: window.AutopilotV2.getBlacklist() };

            case 'resume':
              window.AutopilotV2.resume();
              return { stats: window.AutopilotV2.getStats(), config: window.AutopilotV2.getConfig(), blacklist: window.AutopilotV2.getBlacklist() };

            case 'stop':
              window.AutopilotV2.stop();
              return { stats: window.AutopilotV2.getStats(), config: window.AutopilotV2.getConfig(), blacklist: window.AutopilotV2.getBlacklist() };

            case 'getState':
              return { stats: window.AutopilotV2.getStats(), config: window.AutopilotV2.getConfig(), blacklist: window.AutopilotV2.getBlacklist() };

            case 'getStats':
              return { stats: window.AutopilotV2.getStats() };

            case 'getConfig':
              return { config: window.AutopilotV2.getConfig() };

            case 'setConfig':
              window.AutopilotV2.setConfig(payload.config || {});
              return { config: window.AutopilotV2.getConfig() };

            case 'getBlacklist':
              return { blacklist: window.AutopilotV2.getBlacklist() };

            case 'addToBlacklist': {
              const id = safeText(payload.chatId || payload.id);
              if (id) window.AutopilotV2.addToBlacklist(id);
              return { blacklist: window.AutopilotV2.getBlacklist() };
            }

            case 'removeFromBlacklist': {
              const id = safeText(payload.chatId || payload.id);
              if (id) window.AutopilotV2.removeFromBlacklist(id);
              return { blacklist: window.AutopilotV2.getBlacklist() };
            }

            case 'clearQueue':
              window.AutopilotV2.clearQueue();
              return { stats: window.AutopilotV2.getStats(), queueSize: window.AutopilotV2.getQueue().length };

            case 'getActiveChat':
              return { activeChat: getActiveChatInfo() };

            default:
              return { error: 'Comando desconhecido' };
          }
        })()
          .then(result => sendResponse({ success: true, ...(result || {}) }))
          .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));

        return true;
      });
    }
  } catch (e) {
    console.warn('[Autopilot] Falha ao registrar RPC handler:', e?.message || e);
  }

  // Inicializar
  loadProcessed();
  loadBlacklist();
  loadRateLimits();
  setupMessageListener();
  console.log('[Autopilot v7.5.0] ✅ Módulo carregado com blacklist');

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (eventBusBindingInterval) {
      clearInterval(eventBusBindingInterval);
      eventBusBindingInterval = null;
    }
  });

})();
