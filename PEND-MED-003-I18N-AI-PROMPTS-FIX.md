# FIX PEND-MED-003: i18n Prompt IA

## Problem

AI system prompts are **100% hardcoded in Portuguese** across 26+ instances, completely ignoring user language preferences. Despite having a mature i18n system for UI (500+ keys in 5+ languages), AI responses always come in Portuguese even when UI is in English/Spanish/German.

## Impact

**Broken User Experience:**
- User selects English → UI changes to English
- User asks AI question → AI responds in Portuguese ❌
- Result: Language mismatch destroys UX

## Root Causes

1. **No i18n dictionary for AI prompts** - pt-BR.json has UI keys but NO persona/prompt translations
2. **Modules hardcode prompts** - Each AI module has Portuguese system prompts embedded
3. **No language context passed** - AI generators don't check `window.WHLi18n.getLanguage()`
4. **Forces Portuguese explicitly** - ai-suggestion-fixed.js has `Responda SEMPRE em português...`

## Files Affected (9 total)

| File | Issue | Lines | Instances |
|------|-------|-------|-----------|
| `smart-replies.js` | 6 hardcoded personas | 94-124 | 6 |
| `copilot-engine.js` | 6 hardcoded personas | 139-213 | 6 |
| `ai-suggestion-fixed.js` | Forces Portuguese | 828-835 | 1 |
| `ai-service.js` | No i18n fallback | 1038-1047 | 2 |
| `few-shot-learning.js` | PT labels | 545-561 | 4 |
| `knowledge-base.js` | PT tone settings | 85-90 | 2 |
| `features/multi-persona.js` | 4 hardcoded personas | 29-69 | 4 |
| `advanced/multi-agent.js` | 3 hardcoded agents | 22-43 | 3 |
| `ai-gateway.js` | No language handling | - | - |

**Total: 28 hardcoded Portuguese prompts**

---

## Solution: 4-Phase Implementation

### Phase 1: Add AI Prompt Translations to i18n

**File:** `i18n/locales/pt-BR.json`

Add new section after line 433 (before closing brace):

```json
{
  "existing sections": "...",

  "aiPrompts": {
    "personas": {
      "professional": {
        "name": "Profissional",
        "systemPrompt": "Você é um assistente profissional de atendimento ao cliente. Seja educado, claro e objetivo. Responda em {{language}}."
      },
      "friendly": {
        "name": "Amigável",
        "systemPrompt": "Você é um assistente amigável e acolhedor. Use linguagem casual e empática. Responda em {{language}}."
      },
      "sales": {
        "name": "Vendas",
        "systemPrompt": "Você é um vendedor experiente. Seja persuasivo mas não agressivo. Responda em {{language}}."
      },
      "support": {
        "name": "Suporte",
        "systemPrompt": "Você é um especialista em suporte técnico. Seja paciente e didático. Responda em {{language}}."
      },
      "concierge": {
        "name": "Concierge",
        "systemPrompt": "Você é um concierge de luxo. Seja sofisticado e atencioso. Responda em {{language}}."
      },
      "coach": {
        "name": "Coach",
        "systemPrompt": "Você é um coach motivacional. Seja inspirador e energético. Responda em {{language}}."
      }
    },

    "instructions": {
      "baseRules": "Você é um assistente de atendimento no WhatsApp. {{rules}}",
      "languageInstruction": "Responda SEMPRE em {{language}}.",
      "toneInstruction": "Use tom {{tone}}.",
      "contextAware": "Considere o contexto da conversa ao responder."
    },

    "fewShot": {
      "sectionTitle": "Exemplos de conversas anteriores:",
      "exampleLabel": "Exemplo {{index}}:",
      "customerLabel": "Cliente:",
      "agentLabel": "Atendente:"
    },

    "knowledgeBase": {
      "greeting": "Olá! Como posso ajudar?",
      "closing": "Estou à disposição para qualquer dúvida!",
      "noAnswer": "Não encontrei informações sobre isso. Posso transferir para um humano?"
    },

    "translation": {
      "systemPrompt": "Você é um tradutor profissional. Traduza o texto para {{language}} mantendo o tom e contexto original."
    },

    "agents": {
      "sales": {
        "name": "Vendas",
        "systemPrompt": "Você é um especialista em vendas. Identifique oportunidades e qualifique leads. Responda em {{language}}."
      },
      "support": {
        "name": "Suporte",
        "systemPrompt": "Você é um especialista em suporte técnico. Resolva problemas de forma eficiente. Responda em {{language}}."
      },
      "coordinator": {
        "name": "Coordenador",
        "systemPrompt": "Você coordena entre diferentes especialistas. Direcione para o agente apropriado. Responda em {{language}}."
      }
    }
  }
}
```

**File:** `i18n/locales/en.json`

