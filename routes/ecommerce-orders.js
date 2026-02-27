/**
 * Routes API - Commandes E-commerce
 * POST /api/ecommerce/orders - Créer une commande
 * GET /api/ecommerce/orders - Liste commandes utilisateur
 * GET /api/ecommerce/orders/:orderNumber - Détail commande
 * PATCH /api/ecommerce/orders/:id/status - Modifier statut (admin)
 * POST /api/ecommerce/orders/:id/cancel - Annuler commande
 */

const express = require('express');
const router = express.Router();
const { db, getPool } = require('../database/db');
const { requireAuth, requireAdmin, isAdmin, optionalAuth } = require('../middleware/auths');
const { z } = require('zod');

// ============================================
// VALIDATION SCHEMAS
// ============================================
const addressSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  company: z.string().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().length(2),
  phone: z.string().min(1),
});

const createOrderSchema = z.object({
  cartId: z.string().uuid().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    quantity: z.number().int().positive(),
  })).min(1),
  billingAddress: addressSchema,
  shippingAddress: addressSchema,
  customerNote: z.string().optional(),
  couponCode: z.string().optional(),
  shippingMethod: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
  comment: z.string().optional(),
});

// ============================================
// HELPER: Générer numéro de commande
// ============================================
async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  
  // Compter commandes du jour
  const countResult = await db.query(
    `SELECT COUNT(*) as count FROM orders 
     WHERE created_at >= CURRENT_DATE`
  );
  
  const count = parseInt(countResult.rows[0].count) + 1;
  const orderNumber = `ORD-${date}-${count.toString().padStart(4, '0')}`;
  
  return orderNumber;
}

// ============================================
// HELPER: Calculer totaux commande
// ============================================
async function calculateOrderTotals(items, couponCode = null) {
  let subtotal = 0;
  const orderItems = [];

  // Calculer sous-total et préparer items
  for (const item of items) {
    const productQuery = item.variantId
      ? `SELECT 
          p.id, p.name, p.sku, p.price, p.images, p.stock_quantity,
          pv.name as variant_name, pv.sku as variant_sku, 
          pv.price_adjustment, pv.stock_quantity as variant_stock
         FROM products p
         JOIN product_variants pv ON pv.product_id = p.id
         WHERE p.id = $1 AND pv.id = $2 AND p.status = 'active'`
      : `SELECT id, name, sku, price, images, stock_quantity
         FROM products 
         WHERE id = $1 AND status = 'active'`;

    const productParams = item.variantId
      ? [item.productId, item.variantId]
      : [item.productId];

    const productResult = await db.query(productQuery, productParams);

    if (productResult.rows.length === 0) {
      throw new Error(`Produit ${item.productId} non disponible`);
    }

    const product = productResult.rows[0];
    const availableStock = item.variantId ? product.variant_stock : product.stock_quantity;

    if (availableStock < item.quantity) {
      throw new Error(`Stock insuffisant pour ${product.name}`);
    }

    const price = item.variantId
      ? parseFloat(product.price) + parseFloat(product.price_adjustment || 0)
      : parseFloat(product.price);

    const itemSubtotal = price * item.quantity;
    subtotal += itemSubtotal;

    orderItems.push({
      productId: product.id,
      variantId: item.variantId || null,
      productName: product.name,
      variantName: product.variant_name || null,
      sku: item.variantId ? product.variant_sku : product.sku,
      price,
      quantity: item.quantity,
      subtotal: itemSubtotal,
      imageUrl: product.images?.[0] || null,
    });
  }

  // Appliquer coupon si présent
  let discountAmount = 0;
  let couponInfo = null;

  if (couponCode) {
    const couponResult = await db.query(
      `SELECT * FROM coupons 
       WHERE UPPER(code) = UPPER($1) AND is_active = true
       AND (valid_from IS NULL OR valid_from <= NOW())
       AND (valid_to IS NULL OR valid_to >= NOW())`,
      [couponCode]
    );

    if (couponResult.rows.length > 0) {
      const coupon = couponResult.rows[0];

      // Vérifier limites
      if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
        throw new Error('Code promo épuisé');
      }

      if (coupon.min_purchase_amount && subtotal < parseFloat(coupon.min_purchase_amount)) {
        throw new Error(`Minimum ${coupon.min_purchase_amount}€ requis pour ce code`);
      }

      // Calculer réduction
      if (coupon.discount_type === 'percentage') {
        discountAmount = subtotal * (parseFloat(coupon.discount_value) / 100);
        if (coupon.max_discount_amount) {
          discountAmount = Math.min(discountAmount, parseFloat(coupon.max_discount_amount));
        }
      } else if (coupon.discount_type === 'fixed_amount') {
        discountAmount = parseFloat(coupon.discount_value);
      }

      couponInfo = coupon;
    }
  }

  // Frais de port (simplifié pour le moment)
  const shippingCost = subtotal >= 50 ? 0 : 5.99;

  // Taxes (simplifié - 20% TVA)
  const taxAmount = (subtotal - discountAmount + shippingCost) * 0.20;

  // Total
  const totalAmount = subtotal - discountAmount + shippingCost + taxAmount;

  return {
    orderItems,
    subtotal: subtotal.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    shippingCost: shippingCost.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    couponInfo,
  };
}

