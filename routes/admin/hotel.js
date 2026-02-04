// backend/routes/admin/hotel.js - Gestion hôtel admin (chambres, revenus, menus)
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../../middleware/auths');
const { getPool } = require('../../database/db');

const DEFAULT_HOTEL_ID = process.env.DEFAULT_HOTEL_ID || 'b2178a5e-9a4f-4c8d-9e1b-2a3c4d5e6f70';

router.use(requireAuth, requireAdmin);

const query = (pool, sql, params = []) => pool.query(sql, params).then(r => r.rows);
const queryOne = (pool, sql, params = []) => pool.query(sql, params).then(r => r.rows[0] || null);

// ============================================
// Utilisateurs - Toggle admin
// ============================================
router.get('/users', async (req, res) => {
  try {
    const pool = getPool();
    const { search, limit = 100, offset = 0 } = req.query;
    let sql = `SELECT id, email, firstname, lastname, role, is_active, created_at 
      FROM users WHERE 1=1`;
    const params = [];
    let i = 1;
    if (search) {
      sql += ` AND (firstname ILIKE $${i} OR lastname ILIKE $${i} OR email ILIKE $${i})`;
      params.push(`%${search}%`);
      i++;
    }
    sql += ` ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`;
    params.push(parseInt(limit) || 100, parseInt(offset) || 0);
    const rows = await query(pool, sql, params);
    const countResult = await pool.query('SELECT COUNT(*) as c FROM users');
    res.json({ users: rows, total: parseInt(countResult.rows[0]?.c || 0) });
  } catch (e) {
    console.error('admin hotel users:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/users/:userId/role', async (req, res) => {
  try {
    const pool = getPool();
    const { userId } = req.params;
    const { role } = req.body;
    if (!role || !['admin', 'staff', 'client'].includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide (admin, staff, client)' });
    }
    await pool.query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [role, userId]);
    res.json({ success: true, role });
  } catch (e) {
    console.error('admin hotel users role:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// Chiffre d'affaires prévisionnel
// ============================================
router.get('/revenue-forecast', async (req, res) => {
  try {
    const pool = getPool();
    const hotelId = req.query.hotel_id || DEFAULT_HOTEL_ID;
    const forecast = await queryOne(pool, `
      SELECT 
        COALESCE(SUM(total_amount), 0)::numeric as total_forecast,
        COUNT(*)::int as reservations_count
      FROM room_reservations 
      WHERE hotel_id = $1 AND status NOT IN ('cancelled') AND check_in_date >= CURRENT_DATE
    `, [hotelId]);
    const byMonth = await query(pool, `
      SELECT 
        date_trunc('month', check_in_date)::date as month,
        SUM(total_amount)::numeric as amount,
        COUNT(*)::int as count
      FROM room_reservations 
      WHERE hotel_id = $1 AND status NOT IN ('cancelled') AND check_in_date >= CURRENT_DATE
      GROUP BY date_trunc('month', check_in_date)
      ORDER BY month
    `, [hotelId]);
    res.json({ ...forecast, by_month: byMonth });
  } catch (e) {
    console.error('admin revenue forecast:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// Chambres - Disponibilité par type
// ============================================
router.get('/rooms/availability', async (req, res) => {
  try {
    const pool = getPool();
    const hotelId = req.query.hotel_id || DEFAULT_HOTEL_ID;
    const types = await query(pool, `
      SELECT rt.id, rt.name, rt.slug, rt.base_price_per_night,
        (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = rt.id AND r.status = 'available') as total_rooms,
        (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = rt.id) as total_physical
      FROM room_types rt
      WHERE rt.hotel_id = $1 AND rt.is_active = true
      ORDER BY rt.display_order
    `, [hotelId]);
    const today = new Date().toISOString().slice(0, 10);
    const next30 = await query(pool, `
      SELECT room_type_id, COUNT(*) as reserved
      FROM room_reservations rr
      WHERE hotel_id = $1 AND status NOT IN ('cancelled')
        AND check_in_date <= $2 AND check_out_date > $2
      GROUP BY room_type_id
    `, [hotelId, today]);
    const reservedMap = Object.fromEntries(next30.map(r => [r.room_type_id, parseInt(r.reserved)]));
    const result = types.map(t => ({
      ...t,
      total_rooms: parseInt(t.total_rooms) || 0,
      reserved: reservedMap[t.id] || 0,
      available: (parseInt(t.total_rooms) || 0) - (reservedMap[t.id] || 0)
    }));
    res.json({ room_types: result });
  } catch (e) {
    console.error('admin rooms availability:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/room-types/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;
    const { base_price_per_night } = req.body;
    const updates = [];
    const params = [];
    let i = 1;
    if (base_price_per_night != null) {
      updates.push(`base_price_per_night = $${i}`);
      params.push(Number(base_price_per_night));
      i++;
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Aucune mise à jour' });
    params.push(id);
    await pool.query(`UPDATE room_types SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i}`, params);
    res.json({ success: true });
  } catch (e) {
    console.error('admin room-types update:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/rooms', async (req, res) => {
  try {
    const pool = getPool();
    const { hotel_id, room_type_id, room_number, floor = 1 } = req.body;
    const hid = hotel_id || DEFAULT_HOTEL_ID;
    if (!room_type_id || !room_number) return res.status(400).json({ error: 'room_type_id et room_number requis' });
    const r = await queryOne(pool, `
      INSERT INTO rooms (hotel_id, room_type_id, room_number, floor, status)
      VALUES ($1, $2, $3, $4, 'available')
      RETURNING *
    `, [hid, room_type_id, String(room_number), parseInt(floor) || 1]);
    res.status(201).json(r);
  } catch (e) {
    console.error('admin rooms add:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/rooms/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('admin rooms delete:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// Menus hebdomadaires
// ============================================
router.get('/weekly-menus', async (req, res) => {
  try {
    const pool = getPool();
    const hotelId = req.query.hotel_id || DEFAULT_HOTEL_ID;
    const weekStart = req.query.week_start;
    let sql = 'SELECT * FROM weekly_menus WHERE hotel_id = $1';
    const params = [hotelId];
    if (weekStart) {
      sql += ' AND week_start_date = $2';
      params.push(weekStart);
    }
    sql += ' ORDER BY week_start_date DESC, day_of_week, meal_type';
    const rows = await query(pool, sql, params);
    res.json(rows);
  } catch (e) {
    console.error('admin weekly-menus:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/weekly-menus/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;
    const { title, composition, items } = req.body;
    const updates = [];
    const params = [];
    let i = 1;
    if (title !== undefined) { updates.push(`title = $${i}`); params.push(title); i++; }
    if (composition !== undefined) { updates.push(`composition = $${i}`); params.push(composition); i++; }
    if (items !== undefined) { updates.push(`items = $${i}`); params.push(JSON.stringify(Array.isArray(items) ? items : [])); i++; }
    if (updates.length === 0) return res.status(400).json({ error: 'Aucune mise à jour' });
    params.push(id);
    await pool.query(`UPDATE weekly_menus SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i}`, params);
    res.json({ success: true });
  } catch (e) {
    console.error('admin weekly-menus update:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/weekly-menus', async (req, res) => {
  try {
    const pool = getPool();
    const { hotel_id, week_start_date, meal_type, day_of_week, title, composition, items } = req.body;
    const hid = hotel_id || DEFAULT_HOTEL_ID;
    if (!week_start_date || meal_type == null || day_of_week == null)
      return res.status(400).json({ error: 'week_start_date, meal_type, day_of_week requis' });
    const r = await queryOne(pool, `
      INSERT INTO weekly_menus (hotel_id, week_start_date, meal_type, day_of_week, title, composition, items)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (hotel_id, week_start_date, meal_type, day_of_week)
      DO UPDATE SET title = EXCLUDED.title, composition = EXCLUDED.composition, items = EXCLUDED.items, updated_at = now()
      RETURNING *
    `, [hid, week_start_date, meal_type, day_of_week, title || null, composition || null, JSON.stringify(Array.isArray(items) ? items : [])]);
    res.status(201).json(r);
  } catch (e) {
    console.error('admin weekly-menus create:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// Réservations chambres (liste admin)
// ============================================
router.get('/reservations', async (req, res) => {
  try {
    const pool = getPool();
    const hotelId = req.query.hotel_id || DEFAULT_HOTEL_ID;
    const rows = await query(pool, `
      SELECT rr.*, rt.name as room_type_name
      FROM room_reservations rr
      JOIN room_types rt ON rr.room_type_id = rt.id
      WHERE rr.hotel_id = $1
      ORDER BY rr.check_in_date DESC, rr.created_at DESC
      LIMIT 200
    `, [hotelId]);
    res.json(rows);
  } catch (e) {
    console.error('admin hotel reservations:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
