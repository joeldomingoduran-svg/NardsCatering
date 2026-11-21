const express = require('express');
const router = express.Router();
const controller = require('../Controller/employeesController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const { requirePermission } = require('../Model/permissions');

router.use(requireInternalUser, requirePermission('employees.manage'));
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/booking/:id/team', controller.getTeam);
router.put('/booking/:id/team', controller.setTeam);
router.put('/:id', controller.update);
router.patch('/:id/status', controller.setStatus);

module.exports = router;
