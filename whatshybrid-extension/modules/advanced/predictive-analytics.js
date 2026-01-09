/**
 * ADV-004: Predictive Analytics - Análise preditiva de conversas
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_predictive',
    PREDICTION_WINDOW_DAYS: 30,
    MIN_DATA_POINTS: 10
  };

  class PredictiveAnalytics {
    constructor() {
      this.conversationData = [];
      this.patterns = {};
      this.models = {};
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this._trainModels();
      this.initialized = true;
      console.log('[Predictive] Initialized with', this.conversationData.length, 'data points');
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data) {
          this.conversationData = data.conversationData || [];
          this.patterns = data.patterns || {};
        }
      } catch (e) {
        console.warn('[Predictive] Load failed:', e);
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        conversationData: this.conversationData.slice(-5000),
        patterns: this.patterns
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
     * Registra dados de uma conversa
     */
    recordConversation(data) {
      const record = {
        id: `conv_${Date.now()}`,
        timestamp: Date.now(),
        contactId: data.contactId,
        category: data.category,
        sentiment: data.sentiment,
        duration: data.duration,
        messageCount: data.messageCount,
        resolved: data.resolved,
        outcome: data.outcome, // 'sale', 'support_resolved', 'abandoned', etc
        dayOfWeek: new Date().getDay(),
        hourOfDay: new Date().getHours()
      };

      this.conversationData.push(record);
      this._updatePatterns(record);
      this._saveData();
    }

    _updatePatterns(record) {
      // Padrões por hora do dia
      const hourKey = `hour_${record.hourOfDay}`;
      if (!this.patterns[hourKey]) {
        this.patterns[hourKey] = { count: 0, outcomes: {} };
      }
      this.patterns[hourKey].count++;
      this.patterns[hourKey].outcomes[record.outcome] = 
        (this.patterns[hourKey].outcomes[record.outcome] || 0) + 1;

      // Padrões por dia da semana
      const dayKey = `day_${record.dayOfWeek}`;
      if (!this.patterns[dayKey]) {
        this.patterns[dayKey] = { count: 0, avgDuration: 0 };
      }
      this.patterns[dayKey].count++;
      this.patterns[dayKey].avgDuration = 
        (this.patterns[dayKey].avgDuration * (this.patterns[dayKey].count - 1) + record.duration) / 
        this.patterns[dayKey].count;

      // Padrões por categoria
      const catKey = `cat_${record.category}`;
      if (!this.patterns[catKey]) {
        this.patterns[catKey] = { count: 0, avgSentiment: 0, resolutionRate: 0 };
      }
      this.patterns[catKey].count++;
      this.patterns[catKey].avgSentiment = 
        (this.patterns[catKey].avgSentiment * (this.patterns[catKey].count - 1) + record.sentiment) / 
        this.patterns[catKey].count;
      if (record.resolved) {
        this.patterns[catKey].resolutionRate = 
          (this.patterns[catKey].resolutionRate * (this.patterns[catKey].count - 1) + 1) / 
          this.patterns[catKey].count;
      }
    }

    _trainModels() {
      if (this.conversationData.length < CONFIG.MIN_DATA_POINTS) return;

      // Modelo simples de probabilidade de conversão
      const outcomes = {};
      let total = 0;

      for (const conv of this.conversationData) {
        outcomes[conv.outcome] = (outcomes[conv.outcome] || 0) + 1;
        total++;
      }

      this.models.outcomeProb = {};
      for (const [outcome, count] of Object.entries(outcomes)) {
        this.models.outcomeProb[outcome] = count / total;
      }

      // Modelo de duração esperada
      const durations = this.conversationData.map(c => c.duration).filter(Boolean);
      if (durations.length > 0) {
        this.models.avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        this.models.stdDuration = Math.sqrt(
          durations.reduce((sum, d) => sum + Math.pow(d - this.models.avgDuration, 2), 0) / durations.length
        );
      }
    }

    /**
     * Prediz o resultado provável de uma conversa
     */
    predictOutcome(context) {
      const { category, sentiment, messageCount, hourOfDay, dayOfWeek } = context;
      const predictions = {};

      // Base probabilities
      for (const [outcome, prob] of Object.entries(this.models.outcomeProb || {})) {
        predictions[outcome] = prob;
      }

      // Ajustar por hora do dia
      const hourPattern = this.patterns[`hour_${hourOfDay}`];
      if (hourPattern) {
        for (const [outcome, count] of Object.entries(hourPattern.outcomes)) {
          const hourProb = count / hourPattern.count;
          predictions[outcome] = (predictions[outcome] || 0) * 0.7 + hourProb * 0.3;
        }
      }

      // Ajustar por categoria
      const catPattern = this.patterns[`cat_${category}`];
      if (catPattern) {
        if (sentiment < -0.3) {
          predictions['abandoned'] = (predictions['abandoned'] || 0) + 0.2;
        }
        if (catPattern.resolutionRate > 0.8) {
          predictions['support_resolved'] = (predictions['support_resolved'] || 0) + 0.1;
        }
      }

      // Normalizar
      const total = Object.values(predictions).reduce((a, b) => a + b, 0);
      for (const outcome of Object.keys(predictions)) {
        predictions[outcome] = predictions[outcome] / total;
      }

      // Encontrar mais provável
      const mostLikely = Object.entries(predictions)
        .sort((a, b) => b[1] - a[1])[0];

      return {
        predictions,
        mostLikely: { outcome: mostLikely[0], probability: mostLikely[1] },
        confidence: mostLikely[1]
      };
    }

    /**
     * Prediz volume de conversas
     */
    predictVolume(dayOfWeek, hourOfDay) {
      const hourPattern = this.patterns[`hour_${hourOfDay}`];
      const dayPattern = this.patterns[`day_${dayOfWeek}`];

      const hourAvg = hourPattern?.count / 7 || 0;
      const dayAvg = dayPattern?.count / 24 || 0;

      return {
        expectedVolume: Math.round((hourAvg + dayAvg) / 2),
        peakHour: this._findPeakHour(),
        peakDay: this._findPeakDay()
      };
    }

    _findPeakHour() {
      let peak = { hour: 0, count: 0 };
      for (let h = 0; h < 24; h++) {
        const pattern = this.patterns[`hour_${h}`];
        if (pattern && pattern.count > peak.count) {
          peak = { hour: h, count: pattern.count };
        }
      }
      return peak.hour;
    }

    _findPeakDay() {
      const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      let peak = { day: 0, count: 0 };
      for (let d = 0; d < 7; d++) {
        const pattern = this.patterns[`day_${d}`];
        if (pattern && pattern.count > peak.count) {
          peak = { day: d, count: pattern.count };
        }
      }
      return days[peak.day];
    }

    /**
     * Identifica tendências
     */
    getTrends() {
      const recent = this.conversationData.slice(-100);
      const older = this.conversationData.slice(-200, -100);

      if (recent.length < 10 || older.length < 10) {
        return { message: 'Dados insuficientes para análise de tendências' };
      }

      const recentAvgSentiment = recent.reduce((s, c) => s + (c.sentiment || 0), 0) / recent.length;
      const olderAvgSentiment = older.reduce((s, c) => s + (c.sentiment || 0), 0) / older.length;

      const recentResolution = recent.filter(c => c.resolved).length / recent.length;
      const olderResolution = older.filter(c => c.resolved).length / older.length;

      return {
        sentiment: {
          current: recentAvgSentiment.toFixed(2),
          previous: olderAvgSentiment.toFixed(2),
          trend: recentAvgSentiment > olderAvgSentiment ? '📈' : '📉'
        },
        resolution: {
          current: (recentResolution * 100).toFixed(1) + '%',
          previous: (olderResolution * 100).toFixed(1) + '%',
          trend: recentResolution > olderResolution ? '📈' : '📉'
        }
      };
    }

    getStats() {
      return {
        totalDataPoints: this.conversationData.length,
        patterns: Object.keys(this.patterns).length,
        hasModel: Object.keys(this.models).length > 0,
        trends: this.getTrends()
      };
    }

    exportData() {
      return {
        conversationData: this.conversationData,
        patterns: this.patterns,
        models: this.models,
        stats: this.getStats(),
        exportedAt: new Date().toISOString()
      };
    }
  }

  const predictive = new PredictiveAnalytics();
  predictive.init();

  window.WHLPredictive = predictive;
  console.log('[ADV-004] Predictive Analytics initialized');

})();