```json
{
  "aiPrompts": {
    "personas": {
      "professional": {
        "name": "Professional",
        "systemPrompt": "You are a professional customer service assistant. Be polite, clear, and objective. Respond in {{language}}."
      },
      "friendly": {
        "name": "Friendly",
        "systemPrompt": "You are a friendly and welcoming assistant. Use casual and empathetic language. Respond in {{language}}."
      },
      "sales": {
        "name": "Sales",
        "systemPrompt": "You are an experienced salesperson. Be persuasive but not aggressive. Respond in {{language}}."
      },
      "support": {
        "name": "Support",
        "systemPrompt": "You are a technical support specialist. Be patient and didactic. Respond in {{language}}."
      },
      "concierge": {
        "name": "Concierge",
        "systemPrompt": "You are a luxury concierge. Be sophisticated and attentive. Respond in {{language}}."
      },
      "coach": {
        "name": "Coach",
        "systemPrompt": "You are a motivational coach. Be inspiring and energetic. Respond in {{language}}."
      }
    },

    "instructions": {
      "baseRules": "You are a WhatsApp customer service assistant. {{rules}}",
      "languageInstruction": "ALWAYS respond in {{language}}.",
      "toneInstruction": "Use {{tone}} tone.",
      "contextAware": "Consider conversation context when responding."
    },

    "fewShot": {
      "sectionTitle": "Previous conversation examples:",
      "exampleLabel": "Example {{index}}:",
      "customerLabel": "Customer:",
      "agentLabel": "Agent:"
    },

    "knowledgeBase": {
      "greeting": "Hello! How can I help you?",
      "closing": "I'm available for any questions!",
      "noAnswer": "I couldn't find information about that. Shall I transfer you to a human?"
    },

    "translation": {
      "systemPrompt": "You are a professional translator. Translate the text to {{language}} while maintaining the original tone and context."
    },

    "agents": {
      "sales": {
        "name": "Sales",
        "systemPrompt": "You are a sales specialist. Identify opportunities and qualify leads. Respond in {{language}}."
      },
      "support": {
        "name": "Support",
        "systemPrompt": "You are a technical support specialist. Solve problems efficiently. Respond in {{language}}."
      },
      "coordinator": {
        "name": "Coordinator",
        "systemPrompt": "You coordinate between different specialists. Direct to the appropriate agent. Respond in {{language}}."
      }
    }
  }
}
```

**File:** `i18n/locales/es.json`

```json
{
  "aiPrompts": {
    "personas": {
      "professional": {
        "name": "Profesional",
        "systemPrompt": "Eres un asistente profesional de atención al cliente. Sé educado, claro y objetivo. Responde en {{language}}."
      },
      "friendly": {
        "name": "Amigable",
        "systemPrompt": "Eres un asistente amigable y acogedor. Usa lenguaje casual y empático. Responde en {{language}}."
      },
      "sales": {
        "name": "Ventas",
        "systemPrompt": "Eres un vendedor experimentado. Sé persuasivo pero no agresivo. Responde en {{language}}."
      },
      "support": {
        "name": "Soporte",
        "systemPrompt": "Eres un especialista en soporte técnico. Sé paciente y didáctico. Responde en {{language}}."
      },
      "concierge": {
        "name": "Concierge",
        "systemPrompt": "Eres un concierge de lujo. Sé sofisticado y atento. Responde en {{language}}."
      },
      "coach": {
        "name": "Coach",
        "systemPrompt": "Eres un coach motivacional. Sé inspirador y enérgico. Responde en {{language}}."
      }
    },

    "instructions": {
      "baseRules": "Eres un asistente de atención en WhatsApp. {{rules}}",
      "languageInstruction": "Responde SIEMPRE en {{language}}.",
      "toneInstruction": "Usa tono {{tone}}.",
      "contextAware": "Considera el contexto de la conversación al responder."
    },

    "fewShot": {
      "sectionTitle": "Ejemplos de conversaciones anteriores:",
      "exampleLabel": "Ejemplo {{index}}:",
      "customerLabel": "Cliente:",
      "agentLabel": "Agente:"
    },

    "knowledgeBase": {
      "greeting": "¡Hola! ¿Cómo puedo ayudarte?",
      "closing": "¡Estoy disponible para cualquier duda!",
      "noAnswer": "No encontré información sobre eso. ¿Deseas que transfiera a un humano?"
    },

    "translation": {
      "systemPrompt": "Eres un traductor profesional. Traduce el texto a {{language}} manteniendo el tono y contexto original."
    },

    "agents": {
      "sales": {
        "name": "Ventas",
        "systemPrompt": "Eres un especialista en ventas. Identifica oportunidades y califica leads. Responde en {{language}}."
      },
      "support": {
        "name": "Soporte",
        "systemPrompt": "Eres un especialista en soporte técnico. Resuelve problemas eficientemente. Responde en {{language}}."
      },
      "coordinator": {
        "name": "Coordinador",
        "systemPrompt": "Coordinas entre diferentes especialistas. Dirige al agente apropiado. Responde en {{language}}."
      }
    }
  }
}
```

