/**
 * 🧪 Testes do Sistema de IA
 * Suite de testes para AIRouterService e providers
 */

const { TestSuite } = require('../test-runner');

function createAITests(dependencies = {}) {
  const suite = new TestSuite('AI System', { timeout: 10000 });

  suite.test('deve classificar erros de autenticação', async (assert) => {
    const errors = [
      { status: 401, expected: 'auth' },
      { status: 403, expected: 'auth' },
      { message: 'invalid api key', expected: 'auth' },
      { message: 'unauthorized', expected: 'auth' }
    ];

    for (const { status, message, expected } of errors) {
      const error = { status, message };
      const classification = classifyError(error);
      assert.equal(classification.type, expected, 
        `Erro ${status || message} deve ser classificado como ${expected}`);
    }
  });

  suite.test('deve classificar erros de rate limit', async (assert) => {
    const errors = [
      { status: 429, expected: 'rate_limit' },
      { message: 'rate limit exceeded', expected: 'rate_limit' },
      { message: 'quota exceeded', expected: 'rate_limit' }
    ];

    for (const { status, message, expected } of errors) {
      const error = { status, message };
      const classification = classifyError(error);
      assert.equal(classification.type, expected,
        `Erro ${status || message} deve ser classificado como ${expected}`);
    }
  });

  suite.test('deve classificar erros de servidor', async (assert) => {
    const errors = [
      { status: 500, expected: 'server' },
      { status: 502, expected: 'server' },
      { status: 503, expected: 'server' }
    ];

    for (const { status, expected } of errors) {
      const error = { status };
      const classification = classifyError(error);
      assert.equal(classification.type, expected,
        `Erro ${status} deve ser classificado como ${expected}`);
    }
  });

  suite.test('deve validar formato de mensagens', async (assert) => {
    const validMessages = [
      { role: 'system', content: 'Você é um assistente' },
      { role: 'user', content: 'Olá' },
      { role: 'assistant', content: 'Olá! Como posso ajudar?' }
    ];

    for (const msg of validMessages) {
      assert.ok(isValidMessage(msg), `Mensagem ${msg.role} deve ser válida`);
    }
  });

  suite.test('deve rejeitar mensagens inválidas', async (assert) => {
    const invalidMessages = [
      { role: 'invalid', content: 'test' },
      { role: 'user' }, // sem content
      { content: 'test' }, // sem role
      null,
      undefined,
      'string'
    ];

    for (const msg of invalidMessages) {
      assert.notOk(isValidMessage(msg), `Mensagem ${JSON.stringify(msg)} deve ser inválida`);
    }
  });

  suite.test('deve formatar request para OpenAI', async (assert) => {
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' }
    ];

    const formatted = formatOpenAIRequest(messages, 'gpt-4o', { temperature: 0.7 });
    
    assert.equal(formatted.model, 'gpt-4o', 'Modelo deve ser correto');
    assert.isArray(formatted.messages, 'Messages deve ser array');
    assert.equal(formatted.temperature, 0.7, 'Temperature deve ser 0.7');
  });

  suite.test('deve formatar request para Anthropic', async (assert) => {
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' }
    ];

    const formatted = formatAnthropicRequest(messages, 'claude-3-opus', { max_tokens: 1024 });
    
    assert.equal(formatted.model, 'claude-3-opus', 'Modelo deve ser correto');
    assert.equal(formatted.system, 'System prompt', 'System deve ser extraído');
    assert.isArray(formatted.messages, 'Messages deve ser array');
    assert.equal(formatted.messages.length, 1, 'System não deve estar em messages');
  });

  suite.test('deve extrair resposta de OpenAI', async (assert) => {
    const response = {
      choices: [{
        message: { content: 'Resposta da IA' }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20 }
    };

    const extracted = extractOpenAIResponse(response);
    
    assert.equal(extracted.text, 'Resposta da IA', 'Texto deve ser extraído');
    assert.ok(extracted.usage, 'Usage deve existir');
  });

  suite.test('deve extrair resposta de Anthropic', async (assert) => {
    const response = {
      content: [{ type: 'text', text: 'Resposta do Claude' }],
      usage: { input_tokens: 10, output_tokens: 20 }
    };

    const extracted = extractAnthropicResponse(response);
    
    assert.equal(extracted.text, 'Resposta do Claude', 'Texto deve ser extraído');
    assert.ok(extracted.usage, 'Usage deve existir');
  });

  suite.test('deve calcular cooldown exponencial', async (assert) => {
    const baseCooldown = 1000;
    
    const cooldown1 = calculateCooldown(1, baseCooldown);
    const cooldown2 = calculateCooldown(2, baseCooldown);
    const cooldown3 = calculateCooldown(3, baseCooldown);
    
    assert.greaterThan(cooldown2, cooldown1, 'Cooldown deve aumentar');
    assert.greaterThan(cooldown3, cooldown2, 'Cooldown deve continuar aumentando');
  });

  return suite;
}

// Helpers de teste
function classifyError(error) {
  const status = error.status || error.response?.status;
  const message = (error.message || '').toLowerCase();

  if (status === 401 || status === 403 || message.includes('api key') || message.includes('unauthorized')) {
    return { type: 'auth', action: 'disable' };
  }

  if (status === 429 || message.includes('rate limit') || message.includes('quota')) {
    return { type: 'rate_limit', action: 'backoff' };
  }

  if (status >= 500) {
    return { type: 'server', action: 'retry' };
  }

  if (message.includes('timeout')) {
    return { type: 'timeout', action: 'retry' };
  }

  return { type: 'unknown', action: 'fallback' };
}

function isValidMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.role || !msg.content) return false;
  if (!['system', 'user', 'assistant'].includes(msg.role)) return false;
  return true;
}

function formatOpenAIRequest(messages, model, options) {
  return {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1024
  };
}

function formatAnthropicRequest(messages, model, options) {
  const systemMsg = messages.find(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');
  
  return {
    model,
    max_tokens: options.max_tokens ?? 1024,
    system: systemMsg?.content || '',
    messages: otherMsgs.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
  };
}

function extractOpenAIResponse(data) {
  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: data.usage
  };
}

function extractAnthropicResponse(data) {
  return {
    text: data.content?.[0]?.text || '',
    usage: data.usage
  };
}

function calculateCooldown(attempt, base) {
  return Math.min(base * Math.pow(2, attempt - 1), 60000);
}

module.exports = { createAITests };
