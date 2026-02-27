/**
 * GET /admin/analytics - Données pour la page Analytics (graphiques, tendances)
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { requireAdmin } = require('../../middleware/auths');

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const now = new Date();
    const days = 30;
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [
      revenueByDayResult,
      ordersByDayResult,
      topProductsResult,
      ordersByStatusResult,
      totalStatsResult,
    ] = await Promise.all([
      db.query(
        `SELECT DATE(created_at) as date, COALESCE(SUM(total_amount), 0) as revenue
         FROM orders WHERE payment_status = 'paid' AND created_at >= $1
         GROUP BY DATE(created_at) ORDER BY date`,
        [startDate]
      ),
      db.query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM orders WHERE created_at >= $1
         GROUP BY DATE(created_at) ORDER BY date`,
        [startDate]
      ),
      db.query(
        `SELECT p.id, p.name, p.slug,
                COALESCE(SUM(oi.quantity), 0)::bigint as units_sold,
                COALESCE(SUM(oi.subtotal), 0)::numeric as revenue
         FROM products p
         LEFT JOIN order_items oi ON oi.product_id = p.id
         LEFT JOIN orders o ON oi.order_id = o.id AND o.payment_status = 'paid'
         GROUP BY p.id, p.name, p.slug
         ORDER BY units_sold DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT status, COUNT(*) as count FROM orders GROUP BY status`
      ),
      db.query(
        `SELECT
           (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE payment_status = 'paid' AND created_at >= $1) as month_revenue,
           (SELECT COUNT(*) FROM orders WHERE created_at >= $1) as month_orders,
           (SELECT COUNT(DISTINCT user_id) FROM orders WHERE user_id IS NOT NULL AND created_at >= $1) as new_customers`,
        [new Date(now.getFullYear(), now.getMonth(), 1)]
      ),
    ]);

    const revenueByDay = revenueByDayResult.rows;
    const ordersByDay = ordersByDayResult.rows;
    const topProducts = topProductsResult.rows;
    const ordersByStatus = ordersByStatusResult.rows;
    const totalStats = totalStatsResult.rows[0] || {};

    res.json({
      success: true,
      revenueByDay,
      ordersByDay,
      topProducts,
      ordersByStatus,
      totalStats: {
        monthRevenue: parseFloat(totalStats.month_revenue) || 0,
        monthOrders: parseInt(totalStats.month_orders) || 0,
        newCustomers: parseInt(totalStats.new_customers) || 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
