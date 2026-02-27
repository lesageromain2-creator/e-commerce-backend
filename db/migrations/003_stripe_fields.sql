-- ============================================
-- MIGRATION : Ajouter champs Stripe
-- ============================================

-- Ajouter champs Stripe aux produits
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS stripe_product_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

-- Ajouter champs Stripe aux variantes
ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_products_stripe_product ON products(stripe_product_id);
CREATE INDEX IF NOT EXISTS idx_products_stripe_price ON products(stripe_price_id);
CREATE INDEX IF NOT EXISTS idx_variants_stripe_price ON product_variants(stripe_price_id);

COMMENT ON COLUMN products.stripe_product_id IS 'ID produit dans Stripe';
COMMENT ON COLUMN products.stripe_price_id IS 'ID prix par défaut dans Stripe';
COMMENT ON COLUMN product_variants.stripe_price_id IS 'ID prix de la variante dans Stripe';
