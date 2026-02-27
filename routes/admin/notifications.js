/**
 * Routes API Admin - Notifications
 * GET /admin/notifications - Récupérer le nombre de notifications non lues
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { requireAdmin } = require('../../middleware/auths');

// ============================================
// GET /admin/notifications - Récupérer les compteurs de notifications
// ============================================
// Helper: exécuter une requête COUNT et retourner 0 si la table n'existe pas
async function safeCount(query) {
  try {
    const result = await db.query(query);
    return parseInt(result.rows[0]?.count) || 0;
  } catch (err) {
    const code = err.code || err.cause?.code;
    const msg = (err.message || '').toLowerCase();
    if (code === '42P01' || msg.includes('does not exist')) {
      return 0; // relation does not exist
    }
    throw err;
  }
}

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const [orders, appointments, support, reviews] = await Promise.all([
      safeCount(`SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'processing')`),
      safeCount(`SELECT COUNT(*) as count FROM reservations WHERE status = 'pending'`),
      safeCount(`SELECT COUNT(*) as count FROM support_tickets WHERE status IN ('open', 'in_progress')`),
      safeCount(`SELECT COUNT(*) as count FROM product_reviews WHERE is_approved = false`),
    ]);

    res.json({
      success: true,
      notifications: { orders, appointments, support, reviews },
    });
  } catch (error) {
    console.error('Erreur récupération notifications:', error);
    next(error);
  }
});

module.exports = router;
