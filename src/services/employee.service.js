import axios from 'axios';
import authPool from '../config/authDb.js';
import { getDepartmentMap, resolveDepartmentName } from './department.service.js';

const getUserListUrl = () => {
  const configuredBaseUrl = process.env.AUTH_SERVICE_URL?.trim();
  if (!configuredBaseUrl) {
    throw new Error('AUTH_SERVICE_URL must be configured to search site employees');
  }

  const baseUrl = configuredBaseUrl.replace(/\/+$/, '');
  return /\/api$/i.test(baseUrl) ? `${baseUrl}/user/list/` : `${baseUrl}/api/user/list/`;
};

const getUserList = (responseData) => {
  if (Array.isArray(responseData)) return responseData;
  if (Array.isArray(responseData?.data)) return responseData.data;
  if (Array.isArray(responseData?.data?.data)) return responseData.data.data;
  if (Array.isArray(responseData?.users)) return responseData.users;
  if (Array.isArray(responseData?.data?.users)) return responseData.data.users;
  return [];
};

const getEmployeeName = (employee) => (
  employee.full_name
  || employee.fullName
  || employee.name
  || employee.employee_name
  || employee.employeeName
  || employee.username
  || ''
);

const getEmployeeSiteId = (employee) => (
  employee.emp_site_id
  ?? employee.empSiteId
  ?? employee.site_id
  ?? employee.siteId
  ?? employee.emp_site?.id
  ?? employee.empSite?.id
  ?? employee.site?.id
);

const matchesSite = (employee, siteId) => {
  if (!siteId) return true;
  const employeeSiteId = getEmployeeSiteId(employee);
  if (employeeSiteId === null || employeeSiteId === undefined || employeeSiteId === '') {
    return false;
  }
  return Number(employeeSiteId) === Number(siteId);
};

/**
 * Search employees returned by the user-list API or database for the specified site.
 * @param {string} search - Search query (name, employee ID, department, email)
 * @param {number|string} siteId - Logged-in or selected site ID
 * @param {number} limit - Max results
 * @param {string} role - Optional result filter
 * @param {string} token - Optional incoming bearer token
 */
export const searchEmployees = async (search = '', siteId = null, limit = 25, role = '', token = null) => {
  try {
    if (!siteId || !Number.isFinite(Number(siteId))) {
      throw new Error('A valid logged-in site ID is required to search employees');
    }

    let employees = [];
    const term = search.trim().toLocaleLowerCase();

    // 1. Try fetching from AUTH_SERVICE_URL
    try {
      const headers = token ? { Authorization: token } : {};
      const response = await axios.get(getUserListUrl(), {
        headers,
        params: {
          page: 1,
          limit: 50,
          search: search.trim(),
          emp_site_id: Number(siteId),
          sort_by: 'full_name',
          sort_order: 'asc',
        },
        timeout: 15000,
      });

      if (response.data && response.data.status !== false) {
        employees = getUserList(response.data);
      }
    } catch (apiErr) {
      console.warn('[Employee Service API Notice]:', apiErr.message);
    }

    // 2. Fallback to direct DB query if API returned no data
    if ((!employees || employees.length === 0) && authPool) {
      try {
        const queryTerm = search.trim();
        const dbQuery = `
          SELECT u.id, u.emp_id, u.full_name, u.username, u.email, u.emp_dept, u.hod_email, u.incharge_email, u.mobile_number, u.emp_site_id
          FROM users u
          WHERE u.is_active = true
            AND u.emp_site_id = $1
            AND (
              $2 = ''
              OR u.full_name ILIKE '%' || $2 || '%'
              OR u.emp_id ILIKE '%' || $2 || '%'
              OR u.username ILIKE '%' || $2 || '%'
              OR u.email ILIKE '%' || $2 || '%'
              OR u.emp_dept ILIKE '%' || $2 || '%'
            )
          ORDER BY u.full_name ASC
          LIMIT $3
        `;
        const dbRes = await authPool.query(dbQuery, [Number(siteId), queryTerm, Number(limit) || 25]);
        employees = dbRes.rows;
      } catch (dbErr) {
        console.warn('[Employee Service DB Notice]:', dbErr.message);
      }
    }

    const deptMap = await getDepartmentMap();
    const resolveDept = (val) => {
      if (!val) return 'General';
      const s = String(val).trim();
      return deptMap.get(s.toLowerCase()) || deptMap.get(s) || s;
    };

    return (employees || [])
      .filter((employee) => matchesSite(employee, siteId))
      .filter((employee) => {
        if (role !== 'doctor') return true;
        return /^dr\.?\s/i.test(getEmployeeName(employee).trim());
      })
      .filter((employee) => {
        if (!term) return true;
        const fields = [
          getEmployeeName(employee),
          employee.emp_id,
          employee.empId,
          employee.employee_id,
          employee.username,
          employee.email,
          employee.emp_dept,
          employee.department,
        ];
        return fields.some((field) => String(field || '').toLocaleLowerCase().includes(term));
      })
      .sort((a, b) => getEmployeeName(a).localeCompare(getEmployeeName(b)))
      .slice(0, limit)
      .map((employee) => ({
        id: employee.id ?? employee.user_id,
        empId: employee.emp_id ?? employee.empId ?? employee.employee_id,
        name: getEmployeeName(employee),
        username: employee.username,
        email: employee.email,
        department: resolveDept(employee.emp_dept || employee.department),
        hodEmail: employee.hod_email ?? employee.hodEmail,
        inchargeEmail: employee.incharge_email ?? employee.inchargeEmail,
        mobile: employee.mobile_number ?? employee.mobile,
        siteId: getEmployeeSiteId(employee),
      }));
  } catch (err) {
    console.error('[Employee Service Error]:', err.message);
    throw err;
  }
};

/**
 * Get single employee details by emp_id
 */
export const getEmployeeByEmpId = async (empId, siteId = null) => {
  if (!empId) return null;
  try {
    const params = [String(empId)];
    const siteClause = siteId ? ' AND emp_site_id = $2' : '';
    const query = `
      SELECT id, emp_id, full_name, username, email, emp_dept, hod_email, mobile_number, emp_site_id
      FROM users
      WHERE (emp_id = $1 OR username = $1)${siteClause}
      LIMIT 1
    `;
    if (siteId) params.push(Number(siteId));
    const res = await authPool.query(query, params);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const resolvedDept = await resolveDepartmentName(row.emp_dept);
    return {
      id: row.id,
      empId: row.emp_id,
      name: row.full_name || row.username,
      username: row.username,
      email: row.email,
      department: resolvedDept,
      hodEmail: row.hod_email,
      siteId: row.emp_site_id,
    };
  } catch (err) {
    console.error('[Get Employee By EmpId Error]:', err.message);
    return null;
  }
};
