const express = require('express');
const router = express.Router();
const bookingsController = require('../Controller/bookingsController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const upload = require('../Middleware/upload');
const { requirePermission } = require('../Model/permissions');
const canManage = [requireInternalUser, requirePermission('bookings.manage')];

router.get('/eventtypes', bookingsController.getEventTypes);
router.get('/today',      bookingsController.getTodayEvents);
router.get('/upcoming',   bookingsController.getUpcomingEvents);
router.get('/summary',    bookingsController.getStatusSummary);
router.post('/create-payment-intent', bookingsController.createPaymentIntent);
router.post('/confirm-payment',       bookingsController.confirmPayment);
router.post('/validate-address', bookingsController.validateAddress);
router.get('/', bookingsController.getAllBookings);
router.post('/internal', ...canManage, (req, res, next) => { req.internalBooking = true; next(); }, bookingsController.createBooking);
router.post('/', upload.receipt('paymentProof'), bookingsController.createBooking);
router.post('/:id/payment', upload.receipt('paymentProof'), bookingsController.submitPaymentProof);
router.post('/:id/request', bookingsController.requestChange);
router.patch('/:id/request/resolve', ...canManage, bookingsController.resolveRequest);
router.get('/:id', bookingsController.getBookingById);
router.patch('/:id/status', ...canManage, bookingsController.updateBookingStatus);
router.patch('/:id/archive', ...canManage, bookingsController.archiveBooking);
router.put('/:id', ...canManage, bookingsController.updateBooking);
router.delete('/:id', ...canManage, bookingsController.deleteBooking);

module.exports = router;
