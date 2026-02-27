// backend/server.js - VERSION JWT AVEC FIX SUPABASE
const path = require('path');

// Charger .env depuis backend/ en priorité, puis racine du projet (cwd)
require('dotenv').config({ path: path.join(__dirname, '.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

// En production, variables critiques obligatoires
if (process.env.NODE_ENV === 'production') {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter((k) => !process.env[k] || process.env[k].includes('change-in-production'));
  if (missing.length) {
    console.error('❌ Variables manquantes ou par défaut en production:', missing.join(', '));
    process.exit(1);
  }
}

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initPool } = require('./database/db');
const { initEmailService, isEmailConfigured } = require('./services/emailService');

// Import des routes
const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const userRoutes = require('./routes/users');
const reservationRoutes = require('./routes/reservations');
const menusRoutes = require('./routes/menus');
const dashboardRoutes = require('./routes/dashboard');
const categoriesRoutes = require('./routes/categories');
const dishesRoutes = require('./routes/dishes');
const favoritesRoutes = require('./routes/favorites');
const adminContactRoutes = require('./routes/admin/contacts'); 
const adminProjectsRoutes = require('./routes/admin/projects');
const adminReservationsRoutes = require('./routes/admin/reservations');
const adminDashboardRoutes = require('./routes/admin/dashboard');
const adminHotelRoutes = require('./routes/admin/hotel');
const messagesRoutes = require('./routes/admin/messages');
const adminEcommerceStatsRoutes = require('./routes/admin/ecommerce-stats');
const adminRolesRoutes = require('./routes/admin/roles');
const adminNotificationsRoutes = require('./routes/admin/notifications');
const adminInventoryRoutes = require('./routes/admin/inventory');
const adminFinancesRoutes = require('./routes/admin/finances');
const adminAnalyticsRoutes = require('./routes/admin/analytics');
const adminCustomersRoutes = require('./routes/admin/customers');
const adminSupportRoutes = require('./routes/admin/support');
const dropshipperStatsRoutes = require('./routes/dropshipper/stats');
const contactRoutes = require('./routes/contact');
const projectFilesRouter = require('./routes/projectFiles');
const paymentsRoutes = require('./routes/payments');
const webhooksRoutes = require('./routes/webhooks');
const chatRoutes = require('./routes/chat');
const hotelRoutes = require('./routes/hotel');

// Routes E-commerce
const productsRoutes = require('./routes/products');
const ecommerceCategoriesRoutes = require('./routes/ecommerce-categories');
const cartRoutes = require('./routes/cart');
const ecommerceOrdersRoutes = require('./routes/ecommerce-orders');
const couponsRoutes = require('./routes/coupons');
const chatbotRoutes = require('./routes/chatbot');
const productReviewsRoutes = require('./routes/product-reviews');
const stripeIntegrationRoutes = require('./routes/stripe-integration');
const uploadProductRoutes = require('./routes/upload-product');

const app = express();
const PORT = process.env.PORT || 5000;

// ⚠️ CRITIQUE : Trust proxy pour Render
app.set('trust proxy', 1);

// ============================================
// CONFIGURATION CORS - VERSION JWT
// ============================================
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000'];

// Patterns pour Vercel et localhost
const allowedPatterns = [
  
  /^https:\/\/ecamsap-git-main-devros-projects.*\.vercel\.app$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/[a-z0-9-]+-[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

console.log('🌍 CORS - Origines autorisées:', allowedOrigins);
console.log('🔍 CORS - Patterns autorisés:', allowedPatterns.map(p => p.toString()));

app.use(cors({
  origin: function (origin, callback) {
    console.log('🔍 CORS - Origin reçue:', origin);
    
    // Autoriser requêtes sans origin (Postman, mobile apps)
    if (!origin) {
      console.log('✅ CORS - Requête sans origin autorisée');
      return callback(null, true);
    }
    
    // Vérifier origines fixes
    if (allowedOrigins.includes(origin)) {
      console.log('✅ CORS - Origin autorisée (fixe):', origin);
      return callback(null, true);
    }
    
    // Vérifier patterns
    const matchesPattern = allowedPatterns.some(pattern => pattern.test(origin));
    if (matchesPattern) {
      console.log('✅ CORS - Origin autorisée (pattern):', origin);
      return callback(null, true);
    }
    
    console.log('❌ CORS - Origin refusée:', origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Authorization'],
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Gérer OPTIONS explicitement
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin) || allowedPatterns.some(p => p.test(origin))) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.sendStatus(204);
});

// ============================================
// POSTGRESQL POOL - CONFIGURATION OPTIMISÉE SUPABASE
// ============================================

// Parse DATABASE_URL pour debugging
const dbUrl = process.env.DATABASE_URL;
console.log('🔍 DATABASE_URL:', dbUrl ? dbUrl.replace(/:[^:@]+@/, ':****@') : 'NON DÉFINIE');

if (!dbUrl) {
  console.error('❌ ERREUR: DATABASE_URL non définie.');
  console.error('   Définissez DATABASE_URL dans backend/.env (ou à la racine dans .env).');
  console.error('   Exemple: DATABASE_URL=postgresql://user:pass@host:5432/dbname');
  process.exit(1);
}

// Configuration pool optimisée pour Supabase
const poolConfig = {
  connectionString: dbUrl,
  
  // Configuration SSL pour Supabase
  ssl: {
    rejectUnauthorized: false
  },
  
  // Timeouts augmentés pour connexions lentes
  connectionTimeoutMillis: 60000, // 60 secondes
  idleTimeoutMillis: 30000, // 30 secondes
  query_timeout: 30000, // 30 secondes
  
  // Pool settings
  max: 5, // Réduit pour environnement de dev
  min: 0,
  
  // Keepalive pour maintenir les connexions
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  
  // Options supplémentaires pour Supabase
  application_name: 'lesage_app',
  statement_timeout: 30000
};

console.log('⚙️ Configuration Pool PostgreSQL:', {
  max: poolConfig.max,
  connectionTimeout: poolConfig.connectionTimeoutMillis,
  idleTimeout: poolConfig.idleTimeoutMillis,
  keepAlive: poolConfig.keepAlive
});

const pool = new Pool(poolConfig);

initPool(pool);
app.locals.pool = pool;
initEmailService();

// Test de connexion initial avec retry amélioré
const testConnection = async (retries = 5) => {
  console.log('\n🔌 Tentative de connexion à Supabase...');
  
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`  Tentative ${i + 1}/${retries}...`);
      const client = await pool.connect();
      
      // Test avec une vraie requête
      const result = await client.query('SELECT NOW() as now, current_database() as db');
      console.log('✅ Connecté à Supabase PostgreSQL');
      console.log('  📅 Date serveur:', result.rows[0].now);
      console.log('  🗄️ Base de données:', result.rows[0].db);
      
      client.release();
      return true;
    } catch (err) {
      console.error(`❌ Tentative ${i + 1}/${retries} échouée:`, err.message);
      
      if (err.code === 'ETIMEDOUT') {
        console.error('  ⚠️ Timeout de connexion - Vérifiez:');
        console.error('    1. Que DATABASE_URL est correcte');
        console.error('    2. Que votre IP est autorisée dans Supabase');
        console.error('    3. Que le firewall autorise le port 6543 ou 5432');
        console.error('    4. Votre connexion internet');
      }
      
      if (i < retries - 1) {
        const waitTime = Math.min(5000 * (i + 1), 15000);
        console.log(`  ⏳ Nouvelle tentative dans ${waitTime/1000} secondes...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  console.error('\n❌ ÉCHEC: Impossible de se connecter à Supabase');
  console.error('📋 Checklist de dépannage:');
  console.error('  1. Vérifiez DATABASE_URL dans backend/.env');
  console.error('  2. Vérifiez que votre projet Supabase est actif');
  console.error('  3. Vérifiez les paramètres de connexion dans Supabase Dashboard');
  console.error('  4. Essayez de changer le port 6543 par 5432 dans DATABASE_URL');
  console.error('  5. Désactivez temporairement votre antivirus/firewall');
  
  return false;
};

testConnection().then(success => {
  if (!success) {
    console.error('\n⚠️ Démarrage en mode dégradé (sans BDD)');
  }
});

// Gestion des erreurs de pool
pool.on('error', (err, client) => {
  console.error('❌ Erreur inattendue du pool PostgreSQL:', err.message);
  if (err.code === 'ETIMEDOUT') {
    console.error('  ⚠️ Perte de connexion - Tentative de reconnexion automatique...');
  }
});

pool.on('connect', (client) => {
  console.log('🔌 Nouvelle connexion pool établie');
});

pool.on('acquire', (client) => {
  console.log('📥 Connexion acquise du pool');
});

pool.on('remove', (client) => {
  console.log('📤 Connexion retirée du pool');
});

// ============================================
// MIDDLEWARES DE SÉCURITÉ
// ============================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false, // permet img src cross-origin (frontend :3000 -> API :5000/uploads)
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Trop de requêtes',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  skip: (req) => req.method === 'POST' && (req.path === '/logout' || req.originalUrl?.endsWith('/logout')),
  message: 'Trop de tentatives de connexion'
});

// ============================================
// WEBHOOK STRIPE - RAW BODY (AVANT BODY PARSER!)
// ============================================
// CRITIQUE: Les webhooks Stripe nécessitent le body brut pour vérifier la signature
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// ============================================
// BODY PARSER
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// MIDDLEWARE DE LOGGING JWT (AMÉLIORÉ)
// ============================================
app.use((req, res, next) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  
  console.log(`\n[${timestamp}] ${req.method} ${req.path}`);
  console.log('  📍 Origin:', req.headers.origin || 'none');
  console.log('  🔑 Authorization:', req.headers.authorization ? 'Bearer ***' : 'none');
  console.log('  📦 Body:', req.body && Object.keys(req.body).length > 0 ? Object.keys(req.body) : 'empty');
  
  next();
});

// ============================================
// MIDDLEWARE DE VÉRIFICATION BDD
// ============================================
app.use((req, res, next) => {
  // Routes qui ne nécessitent pas de BDD
  const noDbRoutes = ['/', '/health'];
  if (noDbRoutes.includes(req.path)) {
    return next();
  }
  
  // Vérifier que la BDD est accessible
  if (pool.totalCount === 0 && pool.idleCount === 0) {
    console.warn('⚠️ Aucune connexion BDD disponible');
  }
  
  next();
});

// ============================================
// ROUTES
// ============================================

app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'API Restaurant - JWT Auth',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    auth: 'JWT',
    version: '2.0.0',
    database: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount
    }
  });
});

// Health check: répond 200 en moins de 3s pour Render (timeout DB 3s max)
app.get('/health', async (req, res) => {
  const timeoutMs = 3000;
  const start = Date.now();
  const dbCheck = pool.query('SELECT 1').then(
    () => ({ status: 'connected', latency: Date.now() - start }),
    (err) => {
      console.error('Health check DB error:', err.message);
      return { status: 'error: ' + err.message, latency: null };
    }
  );
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ status: 'timeout', latency: null }), timeoutMs)
  );

  let dbInfo = { status: 'unknown', latency: null };
  try {
    dbInfo = await Promise.race([dbCheck, timeout]);
  } catch (_) {
    dbInfo = { status: 'error', latency: null };
  }

  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    auth: 'JWT',
    database: {
      status: dbInfo.status,
      latency: dbInfo.latency != null ? `${dbInfo.latency}ms` : null,
      connections: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      }
    },
    email: {
      configured: isEmailConfigured(),
      provider: process.env.EMAIL_PROVIDER || 'smtp'
    }
  });
});

// Test DB direct
app.get('/test-db', async (req, res) => {
  try {
    const start = Date.now();
    const result = await pool.query('SELECT NOW() as now, version() as version');
    const latency = Date.now() - start;
    
    res.json({
      success: true,
      latency: `${latency}ms`,
      time: result.rows[0].now,
      version: result.rows[0].version,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      }
    });
  } catch (err) {
    console.error('Test DB error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      code: err.code
    });
  }
});

// Test JWT (protégé)
app.get('/test-jwt', require('./middleware/auths').requireAuth, (req, res) => {
  res.json({
    message: 'JWT valide',
    user: {
      id: req.userId,
      email: req.userEmail,
      role: req.userRole
    }
  });
});

// ============================================
// ROUTES WEBHOOKS (pas de rate limit !)
// ============================================
app.use('/webhooks', webhooksRoutes);

// ============================================
// ROUTES PRINCIPALES
// ============================================
app.use('/auth', authLimiter, authRoutes);
app.use('/settings', settingsRoutes);
app.use('/users', userRoutes);
app.use('/reservations', reservationRoutes);
app.use('/menus', menusRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/categories', categoriesRoutes);
app.use('/dishes', dishesRoutes);
app.use('/favorites', favoritesRoutes);
app.use('/contact', contactRoutes);
app.use('/projects', projectFilesRouter);
app.use('/messages', messagesRoutes);
app.use('/payments', paymentsRoutes);
app.use('/chat', chatRoutes);
app.use('/hotel', hotelRoutes);

// ============================================
// UPLOAD PRODUITS (fichiers statiques + API)
// ============================================
// Middleware pour autoriser le chargement cross-origin des images (frontend sur :3000, API sur :5000)
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  next();
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/upload', uploadProductRoutes);

// ============================================
// ROUTES E-COMMERCE
// ============================================
app.use('/products', productsRoutes);
app.use('/ecommerce/categories', ecommerceCategoriesRoutes);
app.use('/cart', cartRoutes);
app.use('/ecommerce/orders', ecommerceOrdersRoutes);
app.use('/coupons', couponsRoutes);
app.use('/chatbot', chatbotRoutes);
app.use('/reviews', productReviewsRoutes);
app.use('/stripe', stripeIntegrationRoutes);

// ============================================
// ROUTES ADMIN
// ============================================
app.use('/admin/contact', adminContactRoutes);
app.use('/admin/messages', messagesRoutes);
app.use('/admin/projects', adminProjectsRoutes);
app.use('/admin/reservations', adminReservationsRoutes);
app.use('/admin/dashboard', adminDashboardRoutes);
app.use('/admin/hotel', adminHotelRoutes);
app.use('/admin/ecommerce', adminEcommerceStatsRoutes);
app.use('/admin/notifications', adminNotificationsRoutes);
app.use('/admin/inventory', adminInventoryRoutes);
app.use('/admin/finances', adminFinancesRoutes);
app.use('/admin/analytics', adminAnalyticsRoutes);
app.use('/admin/customers', adminCustomersRoutes);
app.use('/admin/support', adminSupportRoutes);
app.use('/admin', adminRolesRoutes);

// ============================================
// ROUTES DROPSHIPPER
// ============================================
app.use('/dropshipper', dropshipperStatsRoutes);

// ============================================
// GESTION ERREURS 404
// ============================================
app.use((req, res) => {
  console.log('❌ 404 - Route non trouvée:', req.method, req.path);
  res.status(404).json({ 
    error: 'Route non trouvée',
    path: req.path,
    method: req.method
  });
});

// ============================================
// GESTION ERREURS GLOBALE (AMÉLIORÉE)
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:');
  console.error('  Message:', err.message);
  console.error('  Code:', err.code);
  console.error('  Path:', req.path);
  console.error('  Method:', req.method);
  
  // Erreurs BDD spécifiques
  if (err.code === 'ETIMEDOUT') {
    return res.status(503).json({
      error: 'Service temporairement indisponible',
      message: 'La base de données ne répond pas',
      code: 'DB_TIMEOUT'
    });
  }
  
  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Service temporairement indisponible',
      message: 'Impossible de se connecter à la base de données',
      code: 'DB_CONNECTION_REFUSED'
    });
  }
  
  const isProduction = process.env.NODE_ENV === 'production';
  const errorMessage = isProduction 
    ? 'Erreur serveur interne' 
    : err.message;
  
  res.status(err.status || 500).json({ 
    error: errorMessage,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: err.toString(),
      path: req.path,
      method: req.method,
      code: err.code
    })
  });
});

// ============================================
// DÉMARRAGE SERVEUR (avec fallback port si 5000 occupé)
// ============================================
const HOST = process.env.HOST || '0.0.0.0';
const PORT_MAX_TRY = 5010;
let server = null;

function startServer(port) {
  return new Promise((resolve, reject) => {
    const s = app.listen(port, HOST, () => {
      const usedPort = s.address().port;
      console.log('');
      console.log('╔══════════════════════════════════════╗');
      console.log(`║  🚀 Serveur démarré (JWT MODE)       ║`);
      console.log(`║  📍 Port: ${String(usedPort).padEnd(25)}║`);
      if (usedPort !== (parseInt(process.env.PORT, 10) || 5000)) {
        console.log(`║  ⚠️  Port ${usedPort} (5000 occupé)        ║`);
        console.log(`║  → Mettez NEXT_PUBLIC_API_URL=http://localhost:${usedPort} ║`);
      }
      console.log(`║  🌍 Environment: ${(process.env.NODE_ENV || 'development').padEnd(17)}║`);
      console.log(`║  🔐 Auth: JWT Tokens                 ║`);
      console.log(`║  🔗 URL: http://localhost:${usedPort}       ║`);
      console.log('╚══════════════════════════════════════╝');
      console.log('');
      console.log('📍 Routes principales:');
      console.log('  GET  / - Status API');
      console.log('  GET  /health - Health check détaillé');
      console.log('  GET  /test-db - Test connexion BDD');
      console.log('');
      console.log('🔐 Auth:');
      console.log('  POST /auth/login - Connexion');
      console.log('  POST /auth/register - Inscription');
      console.log('');
      console.log('💰 Paiements:');
      console.log('  POST /payments/intent - Créer Payment Intent');
      console.log('  POST /payments/checkout-session - Créer Checkout Session');
      console.log('  GET  /payments - Historique paiements');
      console.log('');
      console.log('🪝 Webhooks:');
      console.log('  POST /webhooks/stripe - Webhook Stripe');
      console.log('');
      console.log('📚 Documentation API:');
      console.log('  Voir: docs/API_CONTRACTS.md');
      console.log('');
      resolve(s);
    });
    s.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < PORT_MAX_TRY) {
        console.warn(`⚠️ Port ${port} occupé, tentative sur ${port + 1}...`);
        startServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

(async () => {
  try {
    server = await startServer(parseInt(PORT, 10) || 5000);
  } catch (err) {
    console.error('❌ Impossible de démarrer le serveur:', err.message);
    if (err.code === 'EADDRINUSE') {
      console.error(`   Le port ${PORT} (et suivants jusqu'à ${PORT_MAX_TRY}) est déjà utilisé.`);
      console.error('   Fermez l\'autre processus ou définissez PORT=5001 dans .env');
    }
    process.exit(1);
  }
})();

// ============================================
// ARRÊT GRACIEUX
// ============================================
const { getPool } = require('./database/db');
const gracefulShutdown = () => {
  console.log('\n⏳ Arrêt du serveur...');
  let pool = null;
  try {
    pool = getPool();
  } catch (_) {}
  if (!server) {
    if (pool) pool.end(() => process.exit(0));
    else process.exit(0);
    return;
  }
  server.close(() => {
    console.log('✅ Serveur HTTP fermé');
    if (pool) {
      pool.end(() => {
        console.log('✅ Pool DB fermé');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
  setTimeout(() => {
    console.error('⚠️ Arrêt forcé');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown();
});

module.exports = app;
