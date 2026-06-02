const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool    = require('../db');
const auth    = require('../middlewares/auth');
const upload  = require('../middlewares/upload');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Posts
 *   description: 커뮤니티 게시글 API
 */

/**
 * @swagger
 * /posts:
 *   post:
 *     tags: [Posts]
 *     summary: 게시글 작성 (이미지 최대 5장 + 식재료 해시태그)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 example: "오늘 닭가슴살 샐러드 만들었어요!"
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: 이미지 파일 (최대 5장)
 *               ingredient_tags:
 *                 type: string
 *                 description: JSON 문자열 배열
 *                 example: '["닭가슴살","양상추"]'
 *     responses:
 *       201:
 *         description: 게시글 생성 완료
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 post: { type: object }
 *                 tags:
 *                   type: array
 *                   items: { type: string }
 *                 images:
 *                   type: array
 *                   items: { type: string }
 *       400:
 *         description: content 누락
 *   get:
 *     tags: [Posts]
 *     summary: 피드 조회 (최신순, 커서 페이지네이션)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tag
 *         schema: { type: string }
 *         description: 식재료 해시태그 필터
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *         description: 마지막 게시글의 created_at (다음 페이지 요청 시)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: 게시글 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 posts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Post'
 *                 next_cursor:
 *                   type: string
 *                   nullable: true
 */

/**
 * @swagger
 * /posts/{id}:
 *   get:
 *     tags: [Posts]
 *     summary: 게시글 상세 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 게시글 상세
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 post:
 *                   $ref: '#/components/schemas/Post'
 *       404:
 *         description: 게시글 없음
 *   delete:
 *     tags: [Posts]
 *     summary: 게시글 삭제 (본인만 가능)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 삭제 완료
 *       403:
 *         description: 권한 없음
 *       404:
 *         description: 게시글 없음
 */

/**
 * @swagger
 * /posts/{id}/like:
 *   post:
 *     tags: [Posts]
 *     summary: 좋아요 토글
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 토글 결과
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 liked: { type: boolean }
 *                 like_count: { type: integer }
 */

/**
 * @swagger
 * /posts/{id}/bookmark:
 *   post:
 *     tags: [Posts]
 *     summary: 북마크 토글
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 토글 결과
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bookmarked: { type: boolean }
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Post:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         content: { type: string }
 *         created_at: { type: string, format: date-time }
 *         author_id: { type: string }
 *         nickname: { type: string }
 *         profile_image_url: { type: string, nullable: true }
 *         like_count: { type: integer }
 *         is_liked: { type: boolean }
 *         is_bookmarked: { type: boolean }
 *         images:
 *           type: array
 *           items: { type: string }
 *         tags:
 *           type: array
 *           items: { type: string }
 */

// POST /posts — 게시글 작성
router.post('/', auth, upload.array('images', 5), async (req, res) => {
  const { userId } = req.user;
  const { content, ingredient_tags } = req.body;
  // ingredient_tags: JSON 문자열 배열 ex) '["닭가슴살","고구마"]'

  if (!content?.trim()) {
    return res.status(400).json({ message: 'content가 필요합니다' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const postId = uuidv4();
    await conn.query(
      'INSERT INTO posts (id, user_id, content) VALUES (?, ?, ?)',
      [postId, userId, content.trim()]
    );

    // 이미지 저장
    if (req.files?.length) {
      const imageValues = req.files.map((f, i) => [uuidv4(), postId, f.path, i]);
      await conn.query(
        'INSERT INTO post_images (id, post_id, image_url, `order`) VALUES ?',
        [imageValues]
      );
    }

    // 식재료 해시태그 저장
    let tags = [];
    if (ingredient_tags) {
      try { tags = JSON.parse(ingredient_tags); } catch { tags = []; }
    }
    if (tags.length) {
      const tagValues = tags.filter(t => t?.trim()).map(t => [uuidv4(), postId, t.trim()]);
      if (tagValues.length) {
        await conn.query(
          'INSERT INTO post_ingredient_tags (id, post_id, ingredient_name) VALUES ?',
          [tagValues]
        );
      }
    }

    await conn.commit();

    const [[post]] = await conn.query(
      `SELECT p.*, u.nickname, u.profile_image_url,
              0 AS like_count, 0 AS is_liked, 0 AS is_bookmarked
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`,
      [postId]
    );

    return res.status(201).json({ post, tags, images: req.files?.map(f => f.path) ?? [] });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ message: '게시글 작성 실패' });
  } finally {
    conn.release();
  }
});

