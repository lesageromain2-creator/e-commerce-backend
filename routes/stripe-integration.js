/**
 * Routes API - Intégration Stripe
 * POST /api/stripe/create-checkout - Créer session Stripe Checkout
 * POST /api/stripe/webhook - Webhook Stripe
 * POST /api/stripe/sync-product - Synchroniser produit avec Stripe
 * POST /api/stripe/sync-all-products - Synchroniser tous les produits
 */

const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { verifyToken, isAdmin } = require('../middleware/auths');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ============================================
// POST /api/stripe/create-checkout
// ============================================
router.post('/create-checkout', verifyToken, async (req, res, next) => {
  try {
    const { cartId, shippingAddress, billingAddress } = req.body;
    const userId = req.user.id;

    // Récupérer le panier
    const cart = await db.query('SELECT * FROM carts WHERE id = $1 AND user_id = $2', [cartId, userId]);
    if (cart.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Panier non trouvé',
      });
    }

    // Récupérer les items du panier
    const cartItems = await db.query(
      `SELECT 
        ci.*,
        p.name as product_name,
        p.featured_image,
        p.slug,
        p.stripe_product_id,
        p.stripe_price_id,
        pv.name as variant_name,
        pv.stripe_price_id as variant_stripe_price_id
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_variants pv ON ci.variant_id = pv.id
      WHERE ci.cart_id = $1`,
      [cartId]
    );

    if (cartItems.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Panier vide',
      });
    }

    // Créer les line_items pour Stripe
    const lineItems = await Promise.all(
      cartItems.rows.map(async (item) => {
        // Si le produit n'a pas de price_id Stripe, le créer
        let priceId = item.variant_stripe_price_id || item.stripe_price_id;

        if (!priceId) {
          // Créer le produit Stripe si nécessaire
          let stripeProductId = item.stripe_product_id;
          if (!stripeProductId) {
            const stripeProduct = await stripe.products.create({
              name: item.product_name,
              description: item.variant_name ? `${item.product_name} - ${item.variant_name}` : item.product_name,
              images: item.featured_image ? [item.featured_image] : [],
              metadata: {
                product_id: item.product_id,
                variant_id: item.variant_id || '',
              },
            });
            stripeProductId = stripeProduct.id;

            // Enregistrer l'ID Stripe dans la BDD
            await db.query(
              'UPDATE products SET stripe_product_id = $1 WHERE id = $2',
              [stripeProductId, item.product_id]
            );
          }

          // Créer le prix Stripe
          const stripePrice = await stripe.prices.create({
            product: stripeProductId,
            unit_amount: Math.round(item.price_snapshot * 100), // Centimes
            currency: 'eur',
          });
          priceId = stripePrice.id;

          // Enregistrer le price_id
          if (item.variant_id) {
            await db.query(
              'UPDATE product_variants SET stripe_price_id = $1 WHERE id = $2',
              [priceId, item.variant_id]
            );
          } else {
            await db.query(
              'UPDATE products SET stripe_price_id = $1 WHERE id = $2',
              [priceId, item.product_id]
            );
          }
        }

        return {
          price: priceId,
          quantity: item.quantity,
        };
      })
    );

    // Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cart`,
      customer_email: req.user.email,
      client_reference_id: cartId,
      metadata: {
        user_id: userId,
        cart_id: cartId,
        shipping_address: JSON.stringify(shippingAddress),
        billing_address: JSON.stringify(billingAddress),
      },
      shipping_address_collection: {
        allowed_countries: ['FR', 'BE', 'CH', 'LU', 'MC'],
      },
    });

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Erreur création checkout Stripe:', error);
    next(error);
  }
});

