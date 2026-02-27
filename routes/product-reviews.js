/**
 * Routes API - Avis Produits
 * GET /api/reviews - Liste avis (avec filtres)
 * GET /api/reviews/:id - Détail avis
 * POST /api/reviews - Créer un avis (client)
 * PATCH /api/reviews/:id - Modifier avis
 * DELETE /api/reviews/:id - Supprimer avis
 * POST /api/reviews/:id/approve - Approuver (admin)
 * POST /api/reviews/:id/respond - Répondre (admin/vendeur)
 * POST /api/reviews/:id/helpful - Marquer utile
 */

const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { verifyToken, isAdmin } = require('../middleware/auths');
const { z } = require('zod');

// ============================================
// VALIDATION SCHEMAS
// ============================================
const reviewSchema = z.object({
  productId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(255).optional(),
  comment: z.string().optional(),
  images: z.array(z.string().url()).optional(),
});

// ============================================
// GET /api/reviews - Liste des avis
// ============================================
router.get('/', async (req, res, next) => {
  try {
    const { productId, userId, approved = 'true', limit = '20', offset = '0' } = req.query;

    let query = `
      SELECT 
        r.*,
        u.firstname,
        u.lastname,
        u.email,
        p.name as product_name,
        p.slug as product_slug
      FROM product_reviews r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN products p ON r.product_id = p.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (productId) {
      query += ` AND r.product_id = $${paramIndex}`;
      params.push(productId);
      paramIndex++;
    }

    if (userId) {
      query += ` AND r.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (approved === 'true') {
      query += ` AND r.is_approved = true`;
    }

    query += ` ORDER BY r.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);

    res.json({
      success: true,
      reviews: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/reviews/:id - Détail avis
// ============================================
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        r.*,
        u.firstname,
        u.lastname,
        u.email,
        p.name as product_name,
        p.slug as product_slug
      FROM product_reviews r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN products p ON r.product_id = p.id
      WHERE r.id = $1
    `;

    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Avis non trouvé',
      });
    }

    res.json({
      success: true,
      review: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/reviews - Créer un avis
// ============================================
router.post('/', verifyToken, async (req, res, next) => {
  try {
    const validated = reviewSchema.parse(req.body);
    const userId = req.user.id;

    // Vérifier si le produit existe
    const productCheck = await db.query('SELECT id FROM products WHERE id = $1', [validated.productId]);
    if (productCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé',
      });
    }

    // Vérifier si l'utilisateur a déjà laissé un avis
    const existingReview = await db.query(
      'SELECT id FROM product_reviews WHERE product_id = $1 AND user_id = $2',
      [validated.productId, userId]
    );

    if (existingReview.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Vous avez déjà laissé un avis pour ce produit',
      });
    }

    // Vérifier si c'est un achat vérifié
    let isVerifiedPurchase = false;
    if (validated.orderId) {
      const orderCheck = await db.query(
        `SELECT o.id FROM orders o
         JOIN order_items oi ON o.id = oi.order_id
         WHERE o.id = $1 AND o.user_id = $2 AND oi.product_id = $3 AND o.payment_status = 'paid'`,
        [validated.orderId, userId, validated.productId]
      );
      isVerifiedPurchase = orderCheck.rows.length > 0;
    }

    // Créer l'avis
    const insertQuery = `
      INSERT INTO product_reviews (
        product_id, user_id, order_id, rating, title, comment, images,
        is_verified_purchase, is_approved
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await db.query(insertQuery, [
      validated.productId,
      userId,
      validated.orderId || null,
      validated.rating,
      validated.title || null,
      validated.comment || null,
      validated.images || [],
      isVerifiedPurchase,
      false, // Auto-modéré
    ]);

    // Mettre à jour les stats du produit
    await updateProductReviewStats(validated.productId);

    res.status(201).json({
      success: true,
      message: 'Avis créé avec succès (en attente de modération)',
      review: result.rows[0],
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
// PATCH /api/reviews/:id - Modifier avis
// ============================================
router.patch('/:id', verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { rating, title, comment, images } = req.body;

    // Vérifier que l'avis appartient à l'utilisateur
    const existingReview = await db.query(
      'SELECT * FROM product_reviews WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existingReview.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Avis non trouvé ou vous n\'êtes pas autorisé',
      });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (rating !== undefined) {
      updates.push(`rating = $${paramIndex}`);
      values.push(rating);
      paramIndex++;
    }

    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      values.push(title);
      paramIndex++;
    }

    if (comment !== undefined) {
      updates.push(`comment = $${paramIndex}`);
      values.push(comment);
      paramIndex++;
    }

    if (images !== undefined) {
      updates.push(`images = $${paramIndex}`);
      values.push(images);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Aucune modification fournie',
      });
    }

    // Remettre en modération
    updates.push(`is_approved = false`);

    values.push(id);
    const updateQuery = `UPDATE product_reviews SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    const result = await db.query(updateQuery, values);

    // Mettre à jour les stats
    await updateProductReviewStats(existingReview.rows[0].product_id);

    res.json({
      success: true,
      message: 'Avis modifié (en attente de modération)',
      review: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DELETE /api/reviews/:id - Supprimer avis
// ============================================
router.delete('/:id', verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isUserAdmin = req.user.role === 'admin';

    // Admin peut supprimer n'importe quel avis, sinon vérifier propriété
    const query = isUserAdmin
      ? 'SELECT product_id FROM product_reviews WHERE id = $1'
      : 'SELECT product_id FROM product_reviews WHERE id = $1 AND user_id = $2';

    const params = isUserAdmin ? [id] : [id, userId];
    const existing = await db.query(query, params);

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Avis non trouvé ou vous n\'êtes pas autorisé',
      });
    }

    const productId = existing.rows[0].product_id;

    await db.query('DELETE FROM product_reviews WHERE id = $1', [id]);

    // Mettre à jour les stats
    await updateProductReviewStats(productId);

    res.json({
      success: true,
      message: 'Avis supprimé',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/reviews/:id/approve - Approuver (admin)
// ============================================
router.post('/:id/approve', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { approved } = req.body;

    const result = await db.query(
      'UPDATE product_reviews SET is_approved = $1 WHERE id = $2 RETURNING product_id',
      [approved !== false, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Avis non trouvé',
      });
    }

    // Mettre à jour les stats
    await updateProductReviewStats(result.rows[0].product_id);

    res.json({
      success: true,
      message: approved !== false ? 'Avis approuvé' : 'Avis rejeté',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/reviews/:id/respond - Répondre (admin)
// ============================================
router.post('/:id/respond', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { response } = req.body;

    if (!response || response.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Réponse requise',
      });
    }

    const result = await db.query(
      'UPDATE product_reviews SET seller_response = $1, responded_at = NOW() WHERE id = $2 RETURNING *',
      [response, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Avis non trouvé',
      });
    }

    res.json({
      success: true,
      message: 'Réponse publiée',
      review: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/reviews/:id/helpful - Marquer utile
// ============================================
router.post('/:id/helpful', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { helpful = true } = req.body;

    const field = helpful ? 'helpful_count' : 'not_helpful_count';
    const result = await db.query(
      `UPDATE product_reviews SET ${field} = ${field} + 1 WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Avis non trouvé',
      });
    }

    res.json({
      success: true,
      review: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// HELPERS
// ============================================
async function updateProductReviewStats(productId) {
  await db.query(
    `UPDATE products SET
      reviews_count = (SELECT COUNT(*) FROM product_reviews WHERE product_id = $1 AND is_approved = true),
      average_rating = (SELECT COALESCE(AVG(rating), 0) FROM product_reviews WHERE product_id = $1 AND is_approved = true)
     WHERE id = $1`,
    [productId]
  );
}

module.exports = router;
