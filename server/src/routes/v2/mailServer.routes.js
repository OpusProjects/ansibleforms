import express from 'express';
const router = express.Router();
import mailServerController from '../../controllers/v2/mailServer.controller.js';

router.get('/', mailServerController.find);
router.post('/', mailServerController.create);
router.get('/:id', mailServerController.findById);
router.put('/:id', mailServerController.update);
router.delete('/:id', mailServerController.delete);
// a test mail through the saved server
router.post('/:id/test', mailServerController.test);

export default router
