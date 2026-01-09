/**
 * 🔄 Data Sync Manager - Sincronização Bidirecional de Dados
 * 
 * Garante que todos os dados da extensão sejam salvos tanto localmente
 * quanto no backend, evitando perda de dados por limpeza de cookies/cache.
 * 
 * Dados sincronizados:
 * - CRM (Contatos, Deals, Pipelines, Tasks, Labels)
 * - Recover (Mensagens recuperadas)
 * - Treinamento de IA (Exemplos, FAQs, Produtos)
 * - Configurações da extensão
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  console.log('[DataSyncManager] 🔄 Inicializando...');

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  const CONFIG = {
    STORAGE_PREFIX: 'whl_',
    SYNC_INTERVAL: 60000, // 1 minuto
    SYNC_DEBOUNCE: 5000,  // 5 segundos após última mudança
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    SYNC_STATE_KEY: 'whl_sync_state',
    
    // Dados a serem sincronizados
    SYNC_MODULES: {
      crm_contacts: {
        localKey: 'whl_crm_contacts',
        endpoint: '/api/v1/crm/contacts/sync',
        priority: 'high'
      },
      crm_deals: {
        localKey: 'whl_crm_deals',
        endpoint: '/api/v1/crm/deals/sync',
        priority: 'high'
      },
      crm_pipelines: {
        localKey: 'whl_crm_pipelines',
        endpoint: '/api/v1/crm/pipelines/sync',
        priority: 'medium'
      },
      crm_tasks: {
        localKey: 'whl_crm_tasks',
        endpoint: '/api/v1/crm/tasks/sync',
        priority: 'medium'
      },
      crm_labels: {
        localKey: 'whl_crm_labels',
        endpoint: '/api/v1/crm/labels/sync',
        priority: 'low'
      },
      recover_history: {
        localKey: 'whl_recover_history',
        endpoint: '/api/v1/recover/sync',
        priority: 'high'
      },
      recover_visual_markers: {
        localKey: 'whl_recover_visual_markers',
        endpoint: '/api/v1/recover/markers/sync',
        priority: 'low'
      },
      ai_training_examples: {
        localKey: 'whl_few_shot_examples',
        endpoint: '/api/v1/ai/learn/examples/sync',
        priority: 'medium'
      },
      ai_memory: {
        localKey: 'whl_ai_memory',
        endpoint: '/api/v1/ai/learn/memory/sync',
        priority: 'medium'
      },
      quick_replies: {
        localKey: 'whl_quick_replies',
        endpoint: '/api/v1/templates/sync',
        priority: 'low'
      },
      settings: {
        localKey: 'whl_settings',
        endpoint: '/api/v1/settings/sync',
        priority: 'low'
      }
    }
  };

  // ============================================
  // ESTADO
  // ============================================
  const state = {
    initialized: false,
    lastSync: {},
    pendingChanges: new Map(),
    syncInProgress: false,
    syncTimer: null,
    debounceTimers: {}
  };

  // ============================================
  // INICIALIZAÇÃO
  // ============================================
  async function init() {
    if (state.initialized) return;

    console.log('[DataSyncManager] 🔄 Configurando...');

    // Carregar estado de sincronização
    await loadSyncState();

    // Configurar listeners para mudanças locais
    setupStorageListener();

    // Configurar sync periódico
    setupPeriodicSync();

    // Sincronizar dados do backend (restaurar se necessário)
    await restoreFromBackend();

    state.initialized = true;
    console.log('[DataSyncManager] ✅ Inicializado');

    // Emitir evento de pronto
    if (window.EventBus) {
      window.EventBus.emit('dataSync:ready', { modules: Object.keys(CONFIG.SYNC_MODULES) });
    }
  }

  // ============================================
  // ESTADO DE SINCRONIZAÇÃO
  // ============================================
  async function loadSyncState() {
    try {
      const result = await chrome.storage.local.get(CONFIG.SYNC_STATE_KEY);
      if (result[CONFIG.SYNC_STATE_KEY]) {
        state.lastSync = result[CONFIG.SYNC_STATE_KEY];
      }
    } catch (e) {
      console.warn('[DataSyncManager] Erro ao carregar estado de sync:', e);
    }
  }

  async function saveSyncState() {
    try {
      await chrome.storage.local.set({ [CONFIG.SYNC_STATE_KEY]: state.lastSync });
    } catch (e) {
      console.warn('[DataSyncManager] Erro ao salvar estado de sync:', e);
    }
  }

  // ============================================
  // LISTENER DE MUDANÇAS LOCAIS
  // ============================================
  function setupStorageListener() {
    // Listener para chrome.storage
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
        // Verificar se é uma chave que devemos sincronizar
        const moduleEntry = Object.entries(CONFIG.SYNC_MODULES).find(
          ([, config]) => config.localKey === key
        );

        if (moduleEntry) {
          const [moduleName] = moduleEntry;
          console.log(`[DataSyncManager] 📝 Mudança detectada: ${moduleName}`);
          
          // Marcar como pendente
          state.pendingChanges.set(moduleName, {
            timestamp: Date.now(),
            data: newValue
          });

          // Debounce para evitar muitas sincronizações
          scheduleSync(moduleName);
        }
      }
    });
  }

  function scheduleSync(moduleName) {
    // Limpar timer anterior
    if (state.debounceTimers[moduleName]) {
      clearTimeout(state.debounceTimers[moduleName]);
    }

    // Agendar nova sincronização
    state.debounceTimers[moduleName] = setTimeout(async () => {
      await syncModule(moduleName);
    }, CONFIG.SYNC_DEBOUNCE);
  }

  // ============================================
  // SINCRONIZAÇÃO PERIÓDICA
  // ============================================
  function setupPeriodicSync() {
    state.syncTimer = setInterval(async () => {
      await syncAll();
    }, CONFIG.SYNC_INTERVAL);

    // Cleanup
    window.addEventListener('beforeunload', () => {
      if (state.syncTimer) {
        clearInterval(state.syncTimer);
        state.syncTimer = null;
      }
      Object.values(state.debounceTimers).forEach(timer => clearTimeout(timer));
    });
  }

  // ============================================
  // SINCRONIZAÇÃO DE MÓDULO
  // ============================================
  async function syncModule(moduleName) {
    if (state.syncInProgress) {
      console.log(`[DataSyncManager] ⏳ Sync em andamento, adiando ${moduleName}`);
      return;
    }

    const moduleConfig = CONFIG.SYNC_MODULES[moduleName];
    if (!moduleConfig) {
      console.warn(`[DataSyncManager] Módulo desconhecido: ${moduleName}`);
      return;
    }

    // Verificar se backend está disponível
    if (!window.BackendClient?.isConnected()) {
      console.log(`[DataSyncManager] ⚠️ Backend não conectado, mantendo em pendentes`);
      return;
    }

    state.syncInProgress = true;

    try {
      console.log(`[DataSyncManager] 📤 Sincronizando ${moduleName}...`);

      // Obter dados locais
      const result = await chrome.storage.local.get(moduleConfig.localKey);
      const localData = result[moduleConfig.localKey] || null;

      if (!localData) {
        console.log(`[DataSyncManager] Nenhum dado local para ${moduleName}`);
        state.syncInProgress = false;
        return;
      }

      // Preparar payload
      const payload = {
        module: moduleName,
        data: localData,
        lastSync: state.lastSync[moduleName] || 0,
        timestamp: Date.now()
      };

      // Enviar para backend
      const response = await window.BackendClient.request(moduleConfig.endpoint, {
        method: 'POST',
        body: payload
      });

      if (response.success) {
        // Atualizar timestamp de sincronização
        state.lastSync[moduleName] = Date.now();
        await saveSyncState();

        // Remover das pendentes
        state.pendingChanges.delete(moduleName);

        // Se backend retornou dados mais recentes, mesclar
        if (response.data && response.mergeNeeded) {
          await mergeBackendData(moduleName, moduleConfig.localKey, response.data);
        }

        console.log(`[DataSyncManager] ✅ ${moduleName} sincronizado`);

        // Emitir evento
        if (window.EventBus) {
          window.EventBus.emit('dataSync:synced', { module: moduleName });
        }
      } else {
        throw new Error(response.error || 'Sync failed');
      }

    } catch (e) {
      console.error(`[DataSyncManager] ❌ Erro ao sincronizar ${moduleName}:`, e);
      
      // Emitir evento de erro
      if (window.EventBus) {
        window.EventBus.emit('dataSync:error', { module: moduleName, error: e.message });
      }
    } finally {
      state.syncInProgress = false;
    }
  }

  // ============================================
  // SINCRONIZAR TUDO
  // ============================================
  async function syncAll(force = false) {
    if (state.syncInProgress && !force) {
      console.log('[DataSyncManager] ⏳ Sync já em andamento');
      return;
    }

    // Verificar conexão com backend
    if (!window.BackendClient?.isConnected()) {
      console.log('[DataSyncManager] ⚠️ Backend não conectado');
      return;
    }

    console.log('[DataSyncManager] 📤 Iniciando sincronização completa...');

    // Ordenar módulos por prioridade
    const orderedModules = Object.entries(CONFIG.SYNC_MODULES)
      .sort((a, b) => {
        const priority = { high: 0, medium: 1, low: 2 };
        return priority[a[1].priority] - priority[b[1].priority];
      })
      .map(([name]) => name);

    for (const moduleName of orderedModules) {
      await syncModule(moduleName);
      // Pequeno delay entre módulos
      await new Promise(r => setTimeout(r, 100));
    }

    console.log('[DataSyncManager] ✅ Sincronização completa finalizada');
  }

  // ============================================
  // RESTAURAR DO BACKEND
  // ============================================
  async function restoreFromBackend() {
    // Verificar conexão com backend
    if (!window.BackendClient?.isConnected()) {
      console.log('[DataSyncManager] ⚠️ Backend não conectado, pulando restauração');
      return;
    }

    console.log('[DataSyncManager] 📥 Verificando dados do backend...');

    try {
      const response = await window.BackendClient.request('/api/v1/sync/status', {
        method: 'GET'
      });

      if (response.success && response.modules) {
        for (const [moduleName, backendInfo] of Object.entries(response.modules)) {
          const moduleConfig = CONFIG.SYNC_MODULES[moduleName];
          if (!moduleConfig) continue;

          const localLastSync = state.lastSync[moduleName] || 0;
          const backendLastSync = backendInfo.lastModified || 0;

          // Se backend tem dados mais recentes, baixar
          if (backendLastSync > localLastSync) {
            console.log(`[DataSyncManager] 📥 Restaurando ${moduleName} do backend...`);
            
            const dataResponse = await window.BackendClient.request(
              `${moduleConfig.endpoint}/download`,
              { method: 'GET' }
            );

            if (dataResponse.success && dataResponse.data) {
              await mergeBackendData(moduleName, moduleConfig.localKey, dataResponse.data);
              state.lastSync[moduleName] = Date.now();
            }
          }
        }

        await saveSyncState();
      }
    } catch (e) {
      console.warn('[DataSyncManager] Erro ao restaurar do backend:', e);
    }
  }

  // ============================================
  // ESTRATÉGIAS DE RESOLUÇÃO DE CONFLITOS
  // ============================================
  const CONFLICT_STRATEGIES = {
    LATEST_WINS: 'latest_wins',      // O mais recente vence (padrão)
    LOCAL_WINS: 'local_wins',        // Local sempre vence
    BACKEND_WINS: 'backend_wins',    // Backend sempre vence
    MERGE_FIELDS: 'merge_fields'     // Mescla campos individuais
  };
  
  /**
   * Obtém o timestamp mais confiável de um item
   */
  function getItemTimestamp(item) {
    if (!item) return 0;
    return item.updatedAt || item.updated_at || item.modifiedAt || item.modified_at || 
           item.lastModified || item.last_modified || item.createdAt || item.created_at || 
           item.timestamp || 0;
  }
  
  /**
   * Resolve conflito entre dois itens
   * @param {Object} localItem - Item local
   * @param {Object} backendItem - Item do backend
   * @param {string} strategy - Estratégia de resolução
   * @returns {Object} - Item resolvido
   */
  function resolveItemConflict(localItem, backendItem, strategy = CONFLICT_STRATEGIES.LATEST_WINS) {
    if (!localItem) return backendItem;
    if (!backendItem) return localItem;
    
    switch (strategy) {
      case CONFLICT_STRATEGIES.LOCAL_WINS:
        return localItem;
        
      case CONFLICT_STRATEGIES.BACKEND_WINS:
        return backendItem;
        
      case CONFLICT_STRATEGIES.MERGE_FIELDS:
        // Mescla campos, preferindo valores não-nulos do backend
        const merged = { ...localItem };
        for (const [key, value] of Object.entries(backendItem)) {
          if (value !== null && value !== undefined) {
            // Se ambos têm o campo, usa o mais recente
            const localTs = getItemTimestamp(localItem);
            const backendTs = getItemTimestamp(backendItem);
            if (backendTs >= localTs) {
              merged[key] = value;
            }
          }
        }
        // Atualiza timestamp para o maior
        merged.updatedAt = Math.max(
          getItemTimestamp(localItem),
          getItemTimestamp(backendItem)
        );
        return merged;
        
      case CONFLICT_STRATEGIES.LATEST_WINS:
      default:
        const localTimestamp = getItemTimestamp(localItem);
        const backendTimestamp = getItemTimestamp(backendItem);
        return backendTimestamp >= localTimestamp ? backendItem : localItem;
    }
  }

  // ============================================
  // MESCLAR DADOS DO BACKEND
  // ============================================
  async function mergeBackendData(moduleName, localKey, backendData, strategy = CONFLICT_STRATEGIES.LATEST_WINS) {
    try {
      // Obter dados locais
      const result = await chrome.storage.local.get(localKey);
      const localData = result[localKey];

      let mergedData;
      let conflictsResolved = 0;

      if (Array.isArray(backendData)) {
        // Para arrays, mesclar por ID com resolução de conflitos
        const localArray = Array.isArray(localData) ? localData : [];
        const backendArray = Array.isArray(backendData) ? backendData : [];
        
        const merged = new Map();
        const conflicts = [];
        
        // Primeiro, adicionar itens locais
        for (const item of localArray) {
          const id = item.id || item.key || item.chatId || JSON.stringify(item);
          merged.set(id, { source: 'local', item });
        }
        
        // Depois, verificar itens do backend
        for (const item of backendArray) {
          const id = item.id || item.key || item.chatId || JSON.stringify(item);
          const existing = merged.get(id);
          
          if (existing) {
            // Conflito: item existe em ambos
            const resolved = resolveItemConflict(existing.item, item, strategy);
            merged.set(id, { source: 'resolved', item: resolved });
            conflictsResolved++;
            conflicts.push({ id, localTs: getItemTimestamp(existing.item), backendTs: getItemTimestamp(item) });
          } else {
            merged.set(id, { source: 'backend', item });
          }
        }
        
        mergedData = Array.from(merged.values()).map(entry => entry.item);
        
        if (conflicts.length > 0) {
          console.log(`[DataSyncManager] ⚖️ ${moduleName}: ${conflictsResolved} conflitos resolvidos com estratégia '${strategy}'`);
        }
        
      } else if (typeof backendData === 'object' && backendData !== null) {
        // Para objetos, usar resolução de conflitos por campo
        if (localData && typeof localData === 'object') {
          mergedData = resolveItemConflict(localData, backendData, CONFLICT_STRATEGIES.MERGE_FIELDS);
        } else {
          mergedData = backendData;
        }
      } else {
        // Para valores primitivos, usar backend (mais recente)
        mergedData = backendData;
      }

      // Salvar dados mesclados
      await chrome.storage.local.set({ [localKey]: mergedData });
      
      console.log(`[DataSyncManager] ✅ ${moduleName} mesclado com dados do backend (${conflictsResolved} conflitos resolvidos)`);

      // Emitir evento de conflitos resolvidos
      if (conflictsResolved > 0 && window.EventBus) {
        window.EventBus.emit('dataSync:conflictsResolved', { 
          module: moduleName, 
          count: conflictsResolved,
          strategy 
        });
      }

    } catch (e) {
      console.error(`[DataSyncManager] Erro ao mesclar ${moduleName}:`, e);
    }
  }

  // ============================================
  // FORÇAR SINCRONIZAÇÃO
  // ============================================
  async function forceSync(moduleName = null) {
    if (moduleName) {
      await syncModule(moduleName);
    } else {
      await syncAll(true);
    }
  }

  // ============================================
  // DELETAR DADOS (COM PROPAGAÇÃO PARA BACKEND)
  // ============================================
  async function deleteData(moduleName, itemId = null) {
    const moduleConfig = CONFIG.SYNC_MODULES[moduleName];
    if (!moduleConfig) {
      console.warn(`[DataSyncManager] Módulo desconhecido: ${moduleName}`);
      return false;
    }

    try {
      // Se itemId específico, deletar apenas esse item
      if (itemId) {
        // Obter dados locais
        const result = await chrome.storage.local.get(moduleConfig.localKey);
        let localData = result[moduleConfig.localKey];

        if (Array.isArray(localData)) {
          localData = localData.filter(item => (item.id || item.key) !== itemId);
          await chrome.storage.local.set({ [moduleConfig.localKey]: localData });
        }

        // Propagar para backend
        if (window.BackendClient?.isConnected()) {
          await window.BackendClient.request(`${moduleConfig.endpoint}/${itemId}`, {
            method: 'DELETE'
          });
        }
      } else {
        // Deletar todos os dados do módulo
        await chrome.storage.local.remove(moduleConfig.localKey);

        // Propagar para backend
        if (window.BackendClient?.isConnected()) {
          await window.BackendClient.request(`${moduleConfig.endpoint}/all`, {
            method: 'DELETE'
          });
        }
      }

      console.log(`[DataSyncManager] 🗑️ Dados deletados: ${moduleName}${itemId ? '/' + itemId : ' (todos)'}`);
      return true;

    } catch (e) {
      console.error(`[DataSyncManager] Erro ao deletar ${moduleName}:`, e);
      return false;
    }
  }

  // ============================================
  // EXPORTAR TODOS OS DADOS
  // ============================================
  async function exportAllData() {
    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      modules: {}
    };

    for (const [moduleName, moduleConfig] of Object.entries(CONFIG.SYNC_MODULES)) {
      try {
        const result = await chrome.storage.local.get(moduleConfig.localKey);
        if (result[moduleConfig.localKey]) {
          exportData.modules[moduleName] = result[moduleConfig.localKey];
        }
      } catch (e) {
        console.warn(`[DataSyncManager] Erro ao exportar ${moduleName}:`, e);
      }
    }

    return exportData;
  }

  // ============================================
  // IMPORTAR DADOS
  // ============================================
  async function importData(importData) {
    if (!importData || !importData.modules) {
      throw new Error('Dados de importação inválidos');
    }

    for (const [moduleName, data] of Object.entries(importData.modules)) {
      const moduleConfig = CONFIG.SYNC_MODULES[moduleName];
      if (!moduleConfig) continue;

      try {
        await chrome.storage.local.set({ [moduleConfig.localKey]: data });
        console.log(`[DataSyncManager] ✅ ${moduleName} importado`);
      } catch (e) {
        console.error(`[DataSyncManager] Erro ao importar ${moduleName}:`, e);
      }
    }

    // Sincronizar com backend após importação
    await syncAll(true);
  }

  // ============================================
  // ESTATÍSTICAS
  // ============================================
  function getStats() {
    return {
      initialized: state.initialized,
      lastSyncTimes: { ...state.lastSync },
      pendingChanges: state.pendingChanges.size,
      syncInProgress: state.syncInProgress,
      modules: Object.keys(CONFIG.SYNC_MODULES)
    };
  }

  // ============================================
  // API PÚBLICA
  // ============================================
  window.DataSyncManager = {
    init,
    
    // Sincronização
    syncModule,
    syncAll,
    forceSync,
    restoreFromBackend,
    
    // Gerenciamento de dados
    deleteData,
    exportAllData,
    importData,
    
    // Estatísticas
    getStats,
    getLastSync: (moduleName) => state.lastSync[moduleName] || null,
    getPendingChanges: () => state.pendingChanges.size,
    
    // Configuração
    MODULES: Object.keys(CONFIG.SYNC_MODULES),
    
    // Eventos (via EventBus)
    // 'dataSync:ready' - Quando o manager está pronto
    // 'dataSync:synced' - Quando um módulo foi sincronizado
    // 'dataSync:error' - Quando ocorre um erro de sincronização
  };

  // Auto-inicializar quando BackendClient estiver pronto
  function tryInit() {
    if (window.BackendClient) {
      init();
    } else {
      setTimeout(tryInit, 500);
    }
  }

  // Aguardar DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    setTimeout(tryInit, 1000);
  }

  console.log('[DataSyncManager] 📦 Módulo carregado');

})();
