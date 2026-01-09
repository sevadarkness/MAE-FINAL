/**
 * 📡 Event Manager - Gerenciamento de listeners de eventos
 * WhatsHybrid v7.9.12
 * 
 * Gerencia event listeners para prevenir duplicação e facilitar cleanup.
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const listeners = new Map();
  let listenerId = 0;

  /**
   * Adiciona um event listener com rastreamento
   * @param {EventTarget} target - Elemento alvo
   * @param {string} event - Nome do evento
   * @param {Function} handler - Handler do evento
   * @param {Object} options - Opções do addEventListener
   * @param {string} group - Grupo opcional para cleanup em lote
   * @returns {number} - ID do listener
   */
  function on(target, event, handler, options = {}, group = 'default') {
    if (!target || !event || !handler) {
      console.warn('[EventManager] Parâmetros inválidos para on()');
      return null;
    }

    const id = ++listenerId;
    
    // Wrapper para capturar erros
    const wrappedHandler = function(e) {
      try {
        handler.call(this, e);
      } catch (error) {
        console.error(`[EventManager] Erro em handler (${event}):`, error);
      }
    };

    target.addEventListener(event, wrappedHandler, options);

    listeners.set(id, {
      target,
      event,
      handler,
      wrappedHandler,
      options,
      group,
      createdAt: Date.now()
    });

    return id;
  }

  /**
   * Remove um event listener específico
   * @param {number} id - ID do listener
   */
  function off(id) {
    const listener = listeners.get(id);
    if (listener) {
      listener.target.removeEventListener(
        listener.event,
        listener.wrappedHandler,
        listener.options
      );
      listeners.delete(id);
    }
  }

  /**
   * Remove todos os listeners de um grupo
   * @param {string} group - Nome do grupo
   */
  function offGroup(group) {
    const toRemove = [];
    
    for (const [id, listener] of listeners) {
      if (listener.group === group) {
        toRemove.push(id);
      }
    }
    
    toRemove.forEach(id => off(id));
    console.log(`[EventManager] Removidos ${toRemove.length} listeners do grupo '${group}'`);
  }

  /**
   * Remove todos os listeners
   */
  function offAll() {
    const count = listeners.size;
    
    for (const [id] of listeners) {
      off(id);
    }
    
    console.log(`[EventManager] Removidos ${count} listeners`);
  }

  /**
   * Remove todos os listeners de um elemento
   * @param {EventTarget} target - Elemento alvo
   */
  function offTarget(target) {
    const toRemove = [];
    
    for (const [id, listener] of listeners) {
      if (listener.target === target) {
        toRemove.push(id);
      }
    }
    
    toRemove.forEach(id => off(id));
    return toRemove.length;
  }

  /**
   * Verifica se um listener já existe
   * @param {EventTarget} target - Elemento alvo
   * @param {string} event - Nome do evento
   * @param {Function} handler - Handler (opcional)
   * @returns {boolean}
   */
  function has(target, event, handler = null) {
    for (const [, listener] of listeners) {
      if (listener.target === target && listener.event === event) {
        if (!handler || listener.handler === handler) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Conta listeners ativos
   * @param {string} group - Grupo opcional para filtrar
   * @returns {number}
   */
  function count(group = null) {
    if (!group) return listeners.size;
    
    let count = 0;
    for (const [, listener] of listeners) {
      if (listener.group === group) count++;
    }
    return count;
  }

  /**
   * Obtém lista de chaves/IDs de listeners
   * @returns {number[]}
   */
  function getKeys() {
    return Array.from(listeners.keys());
  }

  /**
   * Adiciona listener que executa apenas uma vez
   * @param {EventTarget} target - Elemento alvo
   * @param {string} event - Nome do evento
   * @param {Function} handler - Handler do evento
   * @param {string} group - Grupo opcional
   * @returns {number}
   */
  function once(target, event, handler, group = 'default') {
    const id = on(target, event, function(e) {
      off(id);
      handler.call(this, e);
    }, { once: true }, group);
    
    return id;
  }

  /**
   * Adiciona listener delegado (event delegation)
   * @param {EventTarget} target - Container
   * @param {string} event - Nome do evento
   * @param {string} selector - Seletor CSS para filtragem
   * @param {Function} handler - Handler
   * @param {string} group - Grupo opcional
   * @returns {number}
   */
  function delegate(target, event, selector, handler, group = 'default') {
    return on(target, event, function(e) {
      const matched = e.target.closest(selector);
      if (matched && target.contains(matched)) {
        handler.call(matched, e, matched);
      }
    }, {}, group);
  }

  /**
   * Obtém estatísticas de listeners
   * @returns {Object}
   */
  function getStats() {
    const groups = {};
    const events = {};
    
    for (const [, listener] of listeners) {
      groups[listener.group] = (groups[listener.group] || 0) + 1;
      events[listener.event] = (events[listener.event] || 0) + 1;
    }
    
    return {
      total: listeners.size,
      byGroup: groups,
      byEvent: events
    };
  }

  // Cleanup ao descarregar página
  window.addEventListener('beforeunload', offAll);

  // Exportar globalmente
  window.WHLEventManager = {
    on,
    off,
    offGroup,
    offAll,
    offTarget,
    has,
    count,
    getKeys,
    once,
    delegate,
    getStats
  };

  console.log('[EventManager] ✅ Gerenciador de eventos carregado');
})();
