const express = require('express');
const router = express.Router();
const abTestsController = require('../controllers/abTestsController');

// Define routes
router.post('/', abTestsController.create);
router.get('/', abTestsController.getAll);
router.get('/:id/progress', abTestsController.getProgress);
router.patch('/:id/start', abTestsController.start);
router.patch('/:id/stop', abTestsController.stop);

// Extended metrics endpoints
router.get('/:id/metrics', abTestsController.getMetrics);
router.get('/:id/winner', abTestsController.getWinner);
router.get('/:id/retry-contacts', abTestsController.getRetryContacts);
router.post('/call-logs/:callLogId/result', abTestsController.logCallResult);

// Agent status endpoint
router.get('/agent-status/:agentConfigId', abTestsController.getAgentRunningStatus);
router.post('/agents-status/bulk', abTestsController.getAgentsBulkRunningStatus);

// Candidates
router.post('/candidates', abTestsController.addCandidate);
router.get('/candidates', abTestsController.getCandidates);
router.get('/candidates/:userId', abTestsController.getCandidatesByUser);
router.post('/candidates/bulk', abTestsController.addCandidatesBulk);
router.delete('/candidates', abTestsController.clearCandidates);
router.delete('/candidates/:userId', abTestsController.clearCandidatesByUser);
router.delete('/candidates/:establishmentId', abTestsController.removeCandidate);
//endpoints de candidatos
router.delete('/candidates/candidate/:id', abTestsController.eliminateCandidateById);
router.get('/candidates/:userId/details', abTestsController.getCandidatesWithDetails);
router.get('/candidates/:userId/snapshot', abTestsController.getCandidatesWithSnapshot);

module.exports = router;
