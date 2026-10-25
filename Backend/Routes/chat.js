const express = require('express');
const router = express.Router();
const { chat } = require('../Controller/chatController');

router.post('/', chat);

module.exports = router;
