import { PrismaClient } from './prisma/generated/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const list = await prisma.incidentReport.findMany({
    orderBy: { created_at: 'desc' },
    take: 1,
    select: {
      id: true,
      incident_no: true,
      rca_method: true,
      rca_data: true,
      factors_which_contributed_to_the_event: true
    }
  });
  console.log('Success selecting rca_method:', list);
}

main().catch(console.error).finally(() => prisma.$disconnect());
