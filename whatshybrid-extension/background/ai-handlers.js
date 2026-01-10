/**
 * WhatsHybrid Background - AI / Memory / Few-shot / Proxy handlers
 *
 * Este arquivo foi extraído do `background.js` para reduzir tamanho e melhorar manutenibilidade
 * sem alterar comportamento (HIGH-011).
 */

// ============================================
// AI SYSTEM HANDLERS
// ============================================

// Memory queue for offline storage
let memoryQueue = [];
const MAX_MEMORY_QUEUE = 500;
const MEMORY_EVENT_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MEMORY_QUEUE_STORAGE_KEY = 'whl_memory_queue';

// Carregar queue do storage ao inicializar (previne perda quando SW é terminado)
(async () => {
  try {
    const result = await chrome.storage.local.get([MEMORY_QUEUE_STORAGE_KEY]);
    if (result[MEMORY_QUEUE_STORAGE_KEY] && Array.isArray(result[MEMORY_QUEUE_STORAGE_KEY])) {
      memoryQueue = result[MEMORY_QUEUE_STORAGE_KEY];
      console.log('[Background] ✅ Memory queue carregada do storage:', memoryQueue.length, 'eventos');
    }
  } catch (error) {
    console.error('[Background] ❌ Erro ao carregar memory queue:', error);
  }
})();

/**
 * Enfileira evento de memória
 */
async function enqueueMemoryEvent(event) {
  try {
    memoryQueue.push({
      ...event,
      timestamp: event.timestamp || Date.now()
    });
    
    // Limita tamanho da fila
    if (memoryQueue.length > MAX_MEMORY_QUEUE) {
      memoryQueue = memoryQueue.slice(-MAX_MEMORY_QUEUE);
    }
    
    // Remove eventos muito antigos
    const cutoff = Date.now() - MEMORY_EVENT_MAX_AGE;
    memoryQueue = memoryQueue.filter(e => e.timestamp > cutoff);
    
    // Salva fila
    await chrome.storage.local.set({ whl_memory_queue: memoryQueue });
    
    console.log('[Background] Evento de memória enfileirado. Fila:', memoryQueue.length);
  } catch (error) {
    console.error('[Background] Erro ao enfileirar evento:', error);
  }
}

/**
 * Envia fila de memórias para o backend com exponential backoff
 * @param {Object} settings - Configurações do backend
 * @param {number} retryCount - Contador de tentativas (para recursão)
 * @returns {Promise<Object>} Resultado da sincronização
 */
