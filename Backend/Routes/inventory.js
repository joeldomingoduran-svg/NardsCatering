const express = require('express');
const router = express.Router();
const inventoryController = require('../Controller/inventoryController');
const { requireInternalUser, requireAdmin } = require('../Middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../Model/permissions');
const canManage = [requireInternalUser, requirePermission('inventory.manage')];
const canViewLogs = [requireInternalUser, requireAnyPermission('inventory.manage', 'assets.manage', 'reports.view', 'bookings.view')];

router.get('/movements', ...canViewLogs, inventoryController.getMovements);
router.get('/readiness', ...canViewLogs, inventoryController.getReadiness);
router.get('/approvals', requireInternalUser, requireAdmin, inventoryController.getApprovals);
router.patch('/approvals/:id', requireInternalUser, requireAdmin, inventoryController.reviewApproval);
router.get('/', inventoryController.getAllInventory);
router.post('/', ...canManage, inventoryController.createInventory);
router.post('/:id/dispose', ...canManage, inventoryController.disposeInventory);
router.get('/:id', inventoryController.getInventoryById);
router.put('/:id', ...canManage, inventoryController.updateInventory);
router.patch('/:id/archive', ...canManage, inventoryController.archiveInventory);
router.delete('/:id', ...canManage, inventoryController.deleteInventory);

module.exports = router;
