/**
 * WhatsHybrid Backend - Recover Routes v7.5.0
 * Endpoints para suporte ao módulo Recover Advanced
 * 
 * FEATURES:
 * - Sincronização de mensagens recuperadas
 * - Transcrição de áudio via OpenAI Whisper
 * - OCR via Tesseract.js
 * - Download de mídia
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/auth');

// Em produção, proteger TODOS os endpoints do Recover (inclui transcribe/OCR/download de mídia)
// para evitar abuso (ex.: encher disco com /sync, ou uso indevido de API keys).
// Em dev, permitir sem auth para facilitar testes locais.
function recoverAuth(req, res, next) {
  if (process.env.NODE_ENV === 'production') return authenticate(req, res, next);
  return next();
}

router.use(recoverAuth);

// Opcional: Tesseract.js para OCR local
let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
  logger.info('[Recover] ✅ Tesseract.js carregado para OCR');
} catch (e) {
  logger.info('[Recover] ⚠️ Tesseract.js não instalado - OCR desabilitado (npm install tesseract.js)');
}

// Diretório para armazenar dados de recover
const RECOVER_DIR = path.join(__dirname, '../../data/recover');

// Garantir que diretório existe
if (!fs.existsSync(RECOVER_DIR)) {
  fs.mkdirSync(RECOVER_DIR, { recursive: true });
}

/**
 * POST /api/recover/sync
 * Sincronizar mensagens recuperadas com o backend
 */
