/**
 * PEND-MED-008: Tab Coordinator
 * Coordena múltiplas abas do WhatsApp para evitar duplicação de instâncias
 *
 * Usa BroadcastChannel para comunicação entre tabs e implementa leader election
 */
(function() {
  'use strict';

  const CHANNEL_NAME = 'whl_tabs_coordination';
  const HEARTBEAT_INTERVAL = 5000; // 5 segundos
  const LEADER_TIMEOUT = 10000; // 10 segundos

  const state = {
    tabId: `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    isLeader: false,
    channel: null,
    knownTabs: new Map(), // tabId -> lastSeen timestamp
    heartbeatInterval: null,
    leaderCheckInterval: null
  };

  /**
   * Inicializa coordenador de tabs
   */
  function init() {
    try {
      // Criar canal de broadcast
      state.channel = new BroadcastChannel(CHANNEL_NAME);

      // Configurar listeners
      state.channel.onmessage = handleMessage;

      // Anunciar presença
      broadcast({
        type: 'TAB_JOINED',
        tabId: state.tabId,
        timestamp: Date.now()
      });

      // Iniciar heartbeat
      startHeartbeat();

      // Iniciar verificação de líder
      startLeaderElection();

      console.log('[TabCoordinator] ✅ Inicializado. Tab ID:', state.tabId);

      // Cleanup ao fechar tab
      window.addEventListener('beforeunload', cleanup);

    } catch (error) {
      console.error('[TabCoordinator] ❌ Erro ao inicializar:', error);
    }
  }

  /**
   * Processar mensagens de outras tabs
   */
  function handleMessage(event) {
    const { type, tabId, timestamp, data } = event.data;

    if (tabId === state.tabId) return; // Ignorar próprias mensagens

    // Atualizar conhecimento de tabs ativas
    state.knownTabs.set(tabId, timestamp);

    switch (type) {
      case 'TAB_JOINED':
        console.log('[TabCoordinator] 📥 Nova tab detectada:', tabId);
        // Responder com heartbeat
        broadcast({
          type: 'HEARTBEAT',
          tabId: state.tabId,
          timestamp: Date.now(),
          isLeader: state.isLeader
        });
        break;

      case 'HEARTBEAT':
        // Atualizar última atividade da tab
        state.knownTabs.set(tabId, timestamp);
        break;

      case 'TAB_LEFT':
        console.log('[TabCoordinator] 📤 Tab saiu:', tabId);
        state.knownTabs.delete(tabId);
        checkLeadership();
        break;

      case 'LEADER_CLAIM':
        // Outra tab reivindicou liderança
        if (state.isLeader && timestamp > Date.now() - 1000) {
          // Conflito de liderança, tab com menor ID vence
          if (tabId < state.tabId) {
            console.log('[TabCoordinator] 🏳️ Cedendo liderança para:', tabId);
            state.isLeader = false;
            emitLeadershipChange();
          }
        }
        break;

      case 'ACTION_REQUEST':
        // Apenas líder processa requisições
        if (state.isLeader && data?.action) {
          handleActionRequest(data);
        }
        break;

      case 'ACTION_RESPONSE':
        // Resposta de ação executada
        if (data?.requestId) {
          emitActionResponse(data);
        }
        break;

      default:
        console.warn('[TabCoordinator] ⚠️ Tipo de mensagem desconhecido:', type);
    }
  }

  /**
   * Broadcast mensagem para todas as tabs
   */
  function broadcast(message) {
    if (!state.channel) return;
    try {
      state.channel.postMessage(message);
    } catch (error) {
      console.error('[TabCoordinator] ❌ Erro ao enviar broadcast:', error);
    }
  }

  /**
   * Heartbeat periódico
   */
  function startHeartbeat() {
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);

    state.heartbeatInterval = setInterval(() => {
      broadcast({
        type: 'HEARTBEAT',
        tabId: state.tabId,
        timestamp: Date.now(),
        isLeader: state.isLeader
      });

      // Limpar tabs inativas
      cleanupInactiveTabs();
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Remove tabs que não respondem
   */
  function cleanupInactiveTabs() {
    const now = Date.now();
    const timeout = LEADER_TIMEOUT;

    for (const [tabId, lastSeen] of state.knownTabs.entries()) {
      if (now - lastSeen > timeout) {
        console.log('[TabCoordinator] 🗑️ Removendo tab inativa:', tabId);
        state.knownTabs.delete(tabId);
      }
    }
  }

  /**
   * Leader election
   */
  function startLeaderElection() {
    if (state.leaderCheckInterval) clearInterval(state.leaderCheckInterval);

    // Verificar liderança imediatamente
    checkLeadership();

    // Verificar periodicamente
    state.leaderCheckInterval = setInterval(() => {
      checkLeadership();
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Verifica e reivindica liderança se necessário
   */
  function checkLeadership() {
    const activeTabs = Array.from(state.knownTabs.keys());
    const allTabs = [state.tabId, ...activeTabs].sort();

    // Tab com menor ID é o líder
    const shouldBeLeader = allTabs[0] === state.tabId;

    if (shouldBeLeader && !state.isLeader) {
      claimLeadership();
    } else if (!shouldBeLeader && state.isLeader) {
      state.isLeader = false;
      console.log('[TabCoordinator] 👑 Liderança perdida');
      emitLeadershipChange();
    }
  }

  /**
   * Reivindicar liderança
   */
  function claimLeadership() {
    state.isLeader = true;
    console.log('[TabCoordinator] 👑 Liderança reivindicada');

    broadcast({
      type: 'LEADER_CLAIM',
      tabId: state.tabId,
      timestamp: Date.now()
    });

    emitLeadershipChange();
  }

  /**
   * Emitir evento de mudança de liderança
   */
  function emitLeadershipChange() {
    if (window.EventBus) {
      window.EventBus.emit('tab_coordinator:leadership_changed', {
        isLeader: state.isLeader,
        tabId: state.tabId
      });
    }

    window.dispatchEvent(new CustomEvent('whl_leadership_changed', {
      detail: { isLeader: state.isLeader, tabId: state.tabId }
    }));
  }

  /**
   * Processar requisição de ação (apenas líder)
   */
  function handleActionRequest(data) {
    const { action, requestId, params } = data;

    console.log('[TabCoordinator] 🎯 Processando ação:', action);

    // Emitir evento para módulos locais processarem
    if (window.EventBus) {
      window.EventBus.emit('tab_coordinator:action_request', {
        action,
        requestId,
        params
      });
    }
  }

  /**
   * Emitir resposta de ação
   */
  function emitActionResponse(data) {
    if (window.EventBus) {
      window.EventBus.emit('tab_coordinator:action_response', data);
    }
  }

  /**
   * Solicitar ação ao líder
   */
  function requestAction(action, params = {}) {
    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Timeout de 5 segundos
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'timeout' });
      }, 5000);

      // Listener para resposta
      const handleResponse = (event) => {
        const data = event.detail || event.data;
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          window.EventBus?.off?.('tab_coordinator:action_response', handleResponse);
          resolve(data);
        }
      };

      if (window.EventBus) {
        window.EventBus.on('tab_coordinator:action_response', handleResponse);
      }

      // Enviar requisição
      broadcast({
        type: 'ACTION_REQUEST',
        tabId: state.tabId,
        timestamp: Date.now(),
        data: {
          action,
          requestId,
          params
        }
      });
    });
  }

  /**
   * Responder requisição de ação
   */
  function respondAction(requestId, result) {
    broadcast({
      type: 'ACTION_RESPONSE',
      tabId: state.tabId,
      timestamp: Date.now(),
      data: {
        requestId,
        result
      }
    });
  }

  /**
   * Cleanup ao fechar tab
   */
  function cleanup() {
    broadcast({
      type: 'TAB_LEFT',
      tabId: state.tabId,
      timestamp: Date.now()
    });

    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    if (state.leaderCheckInterval) clearInterval(state.leaderCheckInterval);

    if (state.channel) {
      state.channel.close();
    }

    console.log('[TabCoordinator] 👋 Tab coordinator finalizado');
  }

  /**
   * Obter estado do coordenador
   */
  function getState() {
    return {
      tabId: state.tabId,
      isLeader: state.isLeader,
      activeTabs: Array.from(state.knownTabs.keys()),
      totalTabs: state.knownTabs.size + 1
    };
  }

  /**
   * FIX PEND-MED-008: Helper to add storage listener with leadership check
   * Only the leader tab will execute the callback, preventing duplicate processing
   *
   * @param {Function} callback - The storage change handler
   * @param {Object} options - Optional configuration
   * @returns {Function} - The wrapped listener function
   */
  function addStorageListener(callback, options = {}) {
    const {
      leaderOnly = true,  // Only leader processes by default
      broadcastToOthers = false  // Optionally broadcast to other tabs
    } = options;

    const wrappedCallback = (changes, areaName) => {
      // If leaderOnly is true and this tab is not the leader, ignore
      if (leaderOnly && !state.isLeader) {
        return;
      }

      // Execute the callback
      callback(changes, areaName);

      // Optionally broadcast the change to other tabs
      if (broadcastToOthers && state.isLeader) {
        broadcast({
          type: 'STORAGE_CHANGED',
          tabId: state.tabId,
          changes,
          areaName,
          timestamp: Date.now()
        });
      }
    };

    // Register the wrapped listener
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(wrappedCallback);
    }

    return wrappedCallback;  // Return so caller can remove if needed
  }

  /**
   * FIX PEND-MED-008: Execute callback only if this tab is the leader
   * Useful for wrapping existing storage listener code
   */
  function executeIfLeader(callback) {
    if (state.isLeader) {
      return callback();
    }
    return null;
  }

  // API Pública
  window.TabCoordinator = {
    init,
    getState,
    isLeader: () => state.isLeader,
    getTabId: () => state.tabId,
    requestAction,
    respondAction,
    broadcast,
    // FIX PEND-MED-008: New helpers for storage listener coordination
    addStorageListener,
    executeIfLeader
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[TabCoordinator] Módulo carregado');

})();