// ============================================
// POST /api/ecommerce/orders - Créer commande
// ============================================
router.post('/', async (req, res, next) => {
  const client = await getPool().connect();
  
  try {
    const validated = createOrderSchema.parse(req.body);
    const userId = req.user?.id || null;
    const guestEmail = validated.billingAddress.email || req.body.billingAddress?.email || req.body.email || null;

    await client.query('BEGIN');

    // Calculer totaux
    const {
      orderItems,
      subtotal,
      discountAmount,
      shippingCost,
      taxAmount,
      totalAmount,
      couponInfo,
    } = await calculateOrderTotals(validated.items, validated.couponCode);

    // Générer numéro commande
    const orderNumber = await generateOrderNumber();

    // Créer commande
    const insertOrderQuery = `
      INSERT INTO orders (
        order_number, user_id, guest_email,
        billing_address, shipping_address,
        subtotal, shipping_cost, tax_amount, discount_amount, total_amount,
        coupon_code, coupon_discount,
        shipping_method, customer_note,
        status, payment_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )
      RETURNING *
    `;

    const orderValues = [
      orderNumber,
      userId,
      guestEmail,
      JSON.stringify(validated.billingAddress),
      JSON.stringify(validated.shippingAddress),
      subtotal,
      shippingCost,
      taxAmount,
      discountAmount,
      totalAmount,
      validated.couponCode || null,
      discountAmount,
      validated.shippingMethod || 'standard',
      validated.customerNote || null,
      'pending',
      'pending',
    ];

    const orderResult = await client.query(insertOrderQuery, orderValues);
    const order = orderResult.rows[0];

    // Insérer items de commande
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (
          order_id, product_id, variant_id,
          product_name, variant_name, sku,
          price, quantity, subtotal, image_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.id,
          item.productId,
          item.variantId,
          item.productName,
          item.variantName,
          item.sku,
          item.price,
          item.quantity,
          item.subtotal,
          item.imageUrl,
        ]
      );

      // Décrémenter stock
      if (item.variantId) {
        await client.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity - $1 WHERE id = $2',
          [item.quantity, item.variantId]
        );
      } else {
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
          [item.quantity, item.productId]
        );
      }

      // Ajouter mouvement inventaire
      await client.query(
        `INSERT INTO inventory_movements (
          product_id, variant_id, type, quantity, reference
        ) VALUES ($1, $2, 'sale', $3, $4)`,
        [item.productId, item.variantId, -item.quantity, orderNumber]
      );
    }

    // Incrémenter compteur ventes produits
    for (const item of orderItems) {
      await client.query(
        'UPDATE products SET sales_count = sales_count + $1 WHERE id = $2',
        [item.quantity, item.productId]
      );
    }

    // Enregistrer usage coupon
    if (couponInfo) {
      await client.query(
        'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = $1',
        [couponInfo.id]
      );

      await client.query(
        `INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_amount)
         VALUES ($1, $2, $3, $4)`,
        [couponInfo.id, userId, order.id, discountAmount]
      );
    }

    // Créer historique statut
    await client.query(
      `INSERT INTO order_status_history (order_id, to_status, comment)
       VALUES ($1, 'pending', 'Commande créée')`,
      [order.id]
    );

    // Vider le panier si fourni
    if (validated.cartId) {
      await client.query('DELETE FROM cart_items WHERE cart_id = $1', [validated.cartId]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Commande créée avec succès',
      order: {
        id: order.id,
        orderNumber: order.order_number,
        totalAmount: order.total_amount,
        status: order.status,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: error.errors,
      });
    }
    
    next(error);
  } finally {
    client.release();
  }
});

// ============================================
// GET /api/ecommerce/orders - Liste commandes
// ============================================
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.userId;
    const { status = '', page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT 
        o.*,
        COUNT(oi.id) as items_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1
    `;

    const params = [userId];
    let paramIndex = 2;

    if (status) {
      query += ` AND o.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += `
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limitNum, offset);

    const result = await db.query(query, params);

    // Count total
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM orders WHERE user_id = $1 ${status ? 'AND status = $2' : ''}`,
      status ? [userId, status] : [userId]
    );

    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      orders: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/ecommerce/orders/:orderNumber - Détail
