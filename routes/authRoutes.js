const express = require("express");
const { signup, login, demoLogin, resetDemoData } = require("../controllers/authController");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/demo-login", demoLogin);
router.post("/reset-demo", resetDemoData);

module.exports = router;