---

### Phase 2: Create Helper Function for i18n Prompts

**File:** `i18n/i18n-manager.js`

Add new function after line 400 (in the API section):

```javascript
/**
 * FIX PEND-MED-003: Get localized AI prompt
 * @param {string} key - Prompt key (e.g., 'personas.professional.systemPrompt')
 * @param {object} vars - Template variables (e.g., {language: 'English'})
 * @returns {string} - Localized prompt with variables replaced
 */
function getAIPrompt(key, vars = {}) {
  const language = getCurrentLanguage();
  const fullKey = `aiPrompts.${key}`;
  let prompt = translate(fullKey);

  // Replace template variables
  if (vars && typeof vars === 'object') {
    for (const [varKey, varValue] of Object.entries(vars)) {
      const placeholder = new RegExp(`\\{\\{${varKey}\\}\\}`, 'g');
      prompt = prompt.replace(placeholder, varValue);
    }
  }

  return prompt;
}

/**
 * Get user's preferred language in human-readable form
 * @returns {string} - Language name (e.g., 'English', 'Portuguese', 'Spanish')
 */
function getLanguageName() {
  const code = getCurrentLanguage();
  const languageNames = {
    'en': 'English',
    'pt-BR': 'Portuguese',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'ru': 'Russian',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'tr': 'Turkish'
  };
  return languageNames[code] || languageNames['en'];
}

// Export new functions
window.WHLi18n = {
  ...window.WHLi18n,
  getAIPrompt,
  getLanguageName
};
```

---

### Phase 3: Update AI Modules to Use i18n

#### **3.1. smart-replies.js**

**Replace** lines 94-124 with:

```javascript
// FIX PEND-MED-003: Use i18n for persona prompts
const PERSONAS = {
  professional: {
    name: () => window.WHLi18n?.getAIPrompt('personas.professional.name') || 'Professional',
    systemPrompt: () => window.WHLi18n?.getAIPrompt('personas.professional.systemPrompt', {
      language: window.WHLi18n?.getLanguageName() || 'Portuguese'
    }) || defaultFallback
  },
  friendly: {
    name: () => window.WHLi18n?.getAIPrompt('personas.friendly.name') || 'Friendly',
    systemPrompt: () => window.WHLi18n?.getAIPrompt('personas.friendly.systemPrompt', {
      language: window.WHLi18n?.getLanguageName() || 'Portuguese'
    }) || defaultFallback
  },
  // ... repeat for sales, support, concierge, coach
};
```

#### **3.2. copilot-engine.js**

**Replace** lines 139-213 with same pattern as above.

#### **3.3. ai-suggestion-fixed.js**

**Replace** lines 828-835 with:

```javascript
// FIX PEND-MED-003: Use user's language instead of forcing Portuguese
const baseRules = window.WHLi18n?.getAIPrompt('instructions.baseRules', {
  rules: 'Seja útil e preciso.'
}) || 'You are a WhatsApp customer service assistant.';

const languageInstruction = window.WHLi18n?.getAIPrompt('instructions.languageInstruction', {
  language: window.WHLi18n?.getLanguageName() || 'Portuguese'
}) || 'Respond in the user\'s preferred language.';
```

#### **3.4. few-shot-learning.js**

**Replace** lines 545-561 with:

```javascript
formatForPrompt(examples) {
  const sectionTitle = window.WHLi18n?.getAIPrompt('fewShot.sectionTitle') || 'Previous conversation examples:';
  const exampleLabel = window.WHLi18n?.getAIPrompt('fewShot.exampleLabel', { index: '{INDEX}' }) || 'Example {INDEX}:';
  const customerLabel = window.WHLi18n?.getAIPrompt('fewShot.customerLabel') || 'Customer:';
  const agentLabel = window.WHLi18n?.getAIPrompt('fewShot.agentLabel') || 'Agent:';

  let formatted = `${sectionTitle}\n\n`;

  for (const [index, example] of examples.entries()) {
    formatted += `${exampleLabel.replace('{INDEX}', index + 1)}\n`;
    formatted += `${customerLabel} ${example.input}\n`;
    formatted += `${agentLabel} ${example.output}\n\n`;
  }

  return formatted;
}
```

#### **3.5. knowledge-base.js**

**Replace** lines 85-90 with:

