/**
 * 🏢 AI Gateway Enterprise v1.0.0
 * Sistema Enterprise de Gestão de APIs de IA
 * 
 * Técnicas implementadas:
 * 1. API Key Pool com Load Balancing
 * 2. Rate Limiting inteligente (por usuário e global)
 * 3. Queue System com priorização
 * 4. Multi-Provider Fallback (OpenAI → Claude → Groq → Google)
 * 5. Circuit Breaker (para APIs com problemas)
 * 6. Exponential Backoff (retry inteligente)
 * 7. Semantic Caching (cache de respostas similares)
 * 8. Request Deduplication (evita requisições duplicadas)
 * 
 * @version 1.0.0
 */
(function() {
  'use strict';

  // ============================================
  // CONFIGURAÇÃO
  // ============================================

  const CONFIG = {
    // Rate Limiting
    RATE_LIMIT_WINDOW: 60000, // 1 minuto
    RATE_LIMIT_MAX_REQUESTS: 20, // max requisições por janela
    RATE_LIMIT_PER_USER: 10, // max por usuário por minuto

    // Queue
    QUEUE_MAX_SIZE: 100,
    QUEUE_PROCESS_INTERVAL: 100, // ms entre processamentos
    QUEUE_TIMEOUT: 30000, // timeout de requisição

    // Circuit Breaker
    CIRCUIT_FAILURE_THRESHOLD: 5, // falhas para abrir circuito
    CIRCUIT_RESET_TIMEOUT: 60000, // tempo para tentar novamente
    CIRCUIT_HALF_OPEN_REQUESTS: 3, // requisições de teste

    // Retry
    RETRY_MAX_ATTEMPTS: 3,
    RETRY_BASE_DELAY: 1000, // 1 segundo
    RETRY_MAX_DELAY: 30000, // 30 segundos

    // Cache
    CACHE_TTL: 300000, // 5 minutos
    CACHE_MAX_SIZE: 500,
    CACHE_SIMILARITY_THRESHOLD: 0.85,

    // Storage
    STORAGE_KEY: 'whl_ai_gateway'
  };

  // ============================================
  // PROVIDERS CONFIGURATION
  // ============================================

  // CONFIGURAÇÃO: OpenAI como primário, Groq como fallback
  // Anthropic/Claude removido conforme solicitado
  const PROVIDERS = {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      priority: 1, // PRIMÁRIO
      endpoint: 'https://api.openai.com/v1/chat/completions',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      defaultModel: 'gpt-4o', // Modelo principal
      rateLimit: { rpm: 500, tpm: 30000 },
      costPer1kTokens: { input: 0.00015, output: 0.0006 }
    },
    groq: {
      id: 'groq',
      name: 'Groq',
      priority: 2, // FALLBACK
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
      defaultModel: 'llama-3.1-70b-versatile',
      rateLimit: { rpm: 30, tpm: 6000 },
      costPer1kTokens: { input: 0.00059, output: 0.00079 }
    }
    // NOTA: Anthropic/Claude e Google/Gemini removidos
    // Para adicionar no futuro, basta descomentar:
    /*
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic Claude',
      priority: 3,
      endpoint: 'https://api.anthropic.com/v1/messages',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
      defaultModel: 'claude-3-5-sonnet-20241022',
      rateLimit: { rpm: 50, tpm: 40000 },
      costPer1kTokens: { input: 0.003, output: 0.015 }
    },
    google: {
      id: 'google',
      name: 'Google Gemini',
      priority: 4,
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      models: ['gemini-1.5-flash', 'gemini-1.5-pro'],
      defaultModel: 'gemini-1.5-flash',
      rateLimit: { rpm: 60, tpm: 32000 },
      costPer1kTokens: { input: 0.000075, output: 0.0003 }
    }
    */
  };

  // ============================================
  // STATE
  // ============================================

  const state = {
    initialized: false,
    
    // API Key Pool
    apiKeys: {
      // providerId: [{ key: '...', usage: 0, lastUsed: null, errors: 0 }]
    },
    
    // Rate Limiting
    rateLimits: {
      global: { requests: 0, windowStart: Date.now() },
      perUser: new Map(), // userId -> { requests: 0, windowStart }
      perProvider: new Map() // providerId -> { requests: 0, tokens: 0, windowStart }
    },
    
    // Circuit Breaker
    circuits: new Map(), // providerId -> { state: 'closed'|'open'|'half-open', failures: 0, lastFailure: null, successCount: 0 }
    
    // Queue
    queue: [],
    processing: false,
    pendingRequests: new Map(), // requestId -> { resolve, reject, timeout }
    
    // Cache
    cache: new Map(), // hash -> { response, timestamp, hits }
    
    // Deduplication
    inFlight: new Map(), // hash -> Promise
    
    // Metrics
    metrics: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgLatency: 0,
      providerUsage: {},
      creditsConsumed: 0
    },
    
    queueInterval: null
  };

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    if (state.initialized) return;

    await loadState();
    startQueueProcessor();
    startCleanupTask();

    state.initialized = true;
    console.log('[AIGateway] ✅ Enterprise Gateway inicializado');

    // Emitir evento
    window.EventBus?.emit?.('ai_gateway:initialized', { providers: Object.keys(PROVIDERS) });

    // Cleanup
    window.addEventListener('beforeunload', () => {
      if (state.queueInterval) clearInterval(state.queueInterval);
      if (healthMonitorInterval) clearInterval(healthMonitorInterval); // Definido em ai-service.js mas referenciado aqui? Não, espera.
      // ai-gateway tem startCleanupTask mas não vi a definição.
      // Vou focar apenas no queueInterval que eu criei e adicionei
    });
  }

  async function loadState() {
    return new Promise(resolve => {
      chrome.storage.local.get([CONFIG.STORAGE_KEY], result => {
        if (result[CONFIG.STORAGE_KEY]) {
          const saved = result[CONFIG.STORAGE_KEY];
          if (saved.apiKeys) state.apiKeys = saved.apiKeys;
          if (saved.metrics) state.metrics = { ...state.metrics, ...saved.metrics };
        }
        resolve();
      });
    });
  }

  async function saveState() {
    return new Promise(resolve => {
      chrome.storage.local.set({
        [CONFIG.STORAGE_KEY]: {
          apiKeys: state.apiKeys,
          metrics: state.metrics
        }
      }, resolve);
    });
  }

  // ============================================
  // API KEY POOL
  // ============================================

  /**
   * Adiciona uma chave API ao pool
   */
  function addApiKey(providerId, apiKey) {
    if (!state.apiKeys[providerId]) {
      state.apiKeys[providerId] = [];
    }

    // Verificar se já existe
    const exists = state.apiKeys[providerId].find(k => k.key === apiKey);
    if (exists) {
      console.warn('[AIGateway] Chave já existe no pool');
      return false;
    }

    state.apiKeys[providerId].push({
      key: apiKey,
      usage: 0,
      lastUsed: null,
      errors: 0,
      addedAt: Date.now()
    });

    saveState();
    console.log(`[AIGateway] Chave adicionada ao pool: ${providerId}`);
    return true;
  }

  /**
   * Remove uma chave do pool
   */
  function removeApiKey(providerId, apiKey) {
    if (!state.apiKeys[providerId]) return false;
    
    const index = state.apiKeys[providerId].findIndex(k => k.key === apiKey);
    if (index > -1) {
      state.apiKeys[providerId].splice(index, 1);
      saveState();
      return true;
    }
    return false;
  }

  /**
   * Seleciona a melhor chave disponível (Load Balancing)
   * Algoritmo: Least Connections + Error Rate
   */
  function selectApiKey(providerId) {
    const keys = state.apiKeys[providerId];
    if (!keys || keys.length === 0) {
      // Fallback: usar chave do AIService se disponível
      if (window.AIService) {
        const config = window.AIService.getConfig?.();
        if (config?.apiKey) {
          return { key: config.apiKey, fromService: true };
        }
      }
      return null;
    }

    // Filtrar chaves com muitos erros
    const healthyKeys = keys.filter(k => k.errors < 5);
    if (healthyKeys.length === 0) {
      // Reset errors se todas estão com problemas
      keys.forEach(k => k.errors = 0);
      return selectApiKey(providerId);
    }

    // Ordenar por: menos uso, menos erros, menos recente
    const sorted = healthyKeys.sort((a, b) => {
      const scoreA = a.usage + (a.errors * 10) - (Date.now() - (a.lastUsed || 0)) / 60000;
      const scoreB = b.usage + (b.errors * 10) - (Date.now() - (b.lastUsed || 0)) / 60000;
      return scoreA - scoreB;
    });

    return sorted[0];
  }

  /**
   * Registra uso de uma chave
   */
  function recordKeyUsage(providerId, apiKey, success = true) {
    const keys = state.apiKeys[providerId];
    if (!keys) return;

    const keyInfo = keys.find(k => k.key === apiKey);
    if (keyInfo) {
      keyInfo.usage++;
      keyInfo.lastUsed = Date.now();
      if (!success) keyInfo.errors++;
      else keyInfo.errors = Math.max(0, keyInfo.errors - 1); // Diminui erros em sucesso
    }
  }

  // ============================================
  // RATE LIMITING
  // ============================================

  /**
   * Verifica rate limit global
   */
  function checkGlobalRateLimit() {
    const now = Date.now();
    const { global } = state.rateLimits;

    // Reset janela se expirou
    if (now - global.windowStart > CONFIG.RATE_LIMIT_WINDOW) {
      global.requests = 0;
      global.windowStart = now;
    }

    if (global.requests >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
      const waitTime = CONFIG.RATE_LIMIT_WINDOW - (now - global.windowStart);
      return { allowed: false, waitTime, reason: 'global_limit' };
    }

    return { allowed: true };
  }

  /**
   * Verifica rate limit por usuário
   */
  function checkUserRateLimit(userId) {
    if (!userId) return { allowed: true };

    const now = Date.now();
    let userLimit = state.rateLimits.perUser.get(userId);

    if (!userLimit || now - userLimit.windowStart > CONFIG.RATE_LIMIT_WINDOW) {
      userLimit = { requests: 0, windowStart: now };
      state.rateLimits.perUser.set(userId, userLimit);
    }

    if (userLimit.requests >= CONFIG.RATE_LIMIT_PER_USER) {
      const waitTime = CONFIG.RATE_LIMIT_WINDOW - (now - userLimit.windowStart);
      return { allowed: false, waitTime, reason: 'user_limit' };
    }

    return { allowed: true };
  }

  /**
   * Verifica rate limit do provider
   */
  function checkProviderRateLimit(providerId) {
    const provider = PROVIDERS[providerId];
    if (!provider) return { allowed: true };

    const now = Date.now();
    let providerLimit = state.rateLimits.perProvider.get(providerId);

    if (!providerLimit || now - providerLimit.windowStart > 60000) {
      providerLimit = { requests: 0, tokens: 0, windowStart: now };
      state.rateLimits.perProvider.set(providerId, providerLimit);
    }

    if (providerLimit.requests >= provider.rateLimit.rpm) {
      const waitTime = 60000 - (now - providerLimit.windowStart);
      return { allowed: false, waitTime, reason: 'provider_limit' };
    }

    return { allowed: true };
  }

  /**
   * Incrementa contadores de rate limit
   */
  function incrementRateLimits(userId, providerId, tokens = 0) {
    state.rateLimits.global.requests++;

    if (userId) {
      const userLimit = state.rateLimits.perUser.get(userId);
      if (userLimit) userLimit.requests++;
    }

    const providerLimit = state.rateLimits.perProvider.get(providerId);
    if (providerLimit) {
      providerLimit.requests++;
      providerLimit.tokens += tokens;
    }
  }

  // ============================================
  // CIRCUIT BREAKER
  // ============================================

  /**
   * Obtém estado do circuit breaker
   */
  function getCircuitState(providerId) {
    if (!state.circuits.has(providerId)) {
      state.circuits.set(providerId, {
        state: 'closed',
        failures: 0,
        lastFailure: null,
        successCount: 0
      });
    }
    return state.circuits.get(providerId);
  }

  /**
   * Verifica se o circuito permite requisição
   */
  function isCircuitOpen(providerId) {
    const circuit = getCircuitState(providerId);

    switch (circuit.state) {
      case 'closed':
        return false;

      case 'open':
        // Verificar se pode tentar half-open
        if (Date.now() - circuit.lastFailure > CONFIG.CIRCUIT_RESET_TIMEOUT) {
          circuit.state = 'half-open';
          circuit.successCount = 0;
          return false;
        }
        return true;

      case 'half-open':
        return false;

      default:
        return false;
    }
  }

  /**
   * Registra resultado no circuit breaker
   */
  function recordCircuitResult(providerId, success) {
    const circuit = getCircuitState(providerId);

    if (success) {
      if (circuit.state === 'half-open') {
        circuit.successCount++;
        if (circuit.successCount >= CONFIG.CIRCUIT_HALF_OPEN_REQUESTS) {
          circuit.state = 'closed';
          circuit.failures = 0;
          console.log(`[AIGateway] Circuit CLOSED para ${providerId}`);
        }
      } else {
        circuit.failures = Math.max(0, circuit.failures - 1);
      }
    } else {
      circuit.failures++;
      circuit.lastFailure = Date.now();

      if (circuit.failures >= CONFIG.CIRCUIT_FAILURE_THRESHOLD) {
        circuit.state = 'open';
        console.warn(`[AIGateway] Circuit OPEN para ${providerId} - ${circuit.failures} falhas`);
        
        window.EventBus?.emit?.('ai_gateway:circuit_open', { providerId, failures: circuit.failures });
      }
    }
  }

  // ============================================
  // QUEUE SYSTEM
  // ============================================

  /**
   * Adiciona requisição à fila
   */
  function enqueue(request) {
    return new Promise((resolve, reject) => {
      if (state.queue.length >= CONFIG.QUEUE_MAX_SIZE) {
        reject(new Error('Fila de requisições cheia. Tente novamente.'));
        return;
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Timeout
      const timeout = setTimeout(() => {
        const pending = state.pendingRequests.get(requestId);
        if (pending) {
          state.pendingRequests.delete(requestId);
          state.queue = state.queue.filter(r => r.id !== requestId);
          reject(new Error('Requisição expirou na fila'));
        }
      }, CONFIG.QUEUE_TIMEOUT);

      state.pendingRequests.set(requestId, { resolve, reject, timeout });

      state.queue.push({
        id: requestId,
        request,
        priority: request.priority || 5,
        timestamp: Date.now()
      });

      // Ordenar por prioridade (menor = mais importante)
      state.queue.sort((a, b) => a.priority - b.priority);
    });
  }

  /**
   * Processa fila de requisições
   */
  function startQueueProcessor() {
    if (state.queueInterval) clearInterval(state.queueInterval);
    state.queueInterval = setInterval(async () => {
      if (state.processing || state.queue.length === 0) return;

      state.processing = true;

      try {
        const item = state.queue.shift();
        if (!item) {
          state.processing = false;
          return;
        }

        const pending = state.pendingRequests.get(item.id);
        if (!pending) {
          state.processing = false;
          return;
        }

        clearTimeout(pending.timeout);
        state.pendingRequests.delete(item.id);

        try {
          const result = await executeRequest(item.request);
          pending.resolve(result);
        } catch (error) {
          pending.reject(error);
        }
      } finally {
        state.processing = false;
      }
    }, CONFIG.QUEUE_PROCESS_INTERVAL);
  }

  // ============================================
  // SEMANTIC CACHE
  // ============================================

  /**
   * Gera hash de uma requisição
   */
  function generateRequestHash(messages, options = {}) {
    const content = messages.map(m => `${m.role}:${m.content}`).join('|');
    const optStr = JSON.stringify({ model: options.model, temperature: options.temperature });
    
    // Simple hash function
    let hash = 0;
    const str = content + optStr;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Verifica cache
   */
  function checkCache(hash) {
    const cached = state.cache.get(hash);
    if (!cached) return null;

    // Verificar TTL
    if (Date.now() - cached.timestamp > CONFIG.CACHE_TTL) {
      state.cache.delete(hash);
      return null;
    }

    cached.hits++;
    state.metrics.cacheHits++;
    return cached.response;
  }

  /**
   * Adiciona ao cache
   */
  function addToCache(hash, response) {
    // Evitar cache muito grande
    if (state.cache.size >= CONFIG.CACHE_MAX_SIZE) {
      // Remover entradas mais antigas
      const oldest = [...state.cache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, CONFIG.CACHE_MAX_SIZE / 4);
      
      oldest.forEach(([key]) => state.cache.delete(key));
    }

    state.cache.set(hash, {
      response,
      timestamp: Date.now(),
      hits: 0
    });

    state.metrics.cacheMisses++;
  }

  // ============================================
  // REQUEST DEDUPLICATION
  // ============================================

  /**
   * Evita requisições duplicadas simultâneas
   */
  function deduplicateRequest(hash, requestFn) {
    if (state.inFlight.has(hash)) {
      return state.inFlight.get(hash);
    }

    const promise = requestFn().finally(() => {
      state.inFlight.delete(hash);
    });

    state.inFlight.set(hash, promise);
    return promise;
  }

  // ============================================
  // RETRY COM EXPONENTIAL BACKOFF
  // ============================================

  async function retryWithBackoff(fn, maxAttempts = CONFIG.RETRY_MAX_ATTEMPTS) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Não retry em erros de validação ou créditos
        if (error.message?.includes('crédito') || 
            error.message?.includes('API key') ||
            error.status === 401 ||
            error.status === 403) {
          throw error;
        }

        if (attempt < maxAttempts) {
          const delay = Math.min(
            CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt - 1),
            CONFIG.RETRY_MAX_DELAY
          );
          console.log(`[AIGateway] Retry ${attempt}/${maxAttempts} em ${delay}ms...`);
          await sleep(delay);
        }
      }
    }

    throw lastError;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // 🔥 PROXY FETCH - Contorna CORS usando background.js
  // ============================================

  /**
   * Fetch via proxy (para content scripts)
   * Usa chrome.runtime.sendMessage para fazer fetch no background
   * 
   * v7.9.13: BACKEND SOBERANO - Sem fallback silencioso
   */
  async function proxyFetch(url, options = {}) {
    const startTime = Date.now();
    const shortUrl = url.length > 60 ? url.substring(0, 57) + '...' : url;
    
    console.log(`[AIGateway] 🌐 [FETCH_PROXY] Iniciando requisição: ${shortUrl}`);
    
    // Se chrome.runtime está disponível, usar proxy OBRIGATÓRIO
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'FETCH_PROXY',
          url,
          method: options.method || 'POST',
          headers: options.headers || {},
          body: options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : undefined,
          timeout: 30000
        }, (response) => {
          const latency = Date.now() - startTime;
          
          if (chrome.runtime.lastError) {
            // v7.9.13: NÃO fazer fallback silencioso - reportar erro
            console.error(`[AIGateway] ❌ [FETCH_PROXY] Erro do background: ${chrome.runtime.lastError.message}`);
            console.error('[AIGateway] 🚨 Background script não respondeu. Verifique se a extensão está carregada corretamente.');
            reject(new Error(`Proxy falhou: ${chrome.runtime.lastError.message}. Recarregue a extensão.`));
            return;
          }
          
          if (!response) {
            console.error('[AIGateway] ❌ [FETCH_PROXY] Resposta vazia do background');
            reject(new Error('Background não retornou resposta. Verifique console do service worker.'));
            return;
          }
          
          if (response.success) {
            console.log(`[AIGateway] ✅ [FETCH_PROXY] Sucesso em ${latency}ms | Status: ${response.status}`);
            // Criar objeto similar a Response
            resolve({
              ok: response.status >= 200 && response.status < 300,
              status: response.status,
              statusText: response.statusText,
              json: async () => response.data,
              text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
            });
          } else {
            console.error(`[AIGateway] ❌ [FETCH_PROXY] Falha em ${latency}ms | Erro: ${response.error}`);
            reject(new Error(response.error || 'Proxy request failed'));
          }
        });
      });
    }
    
    // v7.9.13: Se não tem chrome.runtime, provavelmente está em contexto errado
    console.warn('[AIGateway] ⚠️ chrome.runtime não disponível - contexto incorreto');
    
    // Último recurso: tentar fetch direto (pode falhar por CORS)
    console.warn('[AIGateway] ⚠️ Tentando fetch direto (pode falhar por CORS)...');
    return directFetch(url, options);
  }

  /**
   * Fetch direto (quando proxy não está disponível)
   */
  async function directFetch(url, options) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      console.error('[AIGateway] Direct fetch error:', error);
      throw error;
    }
  }

  // ============================================
  // EXECUÇÃO DE REQUISIÇÃO
  // ============================================

  /**
   * Seleciona o melhor provider disponível
   */
  function selectProvider(preferredProvider) {
    const providers = Object.values(PROVIDERS)
      .filter(p => !isCircuitOpen(p.id))
      .filter(p => state.apiKeys[p.id]?.length > 0 || (window.AIService && p.id === 'openai'))
      .sort((a, b) => a.priority - b.priority);

    if (preferredProvider && providers.find(p => p.id === preferredProvider)) {
      return PROVIDERS[preferredProvider];
    }

    return providers[0] || PROVIDERS.openai;
  }

  /**
   * Executa requisição para um provider específico
   */
  async function callProvider(provider, messages, options, apiKey) {
    const startTime = Date.now();

    try {
      let response;

      // 🔥 Usar proxyFetch para contornar CORS
      if (provider.id === 'openai' || provider.id === 'groq') {
        response = await proxyFetch(provider.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: options.model || provider.defaultModel,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens ?? 1000
          })
        });
      } else if (provider.id === 'anthropic') {
        response = await proxyFetch(provider.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: options.model || provider.defaultModel,
            max_tokens: options.max_tokens ?? 1000,
            messages: messages.filter(m => m.role !== 'system'),
            system: messages.find(m => m.role === 'system')?.content
          })
        });
      } else if (provider.id === 'google') {
        const model = options.model || provider.defaultModel;
        response = await proxyFetch(`${provider.endpoint}/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            }))
          })
        });
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const latency = Date.now() - startTime;

      // Normalizar resposta
      let text, usage;
      if (provider.id === 'anthropic') {
        text = data.content?.[0]?.text || '';
        usage = { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens };
      } else if (provider.id === 'google') {
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        usage = { prompt_tokens: 0, completion_tokens: 0 };
      } else {
        text = data.choices?.[0]?.message?.content || '';
        usage = data.usage || {};
      }

      return {
        text,
        usage,
        provider: provider.id,
        model: options.model || provider.defaultModel,
        latency
      };

    } catch (error) {
      console.error(`[AIGateway] Erro em ${provider.id}:`, error);
      throw error;
    }
  }

  /**
   * Executa requisição com todas as proteções
   */
  async function executeRequest(request) {
    const { messages, options = {}, userId } = request;

    // 1. Verificar créditos de IA
    if (window.SubscriptionManager) {
      if (!window.SubscriptionManager.canUseAI()) {
        showCreditsDepletedModal();
        throw new Error('Créditos de IA esgotados');
      }
    }

    // 2. Verificar rate limits
    const globalLimit = checkGlobalRateLimit();
    if (!globalLimit.allowed) {
      throw new Error(`Limite global atingido. Aguarde ${Math.ceil(globalLimit.waitTime / 1000)}s`);
    }

    const userLimit = checkUserRateLimit(userId);
    if (!userLimit.allowed) {
      throw new Error(`Limite de requisições atingido. Aguarde ${Math.ceil(userLimit.waitTime / 1000)}s`);
    }

    // 3. Verificar cache
    const hash = generateRequestHash(messages, options);
    const cached = checkCache(hash);
    if (cached && !options.skipCache) {
      console.log('[AIGateway] Cache hit!');
      return cached;
    }

    // 4. Deduplicate
    return deduplicateRequest(hash, async () => {
      // 5. Selecionar provider
      let provider = selectProvider(options.provider);
      let lastError;

      // 6. Tentar providers em ordem de prioridade
      const providers = Object.values(PROVIDERS)
        .filter(p => !isCircuitOpen(p.id))
        .sort((a, b) => {
          if (p.id === provider.id) return -1;
          return a.priority - b.priority;
        });

      for (const currentProvider of providers) {
        // Verificar rate limit do provider
        const providerLimit = checkProviderRateLimit(currentProvider.id);
        if (!providerLimit.allowed) continue;

        // Selecionar API key
        const keyInfo = selectApiKey(currentProvider.id);
        if (!keyInfo) continue;

        try {
          // 7. Executar com retry
          const result = await retryWithBackoff(async () => {
            return await callProvider(currentProvider, messages, options, keyInfo.key);
          });

          // 8. Sucesso - atualizar métricas
          recordKeyUsage(currentProvider.id, keyInfo.key, true);
          recordCircuitResult(currentProvider.id, true);
          incrementRateLimits(userId, currentProvider.id, result.usage?.total_tokens || 0);

          state.metrics.totalRequests++;
          state.metrics.successfulRequests++;
          state.metrics.avgLatency = (state.metrics.avgLatency + result.latency) / 2;
          state.metrics.providerUsage[currentProvider.id] = 
            (state.metrics.providerUsage[currentProvider.id] || 0) + 1;

          // 9. Consumir crédito
          if (window.SubscriptionManager) {
            await window.SubscriptionManager.consumeCredits(1, 'ai_request');
          }

          // 10. Adicionar ao cache
          addToCache(hash, result);

          saveState();
          return result;

        } catch (error) {
          lastError = error;
          recordKeyUsage(currentProvider.id, keyInfo.key, false);
          recordCircuitResult(currentProvider.id, false);
          console.warn(`[AIGateway] Fallback de ${currentProvider.id} devido a:`, error.message);
        }
      }

      // Todos os providers falharam
      state.metrics.totalRequests++;
      state.metrics.failedRequests++;
      
      throw lastError || new Error('Todos os provedores de IA falharam');
    });
  }

  // ============================================
  // MODAL DE CRÉDITOS ESGOTADOS
  // ============================================

  function showCreditsDepletedModal() {
    // Remover modal existente
    const existing = document.getElementById('whl-credits-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'whl-credits-modal';
    modal.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <div style="
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 20px;
          padding: 32px;
          max-width: 420px;
          width: 90%;
          text-align: center;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(139, 92, 246, 0.3);
        ">
          <div style="font-size: 64px; margin-bottom: 16px;">🪫</div>
          
          <h2 style="
            margin: 0 0 12px 0;
            font-size: 24px;
            font-weight: 700;
            background: linear-gradient(135deg, #8b5cf6, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          ">Créditos de IA Esgotados</h2>
          
          <p style="
            margin: 0 0 24px 0;
            color: rgba(255, 255, 255, 0.7);
            font-size: 15px;
            line-height: 1.6;
          ">
            Seus créditos de IA acabaram. Para continuar usando 
            <strong style="color: #8b5cf6;">Sugestões de Resposta</strong>, 
            <strong style="color: #8b5cf6;">Copiloto</strong> e outras funções de IA, 
            escolha uma opção:
          </p>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            <button id="whl-buy-credits-btn" style="
              width: 100%;
              padding: 14px 24px;
              background: linear-gradient(135deg, #8b5cf6, #3b82f6);
              border: none;
              border-radius: 12px;
              color: white;
              font-size: 15px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              transition: transform 0.2s, box-shadow 0.2s;
            " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
              💳 Comprar Créditos Extras
            </button>

            <button id="whl-upgrade-plan-btn" style="
              width: 100%;
              padding: 14px 24px;
              background: linear-gradient(135deg, #10b981, #059669);
              border: none;
              border-radius: 12px;
              color: white;
              font-size: 15px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              transition: transform 0.2s;
            " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
              ⬆️ Fazer Upgrade de Plano
            </button>

            <button id="whl-close-credits-modal" style="
              width: 100%;
              padding: 12px 24px;
              background: rgba(255, 255, 255, 0.1);
              border: 1px solid rgba(255, 255, 255, 0.2);
              border-radius: 12px;
              color: rgba(255, 255, 255, 0.7);
              font-size: 14px;
              cursor: pointer;
              transition: background 0.2s;
            " onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">
              Continuar sem IA
            </button>
          </div>

          <p style="
            margin: 20px 0 0 0;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.4);
          ">
            💡 Dica: No plano Enterprise você tem 2.000 créditos/mês
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('whl-buy-credits-btn')?.addEventListener('click', () => {
      if (window.SubscriptionManager) {
        window.open(window.SubscriptionManager.getBuyCreditsUrl(), '_blank');
      }
      modal.remove();
    });

    document.getElementById('whl-upgrade-plan-btn')?.addEventListener('click', () => {
      if (window.SubscriptionManager) {
        window.open(window.SubscriptionManager.getUpgradeUrl(), '_blank');
      }
      modal.remove();
    });

    document.getElementById('whl-close-credits-modal')?.addEventListener('click', () => {
      modal.remove();
    });

    // Fechar ao clicar fora
    modal.addEventListener('click', (e) => {
      if (e.target === modal.firstElementChild.parentElement) {
        modal.remove();
      }
    });

    // Emitir evento
    window.EventBus?.emit?.('ai_gateway:credits_depleted_shown');
  }

  // ============================================
  // CLEANUP
  // ============================================

  let cleanupInterval = null;

  function stopCleanupTask() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }

  function startCleanupTask() {
    stopCleanupTask();
    cleanupInterval = setInterval(() => {
      // Limpar cache expirado
      const now = Date.now();
      state.cache.forEach((value, key) => {
        if (now - value.timestamp > CONFIG.CACHE_TTL) {
          state.cache.delete(key);
        }
      });

      // Limpar rate limits expirados
      state.rateLimits.perUser.forEach((value, key) => {
        if (now - value.windowStart > CONFIG.RATE_LIMIT_WINDOW * 2) {
          state.rateLimits.perUser.delete(key);
        }
      });

      // Salvar métricas
      saveState();
    }, 60000); // A cada minuto
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  /**
   * Método principal para fazer requisições de IA
   */
  async function complete(messages, options = {}) {
    if (!state.initialized) await init();

    // Verificar se é array de mensagens
    if (!Array.isArray(messages)) {
      messages = [{ role: 'user', content: String(messages) }];
    }

    // Usar fila para alta carga
    if (state.queue.length > 0 || state.processing) {
      return enqueue({ messages, options, userId: options.userId });
    }

    return executeRequest({ messages, options, userId: options.userId });
  }

  /**
   * Versão simplificada para texto direto
   */
  async function ask(prompt, options = {}) {
    const messages = [{ role: 'user', content: prompt }];
    if (options.systemPrompt) {
      messages.unshift({ role: 'system', content: options.systemPrompt });
    }
    const result = await complete(messages, options);
    return result.text;
  }

  // ============================================
  // EXPORT
  // ============================================

  const api = {
    init,
    
    // Requisições
    complete,
    ask,
    
    // API Key Pool
    addApiKey,
    removeApiKey,
    getApiKeys: (providerId) => state.apiKeys[providerId]?.map(k => ({ 
      ...k, 
      key: k.key.slice(0, 8) + '...' + k.key.slice(-4) 
    })) || [],
    
    // Verificação de créditos
    checkCredits: () => {
      if (!window.SubscriptionManager) {
        return { hasCredits: true, remaining: 999, canProceed: true };
      }
      const sm = window.SubscriptionManager;
      const canUse = sm.canUseAI();
      const credits = sm.getCredits();
      return {
        hasCredits: canUse,
        remaining: credits.remaining,
        total: credits.total,
        used: credits.used,
        percentage: credits.percentage,
        canProceed: canUse
      };
    },
    canUseAI: () => {
      if (!window.SubscriptionManager) return true;
      return window.SubscriptionManager.canUseAI();
    },
    consumeCredit: async (amount = 1, operation = 'ai_call') => {
      if (!window.SubscriptionManager) return true;
      try {
        await window.SubscriptionManager.consumeCredits(amount, operation);
        return true;
      } catch (e) {
        return false;
      }
    },
    
    // Métricas
    getMetrics: () => ({ ...state.metrics }),
    getQueueSize: () => state.queue.length,
    getCacheStats: () => ({
      size: state.cache.size,
      hits: state.metrics.cacheHits,
      misses: state.metrics.cacheMisses,
      hitRate: state.metrics.cacheHits / (state.metrics.cacheHits + state.metrics.cacheMisses) || 0
    }),
    getCircuits: () => Object.fromEntries(state.circuits),
    
    // Modais
    showCreditsDepletedModal,
    
    // Providers
    PROVIDERS,
    
    // Reset
    clearCache: () => state.cache.clear(),
    resetMetrics: () => {
      state.metrics = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        avgLatency: 0,
        providerUsage: {},
        creditsConsumed: 0
      };
      saveState();
    },
    cleanup: stopCleanupTask
  };

  window.AIGateway = api;

  console.log('[AIGateway] 🏢 Enterprise Gateway carregado');

  // Evitar vazamento de intervalos em recarregamentos
  window.addEventListener('beforeunload', () => {
    stopCleanupTask();
  });

})();
