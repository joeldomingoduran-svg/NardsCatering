const express = require('express');
const router = express.Router();
const controller = require('../Controller/notificationsController');
const { requireInternalUser } = require('../Middleware/authMiddleware');

router.get('/', requireInternalUser, controller.list);
router.post('/read', requireInternalUser, controller.markRead);

module.exports = router;
