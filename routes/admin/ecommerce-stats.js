/**
 * Routes API - Stats Admin E-commerce
 * GET /admin/ecommerce/stats - Stats dashboard
 * GET /admin/ecommerce/dashboard - Stats + commandes récentes (1 seul appel)
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { verifyToken, isAdmin } = require('../../middleware/auths');

// Exécuter toutes les requêtes stats en parallèle
async function getStats() {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const [
    totalOrdersResult,
    totalRevenueResult,
    pendingOrdersResult,
    completedOrdersResult,
    totalProductsResult,
    activeProductsResult,
    lowStockResult,
    totalCustomersResult,
    currentMonthRevenueResult,
    lastMonthRevenueResult,
    currentMonthOrdersResult,
    lastMonthOrdersResult,
  ] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM orders'),
    db.query('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = $1', ['paid']),
    db.query('SELECT COUNT(*) as count FROM orders WHERE status IN ($1, $2)', ['pending', 'processing']),
    db.query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['delivered']),
    db.query('SELECT COUNT(*) as count FROM products'),
    db.query('SELECT COUNT(*) as count FROM products WHERE status = $1', ['active']),
    db.query(
      'SELECT COUNT(*) as count FROM products WHERE track_inventory = true AND stock_quantity <= low_stock_threshold AND stock_quantity > 0'
    ),
    db.query('SELECT COUNT(DISTINCT user_id) as count FROM orders WHERE user_id IS NOT NULL'),
    db.query(
      'SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = $1 AND created_at >= $2',
      ['paid', currentMonthStart]
    ),
    db.query(
      'SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = $1 AND created_at >= $2 AND created_at <= $3',
      ['paid', lastMonthStart, lastMonthEnd]
    ),
    db.query('SELECT COUNT(*) as count FROM orders WHERE created_at >= $1', [currentMonthStart]),
    db.query(
      'SELECT COUNT(*) as count FROM orders WHERE created_at >= $1 AND created_at <= $2',
      [lastMonthStart, lastMonthEnd]
    ),
  ]);

  const totalOrders = parseInt(totalOrdersResult.rows[0].count);
  const totalRevenue = parseFloat(totalRevenueResult.rows[0].total);
  const pendingOrders = parseInt(pendingOrdersResult.rows[0].count);
  const completedOrders = parseInt(completedOrdersResult.rows[0].count);
  const totalProducts = parseInt(totalProductsResult.rows[0].count);
  const activeProducts = parseInt(activeProductsResult.rows[0].count);
  const lowStockProducts = parseInt(lowStockResult.rows[0].count);
  const totalCustomers = parseInt(totalCustomersResult.rows[0].count);
  const currentMonthRevenue = parseFloat(currentMonthRevenueResult.rows[0].total);
  const lastMonthRevenue = parseFloat(lastMonthRevenueResult.rows[0].total);
  const currentMonthOrders = parseInt(currentMonthOrdersResult.rows[0].count);
  const lastMonthOrders = parseInt(lastMonthOrdersResult.rows[0].count);

  const revenueGrowth = lastMonthRevenue > 0
    ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
    : 0;
  const ordersGrowth = lastMonthOrders > 0
    ? ((currentMonthOrders - lastMonthOrders) / lastMonthOrders * 100).toFixed(1)
    : 0;

  return {
    totalOrders,
    totalRevenue,
    pendingOrders,
    completedOrders,
    totalProducts,
    activeProducts,
    lowStockProducts,
    totalCustomers,
    revenueGrowth: parseFloat(revenueGrowth),
    ordersGrowth: parseFloat(ordersGrowth),
    currentMonthRevenue,
    lastMonthRevenue,
    currentMonthOrders,
    lastMonthOrders,
  };
}

// ============================================
// GET /admin/ecommerce/stats
// ============================================
router.get('/stats', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const stats = await getStats();
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /admin/ecommerce/dashboard - Stats + commandes récentes (1 appel)
// ============================================
router.get('/dashboard', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const [stats, ordersResult] = await Promise.all([
      getStats(),
      db.query(
        `SELECT o.id, o.order_number, o.total_amount, o.status, o.payment_status, o.created_at,
                o.guest_email, u.email as user_email
         FROM orders o
         LEFT JOIN users u ON o.user_id = u.id
         ORDER BY o.created_at DESC
         LIMIT 10`
      ),
    ]);
    res.json({
      success: true,
      stats,
      recentOrders: ordersResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
