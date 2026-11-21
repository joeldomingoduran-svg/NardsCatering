const express    = require('express');
const router     = express.Router();
const dishesCtrl = require('../Controller/dishesController');
const { requireInternalUser } = require('../Middleware/authMiddleware');
const { requirePermission } = require('../Model/permissions');
const canManage = [requireInternalUser, requirePermission('dishes.manage')];

router.get('/',       dishesCtrl.getAllDishes);
router.post('/',      ...canManage, dishesCtrl.createDish);
router.get('/:id/ingredients', dishesCtrl.getDishIngredients);
router.put('/:id/ingredients', ...canManage, dishesCtrl.replaceDishIngredients);
router.put('/:id',    ...canManage, dishesCtrl.updateDish);
router.patch('/:id/archive', ...canManage, dishesCtrl.archiveDish);
router.delete('/:id', ...canManage, dishesCtrl.deleteDish);

module.exports = router;
