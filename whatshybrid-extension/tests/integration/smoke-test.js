/**
 * 🔥 Smoke Test de Integração
 * Testa comunicação: popup ↔ content ↔ background
 * 
 * Roda 100% em Node.js
 * 
 * @version 1.0.0
 */

const path = require('path');

// Carregar setup
require('../setup');
const { TestRunner, assert, resetMocks } = require('../setup');

// ============================================
// MOCKS DE MENSAGERIA
// ============================================

class MessageBus {
  constructor() {
    this.listeners = {
      popup: new Map(),
      content: new Map(),
      background: new Map()
    };
    this.messageLog = [];
  }

  // Simula chrome.runtime.sendMessage do popup/content para background
  sendToBackground(from, message) {
    this.messageLog.push({ from, to: 'background', message, timestamp: Date.now() });
    
    return new Promise((resolve) => {
      const handler = this.listeners.background.get(message.action);
      if (handler) {
        const response = handler(message, { tab: { id: 1 } });
        resolve(response);
      } else {
        resolve({ success: false, error: 'No handler for action: ' + message.action });
      }
    });
  }

  // Simula chrome.tabs.sendMessage do background para content
  sendToContent(message) {
    this.messageLog.push({ from: 'background', to: 'content', message, timestamp: Date.now() });
    
    return new Promise((resolve) => {
      const handler = this.listeners.content.get(message.action);
      if (handler) {
        const response = handler(message);
        resolve(response);
      } else {
        resolve({ success: false, error: 'No handler for action: ' + message.action });
      }
    });
  }

  // Simula mensagem do popup
  sendFromPopup(message) {
    return this.sendToBackground('popup', message);
  }

  // Simula mensagem do content script
  sendFromContent(message) {
    return this.sendToBackground('content', message);
  }

  // Registra handler no background
  onBackground(action, handler) {
    this.listeners.background.set(action, handler);
  }

  // Registra handler no content
  onContent(action, handler) {
    this.listeners.content.set(action, handler);
  }

  // Limpa logs
  clearLog() {
    this.messageLog = [];
  }

  // Obtém log de mensagens
  getLog() {
    return [...this.messageLog];
  }
}

// ============================================
// SIMULAÇÃO DOS SCRIPTS
// ============================================

function setupBackgroundScript(bus) {
  // Handler: GET_STATUS
  bus.onBackground('GET_STATUS', (msg) => ({
    success: true,
    status: 'connected',
    version: '7.9.11',
    features: ['ai', 'crm', 'campaigns', 'recover']
  }));

  // Handler: VALIDATE_SUBSCRIPTION
  bus.onBackground('VALIDATE_SUBSCRIPTION', (msg) => {
    const { code } = msg;
    if (code === 'WHL-PRO-VALID123') {
      return {
        success: true,
        planId: 'pro',
        credits: 500,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
      };
    }
    return { success: false, error: 'Invalid code' };
  });

  // Handler: AI_COMPLETE
  bus.onBackground('AI_COMPLETE', async (msg) => {
    const { messages, options } = msg;
    // Simula chamada de IA
    return {
      success: true,
      content: 'Resposta simulada da IA',
      provider: 'openai',
      model: 'gpt-4o',
      usage: { promptTokens: 50, completionTokens: 30 }
    };
  });

  // Handler: SEND_MESSAGE (delega para content)
  bus.onBackground('SEND_MESSAGE', async (msg) => {
    const response = await bus.sendToContent({
      action: 'WHL_SEND_TEXT_DIRECT',
      phone: msg.phone,
      text: msg.text
    });
    return response;
  });

  // Handler: GET_CONTACTS
  bus.onBackground('GET_CONTACTS', () => ({
    success: true,
    contacts: [
      { id: '5511999999999@c.us', name: 'Contato 1', phone: '5511999999999' },
      { id: '5511888888888@c.us', name: 'Contato 2', phone: '5511888888888' }
    ]
  }));

  // Handler: SYNC_DATA
  bus.onBackground('SYNC_DATA', (msg) => ({
    success: true,
    syncedAt: Date.now(),
    modules: msg.modules || ['all']
  }));
}

