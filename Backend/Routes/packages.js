const express = require('express');
const router  = express.Router();
const pkgCtrl = require('../Controller/packagesController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const { requirePermission } = require('../Model/permissions');
const canManage = [requireInternalUser, requirePermission('packages.manage')];

router.get('/',    pkgCtrl.getAllPackages);
router.post('/',   ...canManage, pkgCtrl.createPackage);
router.get('/:id', pkgCtrl.getPackageById);
router.put('/:id', ...canManage, pkgCtrl.updatePackage);
router.patch('/:id/archive', ...canManage, pkgCtrl.archivePackage);
router.patch('/:id/popular', ...canManage, pkgCtrl.setPopularPackage);
router.delete('/:id', ...canManage, pkgCtrl.deletePackage);

module.exports = router;
