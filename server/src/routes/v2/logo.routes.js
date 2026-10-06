import express from 'express';
import passport from 'passport';
import logoController from '../../controllers/v2/logo.controller.js';
import Middleware from '../../lib/middleware.js';

const router = express.Router();

// the logo is branding, shown in the header and on the login page - before anyone signs in -
// so reading it is public. Changing it needs an authenticated user with settings access.
const authenticate = passport.authenticate("jwt", { session: false });

// get the custom logo, or the default one (public : the login page shows it)
router.get('/', logoController.get);
// upload a new custom logo (settings access only)
router.post('/', authenticate, Middleware.checkSettingsMiddleware, logoController.update);
// remove the custom logo and fall back to the default (settings access only)
router.delete('/', authenticate, Middleware.checkSettingsMiddleware, logoController.remove);

export default router
