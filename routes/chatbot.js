/**
 * Routes API pour le Chatbot IA
 * POST /chat - Envoyer un message au chatbot
 * POST /setup-assistant - Créer l'assistant OpenAI (admin)
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const chatbotService = require('../services/chatbotService');
const { verifyToken, isAdmin } = require('../middleware/auths');
const { getPool } = require('../database/db');

// ============================================
// SEND MESSAGE TO CHATBOT
// ============================================
router.post('/chat', async (req, res) => {
  const schema = z.object({
    message: z.string().min(1).max(1000),
    threadId: z.string().nullish(), // accepte null/undefined pour nouvelle conversation
  });

  try {
    const { message, threadId } = schema.parse(req.body);

    const db = getPool();
    const response = await chatbotService.sendMessage(message, threadId, db);

    res.json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error('Error in chatbot:', error);

    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Erreur serveur',
    });
  }
});

// ============================================
// SETUP ASSISTANT (Admin only - one-time)
// ============================================
router.post('/setup-assistant', verifyToken, isAdmin, async (req, res) => {
  try {
    const assistantId = await chatbotService.createAssistant();

    res.json({
      success: true,
      assistantId,
      message:
        'Assistant créé ! Ajoutez cet ID dans votre .env : OPENAI_ASSISTANT_ID=' +
        assistantId,
    });
  } catch (error) {
    console.error('Error setting up assistant:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors de la création de l\'assistant',
    });
  }
});

// ============================================
// SETUP ASSISTANT DEV (sans auth, local uniquement)
// ============================================
router.post('/setup-assistant-dev', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Route désactivée en production' });
  }
  next();
}, async (req, res) => {
  try {
    const assistantId = await chatbotService.createAssistant();

    res.json({
      success: true,
      assistantId,
      message:
        'Assistant créé ! Ajoutez cet ID dans backend/.env : OPENAI_ASSISTANT_ID=' +
        assistantId,
    });
  } catch (error) {
    console.error('Error setting up assistant:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors de la création de l\'assistant',
    });
  }
});

module.exports = router;
