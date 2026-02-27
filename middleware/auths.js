// backend/middleware/auths.js - VERSION JWT
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// ============================================
// UTILITAIRE - Vérifier le token JWT
// ============================================
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('❌ Token invalide:', error.message);
    return null;
  }
};

// ============================================
// MIDDLEWARE - Authentification JWT requise
// ============================================
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Non authentifié',
      message: 'Token d\'authentification manquant ou invalide'
    });
  }
  
  const token = authHeader.substring(7); // Enlever "Bearer "
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ 
      error: 'Token invalide ou expiré',
      message: 'Veuillez vous reconnecter'
    });
  }
  
  // Attacher les infos utilisateur à la requête
  req.userId = decoded.userId;
  req.userEmail = decoded.email;
  req.userRole = decoded.role;
  
  next();
};

// ============================================
// MIDDLEWARE - Rôle Admin requis
// ============================================
const requireAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Non authentifié' 
    });
  }
  
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ 
      error: 'Token invalide' 
    });
  }
  
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Utilisateur non trouvé' 
      });
    }
    
    if (result.rows[0].role !== 'admin') {
      return res.status(403).json({ 
        error: 'Accès non autorisé',
        message: 'Vous devez être administrateur pour accéder à cette ressource'
      });
    }
    
    // Attacher les infos
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = result.rows[0].role;
    
    next();
  } catch (error) {
    console.error('❌ Erreur vérification admin:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la vérification des permissions' 
    });
  }
};



// ============================================
// MIDDLEWARE - Rôle Staff requis
// ============================================
const requireStaff = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Non authentifié' 
    });
  }
  
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ 
      error: 'Token invalide' 
    });
  }
  
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Utilisateur non trouvé' 
      });
    }
    
    const userRole = result.rows[0].role;
    
    if (userRole !== 'admin' && userRole !== 'staff') {
      return res.status(403).json({ 
        error: 'Accès non autorisé',
        message: 'Vous devez être membre du personnel pour accéder à cette ressource'
      });
    }
    
    // Attacher les infos
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = userRole;
    
    next();
  } catch (error) {
    console.error('❌ Erreur vérification staff:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la vérification des permissions' 
    });
  }
};

// ============================================
// MIDDLEWARE - Compte actif requis
// ============================================
const requireActiveAccount = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Non authentifié' 
    });
  }
  
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ 
      error: 'Token invalide' 
    });
  }
  
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      'SELECT is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Utilisateur non trouvé' 
      });
    }
    
    if (!result.rows[0].is_active) {
      return res.status(403).json({ 
        error: 'Compte désactivé',
        message: 'Votre compte a été désactivé. Contactez l\'administrateur.'
      });
    }
    
    // Attacher les infos
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    
    next();
  } catch (error) {
    console.error('❌ Erreur vérification compte actif:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la vérification du compte' 
    });
  }
};

// ============================================
// MIDDLEWARE - Authentification optionnelle
// ============================================
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Pas de token = pas grave, on continue
    return next();
  }
  
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (decoded) {
    const pool = req.app.locals.pool;
    
    try {
      const result = await pool.query(
        'SELECT id, email, name, role, metadata FROM users WHERE id = $1',
        [decoded.userId]
      );
      
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const metadata = user.metadata || {};
        const nameParts = (user.name || '').split(' ');
        
        req.user = {
          ...user,
          firstname: metadata.firstname || nameParts[0] || '',
          lastname: metadata.lastname || nameParts.slice(1).join(' ') || ''
        };
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        req.userRole = decoded.role;
      }
    } catch (error) {
      console.error('❌ Erreur récupération utilisateur optionnel:', error);
    }
  }
  
  next();
};

// ============================================
// MIDDLEWARE - Attacher infos utilisateur
// ============================================
const attachUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return next();
  }
  
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      `SELECT id, email, name, role, is_active, 
              email_verified, image as avatar_url, created_at, metadata
       FROM users 
       WHERE id = $1`,
      [decoded.userId]
    );
    
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const metadata = user.metadata || {};
      const nameParts = (user.name || '').split(' ');
      
      req.user = {
        ...user,
        firstname: metadata.firstname || nameParts[0] || '',
        lastname: metadata.lastname || nameParts.slice(1).join(' ') || ''
      };
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
      req.userRole = decoded.role;
    }
    
    next();
  } catch (error) {
    console.error('❌ Erreur attachement utilisateur:', error);
    next();
  }
};

// ============================================
// MIDDLEWARE - Vérifier propriété ressource
// ============================================
const requireOwnership = (userIdField, location = 'params') => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Non authentifié' 
      });
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ 
        error: 'Token invalide' 
      });
    }
    
    const resourceUserId = req[location][userIdField];
    
    // Les admins peuvent accéder à toutes les ressources
    const pool = req.app.locals.pool;
    const userResult = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    if (userResult.rows[0]?.role === 'admin') {
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
      req.userRole = userResult.rows[0].role;
      return next();
    }
    
    // Vérifier la propriété
    if (resourceUserId !== decoded.userId) {
      return res.status(403).json({ 
        error: 'Accès non autorisé',
        message: 'Vous ne pouvez accéder qu\'à vos propres ressources'
      });
    }
    
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = userResult.rows[0]?.role;
    
    next();
  };
};

module.exports = {
  verifyToken,
  requireAuth,
  requireAdmin,
  isAdmin: requireAdmin, // Alias pour compatibilité
  requireStaff,
  requireActiveAccount,
  optionalAuth,
  attachUser,
  requireOwnership
};



