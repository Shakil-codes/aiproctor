const express = require("express");
const {
  getExams,
  startExam,
  logEvent,
  chatReason,
  submitExam
} = require("../controllers/examController");
const { verifyToken } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/exams", verifyToken, getExams);
router.post("/exam/start", verifyToken, startExam);
router.post("/exam/log-event", verifyToken, logEvent);
router.post("/exam/chat-reason", verifyToken, chatReason);
router.post("/exam/submit", verifyToken, submitExam);

module.exports = router;