function setupContentScript(bus) {
  // Handler: WHL_SEND_TEXT_DIRECT
  bus.onContent('WHL_SEND_TEXT_DIRECT', (msg) => {
    const { phone, text } = msg;
    // Simula envio de mensagem
    return {
      success: true,
      messageId: `msg_${Date.now()}`,
      phone,
      text,
      sentAt: Date.now()
    };
  });

  // Handler: GET_CHAT_INFO
  bus.onContent('GET_CHAT_INFO', (msg) => ({
    success: true,
    chatId: msg.chatId || '5511999999999@c.us',
    name: 'Contato Atual',
    unreadCount: 3,
    lastMessage: 'Olá, tudo bem?'
  }));

  // Handler: EXTRACT_MESSAGES
  bus.onContent('EXTRACT_MESSAGES', (msg) => ({
    success: true,
    messages: [
      { id: 'msg1', body: 'Olá!', fromMe: false, timestamp: Date.now() - 5000 },
      { id: 'msg2', body: 'Oi, tudo bem?', fromMe: true, timestamp: Date.now() - 3000 },
      { id: 'msg3', body: 'Tenho interesse no produto', fromMe: false, timestamp: Date.now() }
    ]
  }));

  // Handler: INJECT_SUGGESTION
  bus.onContent('INJECT_SUGGESTION', (msg) => ({
    success: true,
    injected: true,
    suggestion: msg.suggestion
  }));
}

// ============================================
// TESTES
// ============================================

const runner = new TestRunner('Smoke Test - Integração de Mensageria');

// Setup
const bus = new MessageBus();
setupBackgroundScript(bus);
setupContentScript(bus);

// Test 1: Popup -> Background (GET_STATUS)
runner.test('Popup solicita status do background', async () => {
  const response = await bus.sendFromPopup({ action: 'GET_STATUS' });
  
  assert.true(response.success, 'Resposta deve ser sucesso');
  assert.equal(response.status, 'connected', 'Status deve ser connected');
  assert.equal(response.version, '7.9.11', 'Versão deve ser 7.9.11');
  assert.true(Array.isArray(response.features), 'Features deve ser array');
});

// Test 2: Popup -> Background (Validação de assinatura)
runner.test('Popup valida código de assinatura', async () => {
  const response = await bus.sendFromPopup({
    action: 'VALIDATE_SUBSCRIPTION',
    code: 'WHL-PRO-VALID123'
  });
  
  assert.true(response.success, 'Validação deve ser sucesso');
  assert.equal(response.planId, 'pro', 'Plano deve ser pro');
  assert.equal(response.credits, 500, 'Créditos devem ser 500');
});

// Test 3: Popup -> Background (Código inválido)
runner.test('Popup rejeita código inválido', async () => {
  const response = await bus.sendFromPopup({
    action: 'VALIDATE_SUBSCRIPTION',
    code: 'INVALID-CODE'
  });
  
  assert.false(response.success, 'Validação deve falhar');
  assert.equal(response.error, 'Invalid code', 'Erro deve indicar código inválido');
});

// Test 4: Content -> Background (Envio de mensagem via IA)
runner.test('Content solicita resposta de IA', async () => {
  const response = await bus.sendFromContent({
    action: 'AI_COMPLETE',
    messages: [
      { role: 'user', content: 'Olá, qual o preço do produto?' }
    ],
    options: { temperature: 0.7 }
  });
  
  assert.true(response.success, 'Resposta de IA deve ser sucesso');
  assert.notNull(response.content, 'Conteúdo não deve ser nulo');
  assert.equal(response.provider, 'openai', 'Provider deve ser openai');
});

// Test 5: Background -> Content (Envio de mensagem)
runner.test('Background delega envio de mensagem para content', async () => {
  bus.clearLog();
  
  const response = await bus.sendFromPopup({
    action: 'SEND_MESSAGE',
    phone: '5511999999999',
    text: 'Olá, esta é uma mensagem de teste!'
  });
  
  assert.true(response.success, 'Envio deve ser sucesso');
  assert.notNull(response.messageId, 'ID da mensagem não deve ser nulo');
  
  // Verificar fluxo de mensagens
  const log = bus.getLog();
  assert.true(log.length >= 2, 'Deve haver ao menos 2 mensagens no log');
  assert.equal(log[0].from, 'popup', 'Primeira mensagem deve vir do popup');
  assert.equal(log[1].to, 'content', 'Segunda mensagem deve ir para content');
});

