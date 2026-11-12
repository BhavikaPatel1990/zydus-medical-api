import { searchEmployees } from '../services/employee.service.js';
import response from '../utils/response.js';

export const search = async (req, res) => {
  try {
    const { q = '', role, site_id, siteId } = req.query;
    const rawSiteId = site_id ?? siteId ?? req.headers['x-site-id'] ?? req.user?.siteId;
    const siteFilter = (rawSiteId !== undefined && rawSiteId !== null && rawSiteId !== '' && String(rawSiteId).toUpperCase() !== 'ALL')
      ? Number(rawSiteId)
      : (req.user?.siteId ? Number(req.user.siteId) : null);

    if (!siteFilter) {
      return response.badRequest(res, 'A logged-in site is required to search employees');
    }

    const token = req.headers.authorization;
    const employees = await searchEmployees(q, siteFilter, 30, role, token);
    return response.success(res, 'Employees fetched successfully', employees);
  } catch (err) {
    return response.serverError(res, 'Failed searching employees', err);
  }
};
