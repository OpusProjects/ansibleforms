import express from 'express';
const router = express.Router();
import runnerController from '../../controllers/v2/runner.controller.js';

router.get('/', runnerController.find);
router.get('/types', runnerController.types);
router.post('/', runnerController.create);
router.get('/:id', runnerController.findById);
router.put('/:id', runnerController.update);
router.delete('/:id', runnerController.delete);
// read-only connection test
router.post('/:id/check', runnerController.check);

export default router
