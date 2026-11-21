const express = require('express');
const router = express.Router();
const inventoryController = require('../Controller/inventoryController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const { requirePermission } = require('../Model/permissions');
const canManage = [requireInternalUser, requirePermission('inventory.manage')];

router.get('/', inventoryController.getAllInventory);
router.post('/', ...canManage, inventoryController.createInventory);
router.get('/:id', inventoryController.getInventoryById);
router.put('/:id', ...canManage, inventoryController.updateInventory);
router.patch('/:id/archive', ...canManage, inventoryController.archiveInventory);
router.delete('/:id', ...canManage, inventoryController.deleteInventory);

module.exports = router;
