const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

// JWT Secret: shared across all routers and middlewares
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: No JWT_SECRET set. Using a persistent generated secret for this session.');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

const PORT = process.env.PORT || 9000;
const HOST = process.env.HOST || '0.0.0.0';

module.exports = {
  JWT_SECRET,
  PORT,
  HOST,
  SALT_ROUNDS: 10
};
