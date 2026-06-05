const express = require('express');
const axios   = require('axios');
const pool    = require('../db');
const auth    = require('../middlewares/auth');

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

module.exports = router;
