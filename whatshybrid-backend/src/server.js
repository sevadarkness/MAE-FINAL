/**
 * 🚀 WhatsHybrid Backend Server
 * Enterprise API for WhatsHybrid Pro
 * 
 * @version 7.2.0
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');

// Credenciais e paths via ambiente
const JWT_SECRET = process.env.JWT_SECRET;
const DB_PATH = process.env.DB_PATH || './data/whatshybrid.db';

// CRIT-005: Exigir JWT_SECRET em TODOS os ambientes (sem fallback previsível)
if (!JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('═══════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.error('FATAL: JWT_SECRET não configurado!');
  // eslint-disable-next-line no-console
  console.error('Defina a variável de ambiente JWT_SECRET antes de iniciar o servidor.');
  // eslint-disable-next-line no-console
  console.error('Ex.: export JWT_SECRET="sua-chave-segura-com-32+ caracteres"');
  // eslint-disable-next-line no-console
  console.error('═══════════════════════════════════════════════════════════');
  process.exit(1);
}

if (String(JWT_SECRET).length < 32) {
  // eslint-disable-next-line no-console
  console.error('FATAL: JWT_SECRET deve ter pelo menos 32 caracteres');
  process.exit(1);
}

const FORBIDDEN_SECRETS = ['dev-only-change-in-production', 'secret', 'jwt-secret', 'my-secret', 'change-me'];
if (FORBIDDEN_SECRETS.some(s => String(JWT_SECRET).toLowerCase().includes(s))) {
  // eslint-disable-next-line no-console
  console.error('FATAL: JWT_SECRET contém valor inseguro');
  process.exit(1);
}

const config = require('../config');
const logger = require('./utils/logger');
const database = require('./utils/database');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');

// Routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const contactsRoutes = require('./routes/contacts');
const conversationsRoutes = require('./routes/conversations');
const campaignsRoutes = require('./routes/campaigns');
const analyticsRoutes = require('./routes/analytics');
const crmRoutes = require('./routes/crm');
const tasksRoutes = require('./routes/tasks');
const templatesRoutes = require('./routes/templates');
const webhooksRoutes = require('./routes/webhooks');
const aiRoutes = require('./routes/ai');
const aiV2Routes = require('./routes/ai-v2');
const settingsRoutes = require('./routes/settings');
const smartbotRoutes = require('./routes/smartbot');
const smartbotExtendedRoutes = require('./routes/smartbot-extended');
const smartbotAIPlusRoutes = require('./routes/smartbot-ai-plus');
const autopilotRoutes = require('./routes/autopilot');
const examplesRoutes = require('./routes/examples');
const recoverRoutes = require('./routes/recover');
const recoverSyncRoutes = require('./routes/recover-sync');
const aiIngestRoutes = require('./routes/ai-ingest');
const syncRoutes = require('./routes/sync');
const adminRoutes = require('./routes/admin');
const paymentWebhooksRoutes = require('./routes/webhooks-payment');
const jobsRoutes = require('./routes/jobs');
const memoryRoutes = require('./routes/memory');
const knowledgeRoutes = require('./routes/knowledge');
const speechRoutes = require('./routes/speech');
const JobsRunner = require('./jobs/JobsRunner');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Socket.IO for real-time updates
const io = new Server(server, {
  cors: {
    origin: config.cors.origin,
    methods: ['GET', 'POST']
  },
  // Heartbeat explícito (reduz risco de conexões "zumbis" em redes instáveis)
  pingInterval: 25000,
  pingTimeout: 60000
});

// Make io available in routes
app.set('io', io);

// ============================================
// MIDDLEWARE
// ============================================

// Security
app.use(helmet());

// CORS
app.use(cors({
  origin: config.cors.origin,
  credentials: true
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (config.env !== 'test') {
  app.use(morgan('combined', { stream: logger.stream }));
}

// Rate limiting
app.use(rateLimiter);

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '7.2.0',
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/contacts', contactsRoutes);
app.use('/api/v1/conversations', conversationsRoutes);
app.use('/api/v1/campaigns', campaignsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/crm', crmRoutes);
app.use('/api/v1/tasks', tasksRoutes);
app.use('/api/v1/templates', templatesRoutes);
app.use('/api/v1/webhooks', webhooksRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v2/ai', aiV2Routes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/smartbot', smartbotRoutes);
app.use('/api/v1/smartbot-extended', smartbotExtendedRoutes);
app.use('/api/v1/smartbot-ai-plus', smartbotAIPlusRoutes);
app.use('/api/v1/autopilot', autopilotRoutes);
app.use('/api/v1/examples', examplesRoutes);
app.use('/api/v1/recover', recoverRoutes);
app.use('/api/recover', recoverSyncRoutes);
app.use('/api/v1/ai/learn', aiIngestRoutes); // Pilar 2: Endpoint de ingestão para aprendizado contínuo
app.use('/api/v1/sync', syncRoutes); // Sincronização bidirecional de dados
app.use('/api/v1/admin', adminRoutes); // Painel Admin
app.use('/api/v1/subscription', paymentWebhooksRoutes); // Webhooks de pagamento e validação
app.use('/webhooks', paymentWebhooksRoutes); // Webhooks alternativos
app.use('/api/v1/jobs', jobsRoutes); // Jobs Runner API
app.use('/api/v1/memory', memoryRoutes); // Memória Híbrida "Leão"
app.use('/api/v1/knowledge', knowledgeRoutes); // Knowledge Management
app.use('/api/v1/speech', speechRoutes); // Speech-to-Text API

// Admin Panel (arquivos estáticos)
app.use('/admin', express.static(path.join(__dirname, '../admin')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/index.html'));
});

// API Documentation
app.get('/api', (req, res) => {
  res.json({
    name: 'WhatsHybrid API',
    version: '7.2.0',
    documentation: '/api/docs',
    endpoints: {
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      contacts: '/api/v1/contacts',
      conversations: '/api/v1/conversations',
      campaigns: '/api/v1/campaigns',
      analytics: '/api/v1/analytics',
      crm: '/api/v1/crm',
      tasks: '/api/v1/tasks',
      templates: '/api/v1/templates',
      webhooks: '/api/v1/webhooks',
      ai: '/api/v1/ai',
      settings: '/api/v1/settings',
      smartbot: '/api/v1/smartbot',
      'smartbot-extended': '/api/v1/smartbot-extended',
      'smartbot-ai-plus': '/api/v1/smartbot-ai-plus',
      'autopilot': '/api/v1/autopilot'
    }
  });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use(notFoundHandler);
app.use(errorHandler);

// ============================================
// SOCKET.IO EVENTS
// ============================================

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('join:user', (userId) => {
    socket.join(`user:${userId}`);
    logger.debug(`User ${userId} joined room`);
  });

  socket.on('join:workspace', (workspaceId) => {
    socket.join(`workspace:${workspaceId}`);
    logger.debug(`Socket joined workspace ${workspaceId}`);
  });

  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
  });
});

// ============================================
// STARTUP
// ============================================

async function startServer() {
  try {
    // Initialize UUID module (ESM compatibility)
    const { initUUID } = require('./utils/uuid-wrapper');
    await initUUID();
    logger.info('UUID module initialized');

    // Initialize database
    await database.initialize();
    logger.info('Database initialized');

    // Initialize Jobs Runner
    try {
      await JobsRunner.initSchema(database.getDb());
      await JobsRunner.start(database.getDb());
      logger.info('Jobs Runner initialized');
    } catch (jobsError) {
      logger.warn('Jobs Runner initialization skipped:', jobsError.message);
    }

    // Seed default user if configured
    try {
      const { seedDefaultUser } = require('../seed-user');
      await seedDefaultUser();
    } catch (seedError) {
      logger.warn('Seed user skipped:', seedError.message);
    }

    // Start server
    const PORT = config.port;
    server.listen(PORT, () => {
      logger.info(`
╔══════════════════════════════════════════════════╗
║   🚀 WhatsHybrid Backend Server                  ║
║   Version: 7.2.0 (SmartBot IA)                   ║
║   Environment: ${config.env.padEnd(32)}║
║   Port: ${String(PORT).padEnd(39)}║
║   Database: SQLite                               ║
╚══════════════════════════════════════════════════╝
      `);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  // Limpar intervalos de webhooks de pagamento
  if (paymentWebhooksRoutes?.cleanup) {
    try {
      paymentWebhooksRoutes.cleanup();
    } catch (err) {
      logger.warn('Erro ao limpar intervalos de webhooks:', err.message);
    }
  }
  server.close(() => {
    logger.info('Server closed');
    database.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  // Limpar intervalos de webhooks de pagamento
  if (paymentWebhooksRoutes?.cleanup) {
    try {
      paymentWebhooksRoutes.cleanup();
    } catch (err) {
      logger.warn('Erro ao limpar intervalos de webhooks:', err.message);
    }
  }
  server.close(() => {
    logger.info('Server closed');
    database.close();
    process.exit(0);
  });
});

// Start
startServer();

module.exports = { app, server, io };
