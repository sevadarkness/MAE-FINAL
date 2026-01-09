/**
 * ⏲️ Timer Manager - Gerenciamento seguro de timers
 * WhatsHybrid v7.9.12
 * 
 * Provê wrappers seguros para setTimeout e setInterval
 * com rastreamento e limpeza automática.
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const activeTimers = new Map();
  const activeIntervals = new Map();
  let timerId = 0;

  /**
   * Cria um timeout seguro com rastreamento
   * @param {Function} callback - Função a executar
   * @param {number} delay - Delay em ms
   * @param {string} label - Label opcional para debug
   * @returns {number} - ID do timer
   */
  function safeTimeout(callback, delay, label = '') {
    const id = ++timerId;
    const internalId = setTimeout(() => {
      activeTimers.delete(id);
      try {
        callback();
      } catch (error) {
        console.error(`[TimerManager] Erro em timeout${label ? ` (${label})` : ''}:`, error);
      }
    }, delay);

    activeTimers.set(id, {
      internalId,
      label,
      createdAt: Date.now(),
      delay,
      type: 'timeout'
    });

    return id;
  }

  /**
   * Cria um interval seguro com rastreamento
   * @param {Function} callback - Função a executar
   * @param {number} interval - Intervalo em ms
   * @param {string} label - Label opcional para debug
   * @returns {number} - ID do interval
   */
  function safeInterval(callback, interval, label = '') {
    const id = ++timerId;
    const internalId = setInterval(() => {
      try {
        callback();
      } catch (error) {
        console.error(`[TimerManager] Erro em interval${label ? ` (${label})` : ''}:`, error);
      }
    }, interval);

    activeIntervals.set(id, {
      internalId,
      label,
      createdAt: Date.now(),
      interval,
      type: 'interval'
    });

    return id;
  }

  /**
   * Limpa um timeout seguro
   * @param {number} id - ID retornado por safeTimeout
   */
  function clearSafeTimeout(id) {
    const timer = activeTimers.get(id);
    if (timer) {
      clearTimeout(timer.internalId);
      activeTimers.delete(id);
    }
  }

  /**
   * Limpa um interval seguro
   * @param {number} id - ID retornado por safeInterval
   */
  function clearSafeInterval(id) {
    const interval = activeIntervals.get(id);
    if (interval) {
      clearInterval(interval.internalId);
      activeIntervals.delete(id);
    }
  }

  /**
   * Limpa todos os timers e intervals ativos
   */
  function clearAll() {
    let clearedTimeouts = 0;
    let clearedIntervals = 0;

    for (const [id, timer] of activeTimers) {
      clearTimeout(timer.internalId);
      clearedTimeouts++;
    }
    activeTimers.clear();

    for (const [id, interval] of activeIntervals) {
      clearInterval(interval.internalId);
      clearedIntervals++;
    }
    activeIntervals.clear();

    console.log(`[TimerManager] Limpos: ${clearedTimeouts} timeouts, ${clearedIntervals} intervals`);
  }

  /**
   * Lista todos os timers ativos
   * @returns {Array} - Lista de timers ativos
   */
  function listActive() {
    const list = [];
    
    for (const [id, timer] of activeTimers) {
      list.push({
        id,
        ...timer,
        age: Date.now() - timer.createdAt
      });
    }
    
    for (const [id, interval] of activeIntervals) {
      list.push({
        id,
        ...interval,
        age: Date.now() - interval.createdAt
      });
    }
    
    return list;
  }

  /**
   * Obtém estatísticas dos timers
   * @returns {Object} - Estatísticas
   */
  function getStats() {
    return {
      activeTimeouts: activeTimers.size,
      activeIntervals: activeIntervals.size,
      total: activeTimers.size + activeIntervals.size
    };
  }

  /**
   * Debounce helper
   * @param {Function} func - Função a executar
   * @param {number} wait - Tempo de espera
   * @param {string} key - Chave única para o debounce
   * @returns {Function} - Função com debounce
   */
  const debounceTimers = new Map();
  function debounce(func, wait, key = '') {
    const finalKey = key || func.toString().slice(0, 50);
    
    return function(...args) {
      const existing = debounceTimers.get(finalKey);
      if (existing) {
        clearSafeTimeout(existing);
      }
      
      const id = safeTimeout(() => {
        debounceTimers.delete(finalKey);
        func.apply(this, args);
      }, wait, `debounce:${finalKey}`);
      
      debounceTimers.set(finalKey, id);
    };
  }

  /**
   * Throttle helper
   * @param {Function} func - Função a executar
   * @param {number} limit - Limite de tempo entre execuções
   * @param {string} key - Chave única
   * @returns {Function} - Função com throttle
   */
  const throttleState = new Map();
  function throttle(func, limit, key = '') {
    const finalKey = key || func.toString().slice(0, 50);
    
    return function(...args) {
      const state = throttleState.get(finalKey);
      const now = Date.now();
      
      if (!state || now - state.lastRun >= limit) {
        throttleState.set(finalKey, { lastRun: now });
        func.apply(this, args);
      }
    };
  }

  // Cleanup ao descarregar página
  window.addEventListener('beforeunload', clearAll);

  // Exportar globalmente
  window.WHLTimerManager = {
    safeTimeout,
    safeInterval,
    clearSafeTimeout,
    clearSafeInterval,
    clearAll,
    listActive,
    getStats,
    debounce,
    throttle
  };

  // Aliases para conveniência
  window.safeTimeout = safeTimeout;
  window.safeInterval = safeInterval;

  console.log('[TimerManager] ✅ Gerenciador de timers carregado');
})();
