const express = require('express');
const router = express.Router();
const controller = require('../Controller/employeesController');
const { requireInternalUser, requireManager } = require('../Middleware/authMiddleware');

router.use(requireInternalUser, requireManager);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/booking/:id/team', controller.getTeam);
router.put('/booking/:id/team', controller.setTeam);
router.put('/:id', controller.update);
router.patch('/:id/status', controller.setStatus);

module.exports = router;
