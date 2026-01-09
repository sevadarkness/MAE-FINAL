/**
 * Backend Logger Centralizado
 * WhatsHybrid v7.9.12
 */

const { v4: uuidv4 } = require('uuid'); // Assumindo wrapper ou uuid direto

// Fallback simples se uuid não estiver disponível
const genId = typeof uuidv4 === 'function' ? uuidv4 : () => Date.now().toString(36) + Math.random().toString(36).substr(2);

class Logger {
  constructor() {
    this.requestIdSymbol = Symbol('requestId');
  }

  // Middleware para adicionar request ID
  requestIdMiddleware() {
    return (req, res, next) => {
      req.requestId = req.headers['x-request-id'] || genId();
      res.setHeader('x-request-id', req.requestId);
      next();
    };
  }

  formatError(error, context = {}) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: error.code,
      ...context,
      timestamp: new Date().toISOString()
    };
  }

  error(message, error, context = {}) {
    const formatted = error instanceof Error ? this.formatError(error, context) : { error, ...context };
    console.error(JSON.stringify({
      level: 'error',
      message,
      ...formatted
    }));
  }

  warn(message, context = {}) {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      ...context,
      timestamp: new Date().toISOString()
    }));
  }

  info(message, context = {}) {
    console.log(JSON.stringify({
      level: 'info',
      message,
      ...context,
      timestamp: new Date().toISOString()
    }));
  }
  
  debug(message, context = {}) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(JSON.stringify({
        level: 'debug',
        message,
        ...context,
        timestamp: new Date().toISOString()
      }));
    }
  }
}

const logger = new Logger();

// Wrapper para rotas async
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      logger.error('Route error', error, {
        requestId: req.requestId,
        path: req.path,
        method: req.method,
        userId: req.user?.id
      });
      
      res.status(500).json({
        error: 'Internal Server Error',
        requestId: req.requestId,
        // Em produção, não expor stack trace
        message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
      });
    });
  };
}

// Classe de Erro Customizada
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { logger, asyncHandler, AppError };