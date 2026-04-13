const express = require("express");
const { getMyResults } = require("../controllers/resultController");
const { verifyToken } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/results/me", verifyToken, getMyResults);

module.exports = router;
