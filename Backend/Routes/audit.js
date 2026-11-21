const express = require('express');
const router = express.Router();
const auditController = require('../Controller/auditController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');
const { requirePermission } = require('../Model/permissions');

router.get('/', requireInternalUser, requirePermission('audit.view'), auditController.getAuditLog);
router.get('/logins', requireInternalUser, requireAdmin, auditController.getLoginActivity);

module.exports = router;
