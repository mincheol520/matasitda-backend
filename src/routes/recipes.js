const express = require('express');
const axios   = require('axios');
const pool    = require('../db');
const auth    = require('../middlewares/auth');

/**
 * @swagger
 * tags:
 *   name: Recipes
 *   description: AI 레시피 추천/수정 API
 */

/**
 * @swagger
 * /recipes/recommend:
 *   post:
 *     tags: [Recipes]
 *     summary: 레시피 추천 생성 (1/3/7일)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               days:
 *                 type: integer
 *                 example: 1
 *               meals:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["breakfast", "lunch", "dinner"]
 *               prompt:
 *                 type: string
 *                 example: "단백질 위주로"
 *     responses:
 *       200:
 *         description: 추천 성공
 *
 * /recipes/revise:
 *   post:
 *     tags: [Recipes]
 *     summary: 레시피 수정/재생성
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_plan]
 *             properties:
 *               current_plan:
 *                 type: object
 *               prompt:
 *                 type: string
 *                 example: "저녁은 더 가볍게"
 *               regenerate_items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     day:
 *                       type: integer
 *                     meal:
 *                       type: string
 *                 example: [{"day": 1, "meal": "dinner"}]
 *     responses:
 *       200:
 *         description: 수정 성공
 *
 * /recipes/save:
 *   post:
 *     tags: [Recipes]
 *     summary: 레시피 저장
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [days, meals, plan]
 *             properties:
 *               days:
 *                 type: integer
 *                 example: 1
 *               meals:
 *                 type: array
 *                 items:
 *                   type: string
 *               prompt:
 *                 type: string
 *               plan:
 *                 type: object
 *               source:
 *                 type: string
 *                 example: "openai"
 *     responses:
 *       200:
 *         description: 저장 완료
 *
 * /recipes:
 *   get:
 *     tags: [Recipes]
 *     summary: 내 저장된 레시피 목록
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 조회 성공
 *
 * /recipes/{id}:
 *   delete:
 *     tags: [Recipes]
 *     summary: 레시피 삭제
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 삭제 완료
 */

const router = express.Router();

// POST /recipes/recommend — 레시피 추천
router.post('/recommend', auth, async (req, res) => {
  const { userId } = req.user;
  const { days = 1, meals, prompt, disliked_recipe_ids = [] } = req.body;

  try {
    // 유저 정보 조회해서 AI 서버에 전달
    const [users]     = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    const [allergies] = await pool.query('SELECT allergy_type FROM user_allergies WHERE user_id = ?', [userId]);
    const user = users[0];

    const { data } = await axios.post(
      `${process.env.AI_SERVER_URL}/recipes/recommend`,
      {
        days,
        meals,
        prompt,
        disliked_recipe_ids,
        user_info: {
          goals: user?.diet_goal,
          calories_target: user?.tdee_kcal,
          allergies: allergies.map(a => a.allergy_type),
        },
      },
      { timeout: 60000 }
    );

    return res.json(data);

  } catch (err) {
    console.error(err?.response?.data || err.message);
    return res.status(500).json({ message: '레시피 추천 실패' });
  }
});

// POST /recipes/revise — 레시피 수정
router.post('/revise', auth, async (req, res) => {
  const { current_plan, prompt, regenerate_items = [], disliked_recipe_ids = [] } = req.body;

  try {
    const { data } = await axios.post(
      `${process.env.AI_SERVER_URL}/recipes/revise`,
      { current_plan, prompt, regenerate_items, disliked_recipe_ids },
      { timeout: 60000 }
    );

    return res.json(data);

  } catch (err) {
    console.error(err?.response?.data || err.message);
    return res.status(500).json({ message: '레시피 수정 실패' });
  }
});

// POST /recipes/save — 레시피 저장
router.post('/save', auth, async (req, res) => {
  const { userId } = req.user;
  const { days, meals, prompt, plan, source } = req.body;

  try {
    const id = require('uuid').v4();
    await pool.query(
      `INSERT INTO recipes (id, user_id, days, meals, prompt, plan, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, days, JSON.stringify(meals), prompt, JSON.stringify(plan), source || 'fallback']
    );
    return res.json({ message: '저장 완료', recipe_id: id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '저장 실패' });
  }
});

// GET /recipes — 내 저장된 레시피 목록
router.get('/', auth, async (req, res) => {
  const { userId } = req.user;
  try {
    const [rows] = await pool.query(
      'SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return res.json({ recipes: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '조회 실패' });
  }
});

// DELETE /recipes/:id — 레시피 삭제
router.delete('/:id', auth, async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;
  try {
    await pool.query(
      'DELETE FROM recipes WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    return res.json({ message: '삭제 완료' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '삭제 실패' });
  }
});

module.exports = router;
