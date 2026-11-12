import authPool from '../config/authDb.js';
import response from '../utils/response.js';

export const getLocations = async (req, res) => {
  try {
    const { site_id, siteId, search = '' } = req.query;
    const targetSiteId = site_id || siteId || req.user?.siteId;

    let query = `
      SELECT id, ward, mst_siteid
      FROM public.all_wards
      WHERE deleted_at IS NULL
    `;
    const params = [];

    if (targetSiteId && !isNaN(Number(targetSiteId))) {
      params.push(Number(targetSiteId));
      query += ` AND mst_siteid = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` AND ward ILIKE $${params.length}`;
    }

    query += ` ORDER BY ward ASC LIMIT 300`;

    const result = await authPool.query(query, params);
    const locations = (result?.rows || []).map((r) => ({
      id: r.id,
      name: r.ward,
      ward: r.ward,
      site_id: r.mst_siteid,
    }));

    return response.success(res, 'Locations fetched successfully', locations);
  } catch (err) {
    console.error('[Location Fetch Error]:', err.message);
    return response.serverError(res, 'Failed to fetch locations', err);
  }
};
