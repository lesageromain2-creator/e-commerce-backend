-- ============================================
-- DONNÉES DE TEST - PRODUITS ATELIER VINTAGE
-- ============================================

-- Catégories Vintage
INSERT INTO categories (name, slug, description, is_active, display_order) VALUES
('Vêtements Homme', 'vetements-homme', 'Collection vintage pour homme', true, 1),
('Vêtements Femme', 'vetements-femme', 'Collection vintage pour femme', true, 2),
('Accessoires', 'accessoires', 'Accessoires vintage', true, 3),
('Chaussures', 'chaussures', 'Chaussures vintage', true, 4)
ON CONFLICT (slug) DO NOTHING;

-- Marques Vintage
INSERT INTO brands (name, slug, description, is_active) VALUES
('Levi''s Vintage', 'levis-vintage', 'Icône du denim vintage américain', true),
('Ralph Lauren', 'ralph-lauren', 'Élégance américaine intemporelle', true),
('Carhartt', 'carhartt', 'Workwear authentique', true),
('Adidas Vintage', 'adidas-vintage', 'Sportswear rétro', true)
ON CONFLICT (slug) DO NOTHING;

-- Récupérer les IDs des catégories
DO $$
DECLARE
  cat_homme_id UUID;
  cat_femme_id UUID;
  cat_accessoires_id UUID;
  brand_levis_id UUID;
  brand_ralph_id UUID;
  brand_carhartt_id UUID;
BEGIN
  SELECT id INTO cat_homme_id FROM categories WHERE slug = 'vetements-homme';
  SELECT id INTO cat_femme_id FROM categories WHERE slug = 'vetements-femme';
  SELECT id INTO cat_accessoires_id FROM categories WHERE slug = 'accessoires';
  SELECT id INTO brand_levis_id FROM brands WHERE slug = 'levis-vintage';
  SELECT id INTO brand_ralph_id FROM brands WHERE slug = 'ralph-lauren';
  SELECT id INTO brand_carhartt_id FROM brands WHERE slug = 'carhartt';

  -- Produits Homme
  INSERT INTO products (
    sku, name, slug, description, short_description,
    category_id, brand_id, price, compare_at_price,
    stock_quantity, low_stock_threshold,
    images, featured_image,
    status, is_featured, is_on_sale,
    tags
  ) VALUES
  (
    'LEV-501-90S',
    'Jean Levi''s 501 Vintage Années 90',
    'jean-levis-501-vintage-90s',
    '<p>Authentique jean Levi''s 501 des années 90 en excellent état. Coupe droite classique, denim brut délavé naturellement. Pièce unique vintage.</p><p><strong>Détails :</strong></p><ul><li>Taille : W32 L34</li><li>100% coton denim</li><li>Made in USA</li><li>État : Excellent (8/10)</li><li>Boutons vintage d''origine</li></ul>',
    'Jean iconique Levi''s 501 vintage années 90, coupe droite, denim authentique',
    cat_homme_id,
    brand_levis_id,
    89.90,
    120.00,
    15,
    5,
    ARRAY[
      'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800',
      'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=800'
    ],
    'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800',
    'active',
    true,
    true,
    ARRAY['denim', 'vintage', 'homme', '90s']
  ),
  (
    'RL-POLO-CREAM',
    'Polo Ralph Lauren Vintage Crème',
    'polo-ralph-lauren-vintage-creme',
    '<p>Sublime polo Ralph Lauren vintage années 80-90 en coton piqué. Coloris crème intemporel avec logo brodé.</p><p><strong>Caractéristiques :</strong></p><ul><li>Taille : M</li><li>100% coton piqué</li><li>Col classique</li><li>Logo polo brodé</li><li>État : Très bon (9/10)</li></ul>',
    'Polo Ralph Lauren vintage crème, coton piqué, logo brodé',
    cat_homme_id,
    brand_ralph_id,
    59.90,
    NULL,
    8,
    3,
    ARRAY[
      'https://images.unsplash.com/photo-1586790170083-2f9ceadc732d?w=800'
    ],
    'https://images.unsplash.com/photo-1586790170083-2f9ceadc732d?w=800',
    'active',
    true,
    false,
    ARRAY['polo', 'vintage', 'homme', 'ralph lauren']
  ),
  (
    'CAR-JACKET-BROWN',
    'Veste Carhartt Workwear Marron',
    'veste-carhartt-workwear-marron',
    '<p>Veste Carhartt vintage authentique des années 90. Toile coton robuste marron, doublure sherpa amovible.</p><p><strong>Spécifications :</strong></p><ul><li>Taille : L</li><li>Toile coton duck</li><li>Doublure sherpa</li><li>Poches multiples</li><li>État : Excellent (8/10)</li></ul>',
    'Veste workwear Carhartt vintage marron, doublure sherpa',
    cat_homme_id,
    brand_carhartt_id,
    149.90,
    189.90,
    5,
    3,
    ARRAY[
      'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800'
    ],
    'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800',
    'active',
    true,
    true,
    ARRAY['veste', 'vintage', 'homme', 'carhartt', 'workwear']
  );

  -- Produits Femme
  INSERT INTO products (
    sku, name, slug, description, short_description,
    category_id, brand_id, price,
    stock_quantity, low_stock_threshold,
    images, featured_image,
    status, is_featured,
    tags
  ) VALUES
  (
    'DRESS-FLORAL-80S',
    'Robe Fleurie Vintage Années 80',
    'robe-fleurie-vintage-80s',
    '<p>Magnifique robe vintage années 80 à motifs floraux. Coupe fluide, manches bouffantes, ceinture à nouer.</p><p><strong>Détails :</strong></p><ul><li>Taille : M (38-40)</li><li>100% viscose</li><li>Longueur midi</li><li>Fermeture boutons nacre</li><li>État : Excellent (9/10)</li></ul>',
    'Robe vintage années 80 à fleurs, coupe fluide, manches bouffantes',
    cat_femme_id,
    NULL,
    79.90,
    12,
    5,
    ARRAY[
      'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800'
    ],
    'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800',
    'active',
    true,
    ARRAY['robe', 'vintage', 'femme', '80s', 'floral']
  );

  -- Variantes pour le jean Levi's
  INSERT INTO product_variants (product_id, sku, name, option1_name, option1_value, price_adjustment, stock_quantity, is_active)
  SELECT 
    id,
    'LEV-501-90S-W30',
    'W30 L32',
    'Taille',
    'W30 L32',
    0,
    3,
    true
  FROM products WHERE sku = 'LEV-501-90S';

  INSERT INTO product_variants (product_id, sku, name, option1_name, option1_value, price_adjustment, stock_quantity, is_active)
  SELECT 
    id,
    'LEV-501-90S-W32',
    'W32 L34',
    'Taille',
    'W32 L34',
    0,
    5,
    true
  FROM products WHERE sku = 'LEV-501-90S';

  INSERT INTO product_variants (product_id, sku, name, option1_name, option1_value, price_adjustment, stock_quantity, is_active)
  SELECT 
    id,
    'LEV-501-90S-W34',
    'W34 L34',
    'Taille',
    'W34 L34',
    5.00,
    2,
    true
  FROM products WHERE sku = 'LEV-501-90S';
END $$;
