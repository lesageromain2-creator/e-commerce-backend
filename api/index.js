// Backend API pour Vercel Serverless Functions
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { initPool } = require('../database/db.js');
const { initEmailService } = require('../services/emailService.js');

// Import des routes
const authRoutes = require('../routes/auth.js');
const reservationRoutes = require('../routes/reservations.js');
const adminRoutes = require('../routes/admin.js');

const app = express();

// Configuration CORS pour Vercel
app.use(cors({
  origin: [
    'https://lesagedev.vercel.app',
    'https://lesagedev.com',
    /^https:\/\/lesagedev.*\.vercel\.app$/,
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variables de debug pour production
console.log('🔧 Configuration Production:');
console.log('  📍 NODE_ENV:', process.env.NODE_ENV);
console.log('  📧 EMAIL_PROVIDER:', process.env.EMAIL_PROVIDER);
console.log('  🌐 SMTP_HOST:', process.env.SMTP_HOST);
console.log('  👤 SMTP_USER:', process.env.SMTP_USER);
console.log('  📊 DATABASE_URL:', process.env.DATABASE_URL ? '✅ Configuré' : '❌ Manquant');

// Initialisation base de données
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 60000,
  idleTimeoutMillis: 30000,
  max: 5,
  min: 0,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  application_name: 'lesage_vercel_backend',
  statement_timeout: 30000
};

const pool = new Pool(poolConfig);
initPool(pool);

// Initialisation service email
initEmailService();

// Middleware pour passer le pool aux routes
app.use((req, res, next) => {
  req.app.locals.pool = pool;
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/reservations', reservationRoutes);
app.use('/admin', adminRoutes);

// Route de test pour vérifier la configuration
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV,
    email_configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    database_configured: !!process.env.DATABASE_URL,
    timestamp: new Date().toISOString()
  });
});

// Route de test email
app.post('/api/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    const { sendEmail } = require('../services/emailService.js');
    
    const result = await sendEmail({
      to: email || process.env.SMTP_USER,
      toName: 'Test Production',
      subject: 'Test Email Production',
      html: '<h1>Test email depuis production Vercel</h1><p>Ceci est un test pour vérifier que l\'envoi d\'emails fonctionne en production.</p>',
      emailType: 'test'
    });
    
    res.json({ success: true, result });
  } catch (error) {
    console.error('❌ Erreur test email production:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export pour Vercel
module.exports = app;
