const express = require('express');
const pool    = require('../db');
const auth    = require('../middlewares/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Products
 *   description: 못난이 농산물 상품 & 장바구니 API
 */

/**
 * @swagger
 * /products:
 *   get:
 *     tags: [Products]
 *     summary: 상품 목록 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: 카테고리 필터
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: 상품 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       name: { type: string }
 *                       price: { type: integer }
 *                       category: { type: string }
 *                       image_url: { type: string }
 *                       in_stock: { type: boolean }
 */

/**
 * @swagger
 * /products/cart:
 *   post:
 *     tags: [Products]
 *     summary: 장바구니에 상품 추가 (이미 있으면 수량 증가)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id]
 *             properties:
 *               product_id: { type: string }
 *               quantity: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: 추가 완료
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *   get:
 *     tags: [Products]
 *     summary: 장바구니 조회
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 장바구니 목록 및 합계
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       quantity: { type: integer }
 *                       id: { type: string }
 *                       name: { type: string }
 *                       price: { type: integer }
 *                 total: { type: integer }
 */

// GET /products — 상품 목록 (어글리어스 연동 전 DB 기반)
router.get('/', auth, async (req, res) => {
  const { category, limit = 20, offset = 0 } = req.query;

  try {
    let query = 'SELECT * FROM products WHERE in_stock = 1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY name DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const [products] = await pool.query(query, params);
    return res.json({ products });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '조회 실패' });
  }
});

// POST /products/cart — 장바구니 추가
router.post('/cart', auth, async (req, res) => {
  const { userId } = req.user;
  const { product_id, quantity = 1 } = req.body;

  try {
    await pool.query(
      `INSERT INTO cart_items (id, user_id, product_id, quantity)
       VALUES (UUID(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
      [userId, product_id, quantity, quantity]
    );
    return res.json({ message: '장바구니에 추가됐어요' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '추가 실패' });
  }
});

// GET /products/cart — 장바구니 조회
router.get('/cart', auth, async (req, res) => {
  const { userId } = req.user;

  try {
    const [items] = await pool.query(
      `SELECT c.quantity, p.*
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       WHERE c.user_id = ?`,
      [userId]
    );

    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return res.json({ items, total });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '조회 실패' });
  }
});

// POST /products/orders — 주문 생성
router.post('/orders', auth, async (req, res) => {
  const { userId } = req.user;
  const { payment_method, coupon_discount = 0, points_used = 0 } = req.body;

  try {
    // 장바구니 조회
    const [items] = await pool.query(
      `SELECT c.quantity, p.id as product_id, p.price
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       WHERE c.user_id = ?`,
      [userId]
    );

    if (!items.length) {
      return res.status(400).json({ message: '장바구니가 비었어요' });
    }

    const subtotal    = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const final_price = subtotal - coupon_discount - points_used;

    // 주문 저장
    const orderId = require('uuid').v4();
    await pool.query(
      `INSERT INTO orders
        (id, user_id, subtotal, coupon_discount, points_used, final_price, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orderId, userId, subtotal, coupon_discount, points_used, final_price, payment_method]
    );

    // 주문 항목 저장
    const orderItems = items.map(i => [
      require('uuid').v4(), orderId, i.product_id, i.quantity, i.price
    ]);
    await pool.query(
      'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES ?',
      [orderItems]
    );

    // 포인트 사용했으면 차감
    if (points_used > 0) {
      await pool.query(
        'UPDATE user_points SET balance = balance - ? WHERE user_id = ?',
        [points_used, userId]
      );
    }

    // 장바구니 비우기
    await pool.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);

    return res.json({ order_id: orderId, final_price, message: '주문 완료' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '주문 실패' });
  }
});

module.exports = router;