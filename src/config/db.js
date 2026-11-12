import { PrismaClient } from '../../prisma/generated/client/index.js';

const isDev = process.env.NODE_ENV === 'development';

const prisma = new PrismaClient({
  log: isDev ? ['error', 'warn'] : ['error'],
});

export default prisma;
