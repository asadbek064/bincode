require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const { initializeDb } = require('./db/connect');
const routes = require('./routes');

const app = express();

app.set('trust proxy', true);

// app.use(rateLimit({
//   windowMs: 2 * 60 * 1000, // 2min
//   max: 1000, // 1000 request per IP
// }));

app.use(express.json());
app.use(express.static('public'));

app.use('/api', routes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    //await initializeDb();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
