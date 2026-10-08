import express from 'express';
import settingsController from '../../controllers/v2/settings.controller.js';

const router = express.Router();
// Retrieve settings
router.get('/', settingsController.find);
// Set settings
router.put('/', settingsController.update);
// Active config (reads/writes from the source set in config_source)
router.get('/config', settingsController.getConfig);
router.put('/config', settingsController.saveConfig);
// Import config (from config.yaml)
router.put('/importConfig', settingsController.importConfig);
// Export config (from database to config.yaml)
router.put('/exportConfig', settingsController.exportConfig);
// Test settings
router.post('/mailcheck/', settingsController.mailcheck);

export default router
