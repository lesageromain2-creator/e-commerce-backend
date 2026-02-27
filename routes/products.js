/**
 * Routes API - Produits E-commerce
 * GET /api/products - Liste avec filtres
 * GET /api/products/:slug - Détail produit
 * POST /api/products - Création (admin)
 * PATCH /api/products/:id - Mise à jour (admin)
 * DELETE /api/products/:id - Suppression (admin)
 */

const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { requireAdmin } = require('../middleware/auths');
const { z } = require('zod');

// ============================================
// VALIDATION SCHEMAS
// ============================================
const productCreateSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(300),
  description: z.string().optional(),
  shortDescription: z.string().max(500).optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  price: z.number().positive(),
  compareAtPrice: z.number().positive().optional(),
  costPrice: z.number().positive().optional(),
  currency: z.string().length(3).default('EUR'),
  trackInventory: z.boolean().default(true),
  stockQuantity: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(10),
  allowBackorder: z.boolean().default(false),
  images: z.array(z.string()).optional(),
  featuredImage: z.string().optional(),
  videoUrl: z.string().url().optional(),
  metaTitle: z.string().max(60).optional(),
  metaDescription: z.string().max(160).optional(),
  metaKeywords: z.array(z.string()).optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  isFeatured: z.boolean().default(false),
  isOnSale: z.boolean().default(false),
  weightKg: z.number().positive().optional(),
  lengthCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
});

const productUpdateSchema = productCreateSchema.partial();

