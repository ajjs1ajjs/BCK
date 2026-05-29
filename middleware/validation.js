const { z } = require('zod');

const schemas = {
  login: z.object({
    username: z.string().min(1).max(50),
    password: z.string().min(1).max(200),
  }),
  createUser: z.object({
    username: z.string().min(2).max(50).regex(/^[a-zA-Z0-9_-]+$/),
    password: z.string().min(4).max(200),
    role: z.string().min(1).max(50),
    email: z.string().email().optional().or(z.literal('')),
  }),
  createBackup: z.object({
    name: z.string().min(1).max(200),
    source: z.string().max(1000).optional(),
    destination: z.string().max(1000).optional(),
    type: z.string().max(50).optional(),
    backupType: z.string().max(50).optional(),
    config: z.any().optional(),
  }),
  createSchedule: z.object({
    name: z.string().min(1).max(200),
    cronExpression: z.string().min(1).max(100),
    backupId: z.string().min(1).max(100),
  }),
  dbConnection: z.object({
    name: z.string().min(1).max(200),
    type: z.enum(['mysql', 'postgres', 'oracle', 'mongodb']),
    host: z.string().min(1).max(500),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(200).optional().or(z.literal('')),
    password: z.string().max(2000).optional().or(z.literal('')),
    database: z.string().max(200).optional().or(z.literal('')),
  }),
  sshConnection: z.object({
    name: z.string().min(1).max(200),
    host: z.string().min(1).max(500),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(200),
    password: z.string().max(2000).optional(),
    key: z.string().max(50000).optional(),
  }),
  cloudCredential: z.object({
    name: z.string().min(1).max(200),
    provider: z.enum(['aws', 'azure', 'gcp']),
    credentials: z.record(z.any()),
  }),
  settings: z.object({
    smtp: z.any().optional(),
    retention: z.any().optional(),
    notifications: z.any().optional(),
    schedule: z.any().optional(),
    security: z.any().optional(),
    advanced: z.any().optional(),
    network: z.any().optional(),
  }),
};

function validate(schemaName, data) {
  const schema = schemas[schemaName];
  if (!schema) {
    throw new Error(`Schema ${schemaName} not found`);
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return { valid: false, errors };
  }
  return { valid: true, data: result.data };
}

module.exports = {
  validate,
  schemas
};
