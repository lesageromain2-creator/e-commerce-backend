/**
 * GET /admin/customers - Liste des clients (utilisateurs ayant passé commande ou role client)
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../database/db');
const { requireAdmin } = require('../../middleware/auths');

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20', role = '' } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = `WHERE (u.role IN ('client', 'user', 'customer') OR u.id IN (SELECT user_id FROM orders WHERE user_id IS NOT NULL))`;
    const params = [];
    let paramIndex = 1;

    if (search.trim()) {
      whereClause += ` AND (u.email ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex})`;
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }
    if (role && role !== 'all') {
      whereClause += ` AND u.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM users u ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    params.push(limitNum, offset);
    const result = await db.query(
      `SELECT u.id, u.email, u.name, u.role, u.phone, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as order_count,
              (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid') as total_spent
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    res.json({
      success: true,
      customers: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
