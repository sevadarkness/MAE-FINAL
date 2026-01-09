/**
 * 📊 WhatsHybrid - Observabilidade
 * Módulo central de observabilidade: métricas, tracing, health checks
 * 
 * @version 7.9.13
 */

const { metrics, metricsMiddleware, metricsEndpoint } = require('./metrics');
const { tracer, tracingMiddleware, ConsoleExporter } = require('./tracing');
const { 
  healthManager, 
  registerDefaultChecks,
  healthEndpoint,
  healthDetailedEndpoint,
  livenessEndpoint,
  readinessEndpoint
} = require('./health');

/**
 * Configura observabilidade completa no Express app
 */
function setupObservability(app, options = {}) {
  const {
    enableMetrics = true,
    enableTracing = true,
    enableHealth = true,
    metricsPath = '/metrics',
    healthPath = '/health',
    traceSampling = 1.0,
    db = null,
    redis = null,
    ai = null
  } = options;

  // Métricas
  if (enableMetrics) {
    app.use(metricsMiddleware);
    app.get(metricsPath, metricsEndpoint);
    console.log(`[Observability] 📊 Métricas habilitadas em ${metricsPath}`);
  }

  // Tracing
  if (enableTracing) {
    tracer.setSamplingRate(traceSampling);
    
    if (process.env.NODE_ENV !== 'production') {
      tracer.addExporter(new ConsoleExporter());
    }
    
    app.use(tracingMiddleware);
    console.log(`[Observability] 🔍 Tracing habilitado (sampling: ${traceSampling * 100}%)`);
  }

  // Health checks
  if (enableHealth) {
    registerDefaultChecks(db, redis, ai);
    healthManager.startPeriodicChecks(30000);
    
    app.get(healthPath, healthEndpoint);
    app.get(`${healthPath}/detailed`, healthDetailedEndpoint);
    app.get(`${healthPath}/live`, livenessEndpoint);
    app.get(`${healthPath}/ready`, readinessEndpoint);
    
    console.log(`[Observability] 🏥 Health checks habilitados em ${healthPath}`);
  }

  return { metrics, tracer, healthManager };
}

module.exports = {
  // Setup
  setupObservability,
  
  // Métricas
  metrics,
  metricsMiddleware,
  metricsEndpoint,
  
  // Tracing
  tracer,
  tracingMiddleware,
  
  // Health
  healthManager,
  registerDefaultChecks,
  healthEndpoint,
  healthDetailedEndpoint,
  livenessEndpoint,
  readinessEndpoint
};
