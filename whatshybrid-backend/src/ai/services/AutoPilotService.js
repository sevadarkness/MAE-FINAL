/**
 * 🤖 AutoPilot Service - Backend
 * 
 * Gerencia sessões de Auto-Pilot, configurações e estatísticas
 * 
 * @version 1.0.0
 */

const EventEmitter = require('events');
const database = require('../../utils/database');

class AutoPilotService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.sessions = new Map();
    this.globalStats = {
      totalSessions: 0,
      totalMessagesSent: 0,
      totalChatsProcessed: 0,
      totalErrors: 0,
      avgResponseTime: 0,
      responseTimes: []
    };
    
    this.options = {
      maxSessionDuration: options.maxSessionDuration || 8 * 60 * 60 * 1000, // 8 horas
      defaultConfig: {
        DELAY_BETWEEN_CHATS: 3000,
        DELAY_BEFORE_SEND: 1500,
        DELAY_AFTER_SEND: 2000,
        MAX_RESPONSES_PER_HOUR: 30,
        MAX_RESPONSES_PER_CHAT: 5,
        SKIP_GROUPS: true,
        WORKING_HOURS: { enabled: false, start: 8, end: 22 }
      },
      ...options
    };
    
    this.initialized = false;
  }

  // ============================================================
  // PERSISTÊNCIA (SQLite via sql.js)
  // ============================================================

  _ensureTables() {
    const db = database;
    // sql.js: usamos database.run (helper) para executar DDL
    db.run(`
      CREATE TABLE IF NOT EXISTS autopilot_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT,
        config TEXT,
        stats TEXT,
        blacklist TEXT,
        whitelist TEXT,
        use_whitelist INTEGER DEFAULT 0,
        stop_reason TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        last_activity INTEGER
      )
    `, []);
  }

  _serializeSession(session) {
    return {
      id: session.id,
      user_id: session.userId,
      status: session.status,
      config: JSON.stringify(session.config || {}),
      stats: JSON.stringify(session.stats || {}),
      blacklist: JSON.stringify(Array.from(session.blacklist || [])),
      whitelist: JSON.stringify(Array.from(session.whitelist || [])),
      use_whitelist: session.useWhitelist ? 1 : 0,
      stop_reason: session.stopReason || null,
      created_at: session.createdAt || Date.now(),
      updated_at: Date.now(),
      last_activity: session.lastActivity || Date.now()
    };
  }

  _saveSession(session) {
    const s = this._serializeSession(session);
    database.run(
      `INSERT OR REPLACE INTO autopilot_sessions
       (id, user_id, status, config, stats, blacklist, whitelist, use_whitelist, stop_reason, created_at, updated_at, last_activity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id, s.user_id, s.status, s.config, s.stats,
        s.blacklist, s.whitelist, s.use_whitelist, s.stop_reason,
        s.created_at, s.updated_at, s.last_activity
      ]
    );
  }

  _loadActiveSessions() {
    // Carregar sessões não finalizadas para evitar perda em restart
    const rows = database.all(
      `SELECT * FROM autopilot_sessions WHERE status IN ('created','running','paused')`,
      []
    ) || [];

    for (const row of rows) {
      try {
        const session = {
          id: row.id,
          userId: row.user_id,
          config: JSON.parse(row.config || '{}'),
          status: row.status || 'created',
          stats: JSON.parse(row.stats || '{}'),
          blacklist: new Set(JSON.parse(row.blacklist || '[]')),
          whitelist: new Set(JSON.parse(row.whitelist || '[]')),
          useWhitelist: !!row.use_whitelist,
          createdAt: Number(row.created_at) || Date.now(),
          lastActivity: Number(row.last_activity) || Date.now(),
          stopReason: row.stop_reason || undefined
        };

        // Não reativar automaticamente: manter 'paused' se estava 'running' em restart
        if (session.status === 'running') {
          session.status = 'paused';
        }

        this.sessions.set(session.id, session);
      } catch (_) {}
    }
  }

  // ============================================================
  // GERENCIAMENTO DE SESSÕES
  // ============================================================

  createSession(userId, config = {}) {
    const sessionId = `ap_${userId}_${Date.now()}`;
    
    const session = {
      id: sessionId,
      userId,
      config: { ...this.options.defaultConfig, ...config },
      status: 'created',
      stats: {
        startTime: null,
        endTime: null,
        messagesSent: 0,
        chatsProcessed: 0,
        chatsSkipped: 0,
        errors: 0,
        responseTimes: []
      },
      blacklist: new Set(),
      whitelist: new Set(),
      useWhitelist: false,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    
    this.sessions.set(sessionId, session);
    this.globalStats.totalSessions++;
    try { this._saveSession(session); } catch (_) {}
    
    this.emit('session:created', { sessionId, userId });
    
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  getUserSessions(userId) {
    const userSessions = [];
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        userSessions.push(session);
      }
    }
    return userSessions;
  }

  startSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    if (session.status === 'running') {
      throw new Error('Session already running');
    }
    
    session.status = 'running';
    session.stats.startTime = Date.now();
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    
    // Agenda timeout automático
    session.timeout = setTimeout(() => {
      this.stopSession(sessionId, 'timeout');
    }, this.options.maxSessionDuration);
    
    this.emit('session:started', { sessionId });
    
    return session;
  }

  pauseSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    if (session.status !== 'running') {
      throw new Error('Session not running');
    }
    
    session.status = 'paused';
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    
    this.emit('session:paused', { sessionId });
    
    return session;
  }

  resumeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    if (session.status !== 'paused') {
      throw new Error('Session not paused');
    }
    
    session.status = 'running';
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    
    this.emit('session:resumed', { sessionId });
    
    return session;
  }

  stopSession(sessionId, reason = 'manual') {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    if (session.timeout) {
      clearTimeout(session.timeout);
    }
    
    session.status = 'stopped';
    session.stats.endTime = Date.now();
    session.stopReason = reason;
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    
    // Atualiza estatísticas globais
    this.globalStats.totalMessagesSent += session.stats.messagesSent;
    this.globalStats.totalChatsProcessed += session.stats.chatsProcessed;
    this.globalStats.totalErrors += session.stats.errors;
    
    // Calcula tempo médio de resposta
    if (session.stats.responseTimes.length > 0) {
      const sessionAvg = session.stats.responseTimes.reduce((a, b) => a + b, 0) / session.stats.responseTimes.length;
      this.globalStats.responseTimes.push(sessionAvg);
      this.globalStats.avgResponseTime = this.globalStats.responseTimes.reduce((a, b) => a + b, 0) / this.globalStats.responseTimes.length;
    }
    
    this.emit('session:stopped', { sessionId, reason });
    
    return session;
  }

  deleteSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.status === 'running') {
        this.stopSession(sessionId, 'deleted');
      }
      this.sessions.delete(sessionId);
      try {
        database.run('DELETE FROM autopilot_sessions WHERE id = ?', [sessionId]);
      } catch (_) {}
      return true;
    }
    return false;
  }

  // ============================================================
  // REGISTRO DE ATIVIDADES
  // ============================================================

  recordMessageSent(sessionId, data = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    session.stats.messagesSent++;
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    
    if (data.responseTime) {
      session.stats.responseTimes.push(data.responseTime);
    }
    
    this.emit('message:sent', { sessionId, ...data });
    
    return session.stats;
  }

  recordChatProcessed(sessionId, chatId, success = true) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    if (success) {
      session.stats.chatsProcessed++;
    } else {
      session.stats.chatsSkipped++;
    }
    
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    
    return session.stats;
  }

  recordError(sessionId, error) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    session.stats.errors++;
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    
    this.emit('error', { sessionId, error: error.message || error });
    
    // Auto-pausa após muitos erros
    if (session.stats.errors >= 10 && session.status === 'running') {
      this.pauseSession(sessionId);
      this.emit('session:autoPaused', { sessionId, reason: 'too_many_errors' });
    }
    
    return session.stats;
  }

  // ============================================================
  // CONFIGURAÇÕES
  // ============================================================

  updateSessionConfig(sessionId, config) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    session.config = { ...session.config, ...config };
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    
    this.emit('config:updated', { sessionId, config: session.config });
    
    return session.config;
  }

  // ============================================================
  // LISTAS (BLACKLIST/WHITELIST)
  // ============================================================

  addToBlacklist(sessionId, chatId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.blacklist.add(chatId);
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    return true;
  }

  removeFromBlacklist(sessionId, chatId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    const ok = session.blacklist.delete(chatId);
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    return ok;
  }

  addToWhitelist(sessionId, chatId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.whitelist.add(chatId);
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    return true;
  }

  removeFromWhitelist(sessionId, chatId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    const ok = session.whitelist.delete(chatId);
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    return ok;
  }

  setWhitelistMode(sessionId, enabled) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.useWhitelist = enabled;
    session.lastActivity = Date.now();
    try { this._saveSession(session); } catch (_) {}
    return true;
  }

  // ============================================================
  // ESTATÍSTICAS
  // ============================================================

  getSessionStats(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    const runtime = session.stats.startTime ? 
      (session.stats.endTime || Date.now()) - session.stats.startTime : 0;
    
    return {
      ...session.stats,
      status: session.status,
      runtime,
      runtimeFormatted: this._formatRuntime(runtime),
      avgResponseTime: session.stats.responseTimes.length > 0 ?
        Math.round(session.stats.responseTimes.reduce((a, b) => a + b, 0) / session.stats.responseTimes.length) : 0,
      blacklistSize: session.blacklist.size,
      whitelistSize: session.whitelist.size
    };
  }

  getGlobalStats() {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.status === 'running').length;
    const pausedSessions = Array.from(this.sessions.values()).filter(s => s.status === 'paused').length;
    
    return {
      ...this.globalStats,
      activeSessions,
      pausedSessions,
      totalSessions: this.sessions.size,
      avgResponseTimeFormatted: `${Math.round(this.globalStats.avgResponseTime)}ms`
    };
  }

  _formatRuntime(ms) {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  }

  // ============================================================
  // TEMPLATES DE RESPOSTA
  // ============================================================

  getResponseTemplates(category = null) {
    const templates = {
      greeting: [
        'Olá! Como posso ajudar?',
        'Oi! Em que posso ser útil?',
        'Olá! Tudo bem? Como posso ajudar hoje?'
      ],
      thanks: [
        'De nada! Qualquer dúvida, estou à disposição.',
        'Por nada! Se precisar de mais alguma coisa, é só chamar.',
        'Disponha! Sempre que precisar, pode contar comigo.'
      ],
      farewell: [
        'Até mais! Tenha um ótimo dia!',
        'Obrigado pelo contato! Até a próxima.',
        'Foi um prazer ajudar. Até logo!'
      ],
      wait: [
        'Só um momento, por favor.',
        'Aguarde um instante, estou verificando.',
        'Um momento, vou checar isso para você.'
      ],
      apology: [
        'Peço desculpas pelo transtorno.',
        'Lamento pelo ocorrido. Vamos resolver isso.',
        'Sinto muito por isso. Deixe-me ajudar.'
      ]
    };
    
    if (category && templates[category]) {
      return templates[category];
    }
    
    return templates;
  }

  // ============================================================
  // LIMPEZA E MANUTENÇÃO
  // ============================================================

  cleanupOldSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'stopped' && (now - session.stats.endTime) > maxAgeMs) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    
    return cleaned;
  }

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  async init() {
    if (this.initialized) return;

    // Persistência: criar tabelas e carregar sessões
    try {
      this._ensureTables();
      this._loadActiveSessions();
      this.globalStats.totalSessions = this.sessions.size;
    } catch (_) {}

    // Agenda limpeza periódica
    setInterval(() => {
      this.cleanupOldSessions();
    }, 60 * 60 * 1000); // A cada hora
    
    this.initialized = true;
    console.log('[AutoPilot Service] ✅ Inicializado');
  }

  getStatus() {
    return {
      initialized: this.initialized,
      activeSessions: Array.from(this.sessions.values()).filter(s => s.status === 'running').length,
      totalSessions: this.sessions.size,
      globalStats: this.getGlobalStats()
    };
  }
}

module.exports = { AutoPilotService };
