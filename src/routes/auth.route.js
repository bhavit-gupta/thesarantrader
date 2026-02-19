/* ---------------- DEPENDENCIES ---------------- */
const express = require("express");
const router = express.Router();

/* ---------------- CONTROLLERS ---------------- */
const {
    registerUser,
    loginUser,
    logoutUser,
    forgotPassword,
    resetPassword,
    verifyResetOTP,
    sendOtp,
    checkExistence
} = require("../controllers/auth.controller");

/* ---------------- ROUTE DEFINITIONS ---------------- */
// Auth routes
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOTP);
router.post("/reset-password", resetPassword);
router.post("/send-otp", sendOtp);
router.post("/check-existence", checkExistence);
router.post("/logout", logoutUser);

module.exports = router;
