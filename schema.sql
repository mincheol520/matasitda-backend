-- ============================================================
--  맛잇-다 (matasitda) — Database Schema
--  기준: 목업 v0.2 / 사업계획서 기반
--  DB: MySQL 8.0+ / PostgreSQL 14+
--  작성일: 2026-05-13
-- ============================================================

-- ① UUID 확장 (PostgreSQL만 필요)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
--  DOMAIN 1. 유저 (User)
-- ============================================================
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS point_history;
DROP TABLE IF EXISTS user_points;
DROP TABLE IF EXISTS reactions;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS post_bookmarks;
DROP TABLE IF EXISTS post_likes;
DROP TABLE IF EXISTS post_ingredient_tags;
DROP TABLE IF EXISTS post_images;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS meal_food_items;
DROP TABLE IF EXISTS meal_nutrition;
DROP TABLE IF EXISTS meal_images;
DROP TABLE IF EXISTS meal_records;
DROP TABLE IF EXISTS foods;
DROP TABLE IF EXISTS user_food_preferences;
DROP TABLE IF EXISTS user_diseases;
DROP TABLE IF EXISTS user_allergies;
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  social_provider  VARCHAR(20)  NOT NULL COMMENT '카카오 | 구글',
  social_id        VARCHAR(100) NOT NULL,
  nickname         VARCHAR(30)  NOT NULL,
  email            VARCHAR(100),
  age              TINYINT UNSIGNED,
  gender           CHAR(1)      COMMENT 'M | F',
  height_cm        DECIMAL(5,1),
  weight_kg        DECIMAL(5,1),
  activity_level   VARCHAR(10)  COMMENT 'low | medium | high',
  diet_goal        VARCHAR(20)  COMMENT 'lose | maintain | gain',
  tdee_kcal        SMALLINT UNSIGNED,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_social (social_provider, social_id)
);

CREATE TABLE user_allergies (
  id           CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  user_id      CHAR(36)    NOT NULL,
  allergy_type VARCHAR(30) NOT NULL COMMENT '견과류 | 갑각류 | 유제품 | 글루텐 | 달걀 | 기타',
  custom_value VARCHAR(50),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_diseases (
  id           CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  user_id      CHAR(36)    NOT NULL,
  disease_type VARCHAR(30) NOT NULL COMMENT '당뇨 | 고혈압 | 고지혈증',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 선호/비선호 식재료 (탄단지 카테고리별)
CREATE TABLE user_food_preferences (
  id              CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  user_id         CHAR(36)    NOT NULL,
  ingredient_name VARCHAR(50) NOT NULL,
  category        VARCHAR(10) NOT NULL COMMENT 'carb | protein | fat',
  preference      VARCHAR(10) NOT NULL COMMENT 'like | dislike',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_ingredient (user_id, ingredient_name)
);

-- ============================================================
--  DOMAIN 2. 식단 기록 (Meal)
-- ============================================================

CREATE TABLE meal_records (
  id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  user_id        CHAR(36)     NOT NULL,
  meal_date      DATE         NOT NULL,
  meal_type      VARCHAR(10)  NOT NULL COMMENT 'breakfast | lunch | dinner | snack',
  score          TINYINT UNSIGNED COMMENT '0~100 AI 채점',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_date (user_id, meal_date)
);

-- 빈 그릇(empty) + 음식 담긴 사진(food) — 2장 쌍
CREATE TABLE meal_images (
  id             CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  meal_record_id CHAR(36)    NOT NULL,
  image_type     VARCHAR(10) NOT NULL COMMENT 'empty | food',
  image_url      VARCHAR(512) NOT NULL,
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meal_record_id) REFERENCES meal_records(id) ON DELETE CASCADE
);

-- AI 분석 결과 (1:1)
CREATE TABLE meal_nutrition (
  id             CHAR(36)        PRIMARY KEY DEFAULT (UUID()),
  meal_record_id CHAR(36)        NOT NULL UNIQUE,
  calories       DECIMAL(7,1),
  carbs_g        DECIMAL(6,1),
  protein_g      DECIMAL(6,1),
  fat_g          DECIMAL(6,1),
  fiber_g        DECIMAL(5,1),
  sodium_mg      DECIMAL(7,1),
  ai_confidence  DECIMAL(4,3)    COMMENT '0.000 ~ 1.000',
  analyzed_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meal_record_id) REFERENCES meal_records(id) ON DELETE CASCADE
);

-- 식단 내 개별 음식 항목 (AI 인식 결과)
CREATE TABLE meal_food_items (
  id             CHAR(36)       PRIMARY KEY DEFAULT (UUID()),
  meal_record_id CHAR(36)       NOT NULL,
  food_id        CHAR(36)       NOT NULL,
  amount_g       DECIMAL(6,1)   NOT NULL COMMENT '실제 섭취량 (AI 계측)',
  FOREIGN KEY (meal_record_id) REFERENCES meal_records(id) ON DELETE CASCADE,
  FOREIGN KEY (food_id) REFERENCES foods(id)
);

-- ============================================================
--  DOMAIN 3. 식품 DB (Foods)
--  식품안전처 영양성분 DB + 자체 등록
-- ============================================================

