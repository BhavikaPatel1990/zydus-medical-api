import authPool from '../config/authDb.js';
import prisma from '../config/db.js';

export const INCIDENT_CATEGORY_FIELDS = [
  'patient_related',
  'icu_related',
  'medication_error',
  'health_care_associated_infection',
  'anesthesia_related',
  'laboratory_related',
  'radiology_related',
  'adverse_surgical_event',
  'supply_chain_related',
  'spillage_exposure_break_down',
  'employee_related',
  'infusion_related',
];

const normalizedKeys = (keys = []) => [...new Set(
  (Array.isArray(keys) ? keys : []).map((key) => String(key).trim()).filter((key) => INCIDENT_CATEGORY_FIELDS.includes(key))
)];

export const getAllowedIncidentCategories = async (user) => {
  try {
    const userId = user?.userId || user?.id;
    if (!userId) return [];

    const records = await prisma.incidentCategoryAccess.findMany({
      where: { user_id: String(userId), is_allowed: true },
      select: { category_key: true },
    });
    return normalizedKeys(records.map((row) => row.category_key));
  } catch (err) {
    console.error('[Incident Category Access Error]:', err.message);
    return [];
  }
};

export const getEmployeeCategoryAccess = async (userId) => {
  const result = await authPool.query(
    `SELECT id::text AS user_id, emp_id, username, full_name
       FROM public.users
      WHERE id::text = $1
      LIMIT 1`,
    [String(userId)]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  const records = await prisma.incidentCategoryAccess.findMany({
    where: { user_id: row.user_id, is_allowed: true },
    select: { category_key: true },
  });
  return {
    employee: { id: row.user_id, empId: row.emp_id, username: row.username, name: row.full_name || row.username },
    categories: normalizedKeys(records.map((access) => access.category_key)),
  };
};

export const replaceEmployeeCategoryAccess = async (userId, categoryKeys) => {
  const keys = normalizedKeys(categoryKeys);
  const employee = await authPool.query(
    'SELECT id FROM public.users WHERE id::text = $1 LIMIT 1',
    [String(userId)]
  );
  if (!employee.rows.length) {
    const error = new Error('Employee was not found in the master database');
    error.status = 404;
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.incidentCategoryAccess.deleteMany({ where: { user_id: String(userId) } });
    if (keys.length) {
      await tx.incidentCategoryAccess.createMany({
        data: keys.map((category_key) => ({
          user_id: String(userId),
          category_key,
          is_allowed: true,
        })),
      });
    }
  });
  return keys;
};
