/**
 * Routes API Admin - Finances
 * GET /admin/finances/stats - Stats financières
 * GET /admin/finances/revenue - Données de revenus (graphique)
 * GET /admin/finances/by-category - Ventes par catégorie
 * GET /admin/finances/top-products - Top produits
 * GET /admin/finances/export - Export rapport CSV
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { requireAdmin } = require('../../middleware/auths');

// ============================================
// GET /admin/finances/stats - Statistiques financières
// ============================================
router.get('/stats', requireAdmin, async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    
    // Revenu total
    const totalRevenueResult = await db.query(
      `SELECT SUM(total_amount) as total
       FROM orders
       WHERE payment_status = 'paid'`
    );

    // Revenu ce mois
    const thisMonthResult = await db.query(
      `SELECT SUM(total_amount) as total
       FROM orders
       WHERE payment_status = 'paid'
       AND created_at >= date_trunc('month', CURRENT_DATE)`
    );

    // Revenu mois dernier
    const lastMonthResult = await db.query(
      `SELECT SUM(total_amount) as total
       FROM orders
       WHERE payment_status = 'paid'
       AND created_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
       AND created_at < date_trunc('month', CURRENT_DATE)`
    );

    // Panier moyen et nombre de commandes
    const ordersResult = await db.query(
      `SELECT 
        COUNT(*) as total_orders,
        AVG(total_amount) as avg_order_value
       FROM orders
       WHERE payment_status = 'paid'
       AND created_at >= CURRENT_DATE - INTERVAL '${days} days'`
    );

    // Coûts (cost_price) et profits
    const costsResult = await db.query(
      `SELECT 
        SUM(oi.price * oi.quantity) as revenue,
        SUM(COALESCE(p.cost_price, p.price * 0.6) * oi.quantity) as cost
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE o.payment_status = 'paid'`
    );

    const totalRevenue = parseFloat(totalRevenueResult.rows[0].total) || 0;
    const revenueThisMonth = parseFloat(thisMonthResult.rows[0].total) || 0;
    const revenueLastMonth = parseFloat(lastMonthResult.rows[0].total) || 0;
    const totalOrders = parseInt(ordersResult.rows[0].total_orders) || 0;
    const averageOrderValue = parseFloat(ordersResult.rows[0].avg_order_value) || 0;
    
    const revenue = parseFloat(costsResult.rows[0].revenue) || 0;
    const cost = parseFloat(costsResult.rows[0].cost) || 0;
    const profit = revenue - cost;
    const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

    const revenueGrowth = revenueLastMonth > 0 
      ? ((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100 
      : 0;

    res.json({
      success: true,
      stats: {
        totalRevenue,
        revenueThisMonth,
        revenueLastMonth,
        averageOrderValue,
        totalOrders,
        revenueGrowth: Math.round(revenueGrowth * 10) / 10,
        totalCost: cost,
        totalProfit: profit,
        profitMargin: Math.round(profitMargin * 10) / 10,
      },
    });
  } catch (error) {
    console.error('Erreur stats finances:', error);
    next(error);
  }
});

// ============================================
// GET /admin/finances/revenue - Données de revenus (graphique)
// ============================================
router.get('/revenue', requireAdmin, async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    
    const result = await db.query(
      `SELECT 
        date_trunc('day', created_at) as date,
        SUM(total_amount) as revenue,
        COUNT(*) as orders
       FROM orders
       WHERE payment_status = 'paid'
       AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY date_trunc('day', created_at)
       ORDER BY date ASC`
    );

    const revenue = result.rows.map((row) => ({
      date: new Date(row.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      revenue: parseFloat(row.revenue),
      orders: parseInt(row.orders),
    }));

    res.json({
      success: true,
      revenue,
    });
  } catch (error) {
    console.error('Erreur données revenus:', error);
    next(error);
  }
});

// ============================================
// GET /admin/finances/by-category - Ventes par catégorie
// ============================================
router.get('/by-category', requireAdmin, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT 
        COALESCE(c.name, 'Sans catégorie') as name,
        SUM(oi.subtotal) as value
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE o.payment_status = 'paid'
       GROUP BY c.name
       ORDER BY value DESC
       LIMIT 6`
    );

    const categories = result.rows.map((row) => ({
      name: row.name,
      value: parseFloat(row.value),
    }));

    res.json({
      success: true,
      categories,
    });
  } catch (error) {
    console.error('Erreur ventes par catégorie:', error);
    next(error);
  }
});

// ============================================
// GET /admin/finances/top-products - Top produits
// ============================================
router.get('/top-products', requireAdmin, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const result = await db.query(
      `SELECT 
        p.name,
        SUM(oi.subtotal) as revenue,
        SUM(oi.quantity) as quantity
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE o.payment_status = 'paid'
       GROUP BY p.id, p.name
       ORDER BY revenue DESC
       LIMIT $1`,
      [limit]
    );

    const products = result.rows.map((row) => ({
      name: row.name.length > 20 ? row.name.substring(0, 20) + '...' : row.name,
      revenue: parseFloat(row.revenue),
      quantity: parseInt(row.quantity),
    }));

    res.json({
      success: true,
      products,
    });
  } catch (error) {
    console.error('Erreur top produits:', error);
    next(error);
  }
});

// ============================================
// GET /admin/finances/export - Export rapport CSV
// ============================================
router.get('/export', requireAdmin, async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    
    const result = await db.query(
      `SELECT 
        o.order_number,
        o.created_at,
        COALESCE(u.email, o.guest_email) as customer,
        o.total_amount,
        o.payment_method,
        o.payment_status,
        o.status
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.created_at >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY o.created_at DESC`
    );

    // Créer CSV
    const headers = ['N° Commande', 'Date', 'Client', 'Montant', 'Paiement', 'Statut Paiement', 'Statut'];
    const rows = result.rows.map((row) => [
      row.order_number,
      new Date(row.created_at).toLocaleDateString('fr-FR'),
      row.customer,
      parseFloat(row.total_amount).toFixed(2),
      row.payment_method,
      row.payment_status,
      row.status,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=finances_${period}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Erreur export:', error);
    next(error);
  }
});

module.exports = router;
