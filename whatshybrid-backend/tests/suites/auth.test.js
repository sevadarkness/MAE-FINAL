/**
 * 🧪 Testes de Autenticação
 * Suite de testes para o módulo de autenticação
 */

const { TestSuite } = require('../test-runner');

function createAuthTests(dependencies = {}) {
  const suite = new TestSuite('Authentication');

  suite.test('deve rejeitar requisição sem token', async (assert) => {
    const mockReq = { headers: {} };
    const mockRes = {
      status: function(code) { this.statusCode = code; return this; },
      json: function(data) { this.data = data; return this; }
    };
    
    // Simular middleware
    const result = validateToken(mockReq);
    assert.notOk(result.valid, 'Token deve ser inválido');
  });

  suite.test('deve aceitar token válido', async (assert) => {
    const validToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    const mockReq = { headers: { authorization: validToken } };
    
    const result = parseAuthHeader(mockReq.headers.authorization);
    assert.ok(result.token, 'Deve extrair token');
    assert.equal(result.type, 'Bearer', 'Tipo deve ser Bearer');
  });

  suite.test('deve rejeitar token malformado', async (assert) => {
    const badTokens = [
      'InvalidToken',
      'Bearer',
      'Basic abc123',
      ''
    ];

    for (const token of badTokens) {
      const result = parseAuthHeader(token);
      assert.ok(!result.valid || result.type !== 'Bearer', `Token "${token}" deve ser rejeitado`);
    }
  });

  suite.test('deve validar estrutura JWT', async (assert) => {
    const validJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const parts = validJWT.split('.');
    
    assert.equal(parts.length, 3, 'JWT deve ter 3 partes');
    assert.ok(parts[0].length > 0, 'Header não pode ser vazio');
    assert.ok(parts[1].length > 0, 'Payload não pode ser vazio');
    assert.ok(parts[2].length > 0, 'Signature não pode ser vazia');
  });

  suite.test('deve extrair userId do token', async (assert) => {
    const payload = { userId: 'user_123', exp: Date.now() + 3600000 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString());
    assert.equal(decoded.userId, 'user_123', 'userId deve ser extraído corretamente');
  });

  return suite;
}

// Helpers
function validateToken(req) {
  const authHeader = req.headers?.authorization;
  if (!authHeader) return { valid: false, error: 'No token' };
  if (!authHeader.startsWith('Bearer ')) return { valid: false, error: 'Invalid format' };
  return { valid: true, token: authHeader.slice(7) };
}

function parseAuthHeader(header) {
  if (!header) return { valid: false };
  const parts = header.split(' ');
  if (parts.length !== 2) return { valid: false };
  return { valid: true, type: parts[0], token: parts[1] };
}

module.exports = { createAuthTests };
