/**
 * Upload d'images produit (stockage serveur)
 * POST /upload/product-image — multipart/form-data, champ "image"
 * Réponse: { success: true, url: "http://localhost:5000/uploads/products/xxx.jpg" }
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAdmin } = require('../middleware/auths');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products');
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Créer le dossier uploads/products si besoin
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
  console.warn('Upload dir creation:', err.message);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/jpe?g/, 'jpg');
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Type de fichier non autorisé. Utilisez JPEG, PNG, WebP ou GIF.'));
    }
    cb(null, true);
  },
});

router.post(
  '/product-image',
  requireAdmin,
  upload.single('image'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier envoyé. Utilisez le champ "image".',
      });
    }
    // URL absolue pour que la boutique (frontend) puisse afficher l'image (même origine ou CORS)
    const baseUrl = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl.replace(/\/$/, '')}/uploads/products/${req.file.filename}`;
    return res.json({ success: true, url });
  },
  (err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Fichier trop volumineux (max 5 Mo).' });
      }
    }
    return res.status(400).json({
      success: false,
      message: err.message || 'Erreur lors de l\'upload.',
    });
  }
);

module.exports = router;
