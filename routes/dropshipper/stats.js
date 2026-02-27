/**
 * Routes API - Stats Dropshipper
 * GET /api/dropshipper/stats - Stats pour dropshippers
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { verifyToken } = require('../../middleware/auths');
const { isDropshipperOrAdmin } = require('../../middleware/roleCheck');

// ============================================
// GET /api/dropshipper/stats
// ============================================
router.get('/stats', verifyToken, isDropshipperOrAdmin, async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Commandes en attente
    const pendingResult = await db.query(
      'SELECT COUNT(*) as count FROM orders WHERE status = $1',
      ['pending']
    );
    const pendingOrders = parseInt(pendingResult.rows[0].count);

    // Commandes en traitement
    const processingResult = await db.query(
      'SELECT COUNT(*) as count FROM orders WHERE status = $1',
      ['processing']
    );
    const processingOrders = parseInt(processingResult.rows[0].count);

    // Commandes expédiées
    const shippedResult = await db.query(
      'SELECT COUNT(*) as count FROM orders WHERE status = $1',
      ['shipped']
    );
    const shippedOrders = parseInt(shippedResult.rows[0].count);

    // Produits en stock faible
    const lowStockResult = await db.query(
      'SELECT COUNT(*) as count FROM products WHERE track_inventory = true AND stock_quantity <= low_stock_threshold AND stock_quantity > 0'
    );
    const lowStockProducts = parseInt(lowStockResult.rows[0].count);

    // Revenu du jour
    const todayRevenueResult = await db.query(
      'SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = $1 AND created_at >= $2',
      ['paid', today]
    );
    const totalRevenue = parseFloat(todayRevenueResult.rows[0].total);

    // Commandes du jour
    const todayOrdersResult = await db.query(
      'SELECT COUNT(*) as count FROM orders WHERE created_at >= $1',
      [today]
    );
    const ordersToday = parseInt(todayOrdersResult.rows[0].count);

    res.json({
      success: true,
      stats: {
        pendingOrders,
        processingOrders,
        shippedOrders,
        lowStockProducts,
        totalRevenue,
        ordersToday,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
