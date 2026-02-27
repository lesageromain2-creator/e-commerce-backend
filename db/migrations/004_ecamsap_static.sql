-- ============================================
-- ECAMSAP - Pages statiques & lieux de retrait
-- Exécuter dans Supabase SQL Editor
-- ============================================

-- Table: pages statiques (FAQ, mentions légales, CGV, etc.)
CREATE TABLE IF NOT EXISTS static_pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  meta_description VARCHAR(320),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_static_pages_slug ON static_pages(slug);
CREATE INDEX IF NOT EXISTS idx_static_pages_active ON static_pages(is_active);

-- Table: lieux de retrait / points de remise (Vieux Lyon, Presqu'île)
CREATE TABLE IF NOT EXISTS store_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  address TEXT,
  city VARCHAR(100) DEFAULT 'Lyon',
  postal_code VARCHAR(20),
  description TEXT,
  opening_hours TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_locations_slug ON store_locations(slug);
CREATE INDEX IF NOT EXISTS idx_store_locations_active ON store_locations(is_active);

-- Table: paramètres du site (nom, slogan, infos globales)
CREATE TABLE IF NOT EXISTS site_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Données initiales EcamSap
INSERT INTO site_settings (key, value, updated_at) VALUES
  ('site_name', 'EcamSap', NOW()),
  ('site_tagline', 'Vêtements de seconde main à petits prix pour les étudiants et les Lyonnais', NOW()),
  ('site_pickup_info', 'Remise en main propre sur Vieux Lyon et la Presqu''île', NOW()),
  ('site_new_products', 'Nouveaux produits chaque semaine', NOW()),
  ('contact_email', 'contact@ecamsap.fr', NOW()),
  ('newsletter_enabled', 'true', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Lieux de retrait par défaut
INSERT INTO store_locations (name, slug, address, city, postal_code, description, opening_hours, display_order) VALUES
  ('Vieux Lyon', 'vieux-lyon', 'Quartier Vieux Lyon', 'Lyon', '69005', 'Remise en main propre après commande. Lieu exact communiqué après validation.', 'Sur rendez-vous', 1),
  ('Presqu''île', 'presquile', 'Quartier Presqu''île', 'Lyon', '69002', 'Remise en main propre après commande. Lieu exact communiqué après validation.', 'Sur rendez-vous', 2)
ON CONFLICT (slug) DO NOTHING;

-- Contenu des pages statiques (extraits - à compléter côté admin ou ici)
INSERT INTO static_pages (slug, title, content, meta_description, display_order) VALUES
  ('faq', 'FAQ', '<h1>FAQ</h1><p>Contenu à éditer dans l''admin ou ici.</p><h2>Comment commander ?</h2><p>Parcourez le catalogue, ajoutez au panier et validez. Choisissez la remise en main propre à Lyon.</p><h2>Où récupérer ma commande ?</h2><p>Sur Vieux Lyon ou la Presqu''île. Le lieu exact vous est communiqué après validation.</p><h2>Paiement</h2><p>Paiement en ligne sécurisé ou sur place.</p>', 'Questions fréquentes EcamSap', 1),
  ('mentions-legales', 'Mentions légales', '<h1>Mentions légales</h1><p>Éditeur du site : EcamSap.</p><p>Hébergement : à compléter.</p><p>Contact : contact@ecamsap.fr</p>', 'Mentions légales EcamSap', 2),
  ('confidentialite', 'Politique de confidentialité', '<h1>Politique de confidentialité</h1><p>Vos données sont utilisées uniquement pour traiter vos commandes et vous contacter. Nous ne les vendons pas.</p>', 'Politique de confidentialité', 3),
  ('expedition', 'Livraison et remise', '<h1>Livraison et remise</h1><p>Remise en main propre sur Vieux Lyon et la Presqu''île. Pas de livraison postale pour l''instant. Le lieu et le créneau vous sont communiqués après validation de la commande.</p>', 'Livraison et remise EcamSap', 4),
  ('conditions-service', 'Conditions de service', '<h1>Conditions de service</h1><p>Conditions d''utilisation du site EcamSap.</p>', 'Conditions de service', 5),
  ('conditions-vente', 'Conditions générales de vente', '<h1>CGV</h1><p>Conditions générales de vente. Prix en euros TTC. Remise en main propre à Lyon.</p>', 'Conditions générales de vente', 6),
  ('retours', 'Retours et remboursements', '<h1>Retours et remboursements</h1><p>Vêtements de seconde main : échanges ou remboursement sous 14 jours selon conditions. Contactez-nous avant tout retour.</p>', 'Retours et remboursements', 7)
ON CONFLICT (slug) DO NOTHING;
