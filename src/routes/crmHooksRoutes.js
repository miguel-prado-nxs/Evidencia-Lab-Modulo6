const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../middleware/auth');
const crmHooksController = require('../controllers/crmHooksController');

router.post('/', authenticateApiKey, crmHooksController.handle);

module.exports = router;
