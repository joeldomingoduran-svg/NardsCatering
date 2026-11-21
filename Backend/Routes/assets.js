const express    = require('express');
const router     = express.Router();
const assetsCtrl = require('../Controller/assetsController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const { requirePermission } = require('../Model/permissions');
const canManage = [requireInternalUser, requirePermission('assets.manage')];

router.get('/',    assetsCtrl.getAllAssets);
router.post('/',   ...canManage, assetsCtrl.createAsset);
router.put('/:id', ...canManage, assetsCtrl.updateAsset);
router.patch('/:id/archive', ...canManage, assetsCtrl.archiveAsset);
router.delete('/:id', ...canManage, assetsCtrl.deleteAsset);

module.exports = router;
