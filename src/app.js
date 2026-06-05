require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

const app = express();

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 라우터 (앞으로 여기에 추가)
app.use('/auth',     require('./routes/auth'));
app.use('/users',    require('./routes/users'));
app.use('/meals',    require('./routes/meals'));
app.use('/products', require('./routes/products'));
app.use('/orders',   require('./routes/orders'));
app.use('/posts',    require('./routes/posts'));
app.use('/follows',  require('./routes/social'));
app.use('/friends',  require('./routes/social'));
app.use('/recipes',  require('./routes/recipes'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

app.get('/swagger.json', (req, res) => {
  res.json(swaggerSpec);
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: '서버 오류' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중 → http://localhost:${PORT}`));