async function flushMemoryQueue(settings, retryCount = 0) {
  if (memoryQueue.length === 0) return { success: true, synced: 0 };

  const MAX_RETRIES = 5;
  const BASE_DELAY = 1000; // 1 segundo
  const MAX_DELAY = 5 * 60 * 1000; // 5 minutos

  try {
    // Backend config compat: aceitar múltiplos schemas
    const stored = await chrome.storage.local.get(['whl_backend_config', 'whl_backend_client', 'backend_url', 'backend_token', 'whl_backend_url']);
    const cfg = stored?.whl_backend_config || null;

    let backendUrl = cfg?.url || settings?.backend_url || stored?.backend_url || stored?.whl_backend_url || 'http://localhost:3000';
    let token = cfg?.token || settings?.backend_token || stored?.backend_token || null;

    if ((!backendUrl || !token) && stored?.whl_backend_client) {
      try {
        const parsed = JSON.parse(stored.whl_backend_client);
        backendUrl = backendUrl || parsed?.baseUrl || backendUrl;
        token = token || parsed?.accessToken || token;
      } catch (_) {}
    }

    backendUrl = String(backendUrl || 'http://localhost:3000').replace(/\/$/, '');

    if (!token) {
      console.warn('[Background] Token não configurado, memórias não serão sincronizadas');
      return { success: false, error: 'NO_TOKEN' };
    }

    // Marcar eventos com retry count
    const eventsToSync = memoryQueue.map(e => ({
      ...e,
      retryCount: (e.retryCount || 0) + 1
    }));

    const response = await fetch(`${backendUrl}/api/v1/memory/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ events: eventsToSync })
    });

    if (response.ok) {
      console.log(`[Background] ✅ Memórias sincronizadas: ${memoryQueue.length} eventos`);
      memoryQueue = [];
      await chrome.storage.local.set({ whl_memory_queue: [] });
      return { success: true, synced: eventsToSync.length };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn(`[Background] ⚠️ Falha na sincronização (tentativa ${retryCount + 1}/${MAX_RETRIES}): ${error.message}`);

    // Se excedeu máximo de tentativas
    if (retryCount >= MAX_RETRIES) {
      console.error('[Background] ❌ Máximo de tentativas excedido. Eventos serão mantidos na fila.');

      // Marcar eventos com erro
      memoryQueue = memoryQueue.map(e => ({
        ...e,
        retryCount: (e.retryCount || 0) + 1,
        needsManualSync: true,
        lastError: error.message,
        lastRetryAt: Date.now()
      }));

      await chrome.storage.local.set({ whl_memory_queue: memoryQueue });
      return { success: false, error: 'MAX_RETRIES_EXCEEDED', pending: memoryQueue.length };
    }

    // Calcular delay exponencial: 1s, 2s, 4s, 8s, 16s, max 5min
    const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount), MAX_DELAY);
    console.log(`[Background] 🔄 Tentando novamente em ${Math.round(delay/1000)}s...`);

    // Aguardar e tentar novamente (recursivo)
    await new Promise(resolve => setTimeout(resolve, delay));
    return flushMemoryQueue(settings, retryCount + 1);
  }
}

/**
 * Handler: MEMORY_PUSH
 */
async function handleMemoryPush(message, sender, sendResponse) {
  try {
    await enqueueMemoryEvent(message.event || { type: 'unknown' });
    
    // Tenta sincronizar se habilitado
    const settings = await chrome.storage.local.get(['backend_token', 'backend_url', 'memory_sync_enabled']);
    if (settings.memory_sync_enabled) {
      await flushMemoryQueue(settings);
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background] Erro em MEMORY_PUSH:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: MEMORY_QUERY
 */
async function handleMemoryQuery(message, sender, sendResponse) {
  try {
    const settings = await chrome.storage.local.get(['backend_token', 'backend_url']);
    const backendUrl = settings?.backend_url || 'http://localhost:3000';
    const token = settings?.backend_token;
    
    if (!token) {
      sendResponse({ success: false, error: 'Backend não configurado' });
      return;
    }
    
    // Rota corrigida (Memória v1)
    const response = await fetch(`${backendUrl}/api/v1/memory/query?chatKey=${encodeURIComponent(message.chatKey)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      sendResponse({ success: true, memory: data.memory });
    } else {
      sendResponse({ success: false, error: `HTTP ${response.status}` });
    }
  } catch (error) {
    console.error('[Background] Erro em MEMORY_QUERY:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: GET_CONFIDENCE
 */
async function handleGetConfidence(message, sender, sendResponse) {
  try {
    const data = await chrome.storage.local.get('whl_confidence_system');
    if (data.whl_confidence_system) {
      const confidence = JSON.parse(data.whl_confidence_system);
      sendResponse({ success: true, confidence });
    } else {
      sendResponse({ success: true, confidence: { score: 0, level: 'beginner' } });
    }
  } catch (error) {
    console.error('[Background] Erro em GET_CONFIDENCE:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: UPDATE_CONFIDENCE
 */
async function handleUpdateConfidence(message, sender, sendResponse) {
  try {
    const event = message.event || {};
    
    // Envia para backend se configurado
    const settings = await chrome.storage.local.get(['backend_token', 'backend_url']);
    const backendUrl = settings?.backend_url || 'http://localhost:3000';
    const token = settings?.backend_token;
    
    if (token) {
      // Rota corrigida para Node.js
      fetch(`${backendUrl}/api/v1/ai/learn/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(event)
      }).catch(err => console.warn('[Background] Erro ao enviar confidence:', err));
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background] Erro em UPDATE_CONFIDENCE:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: TOGGLE_COPILOT
 */
async function handleToggleCopilot(message, sender, sendResponse) {
  try {
    const enabled = !!message.enabled;
    await chrome.storage.local.set({ whl_copilot_enabled: enabled });
    sendResponse({ success: true, enabled });
  } catch (error) {
    console.error('[Background] Erro em TOGGLE_COPILOT:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: FEW_SHOT_PUSH
 */
async function handleFewShotPush(message, sender, sendResponse) {
  try {
    const examples = message.examples || [];
    await chrome.storage.local.set({ whl_few_shot_examples: examples });
    sendResponse({ success: true, count: examples.length });
  } catch (error) {
    console.error('[Background] Erro em FEW_SHOT_PUSH:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: FEW_SHOT_SYNC
 */
async function handleFewShotSync(message, sender, sendResponse) {
  try {
    const settings = await chrome.storage.local.get(['backend_token', 'backend_url']);
    const backendUrl = settings?.backend_url || 'http://localhost:3000';
    const token = settings?.backend_token;
    
    if (!token) {
      sendResponse({ success: false, error: 'Backend não configurado' });
      return;
    }
    
    const examplesData = await chrome.storage.local.get(['whl_few_shot_examples']);
    const examples = examplesData.whl_few_shot_examples || [];

    // GHOST-002 FIX: Usar rota correta /api/v1/examples/sync ao invés de /api/v1/ai/few-shot/sync (ghost route)
    const response = await fetch(`${backendUrl}/api/v1/examples/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ examples })
    });
    
    if (response.ok) {
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: `HTTP ${response.status}` });
    }
  } catch (error) {
    console.error('[Background] Erro em FEW_SHOT_SYNC:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: FETCH_PROXY
 * Permite requisições externas via background (evita CORS no contexto do sidepanel/content)
 */
async function handleFetchProxy(message, sender, sendResponse) {
  try {
    const url = message.url;
    const method = message.method || 'GET';
    const headers = message.headers || {};
    const body = message.body;
    
    if (!url) {
      sendResponse({ success: false, error: 'URL não fornecida' });
      return;
    }
    
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    
    const text = await response.text();
    
    sendResponse({
      success: true,
      status: response.status,
      ok: response.ok,
      data: text
    });
  } catch (error) {
    console.error('[Background] Erro em FETCH_PROXY:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: AI_COMPLETION
 * Executa chamada direta (OpenAI/Anthropic/Groq/Google/Backend) via background
 */
async function handleAICompletion(message, sender, sendResponse) {
  try {
    const { provider = 'backend', messages = [], model = null, options = {} } = message || {};

    // Ler config armazenada
    const config = await chrome.storage.local.get([
      'whl_openai_key',
      'whl_anthropic_key',
      'whl_groq_key',
      'whl_google_key',
      'whl_backend_config'
    ]);
    
    // Definir endpoints e headers por provider
    const providers = {
      openai: {
        url: 'https://api.openai.com/v1/chat/completions',
        key: config.whl_openai_key,
        defaultModel: 'gpt-4o',
        formatRequest: (msgs, mdl, opts) => ({
          model: mdl || 'gpt-4o',
          messages: msgs,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.max_tokens ?? 1024
        }),
        extractResponse: (data) => ({
          text: data.choices?.[0]?.message?.content || '',
          usage: data.usage,
          model: data.model
        })
      },
      anthropic: {
        url: 'https://api.anthropic.com/v1/messages',
        key: config.whl_anthropic_key,
        defaultModel: 'claude-3-haiku-20240307',
        extraHeaders: { 'anthropic-version': '2023-06-01' },
        formatRequest: (msgs, mdl, opts) => {
          // Anthropic usa formato diferente
          const systemMsg = msgs.find(m => m.role === 'system');
          const otherMsgs = msgs.filter(m => m.role !== 'system');
          return {
            model: mdl || 'claude-3-haiku-20240307',
            max_tokens: opts.max_tokens ?? 1024,
            system: systemMsg?.content || '',
            messages: otherMsgs.map(m => ({
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content
            }))
          };
        },
        extractResponse: (data) => ({
          text: data.content?.[0]?.text || '',
          usage: data.usage,
          model: data.model
        })
      },
      groq: {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: config.whl_groq_key,
        defaultModel: 'llama-3.1-8b-instant',
        formatRequest: (msgs, mdl, opts) => ({
          model: mdl || 'llama-3.1-8b-instant',
          messages: msgs,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.max_tokens ?? 1024
        }),
        extractResponse: (data) => ({
          text: data.choices?.[0]?.message?.content || '',
          usage: data.usage,
          model: data.model
        })
      },
      google: {
        url: 'https://generativelanguage.googleapis.com/v1beta/models',
        key: config.whl_google_key,
        defaultModel: 'gemini-1.5-flash',
        formatRequest: (msgs, mdl, _opts) => {
          const contents = msgs.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }));
          return { contents };
        },
        buildUrl: (baseUrl, mdl, key) => 
          `${baseUrl}/${mdl || 'gemini-1.5-flash'}:generateContent?key=${key}`,
        extractResponse: (data) => ({
          text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
          usage: data.usageMetadata
        })
      },
      backend: {
        url: config.whl_backend_config?.url 
          ? `${config.whl_backend_config.url}/api/v1/ai/completion`
          : 'http://localhost:3000/api/v1/ai/completion',
        key: config.whl_backend_config?.token,
        defaultModel: 'hybrid',
        formatRequest: (msgs, mdl, opts) => ({
          messages: msgs,
          model: mdl || 'hybrid',
          options: opts
        }),
        extractResponse: (data) => ({
          text: data.response?.text || data.text || data.content || '',
          usage: data.usage,
          model: data.model,
          provider: data.provider,
          route: data.route
        })
      }
    };
    
    const providerConfig = providers[provider];
    
    if (!providerConfig) {
      sendResponse({ success: false, error: `Provider desconhecido: ${provider}` });
      return;
    }
    
    // Verificar se tem API key
    if (!providerConfig.key && provider !== 'backend') {
      console.warn(`[AICompletion] ⚠️ API key não configurada para ${provider}`);
      sendResponse({ 
        success: false, 
        error: `API key não configurada para ${provider}. Configure nas opções.` 
      });
      return;
    }
    
    // Construir URL
    let url = providerConfig.url;
    if (providerConfig.buildUrl) {
      url = providerConfig.buildUrl(providerConfig.url, model, providerConfig.key);
    }
    
    // Construir headers
    const headers = {
      'Content-Type': 'application/json',
      ...(providerConfig.extraHeaders || {})
    };
    
    // Adicionar Authorization (exceto Google que usa query param)
    if (provider !== 'google' && providerConfig.key) {
      headers['Authorization'] = `Bearer ${providerConfig.key}`;
    }
    
    // Formatar request body
    const body = providerConfig.formatRequest(messages, model, options);
    
    console.log(`[AICompletion] 📤 Enviando para ${provider}...`);
    
    // Executar request
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AICompletion] ❌ ${provider} retornou ${response.status}:`, errorText);
      sendResponse({ 
        success: false, 
        error: `${provider} error: ${response.status}`,
        details: errorText
      });
      return;
    }
    
    const data = await response.json();
    const result = providerConfig.extractResponse(data);
    
    console.log(`[AICompletion] ✅ Resposta de ${provider}:`, result.text?.substring(0, 100) + '...');
    
    sendResponse({
      success: true,
      provider,
      ...result
    });
    
  } catch (error) {
    console.error('[AICompletion] ❌ Erro:', error);
    sendResponse({ success: false, error: error.message });
  }
}

