import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import response from '../utils/response.js';

dotenv.config();

export const authorize = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return response.unauthorized(res, 'No Authorization header provided');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return response.unauthorized(res, 'Invalid token format. Expected Bearer <token>');
    }

    const token = parts[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      userId: decoded.id || decoded.userId,
      empId: String(decoded.emp_id || decoded.empId || decoded.username || ''),
      username: decoded.username,
      fullName: decoded.full_name || decoded.fullName || decoded.name,
      email: decoded.email,
      department: decoded.emp_dept || decoded.department,
      role: decoded.role_name || decoded.role || 'USER',
      siteId: Number(decoded.siteId ?? decoded.siteID ?? decoded.site_id ?? decoded.mst_site_id ?? 1),
      permissions: decoded.permissions || {},
    };

    next();
  } catch (err) {
    console.error('[Auth Error]:', err.message);
    return response.unauthorized(res, 'Session token expired or invalid');
  }
};

export default authorize;
