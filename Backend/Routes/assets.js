const express    = require('express');
const router     = express.Router();
const assetsCtrl = require('../Controller/assetsController');
const { requireInternalUser } = require('../Middleware/authMiddleware');

router.get('/',    assetsCtrl.getAllAssets);
router.post('/',   requireInternalUser, assetsCtrl.createAsset);
router.put('/:id', requireInternalUser, assetsCtrl.updateAsset);
router.patch('/:id/archive', requireInternalUser, assetsCtrl.archiveAsset);
router.delete('/:id', requireInternalUser, assetsCtrl.deleteAsset);

module.exports = router;
