/**
 * 🤖 WhatsHybrid - AI Client para Training
 * Cliente de IA leve para uso na página de treinamento
 * Faz chamadas diretas para APIs de IA
 * 
 * @version 7.9.13
 */
(function() {
  'use strict';

  class TrainingAIClient {
    constructor() {
      this.config = null;
      this.backendUrl = null;
      this.initialized = false;
    }

    async init() {
      if (this.initialized) return;
      
      try {
        const data = await this._getStorage([
          'whl_ai_config_v2',
          'whl_backend_url',
          'whl_auth_token',
          'whl_openai_api_key',
          'whl_knowledge_base'
        ]);
        
        this.config = data.whl_ai_config_v2 || {};
        if (typeof this.config === 'string') {
          this.config = JSON.parse(this.config);
        }
        
        this.backendUrl = data.whl_backend_url || 'http://localhost:3000';
        this.authToken = data.whl_auth_token;
        this.apiKey = data.whl_openai_api_key || this.config.apiKey || this.config.openai?.apiKey;
        this.knowledgeBase = data.whl_knowledge_base || {};
        
        this.initialized = true;
        console.log('[TrainingAIClient] Inicializado');
      } catch (e) {
        console.error('[TrainingAIClient] Erro ao inicializar:', e);
      }
    }

    async generateResponse(options = {}) {
      await this.init();
      
      const { messages = [], lastMessage = '', temperature = 0.7 } = options;
      
      // Tentar backend primeiro
      try {
        const backendResponse = await this._callBackend(messages, lastMessage);
        if (backendResponse) return backendResponse;
      } catch (e) {
        console.warn('[TrainingAIClient] Backend indisponível:', e.message);
      }

      // Fallback para OpenAI direto
      if (this.apiKey) {
        try {
          return await this._callOpenAI(messages, lastMessage, temperature);
        } catch (e) {
          console.warn('[TrainingAIClient] OpenAI erro:', e.message);
        }
      }

      // Fallback final - resposta contextual básica
      return this._generateFallback(lastMessage);
    }

    async _callBackend(messages, lastMessage) {
      if (!this.backendUrl) return null;
      
      const response = await fetch(`${this.backendUrl}/api/v1/ai/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {})
        },
        body: JSON.stringify({
          messages: [...messages, { role: 'user', content: lastMessage }],
          temperature: 0.7,
          maxTokens: 500,
          context: 'training'
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      return data.content || data.text || data.message;
    }

    async _callOpenAI(messages, lastMessage, temperature) {
      const systemPrompt = this._buildSystemPrompt();
      
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: lastMessage }
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model || 'gpt-3.5-turbo',
          messages: apiMessages,
          temperature,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    }

    _buildSystemPrompt() {
      const business = this.knowledgeBase.businessInfo || {};
      const faqs = this.knowledgeBase.faqs || [];
      
      let prompt = 'Você é um assistente de atendimento ao cliente treinado para responder de forma profissional e útil.';
      
      if (business.name) {
        prompt += `\n\nVocê trabalha para: ${business.name}`;
      }
      if (business.description) {
        prompt += `\nSobre o negócio: ${business.description}`;
      }
      if (business.tone) {
        prompt += `\nTom de comunicação: ${business.tone}`;
      }
      
      if (faqs.length > 0) {
        prompt += '\n\nFAQs importantes:';
        faqs.slice(0, 5).forEach(faq => {
          prompt += `\n- P: ${faq.question}\n  R: ${faq.answer}`;
        });
      }
      
      prompt += '\n\nResponda de forma concisa, profissional e útil. Se não souber algo, seja honesto.';
      
      return prompt;
    }

    _generateFallback(message) {
      const lower = message.toLowerCase();
      
      // Respostas contextuais básicas
      if (lower.includes('preço') || lower.includes('valor') || lower.includes('quanto')) {
        return 'Posso ajudar com informações sobre preços! Qual produto ou serviço você gostaria de saber mais?';
      }
      if (lower.includes('horário') || lower.includes('funciona') || lower.includes('abre')) {
        return 'Sobre nosso horário de funcionamento, estamos disponíveis para atendimento. Posso ajudar com algo específico?';
      }
      if (lower.includes('obrigad')) {
        return 'Por nada! Fico feliz em ajudar. Precisa de mais alguma coisa?';
      }
      if (lower.includes('oi') || lower.includes('olá') || lower.includes('bom dia') || lower.includes('boa tarde') || lower.includes('boa noite')) {
        return 'Olá! Seja bem-vindo! Como posso ajudá-lo hoje?';
      }
      if (lower.includes('?')) {
        return 'Boa pergunta! Deixe-me verificar isso para você. Pode me dar mais detalhes?';
      }
      
      // Respostas genéricas variadas
      const generic = [
        'Entendi! Pode me contar mais sobre o que você precisa?',
        'Interessante! Como posso ajudá-lo com isso?',
        'Certo, estou aqui para ajudar. O que mais você gostaria de saber?',
        'Compreendo. Posso te ajudar com mais informações sobre isso.',
        'Obrigado por compartilhar! Em que mais posso ser útil?'
      ];
      
      return generic[Math.floor(Math.random() * generic.length)];
    }

    _getStorage(keys) {
      return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get(keys, resolve);
        } else {
          resolve({});
        }
      });
    }
  }

  // Criar instância global e expor como CopilotEngine para compatibilidade
  const client = new TrainingAIClient();
  
  // Expor interface compatível com CopilotEngine
  window.CopilotEngine = {
    generateResponse: async (options) => {
      const text = await client.generateResponse(options);
      return { text, content: text };
    }
  };
  
  // Expor também como AIService
  window.AIService = {
    complete: async (options) => {
      const text = await client.generateResponse(options);
      return { text, content: text };
    }
  };

  window.TrainingAIClient = client;
  
  console.log('[TrainingAIClient] ✅ Carregado e exposto como CopilotEngine/AIService');
})();
