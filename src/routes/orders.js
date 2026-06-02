const express = require('express');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');
const pool    = require('../db');
const auth    = require('../middlewares/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: 주문 및 결제 API (토스페이먼츠)
 */

/**
 * @swagger
 * /orders/prepare:
 *   post:
 *     tags: [Orders]
 *     summary: 주문 준비 — 토스페이먼츠 결제 위젯 호출 전 실행
 *     description: 장바구니 기반으로 주문을 생성하고 결제에 필요한 order_id/amount를 반환합니다.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               coupon_discount: { type: integer, default: 0 }
 *               points_used: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: 주문 준비 완료
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order_id: { type: string }
 *                 order_name: { type: string }
 *                 amount: { type: integer }
 *       400:
 *         description: 장바구니가 비어있음
 */

/**
 * @swagger
 * /orders/confirm:
 *   post:
 *     tags: [Orders]
 *     summary: 토스페이먼츠 결제 승인
 *     description: 클라이언트에서 토스페이먼츠 결제 완료 후 호출. 포인트 적립(결제금액 1%)도 처리됩니다.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentKey, orderId, amount]
 *             properties:
 *               paymentKey: { type: string }
 *               orderId: { type: string }
 *               amount: { type: integer }
 *     responses:
 *       200:
 *         description: 결제 완료
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 order_id: { type: string }
 *                 amount: { type: integer }
 *                 earn_points: { type: integer }
 *       400:
 *         description: 유효하지 않은 주문 또는 금액 불일치
 *       500:
 *         description: 토스페이먼츠 승인 실패
 */

/**
 * @swagger
 * /orders:
 *   get:
 *     tags: [Orders]
 *     summary: 주문 내역 조회
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 주문 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orders:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       status: { type: string, enum: [pending, paid, cancelled] }
 *                       final_price: { type: integer }
 *                       created_at: { type: string, format: date-time }
 *                       items:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             name: { type: string }
 *                             quantity: { type: integer }
 *                             unit_price: { type: integer }
 */

// POST /orders/prepare — 주문 준비 (토스페이먼츠 결제 전)
router.post('/prepare', auth, async (req, res) => {
  const { userId } = req.user;
  const { coupon_discount = 0, points_used = 0 } = req.body;

  try {
    const [items] = await pool.query(
      `SELECT c.quantity, p.id as product_id, p.price, p.name
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       WHERE c.user_id = ?`,
      [userId]
    );

    if (!items.length) {
      return res.status(400).json({ message: '장바구니가 비었어요' });
    }

    const subtotal    = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const final_price = Math.max(0, subtotal - coupon_discount - points_used);
    const orderId     = `order_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
    const orderName   = items.length === 1
      ? items[0].name
      : `${items[0].name} 외 ${items.length - 1}건`;

    // 주문 임시 저장 (pending 상태)
    await pool.query(
      `INSERT INTO orders
        (id, user_id, subtotal, coupon_discount, points_used, final_price, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [orderId, userId, subtotal, coupon_discount, points_used, final_price]
    );

    const orderItems = items.map(i => [
      uuidv4(), orderId, i.product_id, i.quantity, i.price
    ]);
    await pool.query(
      'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES ?',
      [orderItems]
    );

    return res.json({
      order_id:   orderId,
      order_name: orderName,
      amount:     final_price,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '주문 준비 실패' });
  }
});

// POST /orders/confirm — 토스페이먼츠 결제 승인
router.post('/confirm', auth, async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;
  const { userId } = req.user;

  try {
    // 1. 주문 금액 검증
    const [orders] = await pool.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = ?',
      [orderId, userId, 'pending']
    );

    if (!orders.length) {
      return res.status(400).json({ message: '유효하지 않은 주문이에요' });
    }

    if (orders[0].final_price !== amount) {
      return res.status(400).json({ message: '결제 금액이 맞지 않아요' });
    }

    // 2. 토스페이먼츠 결제 승인 API 호출
    const { data: tossData } = await axios.post(
      'https://api.tosspayments.com/v1/payments/confirm',
      { paymentKey, orderId, amount },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(process.env.TOSS_SECRET_KEY + ':').toString('base64')}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // 3. 주문 상태 업데이트
    await pool.query(
      `UPDATE orders SET
        status = 'paid',
        payment_method = ?,
        pg_transaction_id = ?
       WHERE id = ?`,
      [tossData.method, tossData.paymentKey, orderId]
    );

    // 4. 포인트 차감 및 적립 (결제금액의 1%)
    const [order] = orders;
    if (order.points_used > 0) {
      await pool.query(
        'UPDATE user_points SET balance = balance - ? WHERE user_id = ?',
        [order.points_used, userId]
      );
    }
    const earnPoints = Math.floor(amount * 0.01);
    if (earnPoints > 0) {
      await pool.query(
        'UPDATE user_points SET balance = balance + ? WHERE user_id = ?',
        [earnPoints, userId]
      );
      await pool.query(
        `INSERT INTO point_history (id, user_id, amount, type, description)
         VALUES (UUID(), ?, ?, 'earn', ?)`,
        [userId, earnPoints, `${orderId} 구매 적립`]
      );
    }

    // 5. 장바구니 비우기
    await pool.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);

    return res.json({
      message: '결제 완료',
      order_id: orderId,
      amount,
      earn_points: earnPoints,
    });

  } catch (err) {
    console.error(err?.response?.data || err.message);

    // 결제 실패 시 주문 취소 처리
    await pool.query(
      "UPDATE orders SET status = 'cancelled' WHERE id = ?",
      [orderId]
    ).catch(() => {});

    return res.status(500).json({ message: '결제 승인 실패', detail: err?.response?.data });
  }
});

// GET /orders — 주문 내역 조회
router.get('/', auth, async (req, res) => {
  const { userId } = req.user;

  try {
    const [orders] = await pool.query(
      `SELECT o.*,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'name', p.name,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price
          )
        ) as items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.user_id = ?
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [userId]
    );

    return res.json({ orders });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '조회 실패' });
  }
});

module.exports = router;
