const express = require('express');
const router = express.Router();
const clientsController = require('../Controller/clientController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');

router.post('/signup', clientsController.signupClient);
router.post('/login', clientsController.loginClient);
router.post('/verify-otp', clientsController.verifyOtp);
router.post('/resend-otp', clientsController.resendOtp);
router.post('/forgot-password', clientsController.forgotPassword);
router.post('/reset-password', clientsController.resetPassword);
router.get('/', requireInternalUser, clientsController.getAllClients);
router.post('/', requireInternalUser, requireAdmin, clientsController.createClient);
router.get('/:id', requireInternalUser, clientsController.getClientById);
router.put('/:id', requireInternalUser, requireAdmin, clientsController.updateClient);
router.delete('/:id', requireInternalUser, requireAdmin, clientsController.deleteClient);

module.exports = router;
