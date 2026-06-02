const express    = require('express');
const { v4: uuidv4 } = require('uuid');
const pool       = require('../db');
const auth       = require('../middlewares/auth');
const upload     = require('../middlewares/upload');
const aiService  = require('../services/aiService');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Meals
 *   description: 식단 분석 API
 */

/**
 * @swagger
 * /meals/analyze:
 *   post:
 *     tags: [Meals]
 *     summary: 빈 그릇 + 음식 사진 업로드 → AI 분석 → 영양소 저장
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [empty_image, food_image, meal_type, meal_date]
 *             properties:
 *               empty_image:
 *                 type: string
 *                 format: binary
 *                 description: 빈 그릇 사진
 *               food_image:
 *                 type: string
 *                 format: binary
 *                 description: 음식이 담긴 사진
 *               meal_type:
 *                 type: string
 *                 enum: [breakfast, lunch, dinner, snack]
 *               meal_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-05-30"
 *     responses:
 *       200:
 *         description: 분석 결과
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 meal_id: { type: string }
 *                 score: { type: integer, description: "AI 신뢰도 기반 점수 (0~100)" }
 *                 foods:
 *                   type: array
 *                   items: { type: string }
 *                 nutrition:
 *                   type: object
 *                   properties:
 *                     calories: { type: number }
 *                     carbs_g: { type: number }
 *                     protein_g: { type: number }
 *                     fat_g: { type: number }
 *                     fiber_g: { type: number }
 *                     sodium_mg: { type: number }
 *       400:
 *         description: 이미지 또는 필드 누락
 *       500:
 *         description: AI 분석 실패
 */

/**
 * @swagger
 * /meals:
 *   get:
 *     tags: [Meals]
 *     summary: 날짜별 식단 조회 + 하루 합계 (홈 화면)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-30"
 *     responses:
 *       200:
 *         description: 식단 기록 및 하루 합계
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 date: { type: string }
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       meal_type: { type: string }
 *                       calories: { type: number }
 *                       carbs_g: { type: number }
 *                       protein_g: { type: number }
 *                       fat_g: { type: number }
 *                 totals:
 *                   type: object
 *                   properties:
 *                     calories: { type: number }
 *                     carbs_g: { type: number }
 *                     protein_g: { type: number }
 *                     fat_g: { type: number }
 *       400:
 *         description: date 파라미터 누락
 */

// POST /meals/analyze
// 빈 그릇 + 음식 사진 업로드 → AI 분석 → DB 저장
router.post('/analyze', auth, upload.fields([
  { name: 'empty_image', maxCount: 1 },
  { name: 'food_image',  maxCount: 1 },
]), async (req, res) => {
  const { userId } = req.user;
  const { meal_type, meal_date } = req.body;
  // meal_type: breakfast | lunch | dinner | snack
  // meal_date: 2026-05-13

  if (!req.files?.empty_image || !req.files?.food_image) {
    return res.status(400).json({ message: '이미지 2장이 필요합니다 (empty_image, food_image)' });
  }
  if (!meal_type || !meal_date) {
    return res.status(400).json({ message: 'meal_type, meal_date가 필요합니다' });
  }

  const emptyImagePath = req.files.empty_image[0].path;
  const foodImagePath  = req.files.food_image[0].path;

  try {
    // 1. AI 분석 요청
    const aiResult = await aiService.analyzeMeal(emptyImagePath, foodImagePath, false);

    // 2. meal_records 저장
    const mealId = uuidv4();
    await pool.query(
      'INSERT INTO meal_records (id, user_id, meal_date, meal_type) VALUES (?, ?, ?, ?)',
      [mealId, userId, meal_date, meal_type]
    );

    // 3. meal_images 저장
    await pool.query(
      'INSERT INTO meal_images (id, meal_record_id, image_type, image_url) VALUES ?',
      [[
        [uuidv4(), mealId, 'empty', emptyImagePath],
        [uuidv4(), mealId, 'food',  foodImagePath],
      ]]
    );

    // 4. meal_nutrition 저장
    const { nutrition, ai_confidence } = aiResult;
    await pool.query(
      `INSERT INTO meal_nutrition
        (id, meal_record_id, calories, carbs_g, protein_g, fat_g, fiber_g, sodium_mg, ai_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), mealId, nutrition.calories, nutrition.carbs_g,
       nutrition.protein_g, nutrition.fat_g, nutrition.fiber_g,
       nutrition.sodium_mg, ai_confidence]
    );

    // 5. 점수 계산 (간단 버전 — 나중에 고도화)
    const score = Math.round(ai_confidence * 100);
    await pool.query('UPDATE meal_records SET score = ? WHERE id = ?', [score, mealId]);

    return res.json({
      meal_id:   mealId,
      score,
      foods:     aiResult.foods,
      nutrition: aiResult.nutrition,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '식단 분석 실패' });
  }
});

// GET /meals?date=2026-05-13 — 날짜별 식단 조회 (홈 화면)
router.get('/', auth, async (req, res) => {
  const { userId } = req.user;
  const { date } = req.query;
  if (!date) return res.status(400).json({ message: 'date가 필요합니다' });

  try {
    const [records] = await pool.query(
      `SELECT r.*, n.calories, n.carbs_g, n.protein_g, n.fat_g
       FROM meal_records r
       LEFT JOIN meal_nutrition n ON n.meal_record_id = r.id
       WHERE r.user_id = ? AND r.meal_date = ?
       ORDER BY r.created_at ASC`,
      [userId, date]
    );

    // 하루 합계
    const totals = records.reduce((acc, r) => ({
      calories:  acc.calories  + (r.calories  || 0),
      carbs_g:   acc.carbs_g   + (r.carbs_g   || 0),
      protein_g: acc.protein_g + (r.protein_g || 0),
      fat_g:     acc.fat_g     + (r.fat_g     || 0),
    }), { calories: 0, carbs_g: 0, protein_g: 0, fat_g: 0 });

    return res.json({ date, records, totals });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '조회 실패' });
  }
});

module.exports = router;