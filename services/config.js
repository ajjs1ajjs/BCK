const dotenv = require('dotenv');

dotenv.config();

// JWT Secret: shared across all routers and middlewares
if (!process.env.JWT_SECRET) {
  const fallbackSecret = require('crypto').randomBytes(32).toString('hex');
  process.env.JWT_SECRET = fallbackSecret;
  console.warn('WARNING: JWT_SECRET not set. Auto-generated. Set it in .env for persistence.');
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
