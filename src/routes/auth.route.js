const express = require("express");
const router = express.Router();

const {
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    verifyResetOTP,
    sendOtp,
    checkExistence
} = require("../controllers/auth.controller");

// Auth routes
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOTP);
router.post("/reset-password", resetPassword);
router.post("/send-otp", sendOtp);
router.post("/check-existence", checkExistence);

module.exports = router;
