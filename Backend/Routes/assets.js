const express    = require('express');
const router     = express.Router();
const assetsCtrl = require('../Controller/assetsController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const { requirePermission } = require('../Model/permissions');
const canManage = [requireInternalUser, requirePermission('assets.manage')];

router.get('/',    assetsCtrl.getAllAssets);
router.post('/',   ...canManage, assetsCtrl.createAsset);
router.post('/:id/damage', ...canManage, assetsCtrl.reportDamage);
router.post('/:id/damage/resolve', ...canManage, assetsCtrl.resolveDamage);
router.put('/:id', ...canManage, assetsCtrl.updateAsset);
router.patch('/:id/archive', ...canManage, assetsCtrl.archiveAsset);
router.delete('/:id', ...canManage, assetsCtrl.deleteAsset);

module.exports = router;
