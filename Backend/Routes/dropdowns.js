const express = require('express');
const router = express.Router();
const controller = require('../Controller/dropdownsController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');

router.get('/', requireInternalUser, requireAdmin, controller.listAll);
router.get('/:category', controller.listActive);
router.post('/', requireInternalUser, requireAdmin, controller.create);
router.put('/:id', requireInternalUser, requireAdmin, controller.update);
router.patch('/:id/status', requireInternalUser, requireAdmin, controller.setStatus);
router.delete('/:id', requireInternalUser, requireAdmin, controller.remove);

module.exports = router;
