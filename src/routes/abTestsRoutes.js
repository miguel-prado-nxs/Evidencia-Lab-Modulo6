const express = require('express');
const router = express.Router();
const abTestsController = require('../controllers/abTestsController');

// Define routes
router.post('/', abTestsController.create);
router.get('/', abTestsController.getAll);
router.get('/:id/progress', abTestsController.getProgress);
router.patch('/:id/start', abTestsController.start);
router.patch('/:id/stop', abTestsController.stop);

// Candidates
router.post('/candidates', abTestsController.addCandidate);
router.get('/candidates', abTestsController.getCandidates);
router.post('/candidates/bulk', abTestsController.addCandidatesBulk);
router.delete('/candidates', abTestsController.clearCandidates);
router.delete('/candidates/:establishmentId', abTestsController.removeCandidate);

module.exports = router;