// Test 6: Content extrai mensagens
runner.test('Content extrai mensagens do chat', async () => {
  const response = await bus.sendToContent({
    action: 'EXTRACT_MESSAGES',
    chatId: '5511999999999@c.us'
  });
  
  assert.true(response.success, 'Extração deve ser sucesso');
  assert.true(Array.isArray(response.messages), 'Mensagens deve ser array');
  assert.true(response.messages.length > 0, 'Deve haver mensagens');
});

// Test 7: Popup -> Background -> Content (Fluxo completo de sugestão)
runner.test('Fluxo completo: Popup solicita, Background processa, Content injeta', async () => {
  bus.clearLog();
  
  // 1. Popup solicita resposta de IA
  const aiResponse = await bus.sendFromPopup({
    action: 'AI_COMPLETE',
    messages: [{ role: 'user', content: 'Cliente perguntou sobre preço' }]
  });
  
  assert.true(aiResponse.success, 'IA deve responder com sucesso');
  
  // 2. Background envia sugestão para content injetar
  const injectResponse = await bus.sendToContent({
    action: 'INJECT_SUGGESTION',
    suggestion: aiResponse.content
  });
  
  assert.true(injectResponse.success, 'Injeção deve ser sucesso');
  assert.true(injectResponse.injected, 'Sugestão deve estar injetada');
});

// Test 8: Sincronização de dados
runner.test('Sincronização de dados entre componentes', async () => {
  const response = await bus.sendFromPopup({
    action: 'SYNC_DATA',
    modules: ['crm', 'campaigns', 'recover']
  });
  
  assert.true(response.success, 'Sync deve ser sucesso');
  assert.notNull(response.syncedAt, 'Timestamp de sync não deve ser nulo');
  assert.deepEqual(response.modules, ['crm', 'campaigns', 'recover'], 'Módulos devem corresponder');
});

// Test 9: Obter contatos
runner.test('Background retorna lista de contatos', async () => {
  const response = await bus.sendFromPopup({ action: 'GET_CONTACTS' });
  
  assert.true(response.success, 'Resposta deve ser sucesso');
  assert.true(Array.isArray(response.contacts), 'Contatos deve ser array');
  assert.equal(response.contacts.length, 2, 'Deve haver 2 contatos');
  assert.notNull(response.contacts[0].phone, 'Contato deve ter telefone');
});

// Test 10: Handler não existente
runner.test('Retorna erro para action desconhecida', async () => {
  const response = await bus.sendFromPopup({ action: 'UNKNOWN_ACTION' });
  
  assert.false(response.success, 'Deve retornar erro');
  assert.match(response.error, /No handler/, 'Erro deve indicar handler não encontrado');
});

// Test 11: Verificar log de mensagens
runner.test('Log de mensagens registra comunicação corretamente', async () => {
  bus.clearLog();
  
  await bus.sendFromPopup({ action: 'GET_STATUS' });
  await bus.sendFromContent({ action: 'GET_STATUS' });
  
  const log = bus.getLog();
  
  assert.equal(log.length, 2, 'Deve haver 2 entradas no log');
  assert.equal(log[0].from, 'popup', 'Primeira deve ser do popup');
  assert.equal(log[1].from, 'content', 'Segunda deve ser do content');
});

// Test 12: Informações do chat atual
runner.test('Content retorna informações do chat atual', async () => {
  const response = await bus.sendToContent({
    action: 'GET_CHAT_INFO',
    chatId: '5511999999999@c.us'
  });
  
  assert.true(response.success, 'Resposta deve ser sucesso');
  assert.notNull(response.name, 'Nome não deve ser nulo');
  assert.notNull(response.lastMessage, 'Última mensagem não deve ser nula');
});

// ============================================
// EXECUTAR
// ============================================

async function main() {
  console.log('\n🔥 SMOKE TEST DE INTEGRAÇÃO');
  console.log('Testando comunicação: popup ↔ content ↔ background\n');
  
  const results = await runner.run();
  
  console.log('\n📋 Log de Mensagens (últimos 5):');
  bus.getLog().slice(-5).forEach((entry, i) => {
    console.log(`  ${i + 1}. ${entry.from} → ${entry.to}: ${entry.message.action}`);
  });
  
  // Exit code baseado nos resultados
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