// ============================================
// POST /api/stripe/create-checkout-from-order
// Crée une session Stripe Checkout à partir d'une commande (redirection page Stripe)
// ============================================
router.post('/create-checkout-from-order', async (req, res, next) => {
  try {
    const { orderId, successUrl, cancelUrl } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId requis' });
    }

    const orderResult = await db.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Commande non trouvée' });
    }
    const order = orderResult.rows[0];

    const itemsResult = await db.query(
      `SELECT oi.*, p.stripe_product_id, p.stripe_price_id, pv.stripe_price_id as variant_stripe_price_id
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       LEFT JOIN product_variants pv ON oi.variant_id = pv.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    const lineItems = await Promise.all(
      itemsResult.rows.map(async (item) => {
        let priceId = item.variant_stripe_price_id || item.stripe_price_id;
        if (!priceId) {
          const stripeProduct = await stripe.products.create({
            name: item.product_name,
            description: item.variant_name ? `${item.product_name} - ${item.variant_name}` : item.product_name,
            metadata: { product_id: item.product_id, variant_id: item.variant_id || '' },
          });
          const stripePrice = await stripe.prices.create({
            product: stripeProduct.id,
            unit_amount: Math.round(parseFloat(item.price) * 100),
            currency: 'eur',
          });
          priceId = stripePrice.id;
          if (item.variant_id) {
            await db.query('UPDATE product_variants SET stripe_price_id = $1 WHERE id = $2', [priceId, item.variant_id]);
          } else {
            await db.query('UPDATE products SET stripe_price_id = $1 WHERE id = $2', [priceId, item.product_id]);
          }
        }
        return { price: priceId, quantity: item.quantity };
      })
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl || `${frontendUrl}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${frontendUrl}/checkout`,
      customer_email: order.guest_email || undefined,
      client_reference_id: order.order_number,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
      },
    });

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Erreur create-checkout-from-order:', error);
    next(error);
  }
});

// ============================================
// POST /api/stripe/webhook - Webhook Stripe
// ============================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Traiter l'événement
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        console.log('✅ PaymentIntent succeeded:', paymentIntent.id);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        console.log('❌ PaymentIntent failed:', paymentIntent.id);
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Erreur traitement webhook:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// ============================================
// POST /api/stripe/sync-product - Sync un produit
// ============================================
router.post('/sync-product', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const { productId } = req.body;

    const product = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (product.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé',
      });
    }

    const prod = product.rows[0];

    // Créer/Mettre à jour dans Stripe
    let stripeProductId = prod.stripe_product_id;

    if (stripeProductId) {
      // Mettre à jour
      await stripe.products.update(stripeProductId, {
        name: prod.name,
        description: prod.short_description || prod.description,
        images: prod.images?.slice(0, 8) || [],
        active: prod.status === 'active',
      });
    } else {
      // Créer
      const stripeProduct = await stripe.products.create({
        name: prod.name,
        description: prod.short_description || prod.description,
        images: prod.images?.slice(0, 8) || [],
        metadata: {
          product_id: prod.id,
          sku: prod.sku,
        },
      });
      stripeProductId = stripeProduct.id;
      await db.query('UPDATE products SET stripe_product_id = $1 WHERE id = $2', [stripeProductId, prod.id]);
    }

    // Créer le prix
    const stripePrice = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: Math.round(parseFloat(prod.price) * 100),
      currency: prod.currency.toLowerCase(),
    });

    await db.query('UPDATE products SET stripe_price_id = $1 WHERE id = $2', [stripePrice.id, prod.id]);

    res.json({
      success: true,
      message: 'Produit synchronisé avec Stripe',
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePrice.id,
    });
  } catch (error) {
    console.error('Erreur sync Stripe:', error);
    next(error);
  }
});

// ============================================
// POST /api/stripe/sync-all-products
// ============================================
router.post('/sync-all-products', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const products = await db.query('SELECT * FROM products WHERE status = $1', ['active']);

    let synced = 0;
    let errors = 0;

    for (const prod of products.rows) {
      try {
        let stripeProductId = prod.stripe_product_id;

        if (stripeProductId) {
          await stripe.products.update(stripeProductId, {
            name: prod.name,
            description: prod.short_description || prod.description,
            images: prod.images?.slice(0, 8) || [],
          });
        } else {
          const stripeProduct = await stripe.products.create({
            name: prod.name,
            description: prod.short_description || prod.description,
            images: prod.images?.slice(0, 8) || [],
            metadata: {
              product_id: prod.id,
              sku: prod.sku,
            },
          });
          stripeProductId = stripeProduct.id;
          await db.query('UPDATE products SET stripe_product_id = $1 WHERE id = $2', [stripeProductId, prod.id]);
        }

        if (!prod.stripe_price_id) {
          const stripePrice = await stripe.prices.create({
            product: stripeProductId,
            unit_amount: Math.round(parseFloat(prod.price) * 100),
            currency: prod.currency.toLowerCase(),
          });
          await db.query('UPDATE products SET stripe_price_id = $1 WHERE id = $2', [stripePrice.id, prod.id]);
        }

        synced++;
      } catch (err) {
        console.error(`Erreur sync produit ${prod.id}:`, err);
        errors++;
      }
    }

    res.json({
      success: true,
      message: `${synced} produits synchronisés, ${errors} erreurs`,
      synced,
      errors,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// HELPER: Traiter checkout complété
// ============================================
async function handleCheckoutCompleted(session) {
  const { order_id, order_number } = session.metadata || {};

  // Flux "commande déjà créée" (create-checkout-from-order) : on met juste à jour la commande
  if (order_id) {
    const paymentIntentId = session.payment_intent || session.id;
    await db.query(
      `UPDATE orders SET
        payment_method = 'stripe',
        payment_status = 'paid',
        status = 'processing',
        paid_at = NOW(),
        stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $1)
       WHERE id = $2`,
      [paymentIntentId, order_id]
    );
    console.log(`✅ Commande ${order_number || order_id} marquée payée (Stripe Checkout)`);
    return;
  }

  // Ancien flux (panier → Checkout) : créer la commande à partir du panier
  const { user_id, cart_id, shipping_address, billing_address } = session.metadata || {};

  const cartItems = await db.query(
    `SELECT ci.*, p.name as product_name, p.sku, p.featured_image, pv.name as variant_name
     FROM cart_items ci
     JOIN products p ON ci.product_id = p.id
     LEFT JOIN product_variants pv ON ci.variant_id = pv.id
     WHERE ci.cart_id = $1`,
    [cart_id]
  );

  if (cartItems.rows.length === 0) {
    console.warn('checkout.session.completed: panier vide ou inconnu, cart_id=', cart_id);
    return;
  }

  const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  const subtotal = cartItems.rows.reduce((sum, item) => sum + parseFloat(item.price_snapshot) * item.quantity, 0);

  const orderResult = await db.query(
    `INSERT INTO orders (
      order_number, user_id, billing_address, shipping_address,
      subtotal, total_amount, payment_method, payment_status,
      stripe_payment_intent_id, status, paid_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    RETURNING *`,
    [
      orderNumber,
      user_id,
      JSON.parse(billing_address || '{}'),
      JSON.parse(shipping_address || '{}'),
      subtotal,
      session.amount_total / 100,
      'stripe',
      'paid',
      session.payment_intent,
      'processing',
    ]
  );

  const orderId = orderResult.rows[0].id;

  for (const item of cartItems.rows) {
    await db.query(
      `INSERT INTO order_items (
        order_id, product_id, variant_id, product_name, variant_name,
        sku, price, quantity, subtotal, image_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        orderId,
        item.product_id,
        item.variant_id,
        item.product_name,
        item.variant_name,
        item.sku,
        item.price_snapshot,
        item.quantity,
        parseFloat(item.price_snapshot) * item.quantity,
        item.featured_image,
      ]
    );

    if (item.variant_id) {
      await db.query(
        'UPDATE product_variants SET stock_quantity = stock_quantity - $1 WHERE id = $2',
        [item.quantity, item.variant_id]
      );
    } else {
      await db.query(
        'UPDATE products SET stock_quantity = stock_quantity - $1, sales_count = sales_count + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }
  }

  await db.query('DELETE FROM cart_items WHERE cart_id = $1', [cart_id]);
  console.log(`✅ Commande ${orderNumber} créée suite au paiement Stripe (panier)`);
}

module.exports = router;
