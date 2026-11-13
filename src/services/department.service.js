import authPool from '../config/authDb.js';

let deptMap = new Map();
let lastFetchedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

/**
 * Get map of department id/uuid/code -> department name
 */
export const getDepartmentMap = async () => {
  const now = Date.now();
  if (deptMap.size > 0 && now - lastFetchedAt < CACHE_TTL_MS) {
    return deptMap;
  }

  try {
    const res = await authPool.query(`
      SELECT id, his_dept_id, his_dept_name, dept_code
      FROM public.his_dept
      WHERE deleted_at IS NULL
    `);

    const newMap = new Map();
    for (const row of res.rows || []) {
      const name = (row.his_dept_name || '').trim();
      if (!name) continue;

      if (row.id) {
        newMap.set(String(row.id).toLowerCase(), name);
      }
      if (row.his_dept_id !== null && row.his_dept_id !== undefined) {
        newMap.set(String(row.his_dept_id).trim(), name);
      }
      if (row.dept_code) {
        newMap.set(String(row.dept_code).trim().toLowerCase(), name);
      }
    }

    deptMap = newMap;
    lastFetchedAt = now;
  } catch (err) {
    console.warn('[Department Service] Could not fetch his_dept from authDb:', err.message);
  }

  return deptMap;
};

/**
 * Resolve a department value (UUID, his_dept_id, code, or name) to a human-readable department name
 */
export const resolveDepartmentName = async (val) => {
  if (!val) return '';
  const str = String(val).trim();
  if (!str) return '';

  const map = await getDepartmentMap();
  const lower = str.toLowerCase();

  if (map.has(lower)) return map.get(lower);
  if (map.has(str)) return map.get(str);

  // If already a readable string and not a UUID or numeric ID, return as is
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  const isNumeric = /^\d+$/.test(str);

  if (!isUuid && !isNumeric) {
    return str;
  }

  // Fallback single query if not found in bulk map
  try {
    let query = '';
    const params = [str];
    if (isUuid) {
      query = 'SELECT his_dept_name FROM public.his_dept WHERE id = $1::uuid LIMIT 1';
    } else if (isNumeric) {
      query = 'SELECT his_dept_name FROM public.his_dept WHERE his_dept_id = $1::int LIMIT 1';
    }

    if (query) {
      const res = await authPool.query(query, params);
      if (res.rows.length > 0 && res.rows[0].his_dept_name) {
        const found = res.rows[0].his_dept_name.trim();
        map.set(lower, found);
        map.set(str, found);
        return found;
      }
    }
  } catch (e) {
    // ignore fallback lookup error
  }

  return str;
};
