import express from 'express';
const router = express.Router();
import { stream } from '../../lib/liveEvents.js';

// the stream of what changes (lib/liveEvents.js) : event names only, the pages re-read
router.get('/', stream);

export default router
