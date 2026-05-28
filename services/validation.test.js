const { z } = require('zod');

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
});

const backupSchema = z.object({
  name: z.string().min(1).max(200),
  source: z.string().max(1000).optional(),
  destination: z.string().max(1000).optional(),
  type: z.string().max(50).optional(),
  backupType: z.string().max(50).optional(),
});

test('login schema accepts valid input', () => {
  const r = loginSchema.safeParse({ username: 'admin', password: 'secret' });
  expect(r.success).toBe(true);
});

test('login schema rejects empty username', () => {
  const r = loginSchema.safeParse({ username: '', password: 'secret' });
  expect(r.success).toBe(false);
});

test('backup schema accepts valid input', () => {
  const r = backupSchema.safeParse({ name: 'Daily Backup', type: 'full', backupType: 'mysql' });
  expect(r.success).toBe(true);
});

test('backup schema rejects missing name', () => {
  const r = backupSchema.safeParse({ type: 'full' });
  expect(r.success).toBe(false);
});