router.post('/sync', async (req, res) => {
  try {
    const { messages, timestamp, userId } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }
    
    // Salvar no arquivo por usuário/sessão
    const filename = `recover_${userId || 'default'}_${Date.now()}.json`;
    const filepath = path.join(RECOVER_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify({
      timestamp,
      count: messages.length,
      messages
    }, null, 2));
    
    logger.info(`[Recover] Synced ${messages.length} messages to ${filename}`);
    
    res.json({
      success: true,
      synced: messages.length,
      filename
    });
  } catch (error) {
    logger.error('[Recover] Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/recover/history
 * Obter histórico de mensagens recuperadas
 */
router.get('/history', async (req, res) => {
  try {
    const { userId, limit = 100 } = req.query;
    
    // Listar arquivos de recover
    const files = fs.readdirSync(RECOVER_DIR)
      .filter(f => f.startsWith(`recover_${userId || 'default'}`))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      return res.json({ messages: [], total: 0 });
    }
    
    // Carregar último arquivo
    const latest = path.join(RECOVER_DIR, files[0]);
    const data = JSON.parse(fs.readFileSync(latest, 'utf8'));
    
    res.json({
      messages: data.messages?.slice(0, limit) || [],
      total: data.count || 0,
      timestamp: data.timestamp
    });
  } catch (error) {
    logger.error('[Recover] History error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/transcribe
 * Transcrever áudio para texto usando OpenAI Whisper
 * 
 * Body:
 * - audio: Base64 encoded audio data
 * - format: (opcional) 'mp3', 'wav', 'ogg', 'm4a', 'webm' - padrão 'ogg'
 * - language: (opcional) Código do idioma - padrão 'pt'
 */
router.post('/transcribe', async (req, res) => {
  try {
    const { audio, format = 'ogg', language = 'pt' } = req.body;
    
    if (!audio) {
      return res.status(400).json({ success: false, error: 'Audio data required' });
    }
    
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      logger.info('[Recover] ⚠️ OPENAI_API_KEY não configurada');
      return res.json({
        success: false,
        text: '',
        error: 'Transcrição não disponível - configure OPENAI_API_KEY no arquivo .env'
      });
    }
    
    logger.info('[Recover] 🎤 Transcrevendo áudio via Whisper...');
    
    // Converter Base64 para Buffer
    const audioBuffer = Buffer.from(audio.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
    
    // Criar FormData para enviar ao Whisper
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: `audio.${format}`,
      contentType: `audio/${format === 'ogg' ? 'ogg' : format}`
    });
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    formData.append('response_format', 'json');
    
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...formData.getHeaders()
        },
        timeout: 60000, // 60 segundos timeout para arquivos grandes
        maxContentLength: 25 * 1024 * 1024 // 25MB máximo
      }
    );
    
    const text = response.data?.text || '';
    
    logger.info('[Recover] ✅ Transcrição concluída:', text.substring(0, 50) + '...');
    
    res.json({
      success: true,
      text,
      language,
      duration: response.data?.duration
    });
    
  } catch (error) {
    logger.error('[Recover] ❌ Transcription error:', error.response?.data || error.message);
    
    // Erro específico da API
    if (error.response?.status === 401) {
      return res.status(401).json({ 
        success: false, 
        error: 'API key inválida - verifique OPENAI_API_KEY' 
      });
    }
    
    if (error.response?.status === 413) {
      return res.status(413).json({ 
        success: false, 
        error: 'Áudio muito grande - máximo 25MB' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.error?.message || error.message 
    });
  }
});

/**
 * POST /api/ocr
 * Extrair texto de imagem usando Tesseract.js ou Google Vision
 * 
 * Body:
 * - image: Base64 encoded image data
 * - language: (opcional) Código do idioma - padrão 'por' (português)
 */
router.post('/ocr', async (req, res) => {
  try {
    const { image, language = 'por' } = req.body;
    
    if (!image) {
      return res.status(400).json({ success: false, error: 'Image data required' });
    }
    
    logger.info('[Recover] 🔍 Processando OCR...');
    
    // Verificar se temos Tesseract disponível
    if (!Tesseract) {
      // Tentar usar Google Vision API como alternativa
      const googleApiKey = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_API_KEY;
      
      if (googleApiKey) {
        return await processGoogleVisionOCR(image, googleApiKey, res);
      }
      
      return res.json({
        success: false,
        text: '',
        error: 'OCR não disponível - instale tesseract.js (npm install tesseract.js) ou configure GOOGLE_VISION_API_KEY'
      });
    }
    
    // Processar com Tesseract.js
    const imageBuffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    
    const { data: { text, confidence } } = await Tesseract.recognize(
      imageBuffer,
      language,
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            logger.info(`[Recover] OCR progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );
    
    logger.info('[Recover] ✅ OCR concluído, confiança:', confidence);
    
    res.json({
      success: true,
      text: text.trim(),
      confidence: confidence / 100, // Normalizar para 0-1
      language
    });
    
  } catch (error) {
    logger.error('[Recover] ❌ OCR error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Processar OCR via Google Cloud Vision API
 */
async function processGoogleVisionOCR(imageBase64, apiKey, res) {
  try {
    const imageContent = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    
    const response = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        requests: [{
          image: { content: imageContent },
          features: [{ type: 'TEXT_DETECTION', maxResults: 1 }]
        }]
      },
      { timeout: 30000 }
    );
    
    const annotations = response.data?.responses?.[0]?.textAnnotations;
    const text = annotations?.[0]?.description || '';
    
    logger.info('[Recover] ✅ Google Vision OCR concluído');
    
    return res.json({
      success: true,
      text: text.trim(),
      provider: 'google_vision'
    });
    
  } catch (error) {
    logger.error('[Recover] ❌ Google Vision error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro no Google Vision: ' + (error.response?.data?.error?.message || error.message)
    });
  }
}

// ============================================
// RECOVER: WHATSAPP MEDIA DOWNLOAD (decrypt)
// ============================================
const RECOVER_MAX_MEDIA_BYTES = Number(process.env.RECOVER_MAX_MEDIA_BYTES || 5 * 1024 * 1024); // 5MB
const RECOVER_MAX_ENCRYPTED_BYTES = Number(process.env.RECOVER_MAX_ENCRYPTED_BYTES || 12 * 1024 * 1024); // 12MB

function safeStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function parseMediaKey(mediaKey) {
  if (!mediaKey) return null;
  if (Buffer.isBuffer(mediaKey)) return mediaKey;

  // Buffer serializado
  if (typeof mediaKey === 'object' && mediaKey.type === 'Buffer' && Array.isArray(mediaKey.data)) {
    return Buffer.from(mediaKey.data);
  }

  if (Array.isArray(mediaKey)) {
    try { return Buffer.from(mediaKey); } catch (_) { return null; }
  }

  if (typeof mediaKey === 'object' && Array.isArray(mediaKey.data)) {
    try { return Buffer.from(mediaKey.data); } catch (_) { return null; }
  }

  if (typeof mediaKey === 'string') {
    const s = mediaKey.trim();
    if (!s) return null;

    // Tentar base64 primeiro
    if (/^[A-Za-z0-9+/=]+$/.test(s)) {
      try {
        const b = Buffer.from(s, 'base64');
        if (b.length >= 32) return b;
      } catch (_) {}
    }

    // Tentar hex
    if (/^[A-Fa-f0-9]+$/.test(s)) {
      try {
        const b = Buffer.from(s, 'hex');
        if (b.length >= 32) return b;
      } catch (_) {}
    }
  }

  return null;
}

function getMediaInfoString(mimetype) {
  const mt = safeStr(mimetype).toLowerCase();
  if (mt.startsWith('image/')) return 'WhatsApp Image Keys';
  if (mt.startsWith('video/')) return 'WhatsApp Video Keys';
  if (mt.startsWith('audio/')) return 'WhatsApp Audio Keys';
  return 'WhatsApp Document Keys';
}

function buildWhatsAppMediaUrl(directPath) {
  const v = safeStr(directPath);
  if (!v) return null;

  // URL completa (hardening SSRF: permitir apenas whatsapp.net)
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      if (!u.hostname.endsWith('whatsapp.net')) return null;
      return u.toString();
    } catch (_) {
      return null;
    }
  }

  // Apenas path: usar mmg.whatsapp.net
  const p = v.startsWith('/') ? v : `/${v}`;
  if (/\s/.test(p)) return null;
  return `https://mmg.whatsapp.net${p}`;
}

function decryptWhatsAppMedia(encryptedBuf, mediaKeyBuf, mimetype) {
  if (!Buffer.isBuffer(encryptedBuf) || encryptedBuf.length <= 10) {
    throw new Error('Arquivo criptografado inválido');
  }
  if (!Buffer.isBuffer(mediaKeyBuf) || mediaKeyBuf.length < 32) {
    throw new Error('MediaKey inválida');
  }

  const info = getMediaInfoString(mimetype);
  const salt = Buffer.alloc(32, 0);
  const expanded = crypto.hkdfSync('sha256', mediaKeyBuf, salt, Buffer.from(info, 'utf-8'), 112);

  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);

  // WhatsApp: ciphertext + 10 bytes MAC (truncado)
  const mac = encryptedBuf.subarray(encryptedBuf.length - 10);
  const ciphertext = encryptedBuf.subarray(0, encryptedBuf.length - 10);

  const expectedMacFull = crypto.createHmac('sha256', macKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest();
  const expectedMac = expectedMacFull.subarray(0, 10);

  if (mac.length !== expectedMac.length || !crypto.timingSafeEqual(mac, expectedMac)) {
    throw new Error('MAC inválido (integridade)');
  }

  const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}

/**
 * POST /api/media/download
 * Download ativo de mídia do WhatsApp (8.1)
 */
router.post('/media/download', async (req, res) => {
  try {
    const { mediaKey, directPath, mimetype } = req.body;
    
    if (!mediaKey) {
      return res.status(400).json({ error: 'Media key required' });
    }

    const url = buildWhatsAppMediaUrl(directPath);
    if (!url) {
      return res.status(400).json({ error: 'directPath/url inválido ou não permitido' });
    }

    const keyBuf = parseMediaKey(mediaKey);
    if (!keyBuf) {
      return res.status(400).json({ error: 'Media key inválida (esperado base64/hex/buffer)' });
    }

    logger.info('[Recover] Media download requested:', {
      urlHost: (() => { try { return new URL(url).hostname; } catch (_) { return 'unknown'; } })(),
      mimetype: mimetype || null
    });

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: RECOVER_MAX_ENCRYPTED_BYTES,
      maxBodyLength: RECOVER_MAX_ENCRYPTED_BYTES,
      headers: {
        'User-Agent': 'WhatsHybrid-Recover/7.9.13'
      }
    });

    const encrypted = Buffer.from(response.data);
    if (encrypted.length > RECOVER_MAX_ENCRYPTED_BYTES) {
      return res.status(413).json({ error: 'Arquivo criptografado excede limite' });
    }

    const decrypted = decryptWhatsAppMedia(encrypted, keyBuf, mimetype);
    if (decrypted.length > RECOVER_MAX_MEDIA_BYTES) {
      return res.status(413).json({ error: 'Mídia excede limite configurado' });
    }

    return res.json({
      success: true,
      base64: decrypted.toString('base64'),
      mimetype: mimetype || 'application/octet-stream',
      bytes: decrypted.length
    });
  } catch (error) {
    logger.error('[Recover] Media download error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Erro ao baixar mídia' });
  }
});

module.exports = router;