// GET /posts — 피드 조회 (최신순, 해시태그 필터)
// Query: ?tag=닭가슴살&cursor=<last_created_at>&limit=20
router.get('/', auth, async (req, res) => {
  const { userId } = req.user;
  const { tag, cursor, limit = 20 } = req.query;
  const pageSize = Math.min(Number(limit) || 20, 50);

  try {
    // 해시태그 필터 시 post_id 목록 먼저 조회
    let postIdFilter = null;
    if (tag) {
      const [tagged] = await pool.query(
        'SELECT DISTINCT post_id FROM post_ingredient_tags WHERE ingredient_name = ?',
        [tag]
      );
      if (!tagged.length) return res.json({ posts: [], next_cursor: null });
      postIdFilter = tagged.map(r => r.post_id);
    }

    let query = `
      SELECT p.id, p.content, p.created_at,
             u.id AS author_id, u.nickname, u.profile_image_url,
             COUNT(DISTINCT pl.id)  AS like_count,
             MAX(CASE WHEN pl.user_id = ? THEN 1 ELSE 0 END) AS is_liked,
             MAX(CASE WHEN pb.user_id = ? THEN 1 ELSE 0 END) AS is_bookmarked
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN post_likes pl ON pl.post_id = p.id
      LEFT JOIN post_bookmarks pb ON pb.post_id = p.id AND pb.user_id = ?
      WHERE 1=1
    `;
    const params = [userId, userId, userId];

    if (postIdFilter) {
      query += ` AND p.id IN (${postIdFilter.map(() => '?').join(',')})`;
      params.push(...postIdFilter);
    }
    if (cursor) {
      query += ' AND p.created_at < ?';
      params.push(cursor);
    }

    query += ' GROUP BY p.id ORDER BY p.created_at DESC LIMIT ?';
    params.push(pageSize + 1);

    const [rows] = await pool.query(query, params);
    const hasMore = rows.length > pageSize;
    const posts   = hasMore ? rows.slice(0, pageSize) : rows;

    // 각 게시글의 이미지·태그 일괄 조회
    if (posts.length) {
      const ids = posts.map(p => p.id);
      const [images] = await pool.query(
        `SELECT post_id, image_url FROM post_images WHERE post_id IN (${ids.map(() => '?').join(',')}) ORDER BY \`order\``,
        ids
      );
      const [tags] = await pool.query(
        `SELECT post_id, ingredient_name FROM post_ingredient_tags WHERE post_id IN (${ids.map(() => '?').join(',')})`,
        ids
      );

      const imgMap = {};
      const tagMap = {};
      images.forEach(img => { (imgMap[img.post_id] ??= []).push(img.image_url); });
      tags.forEach(t   => { (tagMap[t.post_id]   ??= []).push(t.ingredient_name); });

      posts.forEach(p => {
        p.images = imgMap[p.id] ?? [];
        p.tags   = tagMap[p.id] ?? [];
        p.is_liked      = !!p.is_liked;
        p.is_bookmarked = !!p.is_bookmarked;
      });
    }

    return res.json({
      posts,
      next_cursor: hasMore ? posts[posts.length - 1].created_at : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '피드 조회 실패' });
  }
});

// GET /posts/:id — 게시글 상세
router.get('/:id', auth, async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  try {
    const [[post]] = await pool.query(
      `SELECT p.id, p.content, p.created_at,
              u.id AS author_id, u.nickname, u.profile_image_url,
              COUNT(DISTINCT pl.id)  AS like_count,
              MAX(CASE WHEN pl.user_id = ? THEN 1 ELSE 0 END) AS is_liked,
              MAX(CASE WHEN pb.user_id = ? THEN 1 ELSE 0 END) AS is_bookmarked
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN post_likes pl ON pl.post_id = p.id
       LEFT JOIN post_bookmarks pb ON pb.post_id = p.id AND pb.user_id = ?
       WHERE p.id = ?
       GROUP BY p.id`,
      [userId, userId, userId, id]
    );

    if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다' });

    const [images] = await pool.query(
      'SELECT image_url FROM post_images WHERE post_id = ? ORDER BY `order`',
      [id]
    );
    const [tags] = await pool.query(
      'SELECT ingredient_name FROM post_ingredient_tags WHERE post_id = ?',
      [id]
    );

    post.images = images.map(r => r.image_url);
    post.tags   = tags.map(r => r.ingredient_name);
    post.is_liked      = !!post.is_liked;
    post.is_bookmarked = !!post.is_bookmarked;

    return res.json({ post });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '조회 실패' });
  }
});

// DELETE /posts/:id — 게시글 삭제 (본인만)
router.delete('/:id', auth, async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  try {
    const [[post]] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [id]);
    if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다' });
    if (post.user_id !== userId) return res.status(403).json({ message: '권한이 없습니다' });

    await pool.query('DELETE FROM posts WHERE id = ?', [id]);
    return res.json({ message: '삭제 완료' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '삭제 실패' });
  }
});

// POST /posts/:id/like — 좋아요 토글
router.post('/:id/like', auth, async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  try {
    const [[exists]] = await pool.query(
      'SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?',
      [id, userId]
    );

    if (exists) {
      await pool.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [id, userId]);
      const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM post_likes WHERE post_id = ?', [id]);
      return res.json({ liked: false, like_count: cnt });
    } else {
      await pool.query('INSERT INTO post_likes (id, post_id, user_id) VALUES (?, ?, ?)', [uuidv4(), id, userId]);
      const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM post_likes WHERE post_id = ?', [id]);
      return res.json({ liked: true, like_count: cnt });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '좋아요 처리 실패' });
  }
});

// POST /posts/:id/bookmark — 북마크 토글
router.post('/:id/bookmark', auth, async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  try {
    const [[exists]] = await pool.query(
      'SELECT id FROM post_bookmarks WHERE post_id = ? AND user_id = ?',
      [id, userId]
    );

    if (exists) {
      await pool.query('DELETE FROM post_bookmarks WHERE post_id = ? AND user_id = ?', [id, userId]);
      return res.json({ bookmarked: false });
    } else {
      await pool.query('INSERT INTO post_bookmarks (id, post_id, user_id) VALUES (?, ?, ?)', [uuidv4(), id, userId]);
      return res.json({ bookmarked: true });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '북마크 처리 실패' });
  }
});

module.exports = router;
