// backend/routes/hotel.js - API Hôtel (chambres, réservations, petit-déj, restauration, spa, offres)
const express = require('express');
const router = express.Router();
const { requireAuth, optionalAuth } = require('../middleware/auths');

// UUID par défaut (migration 20260205000000_seed_default_hotel_fixed_id.sql)
const DEFAULT_HOTEL_UUID = 'b2178a5e-9a4f-4c8d-9e1b-2a3c4d5e6f70';
const getHotelId = (req) =>
  req.query.hotel_id || req.body?.hotel_id || process.env.DEFAULT_HOTEL_ID || req.app?.locals?.defaultHotelId || DEFAULT_HOTEL_UUID;

const query = async (pool, sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows;
};
const queryOne = async (pool, sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
};

// ============================================
// INFOS HÔTEL
// ============================================
router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  if (!hotelId) return res.status(400).json({ error: 'hotel_id requis ou DEFAULT_HOTEL_ID non défini' });
  try {
    const hotel = await queryOne(pool, 'SELECT * FROM hotels WHERE id = $1 AND is_active = true', [hotelId]);
    if (!hotel) return res.status(404).json({ error: 'Hôtel non trouvé' });
    res.json(hotel);
  } catch (e) {
    console.error('hotel get:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// TYPES DE CHAMBRES
// ============================================
router.get('/rooms', async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  if (!hotelId) return res.status(400).json({ error: 'hotel_id requis' });
  try {
    const rows = await query(pool,
      'SELECT * FROM room_types WHERE hotel_id = $1 AND is_active = true ORDER BY display_order, name',
      [hotelId]
    );
    res.json(rows);
  } catch (e) {
    console.error('hotel rooms:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// IMPORTANT: /rooms/availability doit être avant /rooms/:id pour ne pas matcher "availability" comme UUID
router.get('/rooms/availability', async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  const { check_in, check_out, room_type_id } = req.query;
  if (!hotelId || !check_in || !check_out) {
    return res.status(400).json({ error: 'check_in, check_out et hotel_id requis' });
  }
  try {
    const checkIn = new Date(check_in);
    const checkOut = new Date(check_out);
    if (checkOut <= checkIn) return res.status(400).json({ error: 'check_out doit être après check_in' });

    let roomTypes = [];
    if (room_type_id) {
      const rt = await queryOne(pool, 'SELECT * FROM room_types WHERE id = $1 AND hotel_id = $2 AND is_active = true', [room_type_id, hotelId]);
      if (!rt) return res.status(404).json({ error: 'Type de chambre non trouvé' });
      roomTypes = [rt];
    } else {
      roomTypes = await query(pool, 'SELECT * FROM room_types WHERE hotel_id = $1 AND is_active = true ORDER BY display_order', [hotelId]);
    }

    const pricingsByType = {};
    for (const rt of roomTypes) {
      const pricings = await query(pool, 'SELECT * FROM room_pricings WHERE room_type_id = $1', [rt.id]);
      pricingsByType[rt.id] = pricings;
    }

    const nights = Math.ceil((checkOut - checkIn) / (24 * 60 * 60 * 1000));
    const results = [];

    for (const rt of roomTypes) {
      const overlapping = await query(pool,
        `SELECT id FROM room_reservations
         WHERE room_type_id = $1 AND status NOT IN ('cancelled')
         AND (check_in_date < $2 AND check_out_date > $3)`,
        [rt.id, check_out, check_in]
      );
      const totalRooms = await queryOne(pool, 'SELECT COUNT(*) as c FROM rooms WHERE room_type_id = $1 AND status = $2', [rt.id, 'available']);
      const total = (totalRooms && parseInt(totalRooms.c, 10) > 0) ? parseInt(totalRooms.c, 10) : 99;
      const available = Math.max(0, total - overlapping.length);

      let totalPrice = 0;
      for (let i = 0; i < nights; i++) {
        const d = new Date(checkIn);
        d.setDate(d.getDate() + i);
        totalPrice += getPriceForDate(pricingsByType[rt.id] || [], rt.base_price_per_night, d);
      }

      results.push({
        room_type_id: rt.id,
        name: rt.name,
        slug: rt.slug,
        max_guests: rt.max_guests,
        image_url: rt.image_url,
        base_price_per_night: rt.base_price_per_night,
        available: available > 0,
        rooms_available: Math.max(0, available),
        nights,
        total_price: Math.round(totalPrice * 100) / 100,
        currency: rt.currency,
      });
    }

    res.json({ check_in: check_in, check_out: check_out, nights, room_types: results });
  } catch (e) {
    console.error('hotel availability:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/rooms/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const row = await queryOne(pool,
      'SELECT * FROM room_types WHERE id = $1 AND is_active = true',
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Type de chambre non trouvé' });
    const pricings = await query(pool,
      'SELECT * FROM room_pricings WHERE room_type_id = $1 AND end_date >= CURRENT_DATE ORDER BY start_date',
      [req.params.id]
    );
    res.json({ ...row, pricings });
  } catch (e) {
    console.error('hotel room detail:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Prix pour une nuit donnée (base ou tarif période)
function getPriceForDate(pricings, basePrice, date) {
  const d = new Date(date);
  const match = pricings.find(p => {
    const start = new Date(p.start_date);
    const end = new Date(p.end_date);
    return d >= start && d <= end;
  });
  return match ? Number(match.price_per_night) : Number(basePrice);
}

// ============================================
// OPTIONS (petit-déjeuner, etc.)
// ============================================
router.get('/amenities', async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  const { type } = req.query;
  if (!hotelId) return res.status(400).json({ error: 'hotel_id requis' });
  try {
    let sql = 'SELECT * FROM amenities WHERE hotel_id = $1 AND is_active = true';
    const params = [hotelId];
    if (type) {
      sql += ' AND type = $2';
      params.push(type);
    }
    sql += ' ORDER BY display_order, name';
    const rows = await query(pool, sql, params);
    res.json(rows);
  } catch (e) {
    console.error('hotel amenities:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// RESTAURATION & BARS
// ============================================
router.get('/dining', async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  if (!hotelId) return res.status(400).json({ error: 'hotel_id requis' });
  try {
    const rows = await query(pool,
      'SELECT * FROM dining_venues WHERE hotel_id = $1 AND is_active = true ORDER BY display_order, name',
      [hotelId]
    );
    res.json(rows);
  } catch (e) {
    console.error('hotel dining:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// BIEN-ÊTRE (Spa, Fitness, Salon)
// ============================================
router.get('/wellness', async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  if (!hotelId) return res.status(400).json({ error: 'hotel_id requis' });
  try {
    const rows = await query(pool,
      'SELECT * FROM wellness_services WHERE hotel_id = $1 AND is_active = true ORDER BY display_order, name',
      [hotelId]
    );
    res.json(rows);
  } catch (e) {
    console.error('hotel wellness:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GALERIE
// ============================================
router.get('/gallery', async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  const { category } = req.query;
  if (!hotelId) return res.status(400).json({ error: 'hotel_id requis' });
  try {
    let sql = 'SELECT * FROM gallery_media WHERE hotel_id = $1';
    const params = [hotelId];
    if (category) {
      sql += ' AND category = $2';
      params.push(category);
    }
    sql += ' ORDER BY display_order, created_at DESC';
    const rows = await query(pool, sql, params);
    res.json(rows);
  } catch (e) {
    console.error('hotel gallery:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// OFFRES / PROMOS
// ============================================
router.get('/offers', async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  if (!hotelId) return res.status(400).json({ error: 'hotel_id requis' });
  try {
    const rows = await query(pool,
      `SELECT * FROM hotel_offers
       WHERE hotel_id = $1 AND is_active = true
       AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
       ORDER BY display_order, name`,
      [hotelId]
    );
    res.json(rows);
  } catch (e) {
    console.error('hotel offers:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// CRÉER RÉSERVATION DE SÉJOUR
// optionalAuth : si l'utilisateur est connecté, on lie la réservation à son compte (visible dans le dashboard)
// ============================================
router.post('/reservations', optionalAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const hotelId = getHotelId(req);
  if (!hotelId) return res.status(400).json({ error: 'hotel_id requis' });

  const {
    guest_email,
    guest_firstname,
    guest_lastname,
    guest_phone,
    room_type_id,
    check_in_date,
    check_out_date,
    adults = 1,
    children = 0,
    special_requests,
    add_ons = [],
    user_id: bodyUserId,
  } = req.body;

  const userId = req.userId || bodyUserId || null;

  if (!guest_email || !guest_firstname || !guest_lastname || !room_type_id || !check_in_date || !check_out_date) {
    return res.status(400).json({ error: 'Champs requis: guest_email, guest_firstname, guest_lastname, room_type_id, check_in_date, check_out_date' });
  }

  const checkIn = new Date(check_in_date);
  const checkOut = new Date(check_out_date);
  if (checkOut <= checkIn) return res.status(400).json({ error: 'check_out doit être après check_in' });
  const nights = Math.ceil((checkOut - checkIn) / (24 * 60 * 60 * 1000));

  try {
    const roomType = await queryOne(pool, 'SELECT * FROM room_types WHERE id = $1 AND hotel_id = $2', [room_type_id, hotelId]);
    if (!roomType) return res.status(404).json({ error: 'Type de chambre non trouvé' });

    const pricings = await query(pool, 'SELECT * FROM room_pricings WHERE room_type_id = $1', [room_type_id]);
    let roomTotal = 0;
    for (let i = 0; i < nights; i++) {
      const d = new Date(checkIn);
      d.setDate(d.getDate() + i);
      roomTotal += getPriceForDate(pricings, roomType.base_price_per_night, d);
    }

    let addOnsTotal = 0;
    const addOnsToInsert = [];
    for (const ao of add_ons) {
      const amenity = await queryOne(pool, 'SELECT * FROM amenities WHERE id = $1 AND hotel_id = $2', [ao.amenity_id, hotelId]);
      if (!amenity) continue;
      const qty = Math.max(1, parseInt(ao.quantity, 10) || 1);
      const unitPrice = Number(amenity.price);
      const total = amenity.price_type === 'per_night' ? unitPrice * nights * qty : unitPrice * qty;
      addOnsTotal += total;
      addOnsToInsert.push({ amenity_id: amenity.id, quantity: qty, unit_price: unitPrice, total_price: total });
    }

    const totalAmount = Math.round((roomTotal + addOnsTotal) * 100) / 100;

    const [reservation] = await query(pool,
      `INSERT INTO room_reservations (
        hotel_id, user_id, guest_email, guest_firstname, guest_lastname, guest_phone,
        room_type_id, check_in_date, check_out_date, nights, adults, children,
        status, total_amount, currency, special_requests
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15)
      RETURNING *`,
      [
        hotelId, userId, guest_email, guest_firstname, guest_lastname, guest_phone || null,
        room_type_id, check_in_date, check_out_date, nights, adults, children,
        totalAmount, roomType.currency, special_requests || null,
      ]
    );

    for (const ao of addOnsToInsert) {
      await pool.query(
        'INSERT INTO reservation_add_ons (room_reservation_id, amenity_id, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5)',
        [reservation.id, ao.amenity_id, ao.quantity, ao.unit_price, ao.total_price]
      );
    }

    res.status(201).json({ success: true, reservation });
  } catch (e) {
    console.error('hotel reservation create:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Mes réservations (auth optionnel : par user_id ou par guest_email)
router.get('/reservations/my', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;
  const hotelId = getHotelId(req);
  try {
    const rows = await query(pool,
      `SELECT r.*, rt.name as room_type_name, rt.slug as room_type_slug
       FROM room_reservations r
       JOIN room_types rt ON r.room_type_id = rt.id
       WHERE r.user_id = $1 AND ($2::uuid IS NULL OR r.hotel_id = $2)
       ORDER BY r.check_in_date DESC`,
      [userId, hotelId || null]
    );
    res.json(rows);
  } catch (e) {
    console.error('hotel reservations my:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Détail d'une réservation
router.get('/reservations/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const row = await queryOne(pool,
      `SELECT r.*, rt.name as room_type_name, rt.slug as room_type_slug, rt.image_url as room_type_image
       FROM room_reservations r
       JOIN room_types rt ON r.room_type_id = rt.id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Réservation non trouvée' });
    const addOns = await query(pool, 'SELECT ra.*, a.name as amenity_name FROM reservation_add_ons ra JOIN amenities a ON ra.amenity_id = a.id WHERE ra.room_reservation_id = $1', [req.params.id]);
    res.json({ ...row, add_ons: addOns });
  } catch (e) {
    console.error('hotel reservation get:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Annuler une réservation
router.put('/reservations/:id/cancel', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const r = await queryOne(pool, 'SELECT id, status FROM room_reservations WHERE id = $1', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Réservation non trouvée' });
    if (r.status === 'cancelled') return res.status(400).json({ error: 'Déjà annulée' });
    await pool.query('UPDATE room_reservations SET status = $1, cancelled_at = now() WHERE id = $2', ['cancelled', req.params.id]);
    res.json({ success: true, message: 'Réservation annulée' });
  } catch (e) {
    console.error('hotel reservation cancel:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
