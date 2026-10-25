const express    = require('express');
const router     = express.Router();
const dishesCtrl = require('../Controller/dishesController');
const { requireInternalUser } = require('../Middleware/authMiddleware');

router.get('/',       dishesCtrl.getAllDishes);
router.post('/',      requireInternalUser, dishesCtrl.createDish);
router.get('/:id/ingredients', dishesCtrl.getDishIngredients);
router.put('/:id/ingredients', requireInternalUser, dishesCtrl.replaceDishIngredients);
router.put('/:id',    requireInternalUser, dishesCtrl.updateDish);
router.patch('/:id/archive', requireInternalUser, dishesCtrl.archiveDish);
router.delete('/:id', requireInternalUser, dishesCtrl.deleteDish);

module.exports = router;
