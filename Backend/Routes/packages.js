const express = require('express');
const router  = express.Router();
const pkgCtrl = require('../Controller/packagesController');
const { requireInternalUser } = require('../Middleware/authMiddleware');

router.get('/',    pkgCtrl.getAllPackages);
router.post('/',   requireInternalUser, pkgCtrl.createPackage);
router.get('/:id', pkgCtrl.getPackageById);
router.put('/:id', requireInternalUser, pkgCtrl.updatePackage);
router.patch('/:id/archive', requireInternalUser, pkgCtrl.archivePackage);
router.patch('/:id/popular', requireInternalUser, pkgCtrl.setPopularPackage);
router.delete('/:id', requireInternalUser, pkgCtrl.deletePackage);

module.exports = router;