CREATE TABLE foods (
  id              CHAR(36)       PRIMARY KEY DEFAULT (UUID()),
  name            VARCHAR(100)   NOT NULL,
  name_en         VARCHAR(100),
  category        VARCHAR(30)    COMMENT '곡류 | 육류 | 채소 | 과일 | 유제품 ...',
  cal_per_100g    DECIMAL(6,1)   NOT NULL,
  carbs_per_100g  DECIMAL(5,1),
  protein_per_100g DECIMAL(5,1),
  fat_per_100g    DECIMAL(5,1),
  fiber_per_100g  DECIMAL(5,1),
  sodium_per_100g DECIMAL(7,1),
  gi_index        TINYINT UNSIGNED COMMENT '혈당지수 0~100',
  source          VARCHAR(30)    COMMENT '식품안전처 | 자체',
  external_code   VARCHAR(50)    COMMENT '식품안전처 식품코드',
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_name (name)
);

-- ============================================================
--  DOMAIN 4. 커머스 (Commerce)
-- ============================================================

-- 어글리어스 등 외부 마켓 상품 DB
CREATE TABLE products (
  id           CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  external_id  VARCHAR(100) NOT NULL COMMENT '어글리어스 상품 ID',
  name         VARCHAR(200) NOT NULL,
  price        INT UNSIGNED NOT NULL,
  image_url    VARCHAR(512),
  category     VARCHAR(50)  COMMENT '채소 | 과일 | 단백질 ...',
  unit         VARCHAR(20)  COMMENT '500g | 1kg | 1묶음',
  source       VARCHAR(30)  NOT NULL DEFAULT '어글리어스',
  in_stock     BOOLEAN      NOT NULL DEFAULT TRUE,
  synced_at    DATETIME     COMMENT '외부 API 동기화 시각',
  UNIQUE KEY uq_external (external_id, source)
);

CREATE TABLE cart_items (
  id         CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  product_id CHAR(36)     NOT NULL,
  quantity   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  added_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  UNIQUE KEY uq_cart (user_id, product_id)
);

CREATE TABLE orders (
  id              CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  user_id         CHAR(36)     NOT NULL,
  subtotal        INT UNSIGNED NOT NULL,
  coupon_discount INT UNSIGNED NOT NULL DEFAULT 0,
  points_used     INT UNSIGNED NOT NULL DEFAULT 0,
  final_price     INT UNSIGNED NOT NULL,
  payment_method  VARCHAR(20)  COMMENT '카카오페이 | 신용카드 | 토스페이',
  pg_transaction_id VARCHAR(100),
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                  COMMENT 'pending | paid | shipped | delivered | cancelled',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user_order (user_id, created_at)
);

CREATE TABLE order_items (
  id         CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  order_id   CHAR(36)     NOT NULL,
  product_id CHAR(36)     NOT NULL,
  quantity   TINYINT UNSIGNED NOT NULL,
  unit_price INT UNSIGNED NOT NULL COMMENT '주문 시점 가격 스냅샷',
  FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- ============================================================
--  DOMAIN 5. 커뮤니티 (Community)
-- ============================================================

CREATE TABLE posts (
  id           CHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  user_id      CHAR(36)  NOT NULL,
  title        VARCHAR(200) NOT NULL,
  recipe_steps TEXT,
  like_count   INT UNSIGNED NOT NULL DEFAULT 0,
  bookmark_count INT UNSIGNED NOT NULL DEFAULT 0,
  view_count   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_created (created_at)
);

CREATE TABLE post_images (
  id       CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  post_id  CHAR(36)     NOT NULL,
  image_url VARCHAR(512) NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 게시글 식재료 해시태그 (#닭가슴살150g)
CREATE TABLE post_ingredient_tags (
  id       CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  post_id  CHAR(36)     NOT NULL,
  food_id  CHAR(36),
  tag_name VARCHAR(50)  NOT NULL COMMENT '원본 태그명 그대로',
  amount_g DECIMAL(6,1),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (food_id) REFERENCES foods(id)
);

CREATE TABLE post_likes (
  id       CHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  post_id  CHAR(36)  NOT NULL,
  user_id  CHAR(36)  NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_like (post_id, user_id)
);

CREATE TABLE post_bookmarks (
  id       CHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  post_id  CHAR(36)  NOT NULL,
  user_id  CHAR(36)  NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_bookmark (post_id, user_id)
);

-- ============================================================
--  DOMAIN 6. 소셜 (Social)
-- ============================================================

CREATE TABLE follows (
  id           CHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  follower_id  CHAR(36)  NOT NULL COMMENT '팔로우 하는 사람',
  following_id CHAR(36)  NOT NULL COMMENT '팔로우 받는 사람',
  created_at   DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (follower_id)  REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_follow (follower_id, following_id),
  INDEX idx_following (following_id)
);

-- 응원 반응 (👏)
CREATE TABLE reactions (
  id            CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  sender_id     CHAR(36)    NOT NULL,
  receiver_id   CHAR(36)    NOT NULL,
  reaction_type VARCHAR(20) NOT NULL DEFAULT 'cheer',
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id)   REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
--  DOMAIN 7. 포인트 / 쿠폰 (Rewards)
-- ============================================================

CREATE TABLE user_points (
  user_id    CHAR(36)     PRIMARY KEY,
  balance    INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE point_history (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36)     NOT NULL,
  amount      INT NOT NULL  COMMENT '양수: 적립 / 음수: 사용',
  type        VARCHAR(20)  NOT NULL COMMENT 'earn | use | expire',
  description VARCHAR(100),
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_history (user_id, created_at)
);

CREATE TABLE coupons (
  id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  user_id          CHAR(36)     NOT NULL,
  discount_amount  INT UNSIGNED NOT NULL,
  expires_at       DATETIME     NOT NULL,
  is_used          BOOLEAN      NOT NULL DEFAULT FALSE,
  used_at          DATETIME,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
SET FOREIGN_KEY_CHECKS = 1;
-- ============================================================
--  끝
-- ============================================================
