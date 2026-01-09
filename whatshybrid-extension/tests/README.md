# 🧪 WhatsHybrid Test Suite

Suite de testes padronizada para rodar **100% em Node.js** (sem dependência de browser/window).

## Estrutura

```
tests/
├── setup.js              # Setup e mocks do ambiente
├── run-all.js            # Runner principal
├── README.md             # Este arquivo
│
├── unit/                 # Testes unitários
│   ├── event-bus.test.js
│   └── scheduler.test.js
│
└── integration/          # Testes de integração
    └── smoke-test.js     # Smoke test popup ↔ content ↔ background
```

## Como Executar

```bash
# Todos os testes
npm test

# Apenas testes unitários
npm run test:unit

# Apenas testes de integração
npm run test:integration

# Com logs detalhados
npm run test:verbose

# Testes específicos
npm run test:smoke
npm run test:eventbus
npm run test:scheduler
```

## Ambiente

Os testes rodam em Node.js com mocks para:

- `window` / `document`
- `localStorage` / `sessionStorage`
- `chrome.storage` (local/sync)
- `chrome.runtime` (sendMessage, onMessage)
- `chrome.tabs`
- `chrome.notifications`
- `fetch`
- `setTimeout` / `setInterval`
- `MutationObserver`
- `speechSynthesis` (TTS)

## Estrutura de um Teste

```javascript
// Carregar setup (cria mocks)
require('../setup');
const { TestRunner, assert, resetMocks } = require('../setup');

// Criar runner
const runner = new TestRunner('Nome da Suite');

// Adicionar testes
runner.test('Descrição do teste', async () => {
  // Arrange
  const data = { value: 42 };
  
  // Act
  const result = someFunction(data);
  
  // Assert
  assert.equal(result, 42, 'Resultado deve ser 42');
});

// Executar
runner.run().then(results => {
  process.exit(results.failed > 0 ? 1 : 0);
});
```

## Assertions Disponíveis

```javascript
assert.equal(actual, expected, message)     // ===
assert.deepEqual(actual, expected, message) // JSON comparison
assert.true(value, message)                 // === true
assert.false(value, message)                // === false
assert.notNull(value, message)              // !== null && !== undefined
assert.includes(array, item, message)       // array.includes(item)
assert.match(string, regex, message)        // regex.test(string)
assert.throws(fn, message)                  // function throws
assert.rejects(promise, message)            // promise rejects
```

## Helpers

```javascript
// Criar mensagem mock
const msg = createMockMessage({
  body: 'Texto customizado',
  fromMe: true
});

// Criar contato mock
const contact = createMockContact({
  name: 'João'
});

// Resetar todos os mocks
resetMocks();
```

## Smoke Test de Integração

O smoke test simula a comunicação entre os três componentes principais:

```
┌─────────┐     ┌────────────┐     ┌─────────┐
│  Popup  │ ←→  │ Background │ ←→  │ Content │
└─────────┘     └────────────┘     └─────────┘
```

### Fluxos testados:

1. **Popup → Background**: GET_STATUS, VALIDATE_SUBSCRIPTION
2. **Content → Background**: AI_COMPLETE, SYNC_DATA
3. **Background → Content**: SEND_MESSAGE, INJECT_SUGGESTION
4. **Fluxo completo**: Popup solicita IA → Background processa → Content injeta

## CI/CD

Para integração contínua, adicione ao seu workflow:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd whatshybrid-extension && npm test
```

## Contribuindo

1. Crie testes em `tests/unit/` para novos módulos
2. Atualize `run-all.js` se adicionar novos arquivos
3. Mantenha testes isolados (use `resetMocks()` quando necessário)
4. Testes devem passar localmente antes de fazer push
