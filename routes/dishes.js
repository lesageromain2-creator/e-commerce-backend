// backend/routes/dishes.js - VERSION JWT
const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auths');

// GET /dishes - Récupérer tous les plats (PUBLIC)
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    
    const result = await pool.query(`
      SELECT 
        d.*,
        c.name as category_name,
        c.icon as category_icon
      FROM dishes d
      LEFT JOIN categories c ON d.category_id = c.id_category
      WHERE d.is_available = true
      ORDER BY c.display_order, d.name
    `);

    res.json({
      success: true,
      dishes: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('❌ Erreur GET /dishes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /dishes/search - Rechercher des plats (PUBLIC)
router.get('/search', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Paramètre de recherche requis' });
    }

    const result = await pool.query(`
      SELECT 
        d.*,
        c.name as category_name,
        c.icon as category_icon
      FROM dishes d
      LEFT JOIN categories c ON d.category_id = c.id_category
      WHERE d.is_available = true
        AND (
          LOWER(d.name) LIKE LOWER($1)
          OR LOWER(d.description) LIKE LOWER($1)
        )
      ORDER BY d.name
    `, [`%${q}%`]);

    res.json({
      success: true,
      dishes: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('❌ Erreur GET /dishes/search:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /dishes/:id - Récupérer un plat par ID (PUBLIC)
router.get('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;

    const result = await pool.query(`
      SELECT 
        d.*,
        c.name as category_name,
        c.icon as category_icon
      FROM dishes d
      LEFT JOIN categories c ON d.category_id = c.id_category
      WHERE d.id_dish = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plat non trouvé' });
    }

    res.json({
      success: true,
      dish: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Erreur GET /dishes/:id:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /dishes - Créer un plat (ADMIN JWT)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const {
      name,
      description,
      category_id,
      price,
      image_url,
      allergens,
      is_vegetarian,
      is_vegan,
      is_gluten_free,
      course_type,
      preparation_time,
      calories
    } = req.body;

    if (!name || !category_id || !price) {
      return res.status(400).json({ error: 'Champs requis manquants' });
    }

    const result = await pool.query(`
      INSERT INTO dishes (
        name, description, category_id, price, image_url,
        allergens, is_vegetarian, is_vegan, is_gluten_free,
        course_type, preparation_time, calories
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      name, description, category_id, price, image_url,
      allergens, is_vegetarian, is_vegan, is_gluten_free,
      course_type, preparation_time, calories
    ]);

    res.status(201).json({
      success: true,
      message: 'Plat créé avec succès',
      dish: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Erreur POST /dishes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /dishes/:id - Mettre à jour un plat (ADMIN JWT)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;

    const {
      name,
      description,
      category_id,
      price,
      image_url,
      allergens,
      is_vegetarian,
      is_vegan,
      is_gluten_free,
      course_type,
      is_available,
      preparation_time,
      calories
    } = req.body;

    const result = await pool.query(`
      UPDATE dishes SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        category_id = COALESCE($3, category_id),
        price = COALESCE($4, price),
        image_url = COALESCE($5, image_url),
        allergens = COALESCE($6, allergens),
        is_vegetarian = COALESCE($7, is_vegetarian),
        is_vegan = COALESCE($8, is_vegan),
        is_gluten_free = COALESCE($9, is_gluten_free),
        course_type = COALESCE($10, course_type),
        is_available = COALESCE($11, is_available),
        preparation_time = COALESCE($12, preparation_time),
        calories = COALESCE($13, calories),
        updated_at = CURRENT_TIMESTAMP
      WHERE id_dish = $14
      RETURNING *
    `, [
      name, description, category_id, price, image_url,
      allergens, is_vegetarian, is_vegan, is_gluten_free,
      course_type, is_available, preparation_time, calories, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plat non trouvé' });
    }

    res.json({
      success: true,
      message: 'Plat mis à jour avec succès',
      dish: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Erreur PUT /dishes/:id:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /dishes/:id - Supprimer un plat (ADMIN JWT)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM dishes WHERE id_dish = $1 RETURNING id_dish',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plat non trouvé' });
    }

    res.json({
      success: true,
      message: 'Plat supprimé avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur DELETE /dishes/:id:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;