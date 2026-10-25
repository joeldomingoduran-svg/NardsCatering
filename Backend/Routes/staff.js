const express = require('express');
const router = express.Router();
const staffController = require('../Controller/staffController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');
const upload = require('../Middleware/upload');

router.post('/login', staffController.login);
router.get('/me', requireInternalUser, staffController.getOwnProfile);
router.put('/me', requireInternalUser, upload.single('profileImage'), staffController.updateOwnProfile);
router.post('/change-password', requireInternalUser, staffController.changeOwnPassword);
router.get('/', requireInternalUser, requireAdmin, staffController.getUsers);
router.post('/', requireInternalUser, requireAdmin, staffController.createUser);
router.put('/:id', requireInternalUser, requireAdmin, staffController.updateUser);
router.patch('/:id/status', requireInternalUser, requireAdmin, staffController.setStatus);
router.delete('/:id', requireInternalUser, requireAdmin, staffController.deleteUser);

module.exports = router;
