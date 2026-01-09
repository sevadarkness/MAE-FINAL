/**
 * 🗣️ WhatsHybrid - Speech to Text
 * Transcrição de áudio com múltiplos provedores e idiomas
 * @version 7.9.13
 */
(function() {
  'use strict';

  const LANGUAGES = {
    'pt-BR': { name: 'Português (Brasil)', whisper: 'pt', flag: '🇧🇷' },
    'en-US': { name: 'English (US)', whisper: 'en', flag: '🇺🇸' },
    'es-ES': { name: 'Español', whisper: 'es', flag: '🇪🇸' },
    'fr-FR': { name: 'Français', whisper: 'fr', flag: '🇫🇷' },
    'de-DE': { name: 'Deutsch', whisper: 'de', flag: '🇩🇪' },
    'it-IT': { name: 'Italiano', whisper: 'it', flag: '🇮🇹' },
    'ja-JP': { name: '日本語', whisper: 'ja', flag: '🇯🇵' },
    'zh-CN': { name: '中文', whisper: 'zh', flag: '🇨🇳' },
    'ar-SA': { name: 'العربية', whisper: 'ar', flag: '🇸🇦' },
    'ru-RU': { name: 'Русский', whisper: 'ru', flag: '🇷🇺' },
    'auto': { name: 'Auto-detectar', whisper: null, flag: '🌐' }
  };

  const PROVIDERS = {
    OPENAI: 'openai_whisper',
    GOOGLE: 'google_speech',
    BROWSER: 'browser_api',
    BACKEND: 'backend'
  };

  class SpeechToText {
    constructor(options = {}) {
      this.provider = options.provider || PROVIDERS.OPENAI;
      this.language = options.language || 'pt-BR';
      this.onProgress = options.onProgress || null;
      this.onError = options.onError || null;
    }

    setLanguage(lang) { if (LANGUAGES[lang]) this.language = lang; }

    async transcribe(audioBlob, options = {}) {
      const lang = options.language || this.language;
      this.onProgress?.({ status: 'processing', message: 'Processando áudio...' });

      try {
        let result;
        switch (this.provider) {
          case PROVIDERS.OPENAI: result = await this._whisper(audioBlob, lang); break;
          case PROVIDERS.GOOGLE: result = await this._google(audioBlob, lang); break;
          case PROVIDERS.BROWSER: result = await this._browser(audioBlob, lang); break;
          case PROVIDERS.BACKEND: result = await this._backend(audioBlob, lang); break;
          default: throw new Error('Provedor inválido');
        }
        return result;
      } catch (error) {
        this.onError?.(error);
        throw error;
      }
    }

    async _whisper(blob, lang) {
      const apiKey = await this._getKey('openai');
      if (!apiKey) throw new Error('API Key OpenAI não configurada');

      const formData = new FormData();
      formData.append('file', new File([blob], 'audio.webm', { type: blob.type }));
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'json');
      
      const langInfo = LANGUAGES[lang];
      if (langInfo?.whisper) formData.append('language', langInfo.whisper);

      this.onProgress?.({ status: 'uploading', message: 'Enviando para Whisper...' });

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Erro HTTP ${res.status}`);
      }

      const data = await res.json();
      return { text: data.text || '', language: lang, provider: 'whisper', confidence: 0.95 };
    }

    async _google(blob, lang) {
      const apiKey = await this._getKey('google');
      if (!apiKey) throw new Error('API Key Google não configurada');

      const base64 = await window.WHLVoiceRecorder.blobToBase64(blob);
      
      this.onProgress?.({ status: 'uploading', message: 'Enviando para Google...' });

      const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { encoding: 'WEBM_OPUS', sampleRateHertz: 16000, languageCode: lang },
          audio: { content: base64 }
        })
      });

      if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
      
      const data = await res.json();
      const alt = data.results?.[0]?.alternatives?.[0] || {};
      return { text: alt.transcript || '', language: lang, provider: 'google', confidence: alt.confidence || 0 };
    }

    async _browser(blob, lang) {
      return new Promise((resolve, reject) => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return reject(new Error('Web Speech API não suportada'));

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = lang;
        
        let text = '', confidence = 0;
        
        recognition.onresult = (e) => {
          const r = e.results[0][0];
          text = r.transcript;
          confidence = r.confidence;
        };
        
        recognition.onend = () => resolve({ text, language: lang, provider: 'browser', confidence });
        recognition.onerror = (e) => reject(new Error(e.error));
        
        const audio = new Audio(URL.createObjectURL(blob));
        audio.onended = () => recognition.stop();
        recognition.start();
        audio.play().catch(reject);
      });
    }

    async _backend(blob, lang) {
      const url = await this._getBackendUrl();
      const formData = new FormData();
      formData.append('audio', blob, 'audio.webm');
      formData.append('language', lang);

      this.onProgress?.({ status: 'uploading', message: 'Enviando para servidor...' });

      const res = await fetch(`${url}/api/v1/speech/transcribe`, {
        method: 'POST',
        body: formData,
        headers: await this._getAuthHeaders()
      });

      if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
      const data = await res.json();
      return { text: data.text || '', language: lang, provider: 'backend', confidence: data.confidence || 0 };
    }

    async _getKey(provider) {
      return new Promise(resolve => {
        chrome.storage?.local.get([`whl_${provider}_api_key`, 'whl_ai_config_v2'], r => {
          const key = r[`whl_${provider}_api_key`];
          if (key) return resolve(key);
          const config = r.whl_ai_config_v2;
          if (config) {
            const parsed = typeof config === 'string' ? JSON.parse(config) : config;
            resolve(parsed[provider]?.apiKey || parsed.apiKey || null);
          } else resolve(null);
        }) || resolve(null);
      });
    }

    async _getBackendUrl() {
      return new Promise(resolve => {
        chrome.storage?.local.get(['whl_backend_url'], r => 
          resolve(r.whl_backend_url || 'http://localhost:3000')
        ) || resolve('http://localhost:3000');
      });
    }

    async _getAuthHeaders() {
      return new Promise(resolve => {
        chrome.storage?.local.get(['whl_auth_token'], r => {
          resolve(r.whl_auth_token ? { 'Authorization': `Bearer ${r.whl_auth_token}` } : {});
        }) || resolve({});
      });
    }

    static getLanguages() {
      return Object.entries(LANGUAGES).map(([code, info]) => ({ code, ...info }));
    }

    static getProviders() {
      return [
        { id: PROVIDERS.OPENAI, name: 'OpenAI Whisper', desc: 'Melhor qualidade' },
        { id: PROVIDERS.GOOGLE, name: 'Google Speech', desc: 'Rápido' },
        { id: PROVIDERS.BROWSER, name: 'Navegador', desc: 'Gratuito' },
        { id: PROVIDERS.BACKEND, name: 'Servidor', desc: 'Customizado' }
      ];
    }
  }

  window.WHLSpeechToText = SpeechToText;
  window.WHLSTTProviders = PROVIDERS;
  window.WHLSTTLanguages = LANGUAGES;
})();