// ============================================
// GET /api/products - Liste avec filtres
// ============================================
router.get('/', async (req, res, next) => {
  try {
    const {
      search = '',
      category = '',
      brand = '',
      minPrice = '',
      maxPrice = '',
      inStock = '',
      featured = '',
      onSale = '',
      status = 'active',
      sort = 'created_at',
      order = 'desc',
      page = '1',
      limit = '20',
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Construction de la query
    let query = `
      SELECT 
        p.*,
        c.name as category_name,
        c.slug as category_slug,
        b.name as brand_name,
        b.slug as brand_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // Filtres
    if (search) {
      query += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      query += ` AND p.category_id = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (brand) {
      query += ` AND p.brand_id = $${paramIndex}`;
      params.push(brand);
      paramIndex++;
    }

    if (minPrice) {
      query += ` AND p.price >= $${paramIndex}`;
      params.push(parseFloat(minPrice));
      paramIndex++;
    }

    if (maxPrice) {
      query += ` AND p.price <= $${paramIndex}`;
      params.push(parseFloat(maxPrice));
      paramIndex++;
    }

    if (inStock === 'true') {
      query += ` AND p.stock_quantity > 0`;
    }

    if (featured === 'true') {
      query += ` AND p.is_featured = true`;
    }

    if (onSale === 'true') {
      query += ` AND p.is_on_sale = true`;
    }

    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // Tri
    const validSorts = ['created_at', 'name', 'price', 'sales_count', 'views_count'];
    const sortField = validSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    query += ` ORDER BY p.${sortField} ${sortOrder}`;

    // Pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offset);

    const result = await db.query(query, params);

    // Count total
    let countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      WHERE 1=1
    `;

    const countParams = [];
    let countIndex = 1;

    if (search) {
      countQuery += ` AND (p.name ILIKE $${countIndex} OR p.description ILIKE $${countIndex})`;
      countParams.push(`%${search}%`);
      countIndex++;
    }

    if (category) {
      countQuery += ` AND p.category_id = $${countIndex}`;
      countParams.push(category);
      countIndex++;
    }

    if (brand) {
      countQuery += ` AND p.brand_id = $${countIndex}`;
      countParams.push(brand);
      countIndex++;
    }

    if (minPrice) {
      countQuery += ` AND p.price >= $${countIndex}`;
      countParams.push(parseFloat(minPrice));
      countIndex++;
    }

    if (maxPrice) {
      countQuery += ` AND p.price <= $${countIndex}`;
      countParams.push(parseFloat(maxPrice));
      countIndex++;
    }

    if (inStock === 'true') {
      countQuery += ` AND p.stock_quantity > 0`;
    }

    if (featured === 'true') {
      countQuery += ` AND p.is_featured = true`;
    }

    if (onSale === 'true') {
      countQuery += ` AND p.is_on_sale = true`;
    }

    if (status) {
      countQuery += ` AND p.status = $${countIndex}`;
      countParams.push(status);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      products: result.rows,
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

// UUID regex pour accepter GET /products/:id en plus de GET /products/:slug
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/products/:slug ou :id - Détail produit
// ============================================
router.get('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const isId = UUID_REGEX.test(slug);
    const whereClause = isId ? 'p.id = $1' : 'p.slug = $1';

    const query = `
      SELECT 
        p.*,
        c.name as category_name,
        c.slug as category_slug,
        b.name as brand_name,
        b.slug as brand_slug,
        b.logo_url as brand_logo
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE ${whereClause}
    `;

    const result = await db.query(query, [slug]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé',
      });
    }

    const product = result.rows[0];

    // Incrémenter compteur de vues (optionnel, ne pas bloquer si colonne absente)
    try {
      await db.query(
        'UPDATE products SET views_count = COALESCE(views_count, 0) + 1 WHERE id = $1',
        [product.id]
      );
    } catch (e) {
      // views_count peut être absent en ancienne migration
    }

    // Récupérer les variantes
    const variantsResult = await db.query(
      `SELECT * FROM product_variants 
       WHERE product_id = $1 AND is_active = true 
       ORDER BY name`,
      [product.id]
    );

    // Récupérer les avis (users n'a que "name", pas firstname/lastname)
    let reviews = [];
    try {
      const reviewsResult = await db.query(
        `SELECT pr.*, u.name AS user_name
         FROM product_reviews pr LEFT JOIN users u ON pr.user_id = u.id
         WHERE pr.product_id = $1 AND pr.is_approved = true
         ORDER BY pr.created_at DESC LIMIT 10`,
        [product.id]
      );
      reviews = (reviewsResult.rows || []).map((r) => {
        const parts = (r.user_name || '').trim().split(/\s+/);
        const firstname = parts[0] || '';
        const lastname = parts.slice(1).join(' ') || '';
        const { user_name, ...rest } = r;
        return { ...rest, firstname, lastname, avatar_url: null };
      });
    } catch (e) {
      console.warn('Reviews fetch skipped:', e.message);
    }

    res.json({
      success: true,
      product: {
        ...product,
        variants: variantsResult.rows || [],
        reviews,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/products - Création (admin)
// ============================================
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const validated = productCreateSchema.parse(req.body);

    // Vérifier unicité SKU et slug
    const existingCheck = await db.query(
      'SELECT id FROM products WHERE sku = $1 OR slug = $2',
      [validated.sku, validated.slug]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'SKU ou slug déjà utilisé',
      });
    }

    const insertQuery = `
      INSERT INTO products (
        sku, name, slug, description, short_description,
        category_id, brand_id, tags,
        price, compare_at_price, cost_price, currency,
        track_inventory, stock_quantity, low_stock_threshold, allow_backorder,
        images, featured_image, video_url,
        meta_title, meta_description, meta_keywords,
        status, is_featured, is_on_sale,
        weight_kg, length_cm, width_cm, height_cm
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19,
        $20, $21, $22,
        $23, $24, $25,
        $26, $27, $28, $29
      )
      RETURNING *
    `;

    const values = [
      validated.sku,
      validated.name,
      validated.slug,
      validated.description || null,
      validated.shortDescription || null,
      validated.categoryId || null,
      validated.brandId || null,
      validated.tags || [],
      validated.price,
      validated.compareAtPrice || null,
      validated.costPrice || null,
      validated.currency,
      validated.trackInventory,
      validated.stockQuantity,
      validated.lowStockThreshold,
      validated.allowBackorder,
      validated.images || [],
      validated.featuredImage || null,
      validated.videoUrl || null,
      validated.metaTitle || null,
      validated.metaDescription || null,
      validated.metaKeywords || [],
      validated.status,
      validated.isFeatured,
      validated.isOnSale,
      validated.weightKg || null,
      validated.lengthCm || null,
      validated.widthCm || null,
      validated.heightCm || null,
    ];

    const result = await db.query(insertQuery, values);

    res.status(201).json({
      success: true,
      message: 'Produit créé avec succès',
      product: result.rows[0],
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
// PATCH /api/products/:id - Mise à jour (admin)
// ============================================
router.patch('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const validated = productUpdateSchema.parse(req.body);

    // Vérifier existence
    const existingProduct = await db.query(
      'SELECT * FROM products WHERE id = $1',
      [id]
    );

    if (existingProduct.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé',
      });
    }

    // Construire la query de mise à jour dynamiquement
    const updates = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(validated).forEach(([key, value]) => {
      if (value !== undefined) {
        // Convertir camelCase en snake_case
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${snakeKey} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Aucune donnée à mettre à jour',
      });
    }

    values.push(id);
    const updateQuery = `
      UPDATE products 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(updateQuery, values);

    res.json({
      success: true,
      message: 'Produit mis à jour avec succès',
      product: result.rows[0],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('PATCH /products/:id validation error:', error.errors);
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
// DELETE /api/products/:id - Suppression (admin)
// ============================================
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM products WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé',
      });
    }

    res.json({
      success: true,
      message: 'Produit supprimé avec succès',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
