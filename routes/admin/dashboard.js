// backend/routes/admin/dashboard.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../../middleware/auths');
const { getPool } = require('../../database/db');

router.use(requireAuth, requireAdmin);

// ============================================
// GET /admin/dashboard - Vue d'ensemble complète
// ============================================
router.get('/', async (req, res) => {
  try {
    const pool = getPool();

    // Statistiques principales
    const stats = await pool.query(`
      SELECT * FROM admin_dashboard_stats
    `);

    // Activité récente (tous types)
    const recentActivity = await pool.query(`
      SELECT 
        'reservation' as type,
        r.id,
        r.created_at,
        u.firstname || ' ' || u.lastname as user_name,
        u.email as user_email,
        r.reservation_date::text as detail,
        r.status
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      WHERE r.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
      
      UNION ALL
      
      SELECT 
        'project' as type,
        p.id,
        p.created_at,
        u.firstname || ' ' || u.lastname as user_name,
        u.email as user_email,
        p.title as detail,
        p.status
      FROM client_projects p
      JOIN users u ON p.user_id = u.id
      WHERE p.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
      
      UNION ALL
      
      SELECT 
        'message' as type,
        cm.id,
        cm.created_at,
        cm.name as user_name,
        cm.email as user_email,
        cm.subject as detail,
        cm.status
      FROM contact_messages cm
      WHERE cm.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
      
      ORDER BY created_at DESC
      LIMIT 20
    `);

    // Projets nécessitant attention (urgent, bloqué, retard)
    const projectsNeedingAttention = await pool.query(`
      SELECT 
        p.id,
        p.title,
        p.status,
        p.priority,
        p.progress,
        p.estimated_delivery,
        u.firstname,
        u.lastname,
        u.email,
        CASE 
          WHEN p.estimated_delivery < CURRENT_DATE THEN 'overdue'
          WHEN p.estimated_delivery < CURRENT_DATE + INTERVAL '7 days' THEN 'due_soon'
          WHEN p.priority = 'urgent' THEN 'urgent'
          WHEN p.status = 'on_hold' THEN 'on_hold'
          ELSE 'normal'
        END as alert_type
      FROM client_projects p
      JOIN users u ON p.user_id = u.id
      WHERE p.status NOT IN ('completed', 'cancelled')
        AND (
          p.priority IN ('urgent', 'high')
          OR p.status = 'on_hold'
          OR p.estimated_delivery < CURRENT_DATE + INTERVAL '7 days'
        )
      ORDER BY 
        CASE alert_type
          WHEN 'overdue' THEN 1
          WHEN 'urgent' THEN 2
          WHEN 'due_soon' THEN 3
          WHEN 'on_hold' THEN 4
          ELSE 5
        END,
        p.estimated_delivery
      LIMIT 10
    `);

    // Rendez-vous à venir
    const upcomingReservations = await pool.query(`
      SELECT 
        r.*,
        u.firstname,
        u.lastname,
        u.email,
        u.phone,
        u.company_name
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      WHERE r.reservation_date >= CURRENT_DATE
        AND r.status IN ('pending', 'confirmed')
      ORDER BY r.reservation_date, r.reservation_time
      LIMIT 10
    `);

    // Messages non lus
    const unreadMessages = await pool.query(`
      SELECT 
        cm.*,
        (SELECT COUNT(*) FROM contact_message_replies WHERE message_id = cm.id) as reply_count
      FROM contact_messages cm
      WHERE cm.status = 'unread'
      ORDER BY 
        CASE cm.priority 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'normal' THEN 3 
          WHEN 'low' THEN 4 
        END,
        cm.created_at DESC
      LIMIT 10
    `);

    // Nouveaux clients ce mois
    const newClients = await pool.query(`
      SELECT 
        u.id,
        u.firstname,
        u.lastname,
        u.email,
        u.company_name,
        u.created_at,
        COUNT(p.id) as projects_count,
        COUNT(r.id) as reservations_count
      FROM users u
      LEFT JOIN client_projects p ON u.id = p.user_id
      LEFT JOIN reservations r ON u.id = r.user_id
      WHERE u.role = 'client'
        AND u.created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 10
    `);

    // Tendances (évolution sur 6 mois)
    const trends = await pool.query(`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE - INTERVAL '5 months'),
          date_trunc('month', CURRENT_DATE),
          '1 month'::interval
        ) as month
      )
      SELECT 
        to_char(m.month, 'YYYY-MM') as month,
        COUNT(DISTINCT p.id) as projects,
        COUNT(DISTINCT r.id) as reservations,
        COUNT(DISTINCT u.id) as new_clients
      FROM months m
      LEFT JOIN client_projects p ON date_trunc('month', p.created_at) = m.month
      LEFT JOIN reservations r ON date_trunc('month', r.created_at) = m.month
      LEFT JOIN users u ON date_trunc('month', u.created_at) = m.month AND u.role = 'client'
      GROUP BY m.month
      ORDER BY m.month
    `);

    res.json({
      stats: stats.rows[0],
      recent_activity: recentActivity.rows,
      projects_needing_attention: projectsNeedingAttention.rows,
      upcoming_reservations: upcomingReservations.rows,
      unread_messages: unreadMessages.rows,
      new_clients: newClients.rows,
      trends: trends.rows
    });

  } catch (error) {
    console.error('Erreur chargement dashboard:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /admin/dashboard/stats/revenue - Statistiques financières
// ============================================
router.get('/stats/revenue', async (req, res) => {
  try {
    const pool = getPool();

    const revenue = await pool.query(`
      SELECT
        COUNT(*) as total_projects,
        SUM(total_price) as total_revenue,
        SUM(CASE WHEN deposit_paid THEN deposit_amount ELSE 0 END) as deposits_received,
        SUM(CASE WHEN final_paid THEN total_price - COALESCE(deposit_amount, 0) ELSE 0 END) as final_payments_received,
        SUM(CASE WHEN NOT deposit_paid THEN deposit_amount ELSE 0 END) as deposits_pending,
        SUM(CASE WHEN deposit_paid AND NOT final_paid THEN total_price - COALESCE(deposit_amount, 0) ELSE 0 END) as final_payments_pending,
        AVG(total_price) as avg_project_value,
        SUM(CASE WHEN created_at > CURRENT_TIMESTAMP - INTERVAL '30 days' THEN total_price ELSE 0 END) as revenue_this_month,
        SUM(CASE WHEN created_at > CURRENT_TIMESTAMP - INTERVAL '90 days' THEN total_price ELSE 0 END) as revenue_this_quarter
      FROM client_projects
      WHERE status NOT IN ('cancelled')
        AND total_price IS NOT NULL
    `);

    // Revenus par mois (12 derniers mois)
    const monthlyRevenue = await pool.query(`
      SELECT 
        to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
        COUNT(*) as projects_count,
        SUM(total_price) as revenue,
        SUM(CASE WHEN deposit_paid THEN deposit_amount ELSE 0 END) as deposits,
        SUM(CASE WHEN final_paid THEN total_price - COALESCE(deposit_amount, 0) ELSE 0 END) as finals
      FROM client_projects
      WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '12 months'
        AND total_price IS NOT NULL
      GROUP BY date_trunc('month', created_at)
      ORDER BY month DESC
    `);

    // Revenus par type de projet
    const revenueByType = await pool.query(`
      SELECT 
        project_type,
        COUNT(*) as count,
        SUM(total_price) as revenue,
        AVG(total_price) as avg_price
      FROM client_projects
      WHERE total_price IS NOT NULL
        AND status NOT IN ('cancelled')
      GROUP BY project_type
      ORDER BY revenue DESC
    `);

    res.json({
      summary: revenue.rows[0],
      monthly: monthlyRevenue.rows,
      by_type: revenueByType.rows
    });

  } catch (error) {
    console.error('Erreur stats revenus:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /admin/dashboard/activity-logs - Logs d'activité admin
// ============================================
router.get('/activity-logs', async (req, res) => {
  try {
    const pool = getPool();
    const { limit = 50, offset = 0, admin_id, action, entity_type } = req.query;

    let query = `
      SELECT 
        al.*,
        u.firstname,
        u.lastname,
        u.email
      FROM admin_activity_logs al
      JOIN users u ON al.admin_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (admin_id) {
      query += ` AND al.admin_id = $${paramCount}`;
      params.push(admin_id);
      paramCount++;
    }

    if (action) {
      query += ` AND al.action = $${paramCount}`;
      params.push(action);
      paramCount++;
    }

    if (entity_type) {
      query += ` AND al.entity_type = $${paramCount}`;
      params.push(entity_type);
      paramCount++;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      logs: result.rows,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Erreur activity logs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /admin/dashboard/users - Liste des utilisateurs (clients)
// ============================================
router.get('/users', async (req, res) => {
  try {
    const pool = getPool();
    const { search, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        u.*,
        0::bigint as projects_count,
        COUNT(DISTINCT r.id) as reservations_count,
        NULL::numeric as total_spent,
        NULL::timestamptz as last_project_date,
        MAX(r.created_at) as last_reservation_date
      FROM users u
      LEFT JOIN reservations r ON u.id = r.user_id
      WHERE u.role = 'client'
    `;
    const params = [];
    let paramCount = 1;

    if (search) {
      query += ` AND (u.firstname ILIKE $${paramCount} OR u.lastname ILIKE $${paramCount} OR u.email ILIKE $${paramCount} OR u.company_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    query += ` GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const countQuery = `SELECT COUNT(*) FROM users WHERE role = 'client'`;
    const countResult = await pool.query(countQuery);

    res.json({
      users: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Erreur liste utilisateurs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /admin/dashboard/users/:userId - Détails complets d'un utilisateur
// ============================================
router.get('/users/:userId', async (req, res) => {
  try {
    const pool = getPool();
    const { userId } = req.params;

    // Infos utilisateur
    const userResult = await pool.query(`
      SELECT * FROM users WHERE id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Projets
    const projectsResult = await pool.query(`
      SELECT * FROM client_projects
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);

    // Réservations
    const reservationsResult = await pool.query(`
      SELECT * FROM reservations
      WHERE user_id = $1
      ORDER BY reservation_date DESC, reservation_time DESC
    `, [userId]);

    // Notifications
    const notificationsResult = await pool.query(`
      SELECT * FROM user_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId]);

    // Stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(DISTINCT p.id) as total_projects,
        COUNT(DISTINCT r.id) as total_reservations,
        SUM(p.total_price) as total_spent,
        COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'completed') as completed_projects,
        COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('discovery', 'design', 'development', 'testing')) as active_projects
      FROM users u
      LEFT JOIN client_projects p ON u.id = p.user_id
      LEFT JOIN reservations r ON u.id = r.user_id
      WHERE u.id = $1
    `, [userId]);

    res.json({
      user: userResult.rows[0],
      projects: projectsResult.rows,
      reservations: reservationsResult.rows,
      notifications: notificationsResult.rows,
      stats: statsResult.rows[0]
    });

  } catch (error) {
    console.error('Erreur détails utilisateur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// POST /admin/dashboard/notifications/send - Envoyer notification à un utilisateur
// ============================================
router.post('/notifications/send', async (req, res) => {
  try {
    const pool = getPool();
    const { user_id, title, message, type, related_type, related_id } = req.body;

    if (!user_id || !title || !message) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const result = await pool.query(`
      INSERT INTO user_notifications (user_id, title, message, type, related_type, related_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [user_id, title, message, type || 'info', related_type, related_id]);

    await pool.query(`
      INSERT INTO admin_activity_logs (admin_id, action, entity_type, entity_id, description)
      VALUES ($1, 'create', 'notification', $2, $3)
    `, [req.userId, result.rows[0].id, `Notification envoyée à l'utilisateur ${user_id}`]);

    res.json({
      success: true,
      notification: result.rows[0]
    });

  } catch (error) {
    console.error('Erreur envoi notification:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /admin/dashboard/search - Recherche globale
// ============================================
router.get('/search', async (req, res) => {
  try {
    const pool = getPool();
    const { q } = req.query;

    if (!q || q.trim() === '') {
      return res.status(400).json({ error: 'Query manquante' });
    }

    const searchTerm = `%${q}%`;

    // Rechercher dans les projets
    const projects = await pool.query(`
      SELECT 
        'project' as type,
        p.id,
        p.title as name,
        p.status,
        u.firstname || ' ' || u.lastname as client_name
      FROM client_projects p
      JOIN users u ON p.user_id = u.id
      WHERE p.title ILIKE $1 OR p.description ILIKE $1
      LIMIT 10
    `, [searchTerm]);

    // Rechercher dans les clients
    const clients = await pool.query(`
      SELECT 
        'user' as type,
        id,
        firstname || ' ' || lastname as name,
        email,
        company_name
      FROM users
      WHERE role = 'client'
        AND (firstname ILIKE $1 OR lastname ILIKE $1 OR email ILIKE $1 OR company_name ILIKE $1)
      LIMIT 10
    `, [searchTerm]);

    // Rechercher dans les messages
    const messages = await pool.query(`
      SELECT 
        'message' as type,
        id,
        subject as name,
        status,
        name as client_name
      FROM contact_messages
      WHERE subject ILIKE $1 OR message ILIKE $1 OR name ILIKE $1
      LIMIT 10
    `, [searchTerm]);

    res.json({
      results: {
        projects: projects.rows,
        clients: clients.rows,
        messages: messages.rows
      },
      total: projects.rows.length + clients.rows.length + messages.rows.length
    });

  } catch (error) {
    console.error('Erreur recherche:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;