const express = require('express');
const router = express.Router();
const bookingsController = require('../Controller/bookingsController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const upload = require('../Middleware/upload');

router.get('/eventtypes', bookingsController.getEventTypes);
router.get('/today',      bookingsController.getTodayEvents);
router.get('/upcoming',   bookingsController.getUpcomingEvents);
router.get('/summary',    bookingsController.getStatusSummary);
router.post('/create-payment-intent', bookingsController.createPaymentIntent);
router.post('/confirm-payment',       bookingsController.confirmPayment);
router.post('/validate-address', bookingsController.validateAddress);
router.get('/', bookingsController.getAllBookings);
router.post('/', upload.receipt('paymentProof'), bookingsController.createBooking);
router.post('/:id/payment', upload.receipt('paymentProof'), bookingsController.submitPaymentProof);
router.post('/:id/request', bookingsController.requestChange);
router.patch('/:id/request/resolve', requireInternalUser, bookingsController.resolveRequest);
router.get('/:id', bookingsController.getBookingById);
router.patch('/:id/status', requireInternalUser, bookingsController.updateBookingStatus);
router.patch('/:id/archive', requireInternalUser, bookingsController.archiveBooking);
router.put('/:id', requireInternalUser, bookingsController.updateBooking);
router.delete('/:id', requireInternalUser, bookingsController.deleteBooking);

module.exports = router;
