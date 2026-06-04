const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const MOCK_MODE = false;

const mockAnalyze = () => ({
  foods: [
    { name: '닭가슴살', amount_g: 150, confidence: 0.92 },
    { name: '현미밥',   amount_g: 200, confidence: 0.88 },
    { name: '브로콜리', amount_g: 80,  confidence: 0.95 },
  ],
  nutrition: {
    calories:  498,
    carbs_g:   62.4,
    protein_g: 48.2,
    fat_g:     6.8,
    fiber_g:   5.2,
    sodium_mg: 320,
  },
  ai_confidence: 0.91,
});

module.exports = {
  // foodImagePaths: 단일 경로(string) 또는 복수 경로(array) 모두 지원
  async analyzeMeal(emptyImagePath, foodImagePaths, useBase64 = false) {
    if (MOCK_MODE) {
      await new Promise(r => setTimeout(r, 500));
      return mockAnalyze();
    }

    const foodPaths = Array.isArray(foodImagePaths) ? foodImagePaths : [foodImagePaths];

    try {
      if (useBase64) {
        // JSON base64 방식
        const emptyBase64 = fs.readFileSync(emptyImagePath).toString('base64');
        const foodBase64s  = foodPaths.map(p => fs.readFileSync(p).toString('base64'));

        const { data } = await axios.post(
          `${process.env.AI_SERVER_URL}/analyze/meal`,
          {
            empty_image:  emptyBase64,
            food_images:  foodBase64s,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
          }
        );
        return data;

      } else {
        // multipart/form-data 방식 (기본)
        const form = new FormData();
        const emptyBuffer = fs.readFileSync(emptyImagePath);
        const foodBuffer  = fs.readFileSync(foodPaths[0]);

        form.append('empty_image',   emptyBuffer, { filename: 'empty.jpg', contentType: 'image/jpeg' });
        form.append('food_images[]', foodBuffer,  { filename: 'food.jpg',  contentType: 'image/jpeg' });

        const { data } = await axios.post(
          `${process.env.AI_SERVER_URL}/analyze/meal`,
          form,
          { headers: { ...form.getHeaders() }, timeout: 30000 }
        );
        return data;
      }
    } catch (err) {
      console.error('AI 서버 에러 상태코드:', err.response?.status);
      console.error('AI 서버 에러 응답:', JSON.stringify(err.response?.data));
      throw err;
    }
  },
};