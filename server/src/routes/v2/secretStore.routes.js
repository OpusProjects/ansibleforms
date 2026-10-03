import express from 'express';
const router = express.Router();
import secretStoreController from '../../controllers/v2/secretStore.controller.js';

router.get('/', secretStoreController.find);
router.post('/', secretStoreController.create);
router.get('/:id', secretStoreController.findById);
router.put('/:id', secretStoreController.update);
router.delete('/:id', secretStoreController.delete);
// read-only connection test
router.post('/:id/check', secretStoreController.check);
router.get('/:id/mounts', secretStoreController.mounts);

export default router
