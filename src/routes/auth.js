const express = require('express');
const axios   = require('axios');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool    = require('../db');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: 인증 관련 API
 */

/**
 * @swagger
 * /auth/kakao:
 *   post:
 *     tags: [Auth]
 *     summary: 카카오 액세스 토큰으로 로그인
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [access_token]
 *             properties:
 *               access_token:
 *                 type: string
 *                 example: "kakao_access_token_here"
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 isNewUser:
 *                   type: boolean
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     nickname: { type: string }
 *                     email: { type: string }
 *       400:
 *         description: access_token 누락
 *       500:
 *         description: 카카오 로그인 실패
 */
router.post('/kakao', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) {
    return res.status(400).json({ message: 'access_token이 필요합니다' });
  }

  try {
    // 1. 카카오에서 유저 정보 가져오기
    const { data: kakaoUser } = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const socialId       = String(kakaoUser.id);
    const nickname       = kakaoUser.kakao_account?.profile?.nickname || '맛잇다유저';
    const email          = kakaoUser.kakao_account?.email || null;

    // 2. DB에서 기존 유저 확인
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE social_provider = ? AND social_id = ?',
      ['kakao', socialId]
    );

    let user;
    let isNewUser = false;

    if (rows.length > 0) {
      // 기존 유저
      user = rows[0];
    } else {
      // 신규 유저 — users 테이블에 저장
      const newId = uuidv4();
      const userCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      await pool.query(
        `INSERT INTO users (id, social_provider, social_id, nickname, email, user_code)
         VALUES (?, 'kakao', ?, ?, ?, ?)`,
        [newId, socialId, nickname, email, userCode]
      );
      // user_points 초기화
      await pool.query(
        'INSERT INTO user_points (user_id, balance) VALUES (?, 0)',
        [newId]
      );
      user = { id: newId, nickname, email };
      isNewUser = true;
    }

    // 3. JWT 발급
    const token = jwt.sign(
      { userId: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return res.json({
      token,
      isNewUser,  // true면 앱에서 온보딩으로 이동
      user: {
        id:       user.id,
        nickname: user.nickname,
        email:    user.email,
      },
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '카카오 로그인 실패' });
  }
});

/**
 * @swagger
 * /auth/kakao/login:
 *   get:
 *     tags: [Auth]
 *     summary: 카카오 로그인 페이지로 리다이렉트
 *     security: []
 *     responses:
 *       302:
 *         description: 카카오 OAuth 로그인 페이지로 리다이렉트
 */

/**
 * @swagger
 * /auth/kakao/callback:
 *   get:
 *     tags: [Auth]
 *     summary: 카카오 OAuth 콜백 (카카오 서버가 호출)
 *     security: []
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: 로그인 성공 시 토큰을 담아 프론트로 리다이렉트
 */

// 개발용 테스트 토큰 발급 (배포 시 반드시 제거!)
if (process.env.NODE_ENV === 'development') {
  /**
   * @swagger
   * /auth/dev-token:
   *   post:
   *     tags: [Auth]
   *     summary: 개발용 테스트 JWT 발급 (development 환경 전용)
   *     security: []
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               nickname:
   *                 type: string
   *                 example: "테스트유저"
   *     responses:
   *       200:
   *         description: 토큰 발급 성공
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 token: { type: string }
   *                 userId: { type: string }
   */
  router.post('/dev-token', async (req, res) => {
    const { nickname = '테스트유저' } = req.body;

    try {
      // 테스트 유저 DB에 없으면 생성
      const testSocialId = 'dev-test-user';
      const [rows] = await pool.query(
        'SELECT * FROM users WHERE social_provider = ? AND social_id = ?',
        ['dev', testSocialId]
      );

      let userId;
      if (rows.length > 0) {
        userId = rows[0].id;
      } else {
        userId = uuidv4();
        await pool.query(
          `INSERT INTO users (id, social_provider, social_id, nickname)
           VALUES (?, 'dev', ?, ?)`,
          [userId, testSocialId, nickname]
        );
        await pool.query(
          'INSERT INTO user_points (user_id, balance) VALUES (?, 0)',
          [userId]
        );
      }

      const token = jwt.sign(
        { userId, nickname },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      return res.json({ token, userId });

    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: '토큰 발급 실패' });
    }
  });
}

// GET /auth/kakao/login — 카카오 로그인 페이지로 리다이렉트
router.get('/kakao/login', (req, res) => {
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${process.env.KAKAO_CLIENT_ID}&redirect_uri=${process.env.KAKAO_REDIRECT_URI}&response_type=code`;
  res.redirect(url);
});

// GET /auth/kakao/callback — 카카오에서 코드 받아서 토큰 교환
router.get('/kakao/callback', async (req, res) => {
  console.log('쿼리 전체:', req.query);
  const { code } = req.query;
  console.log('code:', code);

  try {
    // 1. 인가코드 → 카카오 액세스 토큰 교환
    const { data: tokenData } = await axios.post(
      'https://kauth.kakao.com/oauth/token',
      new URLSearchParams({
        grant_type:   'authorization_code',
        client_id:    process.env.KAKAO_CLIENT_ID,
        redirect_uri: process.env.KAKAO_REDIRECT_URI,
        code,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // 2. 액세스 토큰으로 유저 정보 조회
    const { data: kakaoUser } = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const socialId = String(kakaoUser.id);
    const nickname = kakaoUser.kakao_account?.profile?.nickname || '맛잇다유저';
    const email    = kakaoUser.kakao_account?.email || null;

    // 3. DB 저장 또는 조회
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE social_provider = ? AND social_id = ?',
      ['kakao', socialId]
    );

    let user;
    let isNewUser = false;

    if (rows.length > 0) {
      user = rows[0];
    } else {
      const newId = uuidv4();
      const userCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      await pool.query(
        `INSERT INTO users (id, social_provider, social_id, nickname, email, user_code)
         VALUES (?, 'kakao', ?, ?, ?, ?)`,
        [newId, socialId, nickname, email, userCode]
      );
      await pool.query(
        'INSERT INTO user_points (user_id, balance) VALUES (?, 0)',
        [newId]
      );
      user = { id: newId, nickname, email };
      isNewUser = true;
    }

    // 4. JWT 발급
    const token = jwt.sign(
      { userId: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // 5. 토큰 들고 프론트로 리다이렉트
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? 'https://matitda-face.vercel.app'
      : 'http://localhost:8081';

    res.redirect(`matitda://auth/success?token=${token}&isNewUser=${isNewUser}`);

  } catch (err) {
  console.error('카카오 콜백 에러:', err.response?.data || err.message);
  const frontendUrl = process.env.NODE_ENV === 'production'
    ? 'https://matitda-face.vercel.app'
    : 'http://localhost:8081';

  res.redirect(`matitda://auth/error`);
}
});

// GET /auth/success — 토큰 확인용 (테스트용)
router.get('/success', (req, res) => {
  const { token, isNewUser } = req.query;
  res.json({ token, isNewUser: isNewUser === 'true' });
});

router.get('/kakao/login', (req, res) => {
  console.log('CLIENT_ID:', process.env.KAKAO_CLIENT_ID);
  console.log('REDIRECT_URI:', process.env.KAKAO_REDIRECT_URI);
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${process.env.KAKAO_CLIENT_ID}&redirect_uri=${process.env.KAKAO_REDIRECT_URI}&response_type=code`;
  res.redirect(url);
});
module.exports = router;