const express = require('express');
const router = express.Router();
const inventoryController = require('../Controller/inventoryController');
const { requireInternalUser, requireManager } = require('../Middleware/authMiddleware');

router.get('/', inventoryController.getAllInventory);
router.post('/', requireInternalUser, requireManager, inventoryController.createInventory);
router.get('/:id', inventoryController.getInventoryById);
router.put('/:id', requireInternalUser, requireManager, inventoryController.updateInventory);
router.patch('/:id/archive', requireInternalUser, requireManager, inventoryController.archiveInventory);
router.delete('/:id', requireInternalUser, requireManager, inventoryController.deleteInventory);

module.exports = router;