// ============================================
router.get('/:orderNumber', optionalAuth, async (req, res, next) => {
  try {
    const { orderNumber } = req.params;
    const userId = req.userId || req.user?.id;

    // Si non authentifié, permettre accès avec email
    const email = req.query.email;

    let query = `
      SELECT * FROM orders 
      WHERE order_number = $1
    `;

    const params = [orderNumber];

    if (userId) {
      query += ' AND user_id = $2';
      params.push(userId);
    } else if (email) {
      query += ' AND guest_email = $2';
      params.push(email);
    } else {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé',
      });
    }

    const orderResult = await db.query(query, params);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée',
      });
    }

    const order = orderResult.rows[0];

    // Récupérer items
    const itemsResult = await db.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [order.id]
    );

    // Récupérer historique
    const historyResult = await db.query(
      `SELECT 
        osh.*,
        u.firstname,
        u.lastname
       FROM order_status_history osh
       LEFT JOIN users u ON osh.admin_id = u.id
       WHERE osh.order_id = $1
       ORDER BY osh.created_at DESC`,
      [order.id]
    );

    res.json({
      success: true,
      order: {
        ...order,
        items: itemsResult.rows,
        statusHistory: historyResult.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PATCH /api/ecommerce/orders/:id/status - Modifier statut (admin)
// ============================================
router.patch('/:id/status', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const validated = updateStatusSchema.parse(req.body);
    const adminId = req.userId;

    // Récupérer commande actuelle
    const orderResult = await db.query('SELECT * FROM orders WHERE id = $1', [id]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée',
      });
    }

    const order = orderResult.rows[0];
    const oldStatus = order.status;

    // Mettre à jour statut
    const updateFields = ['status = $1'];
    const updateValues = [validated.status, id];
    let paramIndex = 3;

    if (validated.status === 'shipped') {
      updateFields.push(`shipped_at = NOW()`);
      updateFields.push(`shipping_status = 'shipped'`);
    } else if (validated.status === 'delivered') {
      updateFields.push(`delivered_at = NOW()`);
      updateFields.push(`shipping_status = 'delivered'`);
    } else if (validated.status === 'cancelled') {
      updateFields.push(`cancelled_at = NOW()`);
    }

    const updateQuery = `
      UPDATE orders 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await db.query(updateQuery, updateValues);

    // Ajouter à l'historique
    await db.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, comment, admin_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, oldStatus, validated.status, validated.comment || null, adminId]
    );

    res.json({
      success: true,
      message: 'Statut mis à jour avec succès',
      order: result.rows[0],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: error.errors,
      });
    }
    next(error);
  }
});

// ============================================
// POST /api/ecommerce/orders/:id/cancel - Annuler commande
// ============================================
router.post('/:id/cancel', requireAuth, async (req, res, next) => {
  const client = await getPool().connect();
  
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { reason } = req.body;

    await client.query('BEGIN');

    // Vérifier que la commande appartient à l'utilisateur
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée',
      });
    }

    const order = orderResult.rows[0];

    // Vérifier que la commande peut être annulée
    if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Cette commande ne peut plus être annulée',
      });
    }

    // Restaurer le stock
    const itemsResult = await client.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [id]
    );

    for (const item of itemsResult.rows) {
      if (item.variant_id) {
        await client.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity + $1 WHERE id = $2',
          [item.quantity, item.variant_id]
        );
      } else {
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }

      // Ajouter mouvement inventaire
      await client.query(
        `INSERT INTO inventory_movements (
          product_id, variant_id, type, quantity, reference, note
        ) VALUES ($1, $2, 'return', $3, $4, 'Annulation commande')`,
        [item.product_id, item.variant_id, item.quantity, order.order_number]
      );
    }

    // Mettre à jour commande
    await client.query(
      `UPDATE orders 
       SET status = 'cancelled', cancelled_at = NOW(), admin_note = $1
       WHERE id = $2`,
      [reason || 'Annulée par le client', id]
    );

    // Historique
    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, comment)
       VALUES ($1, $2, 'cancelled', $3)`,
      [id, order.status, reason || 'Annulée par le client']
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Commande annulée avec succès',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

/**
 * GET /api/ecommerce/orders/my-orders
 * Récupérer les commandes de l'utilisateur connecté
 */
router.get('/my-orders', requireAuth, async (req, res, next) => {
  const pool = getPool();
  
  try {
    const userId = req.userId;
    
    // Récupérer les commandes de l'utilisateur
    const ordersResult = await pool.query(`
      SELECT 
        id,
        order_number,
        total_amount,
        status,
        payment_status,
        shipping_status,
        created_at,
        updated_at,
        billing_address,
        shipping_address
      FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    
    res.json({
      success: true,
      orders: ordersResult.rows,
    });
  } catch (error) {
    console.error('Erreur récupération commandes utilisateur:', error);
    next(error);
  }
});

module.exports = router;
