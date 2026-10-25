const express = require('express');
const router = express.Router();
const menuController = require('../Controller/menuController');
const { requireInternalUser } = require('../Middleware/authMiddleware');

router.get('/', menuController.getAllMenu);
router.post('/', requireInternalUser, menuController.createMenu);
router.get('/:id', menuController.getMenuById);
router.put('/:id', requireInternalUser, menuController.updateMenu);
router.delete('/:id', requireInternalUser, menuController.deleteMenu);

module.exports = router;