```javascript
tone: {
  greeting: window.WHLi18n?.getAIPrompt('knowledgeBase.greeting') || 'Hello! How can I help?',
  closing: window.WHLi18n?.getAIPrompt('knowledgeBase.closing') || 'I\'m available for any questions!'
}
```

#### **3.6. ai-service.js**

**Replace** line 1038 with:

```javascript
const systemPrompt = options.systemPrompt || window.WHLi18n?.getAIPrompt('personas.professional.systemPrompt', {
  language: window.WHLi18n?.getLanguageName() || 'Portuguese'
}) || 'You are a professional assistant.';
```

**Replace** line 1170 with:

```javascript
{ role: 'system', content: window.WHLi18n?.getAIPrompt('translation.systemPrompt', {
  language: safeTargetLanguage
}) || `Translate the text to ${safeTargetLanguage}.` }
```

#### **3.7. features/multi-persona.js**

Update lines 29-69 with same pattern as smart-replies.js.

#### **3.8. advanced/multi-agent.js**

**Replace** lines 22-43 with:

```javascript
const AGENTS = {
  sales: {
    name: () => window.WHLi18n?.getAIPrompt('agents.sales.name') || 'Sales',
    systemPrompt: () => window.WHLi18n?.getAIPrompt('agents.sales.systemPrompt', {
      language: window.WHLi18n?.getLanguageName() || 'Portuguese'
    }) || defaultFallback
  },
  support: {
    name: () => window.WHLi18n?.getAIPrompt('agents.support.name') || 'Support',
    systemPrompt: () => window.WHLi18n?.getAIPrompt('agents.support.systemPrompt', {
      language: window.WHLi18n?.getLanguageName() || 'Portuguese'
    }) || defaultFallback
  },
  coordinator: {
    name: () => window.WHLi18n?.getAIPrompt('agents.coordinator.name') || 'Coordinator',
    systemPrompt: () => window.WHLi18n?.getAIPrompt('agents.coordinator.systemPrompt', {
      language: window.WHLi18n?.getLanguageName() || 'Portuguese'
    }) || defaultFallback
  }
};
```

---

### Phase 4: Testing

1. **Test UI in English:**
   ```javascript
   window.WHLi18n.setLanguage('en');
   // Verify AI responds in English
   ```

2. **Test UI in Spanish:**
   ```javascript
   window.WHLi18n.setLanguage('es');
   // Verify AI responds in Spanish
   ```

3. **Test Fallback:**
   ```javascript
   // Temporarily disable i18n
   window.WHLi18n = null;
   // Verify fallback prompts work
   ```

4. **Test Persona Switching:**
   - Professional persona in English
   - Friendly persona in Spanish
   - Verify correct translations

---

## Expected Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Languages supported (UI) | 5+ | 5+ | Same |
| Languages supported (AI) | 1 (PT only) | 5+ | **+400%** |
| Hardcoded prompts | 28 | 0 | **-100%** |
| i18n coverage | 50% (UI only) | 100% (UI + AI) | **+50%** |
| Language mismatch bugs | Many | None | **Fixed** |

---

## Migration Strategy

**Option A: Big Bang (Risky)**
- Apply all changes at once
- Test thoroughly before deployment
- Risk: Could break AI system if errors exist

**Option B: Gradual (Recommended)**
1. Week 1: Add i18n keys to locale files
2. Week 2: Add helper functions to i18n-manager.js
3. Week 3: Update 2-3 modules (smart-replies, copilot-engine)
4. Week 4: Test in production
5. Week 5: Update remaining modules
6. Week 6: Final testing & polish

---

## Rollback Plan

If issues occur:
1. Each module update has fallback (old hardcoded prompt)
2. Changes are backwards compatible
3. Can rollback individual modules without affecting others

---

## Status

⚠️ **READY FOR IMPLEMENTATION**

This requires careful implementation due to:
- Critical user-facing feature (AI responses)
- Multiple file changes (9 modules)
- New translations required (3 languages minimum)
- Testing across different languages needed

Recommend gradual rollout with thorough testing.

---

## Files to Modify

1. `i18n/locales/pt-BR.json` - Add aiPrompts section
2. `i18n/locales/en.json` - Add aiPrompts section
3. `i18n/locales/es.json` - Add aiPrompts section
4. `i18n/i18n-manager.js` - Add getAIPrompt() and getLanguageName()
5. `modules/smart-replies.js` - Use i18n for personas
6. `modules/copilot-engine.js` - Use i18n for personas
7. `modules/ai-suggestion-fixed.js` - Remove forced Portuguese
8. `modules/ai-service.js` - Use i18n for fallback
9. `modules/few-shot-learning.js` - Use i18n for labels
10. `modules/knowledge-base.js` - Use i18n for tone
11. `modules/features/multi-persona.js` - Use i18n for personas
12. `modules/advanced/multi-agent.js` - Use i18n for agents
