import { Router } from 'express';
import { authorize } from '../middleware/authorize.js';
import { checkPermission } from '../middleware/checkPermission.js';
import { uploadIncidentImages } from '../middleware/upload.js';
import * as authController from '../controllers/auth.controller.js';
import * as employeeController from '../controllers/employee.controller.js';
import * as incidentController from '../controllers/incident.controller.js';
import * as patientController from '../controllers/patient.controller.js';
import * as locationController from '../controllers/location.controller.js';
import * as incidentCategoryAccessController from '../controllers/incidentCategoryAccess.controller.js';
import { isUserSuperAdmin } from '../middleware/checkPermission.js';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: true, service: 'zydus-medical-api', timestamp: new Date() });
});

// Auth routes
router.post('/auth/login', authController.login);
router.get('/auth/me', authorize, authController.getMe);

// Incident category access is employee-specific and managed only by Super Admin.
router.get('/incidents/category-access/me', authorize, incidentCategoryAccessController.myCategories);
router.get('/admin/incident-category-access/:userId', authorize, (req, res, next) => {
  if (!isUserSuperAdmin(req.user)) return res.status(403).json({ status: false, message: 'Super Admin access required' });
  next();
}, incidentCategoryAccessController.getEmployeeAccess);
router.put('/admin/incident-category-access/:userId', authorize, (req, res, next) => {
  if (!isUserSuperAdmin(req.user)) return res.status(403).json({ status: false, message: 'Super Admin access required' });
  next();
}, incidentCategoryAccessController.saveEmployeeAccess);

// Master lookups
router.get('/employees/search', authorize, employeeController.search);
router.get('/patients/search', authorize, patientController.searchPatients);
router.get('/locations', authorize, locationController.getLocations);

// Incident Report CRUD & Workflow with Permission Enforcement
router.post('/incidents', authorize, checkPermission('CREATE'), incidentController.create);
router.post('/incidents/upload', authorize, uploadIncidentImages, incidentController.uploadImages);
router.get('/incidents/images/:filename', incidentController.getImage);
router.get('/incidents/statuses', authorize, incidentController.getStatuses);
router.get('/incidents/export', authorize, checkPermission('READ'), incidentController.exportIncidents);
router.get('/incidents', authorize, checkPermission('READ'), incidentController.list);
router.get('/incidents/:id/edit', authorize, checkPermission('CREATE'), incidentController.getForReporterEdit);
router.put('/incidents/:id', authorize, checkPermission('CREATE'), incidentController.updateReporterIncident);
router.get('/incidents/:id', authorize, checkPermission('READ'), incidentController.getById);
router.put('/incidents/:id/hod-submit', authorize, incidentController.submitHod);
router.put('/incidents/:id/final-approve', authorize, checkPermission('FINAL_APPROVE'), incidentController.finalApprove);
router.get('/incidents/:id/pdf', authorize, checkPermission('READ'), incidentController.downloadPdf);
router.post('/incidents/:id/send-email', authorize, checkPermission('READ'), incidentController.sendEmail);

export default router;
