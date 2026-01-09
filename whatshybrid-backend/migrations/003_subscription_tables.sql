-- ============================================
-- MIGRATION: Subscription & Admin Tables
-- WhatsHybrid v7.9.12
-- ============================================

-- Tabela de Assinaturas
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  email TEXT,
  plan_id TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'inactive', -- inactive, active, trial, expired, cancelled, suspended
  credits_total INTEGER DEFAULT 0,
  credits_used INTEGER DEFAULT 0,
  payment_id TEXT,
  payment_gateway TEXT,
  activated_at TEXT,
  expires_at TEXT,
  trial_ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_code ON subscriptions(code);
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Tabela de Transações de Crédito
CREATE TABLE IF NOT EXISTS credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_code TEXT NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL, -- purchase, consumption, bonus, refund, reset
  description TEXT,
  payment_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_code) REFERENCES subscriptions(code)
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_code ON credit_transactions(subscription_code);

-- Tabela de API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL, -- openai, anthropic, groq, google
  api_key TEXT NOT NULL,
  usage_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_used TEXT,
  status TEXT DEFAULT 'active', -- active, paused, disabled
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);

-- Tabela de Logs de Uso de IA
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_code TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  credits_used INTEGER DEFAULT 1,
  latency_ms INTEGER,
  success INTEGER DEFAULT 1,
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_code ON ai_usage_logs(subscription_code);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_provider ON ai_usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON ai_usage_logs(created_at);

-- Tabela de Logs de Erros
CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  message TEXT,
  stack TEXT,
  context TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Configurações do Admin
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Inserir configurações padrão
INSERT OR IGNORE INTO admin_settings (key, value) VALUES 
  ('rate_limit_global', '60'),
  ('rate_limit_per_user', '20'),
  ('cache_ttl_minutes', '5'),
  ('circuit_breaker_threshold', '5'),
  ('retry_max_attempts', '3');

-- Criar usuário admin padrão (se não existir)
-- Senha: Cristi@no123 (bcrypt hash)
INSERT OR IGNORE INTO users (id, email, password, name, role, status, created_at)
VALUES (
  'admin_sevaland',
  'sevaland10@gmail.com',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'Administrador',
  'admin',
  'active',
  datetime('now')
);
