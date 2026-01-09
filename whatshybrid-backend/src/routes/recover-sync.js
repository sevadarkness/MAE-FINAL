/**
 * RECOVER SYNC ROUTES v7.5.0
 * Endpoints para sincronização do Recover
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/auth');

// Em produção, proteger endpoints legacy (/api/recover/*) também,
// pois estes endpoints podem armazenar grande volume em memória e expõem OCR/Transcribe.
// Em dev, manter livre para facilitar testes locais.
function recoverSyncAuth(req, res, next) {
  if (process.env.NODE_ENV === 'production') return authenticate(req, res, next);
  return next();
}

router.use(recoverSyncAuth);

// Armazenamento temporário (em produção usar MongoDB/PostgreSQL)
const recoverStorage = new Map();

/**
 * POST /api/recover/sync
 * Recebe mensagens do cliente para sincronizar
 */
router.post('/sync', async (req, res) => {
    try {
        const { userId, messages } = req.body;
        
        if (!userId || !Array.isArray(messages)) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId e messages são obrigatórios' 
            });
        }
        
        // Obter mensagens existentes do usuário
        let userMessages = recoverStorage.get(userId) || [];
        
        // Mesclar novas mensagens (evitar duplicatas)
        const existingIds = new Set(userMessages.map(m => m.id));
        const newMessages = messages.filter(m => !existingIds.has(m.id));
        
        userMessages = [...userMessages, ...newMessages];
        
        // Limitar a 10000 mensagens por usuário
        if (userMessages.length > 10000) {
            userMessages = userMessages.slice(-10000);
        }
        
        recoverStorage.set(userId, userMessages);
        
        res.json({
            success: true,
            synced: newMessages.length,
            total: userMessages.length
        });
        
    } catch (error) {
        logger.error('[Recover Sync] Erro:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * GET /api/recover/messages
 * Retorna mensagens do usuário
 */
router.get('/messages', async (req, res) => {
    try {
        const { userId, since = 0, limit = 100 } = req.query;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId é obrigatório' 
            });
        }
        
        const userMessages = recoverStorage.get(userId) || [];
        
        // Filtrar por timestamp
        let messages = userMessages.filter(m => m.timestamp > parseInt(since));
        
        // Ordenar por timestamp (mais recentes primeiro)
        messages.sort((a, b) => b.timestamp - a.timestamp);
        
        // Limitar
        messages = messages.slice(0, parseInt(limit));
        
        res.json({
            success: true,
            messages,
            total: userMessages.length
        });
        
    } catch (error) {
        logger.error('[Recover Sync] Erro:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * DELETE /api/recover/clear
 * Limpa mensagens do usuário
 */
router.delete('/clear', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId é obrigatório' 
            });
        }
        
        recoverStorage.delete(userId);
        
        res.json({
            success: true,
            message: 'Histórico limpo'
        });
        
    } catch (error) {
        logger.error('[Recover Sync] Erro:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * POST /api/recover/ai/transcribe
 * Transcreve áudio para texto usando OpenAI Whisper
 * 
 * Body:
 * - audioData: Base64 encoded audio
 * - format: (opcional) Formato do áudio - padrão 'ogg'
 * - language: (opcional) Idioma - padrão 'pt'
 */
router.post('/ai/transcribe', async (req, res) => {
    try {
        const { audioData, format = 'ogg', language = 'pt' } = req.body;
        
        if (!audioData) {
            return res.status(400).json({ 
                success: false, 
                error: 'audioData é obrigatório' 
            });
        }
        
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            return res.json({
                success: false,
                error: 'OPENAI_API_KEY não configurada no .env'
            });
        }
        
        // Redirecionar para a rota principal de transcrição
        // ou implementar diretamente aqui
        const axios = require('axios');
        const FormData = require('form-data');
        
        const audioBuffer = Buffer.from(
            audioData.replace(/^data:audio\/\w+;base64,/, ''), 
            'base64'
        );
        
        const formData = new FormData();
        formData.append('file', audioBuffer, {
            filename: `audio.${format}`,
            contentType: `audio/${format}`
        });
        formData.append('model', 'whisper-1');
        formData.append('language', language);
        
        const response = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            formData,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    ...formData.getHeaders()
                },
                timeout: 60000
            }
        );
        
        res.json({
            success: true,
            text: response.data?.text || '',
            language
        });
        
    } catch (error) {
        logger.error('[Recover AI] Erro transcrição:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data?.error?.message || error.message 
        });
    }
});

/**
 * POST /api/recover/ai/ocr
 * Extrai texto de imagem usando Tesseract.js ou Google Vision
 * 
 * Body:
 * - imageData: Base64 encoded image
 * - language: (opcional) Idioma - padrão 'por' (português)
 */
router.post('/ai/ocr', async (req, res) => {
    try {
        const { imageData, language = 'por' } = req.body;
        
        if (!imageData) {
            return res.status(400).json({ 
                success: false, 
                error: 'imageData é obrigatório' 
            });
        }
        
        // Tentar Tesseract.js primeiro
        let Tesseract = null;
        try {
            Tesseract = require('tesseract.js');
        } catch (e) {
            // Tesseract não instalado
        }
        
        if (Tesseract) {
            const imageBuffer = Buffer.from(
                imageData.replace(/^data:image\/\w+;base64,/, ''), 
                'base64'
            );
            
            const { data: { text, confidence } } = await Tesseract.recognize(
                imageBuffer,
                language
            );
            
            return res.json({
                success: true,
                text: text.trim(),
                confidence: confidence / 100,
                provider: 'tesseract'
            });
        }
        
        // Tentar Google Vision como fallback
        const googleApiKey = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_API_KEY;
        
        if (googleApiKey) {
            const axios = require('axios');
            const imageContent = imageData.replace(/^data:image\/\w+;base64,/, '');
            
            const response = await axios.post(
                `https://vision.googleapis.com/v1/images:annotate?key=${googleApiKey}`,
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
            
            return res.json({
                success: true,
                text: text.trim(),
                provider: 'google_vision'
            });
        }
        
        // Nenhum serviço disponível
        res.json({
            success: false,
            error: 'Nenhum serviço de OCR disponível. Instale tesseract.js ou configure GOOGLE_VISION_API_KEY.'
        });
        
    } catch (error) {
        logger.error('[Recover AI] Erro OCR:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * POST /api/recover/ai/sentiment
 * Analisa sentimento do texto
 */
router.post('/ai/sentiment', async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ 
                success: false, 
                error: 'text é obrigatório' 
            });
        }
        
        // Análise simples de sentimento (sem API externa)
        const positiveWords = ['bom', 'ótimo', 'excelente', 'feliz', 'obrigado', 'parabéns', 'amor', 'adorei', 'top', 'show', 'maravilhoso', 'incrível'];
        const negativeWords = ['ruim', 'péssimo', 'horrível', 'triste', 'chato', 'raiva', 'ódio', 'problema', 'erro', 'nunca', 'não'];
        
        const textLower = text.toLowerCase();
        let score = 0;
        
        positiveWords.forEach(word => {
            if (textLower.includes(word)) score += 0.2;
        });
        
        negativeWords.forEach(word => {
            if (textLower.includes(word)) score -= 0.2;
        });
        
        // Normalizar score entre -1 e 1
        score = Math.max(-1, Math.min(1, score));
        
        let label = 'neutro';
        if (score > 0.1) label = 'positivo';
        else if (score < -0.1) label = 'negativo';
        
        res.json({
            success: true,
            score,
            label,
            confidence: Math.abs(score)
        });
        
    } catch (error) {
        logger.error('[Recover AI] Erro sentimento:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;
