/**
 * Middleware - Vérification des rôles
 */

// Vérifier si l'utilisateur est dropshipper ou admin
const isDropshipperOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Non authentifié',
    });
  }

  if (req.user.role === 'admin' || req.user.role === 'dropshipper') {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Accès refusé - Rôle dropshipper ou admin requis',
  });
};

// Vérifier si l'utilisateur est dropshipper
const isDropshipper = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Non authentifié',
    });
  }

  if (req.user.role === 'dropshipper') {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Accès refusé - Rôle dropshipper requis',
  });
};

module.exports = {
  isDropshipperOrAdmin,
  isDropshipper,
};
