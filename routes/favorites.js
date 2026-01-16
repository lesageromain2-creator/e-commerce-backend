// backend/routes/favorites.js - VERSION JWT
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auths');

// GET /favorites - Liste des favoris
router.get('/', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT au lieu de req.session.userId

  try {
    const result = await pool.query(`
      SELECT 
        f.id as favorite_id,
        f.created_at as added_at,
        d.id_dish,
        d.name,
        d.description,
        d.price,
        d.image_url,
        d.allergens,
        d.is_vegetarian,
        d.is_vegan,
        d.is_gluten_free,
        d.course_type,
        d.is_available,
        d.preparation_time,
        d.calories,
        c.name as category_name,
        c.icon as category_icon
      FROM favorites f
      INNER JOIN dishes d ON f.dish_id = d.id_dish
      LEFT JOIN categories c ON d.category_id = c.id_category
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
    `, [userId]);

    res.json({ 
      success: true,
      favorites: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('❌ Erreur GET /favorites:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /favorites - Ajouter un favori
router.post('/', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT
  const { dishId } = req.body;

  console.log('📥 POST /favorites:', { userId, dishId });

  if (!dishId) {
    return res.status(400).json({ error: 'dishId requis' });
  }

  try {
    // Vérifier que le plat existe
    const dishCheck = await pool.query(
      'SELECT id_dish FROM dishes WHERE id_dish = $1',
      [dishId]
    );

    if (dishCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Plat non trouvé' });
    }

    // Ajouter (ignore si déjà existant)
    const result = await pool.query(`
      INSERT INTO favorites (user_id, dish_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, dish_id) DO NOTHING
      RETURNING id, created_at
    `, [userId, dishId]);

    if (result.rows.length === 0) {
      return res.json({ 
        success: true,
        message: 'Déjà dans les favoris',
        alreadyExists: true
      });
    }

    res.status(201).json({ 
      success: true,
      message: 'Ajouté aux favoris',
      favorite: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Erreur POST /favorites:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /favorites/:dishId - Retirer un favori
router.delete('/:dishId', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT
  const { dishId } = req.params;

  console.log('🗑️ DELETE /favorites:', { userId, dishId });

  try {
    const result = await pool.query(
      'DELETE FROM favorites WHERE user_id = $1 AND dish_id = $2 RETURNING id',
      [userId, dishId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Favori non trouvé' });
    }

    res.json({ 
      success: true,
      message: 'Retiré des favoris'
    });
  } catch (error) {
    console.error('❌ Erreur DELETE /favorites:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /favorites/check/:dishId - Vérifier si favori
router.get('/check/:dishId', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT
  const { dishId } = req.params;

  try {
    const result = await pool.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND dish_id = $2',
      [userId, dishId]
    );

    res.json({ 
      success: true,
      isFavorite: result.rows.length > 0
    });
  } catch (error) {
    console.error('❌ Erreur GET /favorites/check:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /favorites/count - Nombre de favoris
router.get('/count', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId; // ✅ JWT

  try {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM favorites WHERE user_id = $1',
      [userId]
    );

    res.json({ 
      success: true,
      count: parseInt(result.rows[0].count)
    });
  } catch (error) {
    console.error('❌ Erreur GET /favorites/count:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;