// backend/routes/reservations.js - VERSION JWT
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auths');

// Helper pour exécuter des requêtes
const query = async (pool, sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows;
};

const queryOne = async (pool, sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
};

// ============================================
// VÉRIFIER LES DISPONIBILITÉS (PUBLIC)
// ============================================
router.post('/check-availability', async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const { reservation_date, reservation_time, number_of_people } = req.body;

    if (!reservation_date || !reservation_time || !number_of_people) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    const hour = parseInt(reservation_time.split(':')[0]);
    const isLunchTime = hour >= 12 && hour < 15;

    const availabilityResult = await query(pool,
      `SELECT COALESCE(SUM(number_of_people), 0) as total_people
       FROM reservations 
       WHERE reservation_date = $1
       AND reservation_time BETWEEN $2 AND $3
       AND status IN ('confirmed', 'pending')`,
      [
        reservation_date,
        isLunchTime ? '12:00:00' : '19:00:00',
        isLunchTime ? '14:30:00' : '22:30:00'
      ]
    );

    const totalPeople = parseInt(availabilityResult[0].total_people);
    const availableSeats = 50 - totalPeople;
    const isAvailable = availableSeats >= parseInt(number_of_people);

    res.json({
      available: isAvailable,
      available_seats: availableSeats,
      requested_seats: parseInt(number_of_people)
    });
  } catch (error) {
    console.error('Erreur check availability:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// CRÉER UNE RÉSERVATION (JWT AUTH)
// ============================================
router.post('/', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT
  
  try {
    const {
      reservation_date,
      reservation_time,
      number_of_people,
      special_requests
    } = req.body;

    console.log('📝 Création réservation pour user:', userId);

    // Validation
    if (!reservation_date || !reservation_time || !number_of_people) {
      return res.status(400).json({ 
        error: 'Date, heure et nombre de personnes requis' 
      });
    }

    if (number_of_people < 1 || number_of_people > 20) {
      return res.status(400).json({ 
        error: 'Le nombre de personnes doit être entre 1 et 20' 
      });
    }

    // Vérifier date future
    const reservationDateTime = new Date(`${reservation_date}T${reservation_time}`);
    if (reservationDateTime < new Date()) {
      return res.status(400).json({ 
        error: 'La date de réservation doit être future' 
      });
    }

    // Vérifier horaires
    const [hour, minute] = reservation_time.split(':').map(Number);
    const timeInMinutes = hour * 60 + minute;
    const lunchStart = 12 * 60;
    const lunchEnd = 14 * 60 + 30;
    const dinnerStart = 19 * 60;
    const dinnerEnd = 22 * 60 + 30;
    const isLunchTime = timeInMinutes >= lunchStart && timeInMinutes <= lunchEnd;
    const isDinnerTime = timeInMinutes >= dinnerStart && timeInMinutes <= dinnerEnd;

    if (!isLunchTime && !isDinnerTime) {
      return res.status(400).json({ 
        error: 'Horaires de réservation : 12h-14h30 et 19h-22h30' 
      });
    }

    // Vérifier disponibilité
    const availabilityResult = await query(pool,
      `SELECT COALESCE(SUM(number_of_people), 0) as total_people
       FROM reservations 
       WHERE reservation_date = $1
       AND reservation_time BETWEEN $2 AND $3
       AND status IN ('confirmed', 'pending')`,
      [
        reservation_date,
        isLunchTime ? '12:00:00' : '19:00:00',
        isLunchTime ? '14:30:00' : '22:30:00'
      ]
    );

    const totalPeople = parseInt(availabilityResult[0].total_people);
    if (totalPeople + parseInt(number_of_people) > 50) {
      return res.status(400).json({ 
        error: 'Plus de disponibilité pour ce créneau',
        available_seats: 50 - totalPeople
      });
    }

    // Créer la réservation
    const result = await query(pool,
      `INSERT INTO reservations 
       (user_id, reservation_date, reservation_time, number_of_people, special_requests, status) 
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, user_id, reservation_date, reservation_time, number_of_people, status, created_at`,
      [userId, reservation_date, reservation_time, number_of_people, special_requests || null]
    );

    console.log('✅ Réservation créée:', result[0]);

    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès',
      reservation: result[0]
    });
  } catch (error) {
    console.error('❌ Erreur create reservation:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur' 
    });
  }
});

