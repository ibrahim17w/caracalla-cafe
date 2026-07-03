//server.js
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || 3015;
const JWT_SECRET = process.env.JWT_SECRET || 'caracalla_default_secret';

// PostgreSQL — support Neon DATABASE_URL or individual env vars
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
} else {
  pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'caracalla_cafe',
    password: process.env.DB_PASSWORD || 'your_password',
    port: parseInt(process.env.DB_PORT) || 5432,
  });
}

const os = require('os');

// Multer — store in memory, convert to Base64 data URL
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================== RATE LIMITING =====================
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record) {
    if (record.blockedUntil && now < record.blockedUntil) {
      return { blocked: true, retryAfter: Math.ceil((record.blockedUntil - now) / 1000) };
    }
    if (now > record.blockedUntil) loginAttempts.delete(ip);
  }
  return { blocked: false };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  record.count++;
  if (record.count >= MAX_ATTEMPTS) record.blockedUntil = now + BLOCK_DURATION;
  loginAttempts.set(ip, record);
}

function clearAttempts(ip) { loginAttempts.delete(ip); }

// ===================== AUTH MIDDLEWARE =====================
function verifyToken(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    req.user = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ===================== ORDER RATE LIMITING =====================
const orderLimits = {};
function rateLimitOrders(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  if (!orderLimits[ip]) orderLimits[ip] = [];
  // Keep only requests from last 60 seconds
  orderLimits[ip] = orderLimits[ip].filter(t => now - t < 60000);
  if (orderLimits[ip].length >= 2) {
    return res.status(429).json({ error: 'Too many orders. Please wait a minute.' });
  }
  orderLimits[ip].push(now);
  next();
}

// ===================== AUTH ROUTES =====================
app.post('/api/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const limit = checkRateLimit(ip);
  if (limit.blocked) return res.status(429).json({ error: 'Too many attempts', retryAfter: limit.retryAfter });

  const { role, password } = req.body;
  if (!role || !password) return res.status(400).json({ error: 'Role and password required' });

  const expectedPassword = role === 'owner' ? process.env.OWNER_PASSWORD : process.env.DRIVER_PASSWORD;
  if (!expectedPassword || password !== expectedPassword) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  clearAttempts(ip);
  const token = jwt.sign({ role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, role });
});

