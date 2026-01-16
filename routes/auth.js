// backend/routes/auth.js - VERSION JWT
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();

// ============================================
// CONFIGURATION JWT
// ============================================
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRY = '7d'; // 7 jours

// ============================================
// UTILITAIRES JWT
// ============================================
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION JWT
// ============================================
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Non authentifié',
      message: 'Token manquant ou invalide'
    });
  }
  
  const token = authHeader.substring(7); // Enlever "Bearer "
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ 
      error: 'Token invalide ou expiré' 
    });
  }
  
  req.userId = decoded.userId;
  req.userEmail = decoded.email;
  req.userRole = decoded.role;
  
  next();
};

// ============================================
// UTILITAIRES VALIDATION
// ============================================
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isStrongPassword = (password) => {
  return password.length >= 6;
};

const getClientIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.connection.remoteAddress || 
         req.ip;
};

const isAccountLocked = async (pool, email) => {
  const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
  const lockoutDuration = parseInt(process.env.LOCKOUT_DURATION_MINUTES) || 15;
  
  const result = await pool.query(
    `SELECT COUNT(*) as attempts 
     FROM login_attempts 
     WHERE email = $1 
     AND success = false 
     AND attempted_at > NOW() - INTERVAL '${lockoutDuration} minutes'`,
    [email]
  );
  
  return parseInt(result.rows[0].attempts) >= maxAttempts;
};

const logLoginAttempt = async (pool, email, ip, success, userAgent) => {
  await pool.query(
    `INSERT INTO login_attempts (email, ip_address, success, user_agent) 
     VALUES ($1, $2, $3, $4)`,
    [email, ip, success, userAgent]
  );
};

// ============================================
// ROUTES
// ============================================

/**
 * POST /auth/register
 * Inscription avec JWT
 */
router.post('/register', async (req, res) => {
  const { firstname, lastname, email, password } = req.body;
  const pool = req.app.locals.pool;
  
  try {
    // Validation
    if (!firstname || !lastname || !email || !password) {
      return res.status(400).json({ 
        error: 'Tous les champs sont requis' 
      });
    }
    
    if (firstname.trim().length < 2 || lastname.trim().length < 2) {
      return res.status(400).json({ 
        error: 'Le prénom et le nom doivent contenir au moins 2 caractères' 
      });
    }
    
    if (!isValidEmail(email)) {
      return res.status(400).json({ 
        error: 'Email invalide' 
      });
    }
    
    if (!isStrongPassword(password)) {
      return res.status(400).json({ 
        error: 'Le mot de passe doit contenir au moins 6 caractères' 
      });
    }
    
    // Vérifier email existant
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        error: 'Cet email est déjà utilisé' 
      });
    }
    
    // Hasher le mot de passe
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Créer l'utilisateur
    const result = await pool.query(
      `INSERT INTO users (firstname, lastname, email, password_hash, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, firstname, lastname, email, role, created_at`,
      [
        firstname.trim(),
        lastname.trim(),
        email.toLowerCase(),
        passwordHash,
        'user'
      ]
    );
    
    const newUser = result.rows[0];
    
    // Générer le token JWT
    const token = generateToken(newUser);
    
    console.log(`✅ Nouvel utilisateur créé: ${newUser.email} (ID: ${newUser.id})`);
    
    // Réponse avec token
    res.status(201).json({
      message: 'Compte créé avec succès',
      token,
      user: {
        id: newUser.id,
        firstname: newUser.firstname,
        lastname: newUser.lastname,
        email: newUser.email,
        role: newUser.role,
        createdAt: newUser.created_at
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur inscription:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la création du compte' 
    });
  }
});

/**
 * POST /auth/login
 * Connexion avec JWT
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const pool = req.app.locals.pool;
  const clientIp = getClientIp(req);
  const userAgent = req.headers['user-agent'];
  
  try {
    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email et mot de passe requis' 
      });
    }
    
    // Vérifier blocage
    const locked = await isAccountLocked(pool, email.toLowerCase());
    if (locked) {
      const lockoutMinutes = process.env.LOCKOUT_DURATION_MINUTES || 15;
      return res.status(429).json({ 
        error: `Compte temporairement bloqué. Réessayez dans ${lockoutMinutes} minutes.` 
      });
    }
    
    // Récupérer l'utilisateur
    const result = await pool.query(
      `SELECT id, email, password_hash, firstname, lastname, role, is_active 
       FROM users 
       WHERE email = $1`,
      [email.toLowerCase()]
    );
    
    if (result.rows.length === 0) {
      await logLoginAttempt(pool, email.toLowerCase(), clientIp, false, userAgent);
      return res.status(401).json({ 
        error: 'Email ou mot de passe incorrect' 
      });
    }
    
    const user = result.rows[0];
    
    // Vérifier compte actif
    if (!user.is_active) {
      return res.status(403).json({ 
        error: 'Compte désactivé. Contactez l\'administrateur.' 
      });
    }
    
    // Vérifier mot de passe
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordMatch) {
      await logLoginAttempt(pool, email.toLowerCase(), clientIp, false, userAgent);
      return res.status(401).json({ 
        error: 'Email ou mot de passe incorrect' 
      });
    }
    
    // Connexion réussie
    await logLoginAttempt(pool, email.toLowerCase(), clientIp, true, userAgent);
    
    // Mettre à jour dernière connexion
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    // Générer le token JWT
    const token = generateToken(user);
    
    console.log(`✅ Connexion réussie: ${user.email} (IP: ${clientIp})`);
    
    // Réponse avec token
    res.json({
      message: 'Connexion réussie',
      token,
      user: {
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur connexion:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la connexion' 
    });
  }
});

/**
 * POST /auth/logout
 * Déconnexion (côté client uniquement avec JWT)
 */
router.post('/logout', requireAuth, (req, res) => {
  console.log(`✅ Déconnexion: ${req.userEmail}`);
  res.json({ 
    message: 'Déconnexion réussie',
    // Avec JWT, le client doit supprimer le token
  });
});

/**
 * GET /auth/me
 * Récupérer l'utilisateur connecté
 */
router.get('/me', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      `SELECT id, firstname, lastname, email, role, phone, avatar_url, 
              email_verified, created_at, last_login 
       FROM users 
       WHERE id = $1`,
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    res.json({ user: result.rows[0] });
    
  } catch (error) {
    console.error('❌ Erreur récupération utilisateur:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération des données' 
    });
  }
});

/**
 * GET /auth/check
 * Vérifier le token
 */
router.get('/check', requireAuth, (req, res) => {
  res.json({ 
    authenticated: true,
    userId: req.userId,
    email: req.userEmail,
    role: req.userRole
  });
});

/**
 * POST /auth/refresh
 * Rafraîchir le token
 */
router.post('/refresh', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      'SELECT id, email, role FROM users WHERE id = $1 AND is_active = true',
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    const newToken = generateToken(result.rows[0]);
    
    res.json({
      message: 'Token rafraîchi',
      token: newToken
    });
    
  } catch (error) {
    console.error('❌ Erreur refresh token:', error);
    res.status(500).json({ 
      error: 'Erreur lors du rafraîchissement du token' 
    });
  }
});

module.exports = router;
module.exports.requireAuth = requireAuth;