/**
 * Routes API - Gestion des rôles Admin
 * GET /api/admin/users - Liste utilisateurs avec rôles
 * PATCH /api/admin/users/:id/role - Changer le rôle
 * GET /api/admin/roles - Liste des rôles disponibles
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { verifyToken, isAdmin } = require('../../middleware/auths');

// Rôles disponibles
const ROLES = {
  user: {
    name: 'Utilisateur',
    description: 'Client standard',
    permissions: ['view_products', 'place_orders', 'view_own_orders'],
  },
  dropshipper: {
    name: 'Dropshipper',
    description: 'Gestion des commandes et stocks',
    permissions: [
      'view_products',
      'view_all_orders',
      'update_order_status',
      'manage_inventory',
      'view_dropshipping_dashboard',
    ],
  },
  admin: {
    name: 'Administrateur',
    description: 'Accès complet',
    permissions: ['all'],
  },
};

// ============================================
// GET /api/admin/roles - Liste des rôles
// ============================================
router.get('/roles', verifyToken, isAdmin, async (req, res) => {
  res.json({
    success: true,
    roles: ROLES,
  });
});

// ============================================
// GET /api/admin/users - Liste utilisateurs
// ============================================
router.get('/users', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const { role, search, limit = '50', offset = '0' } = req.query;

    let query = `
      SELECT 
        u.id,
        u.email,
        u.firstname,
        u.lastname,
        u.role,
        u.created_at,
        u.email_verified,
        COUNT(DISTINCT o.id) as orders_count,
        COALESCE(SUM(o.total_amount), 0) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (role) {
      query += ` AND u.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    if (search) {
      query += ` AND (u.email ILIKE $${paramIndex} OR u.firstname ILIKE $${paramIndex} OR u.lastname ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += `
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);

    // Count total
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
    const countParams = [];
    let countIndex = 1;

    if (role) {
      countQuery += ` AND role = $${countIndex}`;
      countParams.push(role);
      countIndex++;
    }

    if (search) {
      countQuery += ` AND (email ILIKE $${countIndex} OR firstname ILIKE $${countIndex} OR lastname ILIKE $${countIndex})`;
      countParams.push(`%${search}%`);
    }

    const countResult = await db.query(countQuery, countParams);

    res.json({
      success: true,
      users: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PATCH /api/admin/users/:id/role - Changer rôle
// ============================================
router.patch('/users/:id/role', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // Vérifier que le rôle existe
    if (!ROLES[role]) {
      return res.status(400).json({
        success: false,
        message: 'Rôle invalide',
        availableRoles: Object.keys(ROLES),
      });
    }

    // Ne pas permettre de changer son propre rôle
    if (id === req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Vous ne pouvez pas changer votre propre rôle',
      });
    }

    // Vérifier que l'utilisateur existe
    const userCheck = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    // Mettre à jour le rôle
    const result = await db.query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [role, id]
    );

    res.json({
      success: true,
      message: `Rôle changé en ${ROLES[role].name}`,
      user: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/users/:id - Détail utilisateur
// ============================================
router.get('/users/:id', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const userResult = await db.query(
      `SELECT 
        u.*,
        COUNT(DISTINCT o.id) as orders_count,
        COALESCE(SUM(o.total_amount), 0) as total_spent,
        COUNT(DISTINCT pr.id) as reviews_count
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      LEFT JOIN product_reviews pr ON u.id = pr.user_id
      WHERE u.id = $1
      GROUP BY u.id`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    // Dernières commandes
    const ordersResult = await db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [id]
    );

    res.json({
      success: true,
      user: {
        ...userResult.rows[0],
        role_info: ROLES[userResult.rows[0].role] || ROLES.user,
      },
      recent_orders: ordersResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
