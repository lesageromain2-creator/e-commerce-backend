/**
 * Routes API Admin - Gestion Inventaire
 * GET /admin/inventory/stats - Stats inventaire
 * GET /admin/inventory/low-stock - Produits à faible stock
 * GET /admin/inventory/movements - Mouvements de stock
 * POST /admin/inventory/adjust - Ajuster le stock
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { requireAdmin } = require('../../middleware/auths');

// ============================================
// GET /admin/inventory/stats - Statistiques inventaire
// ============================================
router.get('/stats', requireAdmin, async (req, res, next) => {
  try {
    // Valeur totale du stock
    const valueResult = await db.query(
      `SELECT SUM(price * stock_quantity) as total_value
       FROM products
       WHERE status = 'active'`
    );

    // Nombre de produits à faible stock
    const lowStockResult = await db.query(
      `SELECT COUNT(*) as count
       FROM products
       WHERE stock_quantity <= low_stock_threshold
       AND track_inventory = true
       AND status = 'active'`
    );

    // Nombre de produits en rupture
    const outOfStockResult = await db.query(
      `SELECT COUNT(*) as count
       FROM products
       WHERE stock_quantity = 0
       AND track_inventory = true
       AND status = 'active'`
    );

    // Nombre total de produits
    const totalResult = await db.query(
      `SELECT COUNT(*) as count
       FROM products
       WHERE status = 'active'`
    );

    res.json({
      success: true,
      stats: {
        totalValue: parseFloat(valueResult.rows[0].total_value) || 0,
        lowStockCount: parseInt(lowStockResult.rows[0].count) || 0,
        outOfStockCount: parseInt(outOfStockResult.rows[0].count) || 0,
        totalProducts: parseInt(totalResult.rows[0].count) || 0,
      },
    });
  } catch (error) {
    console.error('Erreur stats inventaire:', error);
    next(error);
  }
});

// ============================================
// GET /admin/inventory/low-stock - Produits à faible stock
// ============================================
router.get('/low-stock', requireAdmin, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    const result = await db.query(
      `SELECT 
        p.id,
        p.name,
        p.sku,
        p.stock_quantity,
        p.low_stock_threshold,
        p.price,
        p.featured_image,
        c.name as category_name,
        b.name as brand_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.stock_quantity <= p.low_stock_threshold
       AND p.track_inventory = true
       AND p.status = 'active'
       ORDER BY (p.stock_quantity - p.low_stock_threshold) ASC
       LIMIT $1`,
      [limit]
    );

    res.json({
      success: true,
      products: result.rows,
    });
  } catch (error) {
    console.error('Erreur produits faible stock:', error);
    next(error);
  }
});

// ============================================
// GET /admin/inventory/movements - Mouvements de stock
// ============================================
router.get('/movements', requireAdmin, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type;
    const productId = req.query.productId;
    
    let query = `
      SELECT 
        im.id,
        im.type,
        im.quantity,
        im.reference,
        im.note,
        im.created_at,
        p.name as product_name,
        pv.name as variant_name,
        u.name as admin_name
      FROM inventory_movements im
      JOIN products p ON im.product_id = p.id
      LEFT JOIN product_variants pv ON im.variant_id = pv.id
      LEFT JOIN users u ON im.admin_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (type) {
      query += ` AND im.type = $${paramCount}`;
      params.push(type);
      paramCount++;
    }
    
    if (productId) {
      query += ` AND im.product_id = $${paramCount}`;
      params.push(productId);
      paramCount++;
    }
    
    query += ` ORDER BY im.created_at DESC LIMIT $${paramCount}`;
    params.push(limit);
    
    const result = await db.query(query, params);

    res.json({
      success: true,
      movements: result.rows,
    });
  } catch (error) {
    console.error('Erreur mouvements stock:', error);
    next(error);
  }
});

// ============================================
// POST /admin/inventory/adjust - Ajuster le stock
// ============================================
router.post('/adjust', requireAdmin, async (req, res, next) => {
  try {
    const { productId, variantId, quantity, type, note, reference } = req.body;
    
    if (!productId || !quantity || !type) {
      return res.status(400).json({
        success: false,
        message: 'productId, quantity et type sont requis',
      });
    }

    // Mettre à jour le stock
    if (variantId) {
      await db.query(
        `UPDATE product_variants 
         SET stock_quantity = stock_quantity + $1 
         WHERE id = $2`,
        [quantity, variantId]
      );
    } else {
      await db.query(
        `UPDATE products 
         SET stock_quantity = stock_quantity + $1 
         WHERE id = $2`,
        [quantity, productId]
      );
    }

    // Créer le mouvement d'inventaire
    await db.query(
      `INSERT INTO inventory_movements (
        product_id, variant_id, type, quantity, reference, note, admin_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [productId, variantId || null, type, quantity, reference, note, req.userId]
    );

    res.json({
      success: true,
      message: 'Stock ajusté avec succès',
    });
  } catch (error) {
    console.error('Erreur ajustement stock:', error);
    next(error);
  }
});

module.exports = router;
