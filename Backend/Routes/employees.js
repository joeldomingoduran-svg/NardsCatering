const express = require('express');
const router = express.Router();
const controller = require('../Controller/employeesController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../Model/permissions');

router.use(requireInternalUser);
router.get('/', requireAnyPermission('employees.manage', 'bookings.manage'), controller.list);
router.post('/', requirePermission('employees.manage'), controller.create);
router.get('/booking/:id/team', requireAnyPermission('employees.manage', 'bookings.manage'), controller.getTeam);
router.put('/booking/:id/team', requireAnyPermission('employees.manage', 'bookings.manage'), controller.setTeam);
router.put('/:id', requirePermission('employees.manage'), controller.update);
router.patch('/:id/status', requirePermission('employees.manage'), controller.setStatus);

module.exports = router;
