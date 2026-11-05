const express = require('express');
const router = express.Router();
const controller = require('../Controller/rolesController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');

router.get('/me', requireInternalUser, controller.myPermissions);
router.get('/', requireInternalUser, requireAdmin, controller.getMatrix);
router.post('/', requireInternalUser, requireAdmin, controller.createRole);
router.put('/:role', requireInternalUser, requireAdmin, controller.updateRole);
router.patch('/:role/profile', requireInternalUser, requireAdmin, controller.editRole);
router.patch('/:role/status', requireInternalUser, requireAdmin, controller.setStatus);

module.exports = router;
