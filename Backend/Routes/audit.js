const express = require('express');
const router = express.Router();
const auditController = require('../Controller/auditController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');

router.get('/', requireInternalUser, auditController.getAuditLog);
router.get('/logins', requireInternalUser, requireAdmin, auditController.getLoginActivity);

module.exports = router;
