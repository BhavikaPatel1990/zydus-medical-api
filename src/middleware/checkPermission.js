import authPool from '../config/authDb.js';
import response from '../utils/response.js';

export const isUserSuperAdmin = (user) => {
  if (!user) return false;

  const role = String(user.role || user.role_name || '').toUpperCase();

  // 1. Direct Super Admin role flag or is_super_admin boolean flag
  // NOTE: Normal 'ADMIN' or 'admin' role is NOT super admin; they have role-assigned permissions.
  if (role === 'SUPER_ADMIN' || user.is_super_admin === true || user.isSuperAdmin === true) {
    return true;
  }

  // 2. Multi-role checks if array
  if (Array.isArray(user.roles)) {
    return user.roles.some((r) => {
      const rName = String(typeof r === 'object' ? r.name || r.role_name : r).toUpperCase();
      return rName === 'SUPER_ADMIN';
    });
  }

  return false;
};

export const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return response.unauthorized(res, 'Unauthorized');
      }

      // 1. Super Admin has ALL ACCESS unconditionally
      if (isUserSuperAdmin(user)) {
        return next();
      }

      const reqAction = String(requiredPermission || 'READ').toUpperCase();
      const normAction = reqAction.replace(/[\s_-]+/g, '_');

      // 2. Check in-memory user permissions if present in token/session
      const userPerms = user.permissions;
      if (userPerms) {
        if (
          userPerms === 'ALL_ACCESS' ||
          userPerms[reqAction] === true ||
          userPerms[normAction] === true
        ) {
          return next();
        }

        const incidentKeys = ['INCIDENT_PORTAL', 'INCIDENTS', 'INCIDENT_REPORT', 'CLINICAL_INCIDENT'];
        for (const key of incidentKeys) {
          const modPerms = userPerms[key];
          if (Array.isArray(modPerms)) {
            const normalizedModPerms = modPerms.map(p => String(p).toUpperCase().replace(/[\s_-]+/g, '_'));
            if (normalizedModPerms.includes(normAction)) {
              return next();
            }
          }
        }
      }

      // 3. Fallback to live database check in zydusapp (Role Permissions + Direct User Module Permissions)
      const targetUserId = user.userId || user.id;
      const targetEmpId = user.empId || user.emp_id || user.username;

      const query = `
        SELECT DISTINCT p.permission_name
        FROM public.permissions p
        WHERE p.id IN (
          -- Via Assigned Role Permissions
          SELECT rp.permission_id
          FROM public.user_roles ur
          JOIN public.role_permissions rp ON rp.role_id = ur.role_id
          JOIN public.modules m ON m.id = rp.module_id
          WHERE (ur.user_id::text = $1 OR ur.user_id IN (SELECT id FROM public.users WHERE emp_id = $2 OR username = $2))
            AND (m.module_key IN ('INCIDENT_PORTAL', 'INCIDENTS', 'INCIDENT_REPORT', 'CLINICAL_INCIDENT') OR m.url ILIKE '%medical%' OR m.url ILIKE '%incident%')

          UNION

          -- Via Direct User Module Permissions
          SELECT ump.permission_id
          FROM public.user_module_permissions ump
          JOIN public.modules m ON m.id = ump.module_id
          WHERE (ump.user_id::text = $1 OR ump.user_id IN (SELECT id FROM public.users WHERE emp_id = $2 OR username = $2))
            AND (m.module_key IN ('INCIDENT_PORTAL', 'INCIDENTS', 'INCIDENT_REPORT', 'CLINICAL_INCIDENT') OR m.url ILIKE '%medical%' OR m.url ILIKE '%incident%')
        );
      `;

      const result = await authPool.query(query, [String(targetUserId || ''), String(targetEmpId || '')]);
      const actions = result.rows.map(r => String(r.permission_name).toUpperCase());
      const normActions = actions.map(a => a.replace(/[\s_-]+/g, '_'));

      if (actions.includes(reqAction) || normActions.includes(normAction)) {
        // Cache verified permissions on request
        if (!req.user.permissions || typeof req.user.permissions !== 'object') {
          req.user.permissions = {};
        }
        actions.forEach(act => {
          req.user.permissions[act] = true;
          req.user.permissions[act.replace(/[\s_-]+/g, '_')] = true;
        });
        return next();
      }

      return response.forbidden(
        res,
        `Access denied. You do not have '${reqAction}' permission for the Incident Occurrence Reporting Module.`
      );
    } catch (err) {
      console.error('[checkPermission error]:', err);
      return response.serverError(res, 'Permission verification failed', err.message);
    }
  };
};

export default checkPermission;
