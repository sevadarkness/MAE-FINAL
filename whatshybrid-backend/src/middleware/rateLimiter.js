/**
 * Rate Limiter Middleware
 */

const rateLimit = require('express-rate-limit');
const config = require('../../config');

// General rate limiter
const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: Math.ceil(config.rateLimit.windowMs / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.id || req.ip;
  }
});

// Strict rate limiter for auth endpoints
// PRODUÇÃO: Valores restritivos para prevenir ataques de força bruta
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 5, // 5 tentativas por IP
  message: {
    error: 'Too Many Requests',
    message: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Não contar logins bem-sucedidos
});

// API rate limiter (per workspace)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: {
    error: 'Too Many Requests',
    message: 'API rate limit exceeded.'
  },
  keyGenerator: (req) => {
    return req.workspaceId || req.ip;
  }
});

// AI rate limiter (expensive operations)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 AI requests per minute
  message: {
    error: 'Too Many Requests',
    message: 'AI rate limit exceeded. Please wait before making more AI requests.'
  },
  keyGenerator: (req) => {
    return req.workspaceId || req.user?.id || req.ip;
  }
});

// AI completion limiter (mais caro que endpoints auxiliares)
const aiCompletionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 completions por minuto
  message: {
    error: 'Too Many Requests',
    message: 'AI completion rate limit exceeded. Please wait before requesting more completions.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.workspaceId || req.user?.id || req.ip;
  }
});

// Webhook rate limiter
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 webhook calls per minute
  message: {
    error: 'Too Many Requests',
    message: 'Webhook rate limit exceeded.'
  }
});

module.exports = {
  rateLimiter,
  authLimiter,
  apiLimiter,
  aiLimiter,
  aiCompletionLimiter,
  webhookLimiter
};
