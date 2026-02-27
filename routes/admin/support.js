/**
 * Support tickets - CRUD admin
 * GET /admin/support/tickets - Liste
 * POST /admin/support/tickets - Créer (ou depuis formulaire contact)
 * GET /admin/support/tickets/:id - Détail + réponses
 * PATCH /admin/support/tickets/:id - Mettre à jour statut / assignation
 * POST /admin/support/tickets/:id/replies - Ajouter une réponse
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { requireAdmin } = require('../../middleware/auths');

function generateTicketNumber() {
  const d = new Date();
  const datePart = d.toISOString().slice(0, 10).replace(/-/g, '');
  const r = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `TKT-${datePart}-${r}`;
}

// Liste des tickets
router.get('/tickets', requireAdmin, async (req, res, next) => {
  try {
    const { status = '', page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    if (status && status !== 'all') {
      whereClause += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM support_tickets t ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    params.push(limitNum, offset);
    const result = await db.query(
      `SELECT t.*,
              u_assigned.name as assigned_to_name,
              (SELECT COUNT(*) FROM support_ticket_replies r WHERE r.ticket_id = t.id) as reply_count
       FROM support_tickets t
       LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    res.json({
      success: true,
      tickets: result.rows,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 1 },
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.json({ success: true, tickets: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } });
    }
    next(error);
  }
});

// Créer un ticket (admin ou formulaire public)
router.post('/tickets', requireAdmin, async (req, res, next) => {
  try {
    const { subject, message, priority = 'medium', customer_email, customer_name, user_id, order_id } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ success: false, message: 'Subject et message requis.' });
    }
    const ticketNumber = generateTicketNumber();
    const result = await db.query(
      `INSERT INTO support_tickets (ticket_number, subject, message, priority, customer_email, customer_name, user_id, order_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
       RETURNING *`,
      [
        ticketNumber,
        subject,
        message,
        priority || 'medium',
        customer_email || null,
        customer_name || null,
        user_id || null,
        order_id || null,
      ]
    );
    res.status(201).json({ success: true, ticket: result.rows[0] });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ success: false, message: 'Table support_tickets non créée. Exécutez le script SQL dans Supabase.' });
    }
    next(error);
  }
});

// Détail ticket + réponses
router.get('/tickets/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const ticketResult = await db.query(
      `SELECT t.*, u_assigned.name as assigned_to_name
       FROM support_tickets t
       LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.id
       WHERE t.id = $1`,
      [id]
    );
    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket non trouvé.' });
    }
    const repliesResult = await db.query(
      `SELECT r.*, u.name as author_name FROM support_ticket_replies r
       LEFT JOIN users u ON r.author_id = u.id
       WHERE r.ticket_id = $1 ORDER BY r.created_at ASC`,
      [id]
    );
    res.json({
      success: true,
      ticket: ticketResult.rows[0],
      replies: repliesResult.rows,
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(404).json({ success: false, message: 'Ticket non trouvé.' });
    }
    next(error);
  }
});

// Mettre à jour ticket (statut, priorité, assignation)
router.patch('/tickets/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, priority, assigned_to } = req.body;
    const updates = [];
    const values = [];
    let paramIndex = 1;
    if (status !== undefined) {
      updates.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
      if (status === 'resolved' || status === 'closed') {
        updates.push(`resolved_at = NOW()`);
        updates.push(`resolved_by = $${paramIndex}`);
        values.push(req.userId);
        paramIndex++;
      }
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex}`);
      values.push(priority);
      paramIndex++;
    }
    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramIndex}`);
      values.push(assigned_to || null);
      paramIndex++;
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucune donnée à mettre à jour.' });
    }
    values.push(id);
    const result = await db.query(
      `UPDATE support_tickets SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket non trouvé.' });
    }
    res.json({ success: true, ticket: result.rows[0] });
  } catch (error) {
    if (error.code === '42P01') return res.status(404).json({ success: false, message: 'Ticket non trouvé.' });
    next(error);
  }
});

// Ajouter une réponse (staff)
router.post('/tickets/:id/replies', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message requis.' });
    }
    const insertResult = await db.query(
      `INSERT INTO support_ticket_replies (ticket_id, message, is_staff, author_id)
       VALUES ($1, $2, true, $3)
       RETURNING *`,
      [id, message.trim(), req.userId]
    );
    await db.query(
      `UPDATE support_tickets SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    res.status(201).json({ success: true, reply: insertResult.rows[0] });
  } catch (error) {
    if (error.code === '42P01') return res.status(503).json({ success: false, message: 'Table support non créée.' });
    next(error);
  }
});

module.exports = router;
