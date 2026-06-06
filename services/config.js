const dotenv = require('dotenv');

dotenv.config();

// JWT Secret: shared across all routers and middlewares
if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not set in environment variables.');
  console.error('Please add JWT_SECRET=your-random-secret to your .env file.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const PORT = process.env.PORT || 9000;
const HOST = process.env.HOST || '0.0.0.0';

module.exports = {
  JWT_SECRET,
  PORT,
  HOST,
  SALT_ROUNDS: 10
};
