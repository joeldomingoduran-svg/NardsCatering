const express = require('express');
const router = express.Router();
const settingsController = require('../Controller/settingsController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');
const upload = require('../Middleware/upload');

router.get('/gcash-qr', settingsController.getGcashQr);
router.post('/gcash-qr', requireInternalUser, requireAdmin, upload.single('qr'), settingsController.setGcashQr);

module.exports = router;