// ============================================
// RÉCUPÉRER LES RÉSERVATIONS DE L'UTILISATEUR (JWT AUTH)
// ============================================
router.get('/my', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT
  
  try {
    console.log('📋 Récupération réservations pour user:', userId);
    
    const reservations = await query(pool,
      `SELECT * FROM reservations 
       WHERE user_id = $1 
       ORDER BY reservation_date DESC, reservation_time DESC`,
      [userId]
    );

    console.log(`✅ ${reservations.length} réservations trouvées`);

    res.json({ 
      success: true,
      reservations 
    });
  } catch (error) {
    console.error('❌ Erreur get my reservations:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur' 
    });
  }
});

// ============================================
// RÉCUPÉRER UNE RÉSERVATION PAR ID (JWT AUTH)
// ============================================
router.get('/:id', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT
  const userRole = req.userRole; // ✅ JWT
  
  try {
    const reservation = await queryOne(pool,
      `SELECT r.*, u.firstname, u.lastname, u.email, u.phone
       FROM reservations r
       JOIN users u ON r.user_id = u.id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (!reservation) {
      return res.status(404).json({ error: 'Réservation non trouvée' });
    }

    // Vérifier propriétaire ou admin
    if (reservation.user_id !== userId && userRole !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    res.json({
      success: true,
      reservation
    });
  } catch (error) {
    console.error('❌ Erreur get reservation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ANNULER UNE RÉSERVATION (JWT AUTH)
// ============================================
router.put('/:id/cancel', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT
  const userRole = req.userRole; // ✅ JWT
  
  try {
    const reservation = await queryOne(pool,
      'SELECT * FROM reservations WHERE id = $1',
      [req.params.id]
    );

    if (!reservation) {
      return res.status(404).json({ error: 'Réservation non trouvée' });
    }

    // Vérifier propriétaire ou admin
    if (reservation.user_id !== userId && userRole !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    if (reservation.status === 'cancelled') {
      return res.status(400).json({ error: 'Réservation déjà annulée' });
    }

    // Vérifier 2h avant
    const reservationDateTime = new Date(`${reservation.reservation_date}T${reservation.reservation_time}`);
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);

    if (reservationDateTime < twoHoursFromNow) {
      return res.status(400).json({ 
        error: 'Impossible d\'annuler moins de 2h avant la réservation' 
      });
    }

    await query(pool,
      'UPDATE reservations SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['cancelled', req.params.id]
    );

    res.json({ 
      success: true,
      message: 'Réservation annulée avec succès' 
    });
  } catch (error) {
    console.error('❌ Erreur cancel reservation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// SUPPRIMER UNE RÉSERVATION (JWT AUTH)
// ============================================
router.delete('/:id', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT
  const userRole = req.userRole; // ✅ JWT
  const { id } = req.params;

  try {
    // Vérifier propriétaire ou admin
    const checkQuery = `
      SELECT * FROM reservations 
      WHERE id = $1 
      AND (user_id = $2 OR $3 = 'admin')
    `;
    const checkResult = await query(pool, checkQuery, [id, userId, userRole]);

    if (checkResult.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Réservation non trouvée ou accès non autorisé' 
      });
    }

    // Supprimer
    const result = await query(pool,
      'DELETE FROM reservations WHERE id = $1 RETURNING *',
      [id]
    );

    res.json({
      success: true,
      message: 'Réservation supprimée avec succès',
      reservation: result[0]
    });
  } catch (error) {
    console.error('❌ Erreur DELETE /reservations/:id:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ADMIN: TOUTES LES RÉSERVATIONS (JWT ADMIN)
// ============================================
router.get('/admin/all', requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const { date, status } = req.query;
    let sql = `
      SELECT r.*, u.firstname, u.lastname, u.email, u.phone
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (date) {
      sql += ` AND r.reservation_date = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }

    if (status) {
      sql += ` AND r.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    sql += ' ORDER BY r.reservation_date DESC, r.reservation_time DESC';

    const reservations = await query(pool, sql, params);

    res.json({ 
      success: true,
      reservations 
    });
  } catch (error) {
    console.error('❌ Erreur get all reservations:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ADMIN: CONFIRMER UNE RÉSERVATION (JWT ADMIN)
// ============================================
router.put('/:id/confirm', requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    await query(pool,
      'UPDATE reservations SET status = $1 WHERE id = $2',
      ['confirmed', req.params.id]
    );

    res.json({ 
      success: true,
      message: 'Réservation confirmée avec succès' 
    });
  } catch (error) {
    console.error('❌ Erreur confirm reservation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;