// backend/server.js - CONFIGURATION CORRIGÉE POUR MOBILE
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initPool } = require('./database/db');

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

const app = express();
const PORT = process.env.PORT || 5000;

// ⚠️ CRITIQUE : Trust proxy pour Render
app.set('trust proxy', 1);

// ============================================
// CONFIGURATION CORS - VERSION CORRIGÉE
// ============================================
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000'];

// Ajouter tous les domaines Vercel possibles
const allowedPatterns = [
  /^https:\/\/restaurant-frontend.*\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

console.log('🌍 CORS - Origines autorisées:', allowedOrigins);
console.log('🔍 CORS - Patterns autorisés:', allowedPatterns.map(p => p.toString()));

app.use(cors({
  origin: function (origin, callback) {
    console.log('🔍 CORS - Origin reçue:', origin);
    
    // Autoriser requêtes sans origin (Postman, etc.)
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
  credentials: true, // ⚠️ CRITIQUE pour les cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Set-Cookie'],
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
// POSTGRESQL POOL
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

initPool(pool);
app.locals.pool = pool;

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erreur connexion DB:', err.message);
  } else {
    console.log('✅ Connecté à Supabase PostgreSQL');
    release();
  }
});

pool.on('error', (err) => {
  console.error('❌ Erreur pool PostgreSQL:', err);
});

// ============================================
// MIDDLEWARES DE SÉCURITÉ
// ============================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
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
  message: 'Trop de tentatives de connexion'
});

// ============================================
// BODY PARSER
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// CONFIGURATION SESSION - VERSION CORRIGÉE POUR MOBILE
// ============================================

const isProduction = process.env.NODE_ENV === 'production';

const sessionConfig = {
  store: new pgSession({
    pool: pool,
    tableName: 'sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15 // Nettoyer toutes les 15 minutes
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: process.env.SESSION_COOKIE_NAME || 'restaurant_session',
  cookie: {
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 24 * 60 * 60 * 1000, // 24h
    httpOnly: true, // Sécurité XSS
    secure: isProduction, // HTTPS en production
    sameSite: isProduction ? 'none' : 'lax', // ⚠️ CRITIQUE pour cross-domain
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined, // Auto-detect
    path: '/'
  },
  rolling: true, // Renouveler à chaque requête
  proxy: true // ⚠️ CRITIQUE pour Render
};

console.log('🍪 SESSION CONFIG:');
console.log('  - Environment:', process.env.NODE_ENV);
console.log('  - Cookie Name:', sessionConfig.name);
console.log('  - Secure:', sessionConfig.cookie.secure);
console.log('  - SameSite:', sessionConfig.cookie.sameSite);
console.log('  - HttpOnly:', sessionConfig.cookie.httpOnly);
console.log('  - Domain:', sessionConfig.cookie.domain || 'auto-detect');
console.log('  - MaxAge:', sessionConfig.cookie.maxAge / 1000 / 60, 'minutes');
console.log('  - Proxy:', sessionConfig.proxy);

app.use(session(sessionConfig));

// ============================================
// MIDDLEWARE DE DEBUG SESSION
// ============================================
app.use((req, res, next) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log('  📍 Origin:', req.headers.origin || 'none');
  console.log('  🔒 Protocol:', req.protocol);
  console.log('  🌐 Secure:', req.secure);
  console.log('  🍪 SessionID:', req.sessionID ? req.sessionID.substring(0, 8) + '...' : 'none');
  console.log('  👤 UserId:', req.session?.userId || 'none');
  
  if (req.headers.cookie) {
    console.log('  📦 Cookies reçus:', req.headers.cookie.substring(0, 50) + '...');
  }
  
  next();
});

// ============================================
// MIDDLEWARE DE LOGGING
// ============================================
app.use((req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Logger les cookies envoyés
    const setCookie = res.getHeader('Set-Cookie');
    if (setCookie) {
      console.log('  ✉️ Set-Cookie envoyé:', JSON.stringify(setCookie).substring(0, 100));
    }
    
    originalSend.call(this, data);
  };
  
  next();
});

// ============================================
// ROUTES
// ============================================

app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'API Restaurant - Serveur opérationnel',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    session: {
      configured: true,
      secure: sessionConfig.cookie.secure,
      sameSite: sessionConfig.cookie.sameSite,
      httpOnly: sessionConfig.cookie.httpOnly,
      domain: sessionConfig.cookie.domain || 'auto-detect'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    session: req.session?.userId ? 'active' : 'none',
    database: 'connected'
  });
});

// Test de session
app.get('/test-session', (req, res) => {
  if (!req.session.views) {
    req.session.views = 0;
  }
  req.session.views++;
  
  res.json({
    message: 'Session test',
    sessionID: req.sessionID,
    views: req.session.views,
    userId: req.session.userId || null,
    cookie: req.session.cookie
  });
});

// Routes principales
app.use('/auth', authLimiter, authRoutes);
app.use('/settings', settingsRoutes);
app.use('/users', userRoutes);
app.use('/reservations', reservationRoutes);
app.use('/menus', menusRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/categories', categoriesRoutes);
app.use('/dishes', dishesRoutes);
app.use('/favorites', favoritesRoutes);

// ============================================
// GESTION ERREURS 404
// ============================================
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route non trouvée',
    path: req.path,
    method: req.method
  });
});

// ============================================
// GESTION ERREURS GLOBALE
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err);
  console.error('Stack:', err.stack);
  
  const errorMessage = isProduction 
    ? 'Erreur serveur interne' 
    : err.message;
  
  res.status(err.status || 500).json({ 
    error: errorMessage,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: err.toString()
    })
  });
});

// ============================================
// DÉMARRAGE SERVEUR
// ============================================
const server = app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log(`║  🚀 Serveur démarré sur port ${PORT}   ║`);
  console.log(`║  🌍 Environment: ${(process.env.NODE_ENV || 'development').padEnd(17)}║`);
  console.log(`║  🔗 URL: http://localhost:${PORT}       ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});

// ============================================
// ARRÊT GRACIEUX
// ============================================
const gracefulShutdown = () => {
  console.log('\n⏳ Arrêt du serveur...');
  
  server.close(() => {
    console.log('✅ Serveur HTTP fermé');
    
    pool.end(() => {
      console.log('✅ Pool DB fermé');
      process.exit(0);
    });
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