// ===================== SETTINGS =====================
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings');
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/settings/:key', async (req, res) => {
  try {
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', [req.params.key]);
    res.json({ value: result.rows[0]?.value || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', verifyToken, requireRole(['owner']), async (req, res) => {
  const { key, value } = req.body;
  try {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP',
      [key, value]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/settings/:key', verifyToken, requireRole(['owner']), async (req, res) => {
  try {
    await pool.query('DELETE FROM settings WHERE key = $1', [req.params.key]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== UPLOAD =====================
app.post('/api/upload', verifyToken, requireRole(['owner']), upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;
    res.json({ path: dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CATEGORIES =====================
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY sort_order, id');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', verifyToken, requireRole(['owner']), upload.single('image'), async (req, res) => {
  const { name, sort_order } = req.body;
  let imagePath = null;
  if (req.file) {
    try {
      const base64 = req.file.buffer.toString('base64');
      imagePath = `data:${req.file.mimetype};base64,${base64}`;
    } catch (e) { imagePath = null; }
  }
  try {
    const result = await pool.query(
      'INSERT INTO categories (name, sort_order, image_path) VALUES ($1, $2, $3) RETURNING *',
      [name, sort_order || 0, imagePath]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/categories/:id', verifyToken, requireRole(['owner']), upload.single('image'), async (req, res) => {
  const { name, sort_order } = req.body;
  try {
    const oldResult = await pool.query('SELECT image_path FROM categories WHERE id = $1', [req.params.id]);
    const oldImage = oldResult.rows[0]?.image_path;
    let imagePath = oldImage;
    if (req.file) {
      try {
        const base64 = req.file.buffer.toString('base64');
        imagePath = `data:${req.file.mimetype};base64,${base64}`;
      } catch (e) { imagePath = oldImage; }
    }
    const result = await pool.query(
      'UPDATE categories SET name=$1, sort_order=$2, image_path=$3 WHERE id=$4 RETURNING *',
      [name, sort_order, imagePath, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/categories/:id', verifyToken, requireRole(['owner']), async (req, res) => {
  try {
    await pool.query('UPDATE items SET category_id = NULL WHERE category_id = $1', [req.params.id]);
    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== ITEMS =====================
app.get('/api/items', async (req, res) => {
  try {
    const itemsResult = await pool.query('SELECT * FROM items ORDER BY category_id, id');
    const items = itemsResult.rows;
    for (let item of items) {
      const addResult = await pool.query('SELECT * FROM item_additions WHERE item_id = $1 ORDER BY id', [item.id]);
      item.additions = addResult.rows;
    }
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    const itemResult = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (itemResult.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    const item = itemResult.rows[0];
    const addResult = await pool.query('SELECT * FROM item_additions WHERE item_id = $1', [item.id]);
    item.additions = addResult.rows;
    res.json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/items', verifyToken, requireRole(['owner']), upload.single('image'), async (req, res) => {
  const { category_id, name, description, price, stock, additions } = req.body;
  let imagePath = null;
  if (req.file) {
    try {
      const base64 = req.file.buffer.toString('base64');
      imagePath = `data:${req.file.mimetype};base64,${base64}`;
    } catch (e) { imagePath = null; }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemResult = await client.query(
      'INSERT INTO items (category_id, name, description, price, stock, image_path) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [category_id || null, name, description || '', price, stock || null, imagePath]
    );
    const item = itemResult.rows[0];
    if (additions) {
      const adds = JSON.parse(additions);
      for (const add of adds) {
        if (add.name) {
          await client.query('INSERT INTO item_additions (item_id, name, price) VALUES ($1, $2, $3)', [item.id, add.name, add.price || 0]);
        }
      }
    }
    await client.query('COMMIT');
    res.json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.put('/api/items/:id/toggle', verifyToken, requireRole(['owner']), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE items SET is_available = NOT is_available WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/items/:id', verifyToken, requireRole(['owner']), upload.single('image'), async (req, res) => {
  const { category_id, name, description, price, stock, is_available, additions } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const oldItem = await client.query('SELECT image_path FROM items WHERE id = $1', [req.params.id]);
    const oldImage = oldItem.rows[0]?.image_path;
    let imagePath = oldImage;
    if (req.file) {
      try {
        const base64 = req.file.buffer.toString('base64');
        imagePath = `data:${req.file.mimetype};base64,${base64}`;
      } catch (e) { imagePath = oldImage; }
    }
    const itemResult = await client.query(
      'UPDATE items SET category_id=$1, name=$2, description=$3, price=$4, stock=$5, image_path=$6, is_available=$7 WHERE id=$8 RETURNING *',
      [category_id || null, name, description || '', price, stock || null, imagePath, is_available === 'true' || is_available === true, req.params.id]
    );
    if (additions) {
      await client.query('DELETE FROM item_additions WHERE item_id = $1', [req.params.id]);
      const adds = JSON.parse(additions);
      for (const add of adds) {
        if (add.name) await client.query('INSERT INTO item_additions (item_id, name, price) VALUES ($1, $2, $3)', [req.params.id, add.name, add.price || 0]);
      }
    }
    await client.query('COMMIT');
    res.json(itemResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.delete('/api/items/:id', verifyToken, requireRole(['owner']), async (req, res) => {
  try {
    await pool.query('DELETE FROM item_additions WHERE item_id = $1', [req.params.id]);
    await pool.query('UPDATE order_items SET item_id = NULL WHERE item_id = $1', [req.params.id]);
    await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== ORDERS =====================
app.get('/api/orders', verifyToken, requireRole(['owner', 'driver']), async (req, res) => {
  const { status } = req.query;
  try {
    let query = 'SELECT * FROM orders';
    const params = [];
    if (status) { query += ' WHERE status = $1'; params.push(status); }
    query += ' ORDER BY created_at DESC';
    const ordersResult = await pool.query(query, params);
    const orders = ordersResult.rows;
    for (let order of orders) {
      const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
      order.items = itemsResult.rows;
      for (let item of order.items) {
        const addResult = await pool.query('SELECT * FROM order_item_additions WHERE order_item_id = $1', [item.id]);
        item.additions = addResult.rows;
      }
      // daily_order_number is now stored in DB, use it directly
      order.daily_order_number = order.daily_order_number || order.id;
    }
    res.json(orders);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Track order by daily order number (for customers)
app.get('/api/orders/track/:dailyNum', async (req, res) => {
  try {
    const today = getSyriaDate();
    const dailyNum = parseInt(req.params.dailyNum);
    if (isNaN(dailyNum)) return res.status(400).json({ error: 'Invalid order number' });
    
    // Look up directly by stored daily_order_number on today's date
    const orderResult = await pool.query(
      "SELECT * FROM orders WHERE daily_order_number = $1 AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Damascus') = $2",
      [dailyNum, today]
    );
    
    if (orderResult.rows.length === 0) {
      // Fallback: try yesterday in case order was placed just before midnight
      const yesterday = getSyriaDate(new Date(Date.now() - 86400000));
      const yestResult = await pool.query(
        "SELECT * FROM orders WHERE daily_order_number = $1 AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Damascus') = $2",
        [dailyNum, yesterday]
      );
      if (yestResult.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
      orderResult.rows = yestResult.rows;
    }
    
    const order = orderResult.rows[0];
    
    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    order.items = itemsResult.rows;
    for (let item of order.items) {
      const addResult = await pool.query('SELECT * FROM order_item_additions WHERE order_item_id = $1', [item.id]);
      item.additions = addResult.rows;
    }
    order.daily_order_number = dailyNum;

    // If caller has the correct token, return full details; otherwise redact private data
    const token = req.query.token;
    let fullAccess = false;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.oid === order.id) fullAccess = true;
      } catch {}
    }
    if (!fullAccess) {
      delete order.phone;
      delete order.latitude;
      delete order.longitude;
      delete order.address_text;
      delete order.customer_name;
    }
    
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    const order = orderResult.rows[0];
    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    order.items = itemsResult.rows;
    for (let item of order.items) {
      const addResult = await pool.query('SELECT * FROM order_item_additions WHERE order_item_id = $1', [item.id]);
      item.additions = addResult.rows;
    }
    // daily_order_number is now stored in DB
    order.daily_order_number = order.daily_order_number || order.id;
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders', rateLimitOrders, async (req, res) => {
  const { customer_name, phone, table_number, order_type, address_text, latitude, longitude, items, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let total = 0;
    for (const it of items) {
      let itemTotal = it.price * it.quantity;
      if (it.additions) { for (const add of it.additions) itemTotal += (add.price || 0) * it.quantity; }
      total += itemTotal;
    }
    // Get today's date in Syria timezone
    const today = getSyriaDate();
    
    // Debug: log what we're searching for
    console.log('Creating order for date:', today);
    
    // Find the highest daily order number for today
    // Use a subquery to handle NULLs properly
    const maxDailyResult = await client.query(
      `SELECT COALESCE((SELECT MAX(daily_order_number) FROM orders 
        WHERE DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Damascus') = $1
        AND daily_order_number IS NOT NULL), 0) as max_num`,
      [today]
    );
    const maxNum = parseInt(maxDailyResult.rows[0].max_num) || 0;
    const nextDailyNum = maxNum + 1;
    console.log('Next daily order number:', nextDailyNum, '(max was:', maxNum, ')');

    const orderResult = await client.query(
      'INSERT INTO orders (customer_name, phone, table_number, order_type, address_text, latitude, longitude, status, total_amount, notes, daily_order_number) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [customer_name || null, phone || null, table_number || null, order_type || 'dine_in', address_text || null, latitude || null, longitude || null, 'pending', total, notes || '', nextDailyNum]
    );
    const order = orderResult.rows[0];
    order.daily_order_number = nextDailyNum;

    // Secure stateless token for this order (customer can cancel/confirm only with this)
    order.customer_token = jwt.sign({ oid: order.id, daily: nextDailyNum }, JWT_SECRET, { expiresIn: '7d' });
    for (const it of items) {
      const itemSubtotal = it.price * it.quantity + (it.additions || []).reduce((s, a) => s + (a.price || 0) * it.quantity, 0);
      const oiResult = await client.query(
        'INSERT INTO order_items (order_id, item_id, item_name, quantity, unit_price, subtotal) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [order.id, it.id, it.name, it.quantity, it.price, itemSubtotal]
      );
      const orderItem = oiResult.rows[0];
      if (it.additions) {
        for (const add of it.additions) {
          await client.query('INSERT INTO order_item_additions (order_item_id, addition_name, addition_price) VALUES ($1, $2, $3)', [orderItem.id, add.name, add.price || 0]);
        }
      }
    }
    await client.query('COMMIT');
    res.json(order);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.put('/api/orders/:id/status', verifyToken, requireRole(['owner', 'driver']), async (req, res) => {
  const { status } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query('SELECT status FROM orders WHERE id = $1', [req.params.id]);
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    const oldStatus = orderResult.rows[0].status;
    const result = await client.query('UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *', [status, req.params.id]);

    // Deduct stock when completing an order
    if (status === 'completed' && oldStatus !== 'completed') {
      const itemsResult = await client.query('SELECT item_id, quantity FROM order_items WHERE order_id = $1', [req.params.id]);
      for (const item of itemsResult.rows) {
        if (item.item_id) {
          await client.query('UPDATE items SET stock = stock - $1 WHERE id = $2 AND stock IS NOT NULL', [item.quantity, item.item_id]);
        }
      }
    }
    // Restore stock if reverting from completed
    else if (oldStatus === 'completed' && status !== 'completed') {
      const itemsResult = await client.query('SELECT item_id, quantity FROM order_items WHERE order_id = $1', [req.params.id]);
      for (const item of itemsResult.rows) {
        if (item.item_id) {
          await client.query('UPDATE items SET stock = stock + $1 WHERE id = $2 AND stock IS NOT NULL', [item.quantity, item.item_id]);
        }
      }
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.delete('/api/orders/:id', verifyToken, requireRole(['owner']), async (req, res) => {
  try {
    await pool.query('DELETE FROM orders WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== CUSTOMER STATUS (token required) =====================
app.put('/api/orders/:id/customer-status', async (req, res) => {
  const { status, token } = req.body;
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.oid !== parseInt(req.params.id)) return res.status(403).json({ error: 'Invalid token' });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (status !== 'completed' && status !== 'cancelled') {
    return res.status(400).json({ error: 'Invalid status for customer' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query('SELECT status FROM orders WHERE id = $1', [req.params.id]);
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    const oldStatus = orderResult.rows[0].status;

    // Validate transitions
    if (status === 'completed' && !['delivering', 'ready'].includes(oldStatus)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot complete order from current status' });
    }
    if (status === 'cancelled' && oldStatus !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Can only cancel pending orders' });
    }

    const result = await client.query('UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *', [status, req.params.id]);

    // Deduct stock when completing
    if (status === 'completed' && oldStatus !== 'completed') {
      const itemsResult = await client.query('SELECT item_id, quantity FROM order_items WHERE order_id = $1', [req.params.id]);
      for (const item of itemsResult.rows) {
        if (item.item_id) {
          await client.query('UPDATE items SET stock = stock - $1 WHERE id = $2 AND stock IS NOT NULL', [item.quantity, item.item_id]);
        }
      }
    }
    // Restore stock if cancelling a completed order (edge case)
    else if (oldStatus === 'completed' && status !== 'completed') {
      const itemsResult = await client.query('SELECT item_id, quantity FROM order_items WHERE order_id = $1', [req.params.id]);
      for (const item of itemsResult.rows) {
        if (item.item_id) {
          await client.query('UPDATE items SET stock = stock + $1 WHERE id = $2 AND stock IS NOT NULL', [item.quantity, item.item_id]);
        }
      }
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ===================== ORDER EDIT (owner only) =====================
app.put('/api/orders/:id', verifyToken, requireRole(['owner']), async (req, res) => {
  const { customer_name, phone, table_number, order_type, address_text, latitude, longitude, status, notes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE orders SET customer_name = $1, phone = $2, table_number = $3, order_type = $4, address_text = $5, latitude = $6, longitude = $7, status = $8, notes = $9, updated_at = CURRENT_TIMESTAMP WHERE id = $10 RETURNING *',
      [customer_name || null, phone || null, table_number || null, order_type || 'dine_in', address_text || null, latitude || null, longitude || null, status, notes || '', req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/orders/:id/items', async (req, res) => {
  const { items } = req.body;
  const orderId = parseInt(req.params.id);
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Items required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderCheck = await client.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    if (orderCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    if (['completed', 'cancelled'].includes(orderCheck.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot modify completed or cancelled order' });
    }

    let totalAdded = 0;
    for (const it of items) {
      let itemTotal = it.price * it.quantity;
      if (it.additions) { for (const add of it.additions) itemTotal += (add.price || 0) * it.quantity; }
      totalAdded += itemTotal;

      const itemSubtotal = it.price * it.quantity + (it.additions || []).reduce((s, a) => s + (a.price || 0) * it.quantity, 0);
      const oiResult = await client.query(
        'INSERT INTO order_items (order_id, item_id, item_name, quantity, unit_price, subtotal) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [orderId, it.id, it.name, it.quantity, it.price, itemSubtotal]
      );
      const orderItem = oiResult.rows[0];
      if (it.additions) {
        for (const add of it.additions) {
          await client.query('INSERT INTO order_item_additions (order_item_id, addition_name, addition_price) VALUES ($1, $2, $3)', [orderItem.id, add.name, add.price || 0]);
        }
      }
    }

    await client.query('UPDATE orders SET total_amount = total_amount + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [totalAdded, orderId]);
    await client.query('COMMIT');
    res.json({ success: true, added_amount: totalAdded });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});
// ===================== QR CODE =====================
app.get('/api/qrcode', async (req, res) => {
  try {
    const url = req.query.url || `${req.protocol}://${req.get('host')}/menu`;
    const qrDataUrl = await QRCode.toDataURL(url);
    res.json({ qr: qrDataUrl, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function getSyriaDate(d = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Damascus', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}
// ===================== STATS =====================
app.get('/api/stats', verifyToken, requireRole(['owner', 'driver']), async (req, res) => {
  try {
    const today = getSyriaDate();
    const pending = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'pending'");
    const preparing = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'preparing'");
    const ready = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'ready'");
    const delivering = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'delivering'");
    const todayOrders = await pool.query("SELECT COUNT(*) FROM orders WHERE DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Damascus') = $1", [today]);
    const todayRevenue = await pool.query("SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Damascus') = $1 AND status != 'cancelled'", [today]);
    res.json({
      pending: parseInt(pending.rows[0].count),
      preparing: parseInt(preparing.rows[0].count),
      ready: parseInt(ready.rows[0].count),
      delivering: parseInt(delivering.rows[0].count),
      todayOrders: parseInt(todayOrders.rows[0].count),
      todayRevenue: parseFloat(todayRevenue.rows[0].coalesce)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== BEST SELLERS =====================
app.get('/api/best-sellers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT item_id, item_name, SUM(quantity) as total_sold
      FROM order_items
      JOIN orders ON orders.id = order_items.order_id
      WHERE orders.status = 'completed' AND orders.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY item_id, item_name
      ORDER BY total_sold DESC
      LIMIT 5
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Clean URLs (no .html) — must come after all API routes
app.get('/menu', (req, res) => res.sendFile(path.join(__dirname, 'public', 'menu.html')));
app.get('/dashboard-k7m3p9', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard-k7m3p9.html')));
app.get('/portal-x4y8z2', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal-x4y8z2.html')));

app.listen(PORT, () => {
  console.log(`Caracalla Cafe server running on port ${PORT}`);
  console.log(`Customer menu: /menu`);
  console.log(`Owner dashboard: /dashboard-k7m3p9`);
  console.log(`Driver portal: /portal-x4y8z2`);
});
