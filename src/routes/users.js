const express = require('express');
const pool    = require('../db');
const auth    = require('../middlewares/auth');

const router = express.Router();

// GET /users/search?code=AB3K9F2M
router.get('/search', auth, async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ message: 'code가 필요합니다' });

  try {
    const [rows] = await pool.query(
      'SELECT id, nickname, profile_image_url, user_code FROM users WHERE user_code = ?',
      [code.toUpperCase()]
    );
    if (!rows.length) return res.status(404).json({ message: '유저를 찾을 수 없어요' });
    return res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '검색 실패' });
  }
});

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: 사용자 정보 API
 */

/**
 * @swagger
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: 내 정보 조회
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 사용자 정보
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 nickname: { type: string }
 *                 email: { type: string }
 *                 age: { type: integer }
 *                 gender: { type: string, enum: [M, F] }
 *                 height_cm: { type: number }
 *                 weight_kg: { type: number }
 *                 activity_level: { type: string, enum: [low, medium, high] }
 *                 diet_goal: { type: string }
 *                 tdee_kcal: { type: integer }
 *                 allergies:
 *                   type: array
 *                   items: { type: string }
 *                 diseases:
 *                   type: array
 *                   items: { type: string }
 *                 preferences:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       ingredient_name: { type: string }
 *                       category: { type: string }
 *                       preference: { type: string, enum: [like, dislike] }
 *                 points: { type: integer }
 *   patch:
 *     tags: [Users]
 *     summary: 기본 신체 정보 저장 (온보딩 1단계)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname: { type: string }
 *               age: { type: integer, example: 25 }
 *               gender: { type: string, enum: [M, F] }
 *               height_cm: { type: number, example: 170 }
 *               weight_kg: { type: number, example: 65 }
 *               activity_level: { type: string, enum: [low, medium, high] }
 *               diet_goal: { type: string, example: "다이어트" }
 *     responses:
 *       200:
 *         description: 업데이트된 사용자 정보 (tdee_kcal 자동 계산 포함)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { type: object }
 */

// PATCH /users/me — 기본 정보 저장 (온보딩 1단계)
router.patch('/me', auth, async (req, res) => {
  const { userId } = req.user;
  const { nickname, age, gender, height_cm, weight_kg, activity_level, diet_goal } = req.body;

  // TDEE 계산 (Harris-Benedict 공식)
  let tdee = null;
  if (age && gender && height_cm && weight_kg && activity_level) {
    const bmr = gender === 'F'
      ? 655 + (9.6 * weight_kg) + (1.8 * height_cm) - (4.7 * age)
      : 66  + (13.7 * weight_kg) + (5 * height_cm)  - (6.8 * age);

    const activityMap = { low: 1.2, medium: 1.55, high: 1.725 };
    tdee = Math.round(bmr * (activityMap[activity_level] || 1.2));
  }

  try {
    await pool.query(
      `UPDATE users SET
        nickname       = COALESCE(?, nickname),
        age            = COALESCE(?, age),
        gender         = COALESCE(?, gender),
        height_cm      = COALESCE(?, height_cm),
        weight_kg      = COALESCE(?, weight_kg),
        activity_level = COALESCE(?, activity_level),
        diet_goal      = COALESCE(?, diet_goal),
        tdee_kcal      = COALESCE(?, tdee_kcal)
       WHERE id = ?`,
      [nickname, age, gender, height_cm, weight_kg, activity_level, diet_goal, tdee, userId]
    );

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    return res.json({ user: rows[0] });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '업데이트 실패' });
  }
});

/**
 * @swagger
 * /users/me/health:
 *   patch:
 *     tags: [Users]
 *     summary: 건강 정보 저장 (온보딩 2단계)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allergies:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["견과류", "유제품"]
 *               diseases:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["당뇨"]
 *               diet_style:
 *                 type: string
 *                 enum: [일반, 채식, 키토]
 *     responses:
 *       200:
 *         description: 저장 완료
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 */
// PATCH /users/me/health — 건강 정보 저장 (온보딩 2단계)
router.patch('/me/health', auth, async (req, res) => {
  const { userId } = req.user;
  const { allergies, diseases, diet_style } = req.body;
  // allergies: ['견과류', '유제품']
  // diseases:  ['당뇨']
  // diet_style: '일반' | '채식' | '키토'

  try {
    // 기존 데이터 삭제 후 재삽입
    await pool.query('DELETE FROM user_allergies WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM user_diseases  WHERE user_id = ?', [userId]);

    if (allergies?.length) {
      const values = allergies.map(a => [require('uuid').v4(), userId, a]);
      await pool.query(
        'INSERT INTO user_allergies (id, user_id, allergy_type) VALUES ?',
        [values]
      );
    }

    if (diseases?.length) {
      const values = diseases.map(d => [require('uuid').v4(), userId, d]);
      await pool.query(
        'INSERT INTO user_diseases (id, user_id, disease_type) VALUES ?',
        [values]
      );
    }

    if (diet_style) {
      await pool.query(
        'UPDATE users SET diet_goal = ? WHERE id = ?',
        [diet_style, userId]
      );
    }

    return res.json({ message: '건강 정보 저장 완료' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '저장 실패' });
  }
});

/**
 * @swagger
 * /users/me/preferences:
 *   patch:
 *     tags: [Users]
 *     summary: 선호/비선호 식재료 저장 (온보딩 3단계)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               preferences:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [ingredient_name, category, preference]
 *                   properties:
 *                     ingredient_name: { type: string, example: "닭가슴살" }
 *                     category: { type: string, example: "protein" }
 *                     preference: { type: string, enum: [like, dislike] }
 *     responses:
 *       200:
 *         description: 저장 완료
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 */
// PATCH /users/me/preferences — 선호 식재료 저장 (온보딩 3단계)
router.patch('/me/preferences', auth, async (req, res) => {
  const { userId } = req.user;
  const { preferences } = req.body;
  // preferences: [
  //   { ingredient_name: '고구마', category: 'carb', preference: 'like' },
  //   { ingredient_name: '흰쌀밥', category: 'carb', preference: 'dislike' },
  // ]

  try {
    await pool.query('DELETE FROM user_food_preferences WHERE user_id = ?', [userId]);

    if (preferences?.length) {
      const values = preferences.map(p => [
        require('uuid').v4(), userId, p.ingredient_name, p.category, p.preference
      ]);
      await pool.query(
        'INSERT INTO user_food_preferences (id, user_id, ingredient_name, category, preference) VALUES ?',
        [values]
      );
    }

    return res.json({ message: '선호 식재료 저장 완료' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '저장 실패' });
  }
});

// GET /users/me — 내 정보 조회
// (Swagger 문서는 PATCH /users/me 위에 통합 선언)
router.get('/me', auth, async (req, res) => {
  const { userId } = req.user;
  try {
    const [user]        = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    const [allergies]   = await pool.query('SELECT allergy_type FROM user_allergies WHERE user_id = ?', [userId]);
    const [diseases]    = await pool.query('SELECT disease_type FROM user_diseases WHERE user_id = ?', [userId]);
    const [preferences] = await pool.query('SELECT * FROM user_food_preferences WHERE user_id = ?', [userId]);
    const [points]      = await pool.query('SELECT balance FROM user_points WHERE user_id = ?', [userId]);

    return res.json({
      ...user[0],
      allergies:   allergies.map(a => a.allergy_type),
      diseases:    diseases.map(d => d.disease_type),
      preferences,
      points:      points[0]?.balance ?? 0,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '조회 실패' });
  }
});

module.exports = router;