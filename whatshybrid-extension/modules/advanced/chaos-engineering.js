/**
 * ADV-014: Chaos Engineering - Testes de resiliência e stress
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_chaos_engineering',
    SAFE_MODE: true // Previne danos reais
  };

  const CHAOS_TYPES = {
    LATENCY: 'latency',           // Adiciona delay
    ERROR_RATE: 'error_rate',     // Taxa de erro
    TIMEOUT: 'timeout',           // Simula timeouts
    MEMORY_PRESSURE: 'memory',    // Pressão de memória
    CPU_LOAD: 'cpu'               // Carga de CPU
  };

  class ChaosEngineering {
    constructor() {
      this.experiments = [];
      this.activeExperiments = new Map();
      this.results = [];
      this.originalFunctions = new Map();
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this.initialized = true;
      console.log('[ChaosEngineering] Initialized - Safe Mode:', CONFIG.SAFE_MODE);
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data) {
          this.experiments = data.experiments || [];
          this.results = data.results || [];
        }
      } catch (e) {
        console.warn('[ChaosEngineering] Load failed:', e);
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        experiments: this.experiments,
        results: this.results.slice(-100)
      });
    }

    _getStorage(key) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.get([key], res => r(res[key]));
        else r(null);
      });
    }

    _setStorage(key, value) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.set({ [key]: value }, r);
        else r();
      });
    }

    /**
     * Cria experimento de chaos
     */
    createExperiment(config) {
      const experiment = {
        id: `exp_${Date.now()}`,
        name: config.name || 'Novo Experimento',
        type: config.type || CHAOS_TYPES.LATENCY,
        target: config.target || '*',
        intensity: Math.min(1, Math.max(0, config.intensity || 0.5)),
        duration: config.duration || 60000,
        hypothesis: config.hypothesis || '',
        createdAt: Date.now()
      };

      this.experiments.push(experiment);
      this._saveData();
      return experiment;
    }

    /**
     * Inicia experimento
     */
    start(experimentId) {
      if (!CONFIG.SAFE_MODE) {
        console.error('[ChaosEngineering] Cannot run in production without safe mode!');
        return null;
      }

      const experiment = this.experiments.find(e => e.id === experimentId);
      if (!experiment) throw new Error('Experiment not found');

      if (this.activeExperiments.has(experimentId)) {
        throw new Error('Experiment already running');
      }

      const execution = {
        experimentId,
        startedAt: Date.now(),
        metrics: { before: this._collectMetrics() },
        events: []
      };

      // Aplicar chaos baseado no tipo
      switch (experiment.type) {
        case CHAOS_TYPES.LATENCY:
          this._applyLatencyChaos(experiment, execution);
          break;
        case CHAOS_TYPES.ERROR_RATE:
          this._applyErrorRateChaos(experiment, execution);
          break;
        case CHAOS_TYPES.TIMEOUT:
          this._applyTimeoutChaos(experiment, execution);
          break;
      }

      // Auto-stop após duração
      const timeoutId = setTimeout(() => {
        this.stop(experimentId);
      }, experiment.duration);

      this.activeExperiments.set(experimentId, {
        execution,
        timeoutId,
        experiment
      });

      console.log(`[ChaosEngineering] Started: ${experiment.name}`);
      return execution;
    }

    _applyLatencyChaos(experiment, execution) {
      // Interceptar fetch
      const originalFetch = window.fetch;
      this.originalFunctions.set('fetch', originalFetch);

      window.fetch = async (...args) => {
        if (Math.random() < experiment.intensity) {
          const delay = Math.floor(Math.random() * 3000 + 1000);
          execution.events.push({
            type: 'latency_injected',
            delay,
            timestamp: Date.now()
          });
          await new Promise(r => setTimeout(r, delay));
        }
        return originalFetch.apply(window, args);
      };
    }

    _applyErrorRateChaos(experiment, execution) {
      // Interceptar fetch para simular erros
      const originalFetch = window.fetch;
      this.originalFunctions.set('fetch', originalFetch);

      window.fetch = async (...args) => {
        if (Math.random() < experiment.intensity * 0.3) {
          execution.events.push({
            type: 'error_injected',
            timestamp: Date.now()
          });
          throw new Error('[ChaosEngineering] Simulated network error');
        }
        return originalFetch.apply(window, args);
      };
    }

    _applyTimeoutChaos(experiment, execution) {
      // Interceptar fetch com timeout agressivo
      const originalFetch = window.fetch;
      this.originalFunctions.set('fetch', originalFetch);

      window.fetch = async (...args) => {
        if (Math.random() < experiment.intensity * 0.2) {
          execution.events.push({
            type: 'timeout_injected',
            timestamp: Date.now()
          });
          // Simular timeout cancelando a requisição
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 100);
          return originalFetch(args[0], { ...args[1], signal: controller.signal });
        }
        return originalFetch.apply(window, args);
      };
    }

    _collectMetrics() {
      return {
        timestamp: Date.now(),
        memory: performance.memory?.usedJSHeapSize || 0,
        timing: performance.now()
      };
    }

    /**
     * Para experimento
     */
    stop(experimentId) {
      const active = this.activeExperiments.get(experimentId);
      if (!active) return null;

      const { execution, timeoutId, experiment } = active;

      // Limpar timeout
      clearTimeout(timeoutId);

      // Restaurar funções originais
      this._restoreOriginalFunctions();

      // Coletar métricas finais
      execution.metrics.after = this._collectMetrics();
      execution.endedAt = Date.now();
      execution.duration = execution.endedAt - execution.startedAt;

      // Analisar resultado
      const result = this._analyzeResult(experiment, execution);
      this.results.push(result);
      
      this.activeExperiments.delete(experimentId);
      this._saveData();

      console.log(`[ChaosEngineering] Stopped: ${experiment.name}`);
      return result;
    }

    _restoreOriginalFunctions() {
      for (const [name, fn] of this.originalFunctions) {
        if (name === 'fetch') window.fetch = fn;
      }
      this.originalFunctions.clear();
    }

    _analyzeResult(experiment, execution) {
      const { before, after } = execution.metrics;
      
      return {
        id: `result_${Date.now()}`,
        experimentId: experiment.id,
        experimentName: experiment.name,
        type: experiment.type,
        duration: execution.duration,
        eventsCount: execution.events.length,
        hypothesis: experiment.hypothesis,
        metrics: {
          memoryDelta: after.memory - before.memory,
          timingDelta: after.timing - before.timing
        },
        summary: this._generateSummary(execution),
        timestamp: Date.now()
      };
    }

    _generateSummary(execution) {
      const { events } = execution;
      const eventTypes = {};
      
      for (const e of events) {
        eventTypes[e.type] = (eventTypes[e.type] || 0) + 1;
      }

      return {
        totalEvents: events.length,
        eventTypes,
        systemStable: events.length < 10
      };
    }

    /**
     * Para todos os experimentos
     */
    stopAll() {
      for (const expId of this.activeExperiments.keys()) {
        this.stop(expId);
      }
    }

    /**
     * Lista experimentos
     */
    listExperiments() {
      return this.experiments.map(e => ({
        ...e,
        isActive: this.activeExperiments.has(e.id)
      }));
    }

    /**
     * Obtém resultados
     */
    getResults(limit = 20) {
      return this.results.slice(-limit).reverse();
    }

    getStats() {
      return {
        totalExperiments: this.experiments.length,
        activeExperiments: this.activeExperiments.size,
        totalResults: this.results.length,
        safeMode: CONFIG.SAFE_MODE
      };
    }

    destroy() {
      this.stopAll();
    }
  }

  const chaos = new ChaosEngineering();
  chaos.init();

  window.WHLChaosEngineering = chaos;
  window.WHLChaosTypes = CHAOS_TYPES;
  console.log('[ADV-014] Chaos Engineering initialized');

})();
