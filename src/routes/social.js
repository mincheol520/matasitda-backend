const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const auth = require('../middlewares/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Social
 *   description: 팔로우 & 친구 식단 비교 API
 */

/**
 * @swagger
 * /follows/{userId}:
 *   post:
 *     tags: [Social]
 *     summary: 팔로우/언팔로우 토글
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: 팔로우할 대상 유저 ID
 *     responses:
 *       200:
 *         description: 토글 결과
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 following: { type: boolean }
 *       400:
 *         description: 자기 자신 팔로우 불가
 *       404:
 *         description: 대상 유저 없음
 */

/**
 * @swagger
 * /follows/{userId}/followers:
 *   get:
 *     tags: [Social]
 *     summary: 팔로워 목록 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 팔로워 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 followers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserSummary'
 */

/**
 * @swagger
 * /follows/{userId}/following:
 *   get:
 *     tags: [Social]
 *     summary: 팔로잉 목록 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 팔로잉 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 following:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserSummary'
 */

/**
 * @swagger
 * /friends:
 *   get:
 *     tags: [Social]
 *     summary: 친구 식단 달성률 비교 (홈 화면)
 *     description: 내가 팔로우하는 친구들의 오늘 칼로리 달성률을 나와 함께 반환합니다.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 나 + 친구들의 오늘 식단 달성률
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 me:
 *                   $ref: '#/components/schemas/FriendStats'
 *                 friends:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/FriendStats'
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     UserSummary:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         nickname: { type: string }
 *         profile_image_url: { type: string, nullable: true }
 *         is_following: { type: boolean }
 *     FriendStats:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         nickname: { type: string }
 *         profile_image_url: { type: string, nullable: true }
 *         today_calories: { type: number }
 *         tdee_kcal: { type: integer, nullable: true }
 *         achievement_rate:
 *           type: integer
 *           nullable: true
 *           description: "오늘 칼로리 / TDEE × 100 (%)"
 */

// POST /follows/:userCode — 유저코드로 팔로우/언팔로우
router.post('/:userCode', auth, async (req, res) => {
  const { userId } = req.user;
  const { userCode } = req.params;

  try {
    // userCode로 대상 유저 찾기 (UUID도 지원)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userCode);
    const [targets] = isUUID
      ? await pool.query('SELECT id FROM users WHERE id = ?', [userCode])
      : await pool.query('SELECT id FROM users WHERE user_code = ?', [userCode.toUpperCase()]);

    if (!targets.length) return res.status(404).json({ message: '유저를 찾을 수 없어요' });

    const targetId = targets[0].id;

    if (targetId === userId) {
      return res.status(400).json({ message: '자기 자신을 팔로우할 수 없어요' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
      [userId, targetId]
    );

    if (existing.length) {
      await pool.query(
        'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
        [userId, targetId]
      );
      return res.json({ following: false });
    } else {
      await pool.query(
        'INSERT INTO follows (id, follower_id, following_id) VALUES (UUID(), ?, ?)',
        [userId, targetId]
      );
      return res.json({ following: true });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '팔로우 실패' });
  }
});

// GET /follows/:userId/followers — 팔로워 목록
router.get('/:userId/followers', auth, async (req, res) => {
  const { userId: me } = req.user;
  const { userId } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nickname, u.profile_image_url,
              MAX(CASE WHEN f2.follower_id = ? THEN 1 ELSE 0 END) AS is_following
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       LEFT JOIN follows f2 ON f2.follower_id = ? AND f2.following_id = u.id
       WHERE f.following_id = ?
       GROUP BY u.id
       ORDER BY f.created_at DESC`,
      [me, me, userId]
    );

    return res.json({ followers: rows.map(r => ({ ...r, is_following: !!r.is_following })) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '팔로워 조회 실패' });
  }
});

// GET /follows/:userId/following — 팔로잉 목록
router.get('/:userId/following', auth, async (req, res) => {
  const { userId: me } = req.user;
  const { userId } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nickname, u.profile_image_url,
              MAX(CASE WHEN f2.follower_id = ? THEN 1 ELSE 0 END) AS is_following
       FROM follows f
       JOIN users u ON u.id = f.following_id
       LEFT JOIN follows f2 ON f2.follower_id = ? AND f2.following_id = u.id
       WHERE f.follower_id = ?
       GROUP BY u.id
       ORDER BY f.created_at DESC`,
      [me, me, userId]
    );

    return res.json({ following: rows.map(r => ({ ...r, is_following: !!r.is_following })) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '팔로잉 조회 실패' });
  }
});

// GET /friends — 친구 식단 달성률 비교 (홈 화면)
// 내가 팔로우하는 사람들의 오늘 칼로리 달성률
router.get('/', auth, async (req, res) => {
  const { userId } = req.user;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const [friends] = await pool.query(
      `SELECT u.id, u.nickname, u.profile_image_url, u.tdee_kcal,
              COALESCE(SUM(n.calories), 0) AS today_calories
       FROM follows f
       JOIN users u ON u.id = f.following_id
       LEFT JOIN meal_records r ON r.user_id = u.id AND r.meal_date = ?
       LEFT JOIN meal_nutrition n ON n.meal_record_id = r.id
       WHERE f.follower_id = ?
       GROUP BY u.id
       ORDER BY u.nickname`,
      [today, userId]
    );

    // 내 정보도 포함
    const [[me]] = await pool.query(
      `SELECT u.id, u.nickname, u.profile_image_url, u.tdee_kcal,
              COALESCE(SUM(n.calories), 0) AS today_calories
       FROM users u
       LEFT JOIN meal_records r ON r.user_id = u.id AND r.meal_date = ?
       LEFT JOIN meal_nutrition n ON n.meal_record_id = r.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [today, userId]
    );

    const toEntry = u => ({
      id:                 u.id,
      nickname:           u.nickname,
      profile_image_url:  u.profile_image_url,
      today_calories:     u.today_calories,
      tdee_kcal:          u.tdee_kcal,
      achievement_rate:   u.tdee_kcal
        ? Math.round((u.today_calories / u.tdee_kcal) * 100)
        : null,
    });

    return res.json({
      me:      toEntry(me),
      friends: friends.map(toEntry),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '친구 조회 실패' });
  }
});

module.exports = router;
