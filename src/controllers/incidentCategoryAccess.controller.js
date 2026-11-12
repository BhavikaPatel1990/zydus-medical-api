import response from '../utils/response.js';
import { isUserSuperAdmin } from '../middleware/checkPermission.js';
import {
  INCIDENT_CATEGORY_FIELDS,
  getAllowedIncidentCategories,
  getEmployeeCategoryAccess,
  replaceEmployeeCategoryAccess,
} from '../services/incidentCategoryAccess.service.js';

export const myCategories = async (req, res) => {
  try {
    const isSuper = isUserSuperAdmin(req.user);
    if (isSuper) {
      return response.success(res, 'Incident category access loaded', {
        categories: INCIDENT_CATEGORY_FIELDS,
        isSuperAdmin: true,
      });
    }

    const categories = await getAllowedIncidentCategories(req.user);
    return response.success(res, 'Incident category access loaded', {
      categories: categories || [],
      isSuperAdmin: false,
    });
  } catch (error) {
    console.error('[Incident category access]', error.message);
    return response.success(res, 'Incident category access loaded (fallback)', {
      categories: [],
      isSuperAdmin: false,
    });
  }
};

export const getEmployeeAccess = async (req, res) => {
  try {
    const access = await getEmployeeCategoryAccess(req.params.userId);
    if (!access) return response.notFound(res, 'Employee not found');
    return response.success(res, 'Employee category access loaded', access);
  } catch (error) {
    console.error('[Incident category access admin]', error.message);
    return response.serverError(res, 'Failed to load employee category access', error.message);
  }
};

export const saveEmployeeAccess = async (req, res) => {
  try {
    if (!Array.isArray(req.body.categories)) {
      return response.badRequest(res, 'categories must be an array');
    }
    const invalid = req.body.categories.filter((key) => !INCIDENT_CATEGORY_FIELDS.includes(key));
    if (invalid.length) return response.badRequest(res, 'One or more incident categories are invalid');

    const categories = await replaceEmployeeCategoryAccess(req.params.userId, req.body.categories);
    return response.success(res, 'Employee category access saved', { categories });
  } catch (error) {
    if (error.status === 404) return response.notFound(res, error.message);
    console.error('[Incident category access save]', error.message);
    return response.serverError(res, 'Failed to save employee category access', error.message);
  }
};
