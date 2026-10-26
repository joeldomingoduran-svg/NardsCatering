const express = require('express');
const router = express.Router();
const controller = require('../Controller/rolesController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');

router.get('/me', requireInternalUser, controller.myPermissions);
router.get('/', requireInternalUser, requireAdmin, controller.getMatrix);
router.put('/:role', requireInternalUser, requireAdmin, controller.updateRole);

module.exports = router;
