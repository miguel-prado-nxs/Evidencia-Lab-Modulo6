const abTestsService = require("../services/abTestsService");
const logger = require("../config/logger");

exports.create = async (req, res) => {
    try {
        const test = await abTestsService.createTest(req.body);
        res.status(201).json({ success: true, data: test });
    } catch (error) {
        logger.error("Error creating A/B Test:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getAll = async (req, res) => {
    try {
        const tests = await abTestsService.listTests();
        res.json({ success: true, data: tests });
    } catch (error) {
        logger.error("Error listing A/B Tests:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getProgress = async (req, res) => {
    try {
        const { id } = req.params;
        const progress = await abTestsService.getTestProgress(id);
        res.json({ success: true, data: progress });
    } catch (error) {
        logger.error(`Error getting progress for test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.start = async (req, res) => {
    try {
        const { id } = req.params;
        const test = await abTestsService.startTest(id);
        res.json({ success: true, data: test });
    } catch (error) {
        logger.error(`Error starting test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.stop = async (req, res) => {
    try {
        const { id } = req.params;
        const test = await abTestsService.stopTest(id);
        res.json({ success: true, data: test });
    } catch (error) {
        logger.error(`Error stopping test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.addCandidate = async (req, res) => {
    try {
        const { establishmentId } = req.body;
        // Optional: Get userId from req.user if authenticated
        await abTestsService.addCandidate(establishmentId);
        res.json({ success: true, message: "Candidate added" });
    } catch (error) {
        logger.error("Error adding candidate:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.addCandidatesBulk = async (req, res) => {
    try {
        const { establishmentIds } = req.body;
        const result = await abTestsService.addCandidatesBulk(establishmentIds);
        res.json({ success: true, message: "Candidates added", count: result.count });
    } catch (error) {
        logger.error("Error adding candidates bulk:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.removeCandidate = async (req, res) => {
    try {
        const { establishmentId } = req.params;
        await abTestsService.removeCandidate(establishmentId);
        res.json({ success: true, message: "Candidate removed" });
    } catch (error) {
        logger.error("Error removing candidate:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getCandidates = async (req, res) => {
    try {
        const candidates = await abTestsService.getCandidates();
        // Return array of IDs to match what frontend expects
        res.json({ success: true, data: candidates.map(c => c.establishmentId) });
    } catch (error) {
        logger.error("Error getting candidates:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.clearCandidates = async (req, res) => {
    try {
        await abTestsService.clearCandidates();
        res.json({ success: true, message: "All candidates cleared" });
    } catch (error) {
        logger.error("Error clearing candidates:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
