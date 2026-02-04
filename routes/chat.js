// backend/routes/chat.js - Routes de chat temps réel
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin, requireStaff } = require('../middleware/auths');
const { getPool } = require('../database/db');

// ============================================
// ROUTES UTILISATEUR
// ============================================

// GET /chat/conversations - Mes conversations
router.get('/conversations', requireAuth, async (req, res) => {
  const pool = getPool();
  
  try {
    const userId = req.userId;
    const userRole = req.userRole;
    
    let query;
    let params;
    
    if (userRole === 'admin' || userRole === 'staff') {
      // Admin voit toutes les conversations
      query = `
        SELECT 
          c.*,
          u.firstname as user_firstname,
          u.lastname as user_lastname,
          u.email as user_email,
          u.avatar_url as user_avatar,
          a.firstname as admin_firstname,
          a.lastname as admin_lastname,
          NULL::text as project_title,
          (
            SELECT message FROM chat_messages 
            WHERE conversation_id = c.id 
            ORDER BY created_at DESC LIMIT 1
          ) as last_message,
          (
            SELECT COUNT(*) FROM chat_messages 
            WHERE conversation_id = c.id AND is_read = false AND sender_id != $1
          )::int as unread_count
        FROM chat_conversations c
        JOIN users u ON c.user_id = u.id
        LEFT JOIN users a ON c.admin_id = a.id
        WHERE c.status != 'archived'
        ORDER BY c.last_message_at DESC
      `;
      params = [userId];
    } else {
      // Client voit uniquement ses conversations
      query = `
        SELECT 
          c.*,
          a.firstname as admin_firstname,
          a.lastname as admin_lastname,
          a.avatar_url as admin_avatar,
          NULL::text as project_title,
          (
            SELECT message FROM chat_messages 
            WHERE conversation_id = c.id 
            ORDER BY created_at DESC LIMIT 1
          ) as last_message,
          (
            SELECT COUNT(*) FROM chat_messages 
            WHERE conversation_id = c.id AND is_read = false AND sender_id != $1
          )::int as unread_count
        FROM chat_conversations c
        LEFT JOIN users a ON c.admin_id = a.id
        WHERE c.user_id = $1 AND c.status != 'archived'
        ORDER BY c.last_message_at DESC
      `;
      params = [userId];
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      conversations: result.rows
    });
    
  } catch (error) {
    console.error('Erreur récupération conversations:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /chat/conversations - Créer une conversation
router.post('/conversations', requireAuth, async (req, res) => {
  const pool = getPool();
  
  try {
    const userId = req.userId;
    const { subject, project_id, initial_message } = req.body;
    
    // Vérifier si une conversation active existe déjà
    const existingResult = await pool.query(`
      SELECT id FROM chat_conversations 
      WHERE user_id = $1 AND status = 'active' AND project_id IS NOT DISTINCT FROM $2
      LIMIT 1
    `, [userId, project_id || null]);
    
    let conversationId;
    
    if (existingResult.rows.length > 0) {
      conversationId = existingResult.rows[0].id;
    } else {
      // Créer nouvelle conversation
      const newConv = await pool.query(`
        INSERT INTO chat_conversations (user_id, subject, project_id, status)
        VALUES ($1, $2, $3, 'active')
        RETURNING id
      `, [userId, subject || 'Nouvelle conversation', project_id || null]);
      
      conversationId = newConv.rows[0].id;
    }
    
    // Envoyer le message initial si fourni
    if (initial_message) {
      await pool.query(`
        INSERT INTO chat_messages (conversation_id, sender_id, message)
        VALUES ($1, $2, $3)
      `, [conversationId, userId, initial_message]);
      
      // Mettre à jour last_message_at et unread_admin
      await pool.query(`
        UPDATE chat_conversations 
        SET last_message_at = CURRENT_TIMESTAMP, unread_admin = unread_admin + 1
        WHERE id = $1
      `, [conversationId]);
    }
    
    // Récupérer la conversation complète
    const convResult = await pool.query(`
      SELECT c.*, u.firstname, u.lastname, u.email
      FROM chat_conversations c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = $1
    `, [conversationId]);
    
    res.status(201).json({
      success: true,
      conversation: convResult.rows[0]
    });
    
  } catch (error) {
    console.error('Erreur création conversation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /chat/conversations/:id/messages - Messages d'une conversation
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userId = req.userId;
    const userRole = req.userRole;
    const { limit = 50, before } = req.query;
    
    // Vérifier accès à la conversation
    const convResult = await pool.query(`
      SELECT * FROM chat_conversations WHERE id = $1
    `, [id]);
    
    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }
    
    const conv = convResult.rows[0];
    
    // Vérifier que l'utilisateur a accès
    if (userRole !== 'admin' && userRole !== 'staff' && conv.user_id !== userId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }
    
    // Récupérer les messages
    let messagesQuery = `
      SELECT 
        m.*,
        u.firstname as sender_firstname,
        u.lastname as sender_lastname,
        u.role as sender_role,
        u.avatar_url as sender_avatar
      FROM chat_messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = $1 AND m.is_deleted = false
    `;
    
    const params = [id];
    
    if (before) {
      messagesQuery += ` AND m.created_at < $2`;
      params.push(before);
    }
    
    messagesQuery += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    
    const messagesResult = await pool.query(messagesQuery, params);
    
    // Marquer les messages comme lus
    const isAdmin = userRole === 'admin' || userRole === 'staff';
    await pool.query(`
      UPDATE chat_messages 
      SET is_read = true, read_at = CURRENT_TIMESTAMP
      WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false
    `, [id, userId]);
    
    // Réinitialiser le compteur de non-lus
    if (isAdmin) {
      await pool.query(`
        UPDATE chat_conversations SET unread_admin = 0 WHERE id = $1
      `, [id]);
    } else {
      await pool.query(`
        UPDATE chat_conversations SET unread_user = 0 WHERE id = $1
      `, [id]);
    }
    
    res.json({
      success: true,
      messages: messagesResult.rows.reverse(), // Chronologique
      conversation: conv
    });
    
  } catch (error) {
    console.error('Erreur récupération messages:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /chat/conversations/:id/messages - Envoyer un message
router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userId = req.userId;
    const userRole = req.userRole;
    const { message, message_type = 'text', file_url, file_name } = req.body;
    
    if (!message && message_type === 'text') {
      return res.status(400).json({ error: 'Le message est requis' });
    }
    
    // Vérifier accès à la conversation
    const convResult = await pool.query(`
      SELECT * FROM chat_conversations WHERE id = $1
    `, [id]);
    
    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }
    
    const conv = convResult.rows[0];
    
    // Vérifier que l'utilisateur a accès
    if (userRole !== 'admin' && userRole !== 'staff' && conv.user_id !== userId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }
    
    // Insérer le message
    const messageResult = await pool.query(`
      INSERT INTO chat_messages (conversation_id, sender_id, message, message_type, file_url, file_name)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [id, userId, message, message_type, file_url || null, file_name || null]);
    
    const newMessage = messageResult.rows[0];
    
    // Mettre à jour la conversation
    const isAdmin = userRole === 'admin' || userRole === 'staff';
    
    if (isAdmin) {
      // Admin qui répond - assigner la conversation si pas encore fait
      await pool.query(`
        UPDATE chat_conversations 
        SET last_message_at = CURRENT_TIMESTAMP, 
            unread_user = unread_user + 1,
            admin_id = COALESCE(admin_id, $2)
        WHERE id = $1
      `, [id, userId]);
    } else {
      await pool.query(`
        UPDATE chat_conversations 
        SET last_message_at = CURRENT_TIMESTAMP, unread_admin = unread_admin + 1
        WHERE id = $1
      `, [id]);
    }
    
    // Récupérer le message avec les infos du sender
    const fullMessageResult = await pool.query(`
      SELECT 
        m.*,
        u.firstname as sender_firstname,
        u.lastname as sender_lastname,
        u.role as sender_role,
        u.avatar_url as sender_avatar
      FROM chat_messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = $1
    `, [newMessage.id]);
    
    res.status(201).json({
      success: true,
      message: fullMessageResult.rows[0]
    });
    
  } catch (error) {
    console.error('Erreur envoi message:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /chat/conversations/:id/read - Marquer comme lu
router.put('/conversations/:id/read', requireAuth, async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userId = req.userId;
    const userRole = req.userRole;
    
    // Marquer tous les messages comme lus
    await pool.query(`
      UPDATE chat_messages 
      SET is_read = true, read_at = CURRENT_TIMESTAMP
      WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false
    `, [id, userId]);
    
    // Réinitialiser compteur
    const isAdmin = userRole === 'admin' || userRole === 'staff';
    if (isAdmin) {
      await pool.query(`UPDATE chat_conversations SET unread_admin = 0 WHERE id = $1`, [id]);
    } else {
      await pool.query(`UPDATE chat_conversations SET unread_user = 0 WHERE id = $1`, [id]);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Erreur marquage lecture:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /chat/conversations/:id/close - Fermer une conversation
router.put('/conversations/:id/close', requireAuth, async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userRole = req.userRole;
    
    // Seul admin peut fermer
    if (userRole !== 'admin' && userRole !== 'staff') {
      return res.status(403).json({ error: 'Seul un admin peut fermer une conversation' });
    }
    
    await pool.query(`
      UPDATE chat_conversations SET status = 'closed', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Erreur fermeture conversation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /chat/unread-count - Nombre total de messages non lus
router.get('/unread-count', requireAuth, async (req, res) => {
  const pool = getPool();
  
  try {
    const userId = req.userId;
    const userRole = req.userRole;
    
    let result;
    
    if (userRole === 'admin' || userRole === 'staff') {
      result = await pool.query(`
        SELECT COALESCE(SUM(unread_admin), 0)::int as unread_count
        FROM chat_conversations WHERE status = 'active'
      `);
    } else {
      result = await pool.query(`
        SELECT COALESCE(SUM(unread_user), 0)::int as unread_count
        FROM chat_conversations WHERE user_id = $1 AND status = 'active'
      `, [userId]);
    }
    
    res.json({
      success: true,
      unread_count: result.rows[0].unread_count
    });
    
  } catch (error) {
    console.error('Erreur comptage non-lus:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTES ADMIN
// ============================================

// GET /chat/admin/all - Toutes les conversations (admin)
router.get('/admin/all', requireAuth, requireStaff, async (req, res) => {
  const pool = getPool();
  
  try {
    const { status = 'all', search, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        c.*,
        u.firstname as user_firstname,
        u.lastname as user_lastname,
        u.email as user_email,
        u.company_name as user_company,
        a.firstname as admin_firstname,
        a.lastname as admin_lastname,
        NULL::text as project_title,
        (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id) as message_count,
        (
          SELECT message FROM chat_messages 
          WHERE conversation_id = c.id 
          ORDER BY created_at DESC LIMIT 1
        ) as last_message
      FROM chat_conversations c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN users a ON c.admin_id = a.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (status !== 'all') {
      query += ` AND c.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    if (search) {
      query += ` AND (
        u.firstname ILIKE $${paramCount} OR 
        u.lastname ILIKE $${paramCount} OR 
        u.email ILIKE $${paramCount} OR
        c.subject ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }
    
    query += ` ORDER BY c.last_message_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    
    // Compter le total
    const countResult = await pool.query(`
      SELECT COUNT(*) FROM chat_conversations
    `);
    
    res.json({
      success: true,
      conversations: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    console.error('Erreur récupération conversations admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /chat/admin/stats - Stats des conversations
router.get('/admin/stats', requireAuth, requireStaff, async (req, res) => {
  const pool = getPool();
  
  try {
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'active') as active_conversations,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_conversations,
        COALESCE(SUM(unread_admin), 0) as total_unread,
        COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '7 days') as new_this_week,
        (SELECT COUNT(*) FROM chat_messages WHERE created_at > CURRENT_DATE) as messages_today
      FROM chat_conversations
    `);
    
    res.json({
      success: true,
      stats: statsResult.rows[0]
    });
    
  } catch (error) {
    console.error('Erreur stats chat:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /chat/admin/conversations - Créer ou récupérer une conversation avec un client (admin)
router.post('/admin/conversations', requireAuth, requireStaff, async (req, res) => {
  const pool = getPool();
  
  try {
    const { user_id: clientUserId, subject } = req.body;
    
    if (!clientUserId) {
      return res.status(400).json({ error: 'user_id (client) requis' });
    }
    
    const existing = await pool.query(`
      SELECT c.*,
        u.firstname as user_firstname,
        u.lastname as user_lastname,
        u.email as user_email,
        (SELECT message FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM chat_conversations c
      JOIN users u ON c.user_id = u.id
      WHERE c.user_id = $1 AND c.status = 'active'
      ORDER BY c.last_message_at DESC
      LIMIT 1
    `, [clientUserId]);
    
    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        conversation: existing.rows[0],
        created: false
      });
    }
    
    const insert = await pool.query(`
      INSERT INTO chat_conversations (user_id, subject, status)
      VALUES ($1, $2, 'active')
      RETURNING id
    `, [clientUserId, subject || 'Discussion avec l\'équipe']);
    
    const convId = insert.rows[0].id;
    
    const full = await pool.query(`
      SELECT c.*,
        u.firstname as user_firstname,
        u.lastname as user_lastname,
        u.email as user_email,
        NULL::text as last_message
      FROM chat_conversations c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = $1
    `, [convId]);
    
    res.status(201).json({
      success: true,
      conversation: full.rows[0],
      created: true
    });
    
  } catch (error) {
    console.error('Erreur création conversation admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
