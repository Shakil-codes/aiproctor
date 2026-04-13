const express = require("express");
const { getAdminResults } = require("../controllers/adminController");
const { verifyToken, requireAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/admin/results", verifyToken, requireAdmin, getAdminResults);

module.exports = router;
