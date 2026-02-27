// backend/database/db.js
const { Pool } = require('pg');

// Le pool sera passé par le serveur via app.locals
let pool = null;

// Initialiser le pool (appelé depuis server.js)
const initPool = (pgPool) => {
  pool = pgPool;
};

// Fonction pour exécuter une requête qui retourne plusieurs lignes (retourne les rows)
const queryRows = async (text, params = []) => {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  try {
    const result = await pool.query(text, params);
    return result.rows;
  } catch (error) {
    // Ne pas logger les erreurs "table inexistante" (gérées par les routes)
    if (error.code !== '42P01') {
      console.error('Database query error:', error);
    }
    throw error;
  }
};

// Fonction pour exécuter une requête qui retourne une seule ligne
const queryOne = async (text, params = []) => {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  try {
    const result = await pool.query(text, params);
    return result.rows[0] || null;
  } catch (error) {
    if (error.code !== '42P01') {
      console.error('Database queryOne error:', error);
    }
    throw error;
  }
};

// Compatibilité routes qui utilisent const { db } = require('...') et result.rows
const db = {
  async query(text, params = []) {
    const rows = await queryRows(text, params);
    return { rows };
  },
  queryOne,
};

// Fonction pour obtenir le pool directement (utile pour les transactions)
const getPool = () => {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  return pool;
};

module.exports = {
  initPool,
  query: queryRows,
  queryOne,
  getPool,
  get pool() {
    return pool;
  },
  db,
};