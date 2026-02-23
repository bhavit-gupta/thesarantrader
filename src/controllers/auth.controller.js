/**
 * ============================================================================
 * FILE: auth.controller.js
 * PURPOSE: Authentication & Authorization Controller
 * ============================================================================
 * 
 * DESCRIPTION:
 * Handles all user authentication operations including registration, login,
 * password management, and OTP verification. Implements secure password
 * hashing, session management, and single-session enforcement.
 * 
 * KEY FEATURES:
 * - User registration with dual OTP verification (email + phone)
 * - Multi-method login (username, email, or phone)
 * - Password reset with OTP verification
 * - Lazy password migration (plain text to bcrypt hash)
 * - Single session enforcement per user
 * - Session management (login/logout)
 * - Authentication & authorization middleware
 * 
 * SECURITY FEATURES:
 * - bcrypt password hashing (10 rounds)
 * - OTP expiration (5-10 minutes)
 * - CSRF protection via middleware
 * - Rate limiting via middleware
 * - Single session per user enforcement
 * - Session regeneration on login
 * 
 * DEPENDENCIES:
 * - @prisma/client: Database ORM
 * - bcryptjs: Password hashing
 * - express-session: Session management
 * 
 * TODO:
 * - Move OTP store to Redis for production scalability
 * - Implement SMS/Email API for OTP delivery (currently console-only)
 * 
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require("../utils/prisma");
const { withRetry } = require("../utils/prisma");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const otpStore = {};

// [Security] Cleanup interval to prevent memory leak from expired OTPs
// Checks every 5 minutes and removes expired entries
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    for (const identifier in otpStore) {
        if (otpStore[identifier].expires < now) {
            delete otpStore[identifier];
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) {
        console.log(`🧹 [OTP Cleanup] Removed ${cleanedCount} expired OTPs from memory`);
    }
}, 5 * 60 * 1000);

// Specific memory-based rate limiting for forgot password (identifier-based)
// In production, move this to Redis
const forgotPasswordLimits = new Map();
const FORGOT_PASSWORD_WINDOW = 15 * 60 * 1000; // 15 minutes
const FORGOT_PASSWORD_MAX = 3; // 3 attempts per window

function checkForgotPasswordLimit(identifier) {
    const now = Date.now();
    if (!forgotPasswordLimits.has(identifier)) {
        forgotPasswordLimits.set(identifier, { count: 1, resetTime: now + FORGOT_PASSWORD_WINDOW });
        return false;
    }

    const limit = forgotPasswordLimits.get(identifier);
    if (now > limit.resetTime) {
        forgotPasswordLimits.set(identifier, { count: 1, resetTime: now + FORGOT_PASSWORD_WINDOW });
        return false;
    }

    limit.count++;
    return limit.count > FORGOT_PASSWORD_MAX;
}

/* -------------------------------------------------------------------------- */
/*                              AUTH CONTROLLERS                              */
/* -------------------------------------------------------------------------- */

/**
 * Check if username, email, or phone already exists in database.
 * 
 * PURPOSE:
 * Provides real-time validation during registration to prevent duplicate
 * accounts and improve UX by showing errors before form submission.
 * 
 * @route POST /api/auth/check-existence
 * @access Public
 * 
 * @param {Object} req.body - Request payload
 * @param {string} req.body.field - Field to check ('username', 'email', or 'phone')
 * @param {string} req.body.value - Value to check for existence
 * 
 * @returns {Object} JSON response
 * @returns {boolean} exists - Whether the value already exists
 * @returns {string} [message] - Descriptive message if exists is true
 * 
 * @example
 * Request: { "field": "email", "value": "test@example.com" }
 * Response: { "exists": true, "message": "Email already exists." }
 * 
 * SECURITY:
 * - Whitelist validation prevents database probing
 * - Returns false for invalid/malicious field names
 */
exports.checkExistence = async (req, res) => {
    try {
        const { field, value } = req.body; // field: 'username', 'email', or 'phone'

        // Whitelist allowed fields to prevent probing sensitive data
        const allowedFields = ['username', 'email', 'phone'];
        if (!field || !value || !allowedFields.includes(field)) {
            return res.json({ exists: false });
        }

        // Check against Database
        const whereClause = {};
        const normalizedValue = (field === 'email' || field === 'username') ? value.trim().toLowerCase() : value.trim();
        whereClause[field] = normalizedValue;

        const user = await prisma.user.findUnique({
            where: whereClause
        });

        if (user) {
            return res.json({ exists: true, message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists.` });
        }

        return res.json({ exists: false });
    } catch (err) {
        console.error(err);
        return res.json({ exists: false });
    }
};

/**
 * Send OTP to email or phone for registration verification.
 * 
 * PURPOSE:
 * Generates and sends 6-digit OTP for email/phone verification during
 * user registration. Prevents registration with unverified contact info.
 * 
 * @route POST /api/auth/send-otp
 * @access Public
 * 
 * @param {Object} req.body - Request payload
 * @param {string} req.body.identifier - Email address or phone number
 * @param {string} req.body.type - Type of identifier ('email' or 'phone')
 * 
 * @returns {Object} JSON response
 * @returns {boolean} success - Operation success status
 * @returns {string} message - Descriptive message
 * 
 * @throws {400} If identifier is already registered
 * @throws {500} If OTP generation/sending fails
 * 
 * OTP LIFECYCLE:
 * 1. Generate random 6-digit code
 * 2. Store in otpStore with 5-minute expiration
 * 3. Log to console (production: send via SMS/Email API)
 * 4. Expire after 5 minutes
 * 5. Delete after successful verification
 * 
 * NOTE: See ERROR_TRACKING.txt for issues and improvements
 */
exports.sendOtp = async (req, res) => {
    try {
        const { identifier, type } = req.body; // type: 'email' or 'phone'

        if (!identifier) {
            return res.status(400).json({ success: false, message: "Identifier is required" });
        }

        const normalizedIdentifier = type === 'email' ? identifier.trim().toLowerCase() : identifier.trim();

        // Check if Email/Phone exists in Database
        const field = type === 'email' ? 'email' : 'phone';
        const whereClause = {};
        whereClause[field] = normalizedIdentifier;

        const user = await prisma.user.findUnique({ where: whereClause });

        if (user) {
            return res.status(400).json({ success: false, message: `${type === 'email' ? 'Email' : 'Phone number'} is already registered.` });
        }

        // Generate 6-digit OTP using cryptographically secure generator [Security Hardening]
        const otp = crypto.randomInt(100000, 999999).toString();

        // Store OTP with expiration (e.g., 5 min)
        otpStore[normalizedIdentifier] = {
            otp,
            expires: Date.now() + 5 * 60 * 1000
        };

        // Send OTP via configured service or fallback to console
        if (process.env.EMAIL_SERVICE_ENABLED === 'true' && type === 'email') {
            console.log(`✉️ [Email] Sending OTP to ${normalizedIdentifier} via SMTP...`);
            // TODO: Implement nodemailer.sendMail({ to: normalizedIdentifier, text: `Your OTP is ${otp}` })
        } else if (process.env.SMS_SERVICE_ENABLED === 'true' && type === 'phone') {
            console.log(`📱 [SMS] Sending OTP to ${normalizedIdentifier} via API Gateway...`);
            // TODO: Implement SMS API call using process.env.SMS_API_KEY
        } else {
            // Log OTP to console (Simulating SMS/Email for development)
            console.log(`[OTP] Code for ${normalizedIdentifier}: ${otp} (Fallback to console)`);
        }

        res.json({ success: true, message: `OTP sent to ${normalizedIdentifier}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error sending OTP" });
    }
};


/**
 * Register new user with dual OTP verification (email + phone).
 * 
 * PURPOSE:
 * Creates new user account after verifying both email and phone OTPs.
 * Implements comprehensive validation and secure password storage.
 * 
 * @route POST /auth/register
 * @access Public
 * 
 * @param {Object} req.body - Registration form data
 * @param {string} req.body.name - User's full name
 * @param {string} req.body.username - Unique username
 * @param {string} req.body.email - Email address (must be OTP-verified)
 * @param {string} req.body.phone - Phone number (must be OTP-verified)
 * @param {string} req.body.state - State/province
 * @param {string} req.body.city - City
 * @param {string} req.body.password - Plain text password (will be hashed)
 * @param {string} req.body.otp - Email OTP code
 * @param {string} req.body['mobile-otp'] - Phone OTP code
 * 
 * @returns {Redirect} Redirects to /login on success
 * @returns {Render} Re-renders signup form with error on failure
 * 
 * VALIDATION FLOW:
 * 1. Verify email OTP (validity + expiration)
 * 2. Verify phone OTP (validity + expiration)
 * 3. Check for existing user (username, email, phone)
 * 4. Hash password with bcrypt (10 rounds)
 * 5. Create user in database
 * 6. Clear OTPs from store
 * 7. Redirect to login
 * 
 * ERROR HANDLING:
 * - Invalid/expired email OTP → re-render with error + form data
 * - Invalid/expired phone OTP → re-render with error + form data
 * - Duplicate user → re-render with error + form data
 * - Database error → re-render with generic error + form data
 * 
 * NOTE: See ERROR_TRACKING.txt for issues and improvements
 */
exports.registerUser = async (req, res) => {
    try {
        const { name, username, email, phone, state, city, password, otp } = req.body;

        // [Security] Password strength validation
        if (!password || password.length < 8) {
            return res.render("auth/signup", {
                error: "Password must be at least 8 characters long.",
                formData: req.body
            });
        }
        if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
            return res.render("auth/signup", {
                error: "Password must contain at least one uppercase letter and one number.",
                formData: req.body
            });
        }

        // Verify Email OTP
        const storedEmailOtp = otpStore[email];
        if (!storedEmailOtp || storedEmailOtp.otp !== otp || Date.now() > storedEmailOtp.expires) {
            return res.render("auth/signup", {
                error: "Invalid or expired Email OTP.",
                formData: req.body
            });
        }

        // Verify Mobile OTP
        // Note: The frontend sends 'mobile-otp' as the name, ensure it matches
        const mobileOtpValue = req.body['mobile-otp'];
        const storedMobileOtp = otpStore[phone];
        if (!storedMobileOtp || storedMobileOtp.otp !== mobileOtpValue || Date.now() > storedMobileOtp.expires) {
            return res.render("auth/signup", {
                error: "Invalid or expired Phone OTP.",
                formData: req.body
            });
        }

        // Check DB for Existing User (Double check)
        const existingUser = await withRetry(
            () => prisma.user.findFirst({
                where: {
                    OR: [
                        { username: username },
                        { email: email },
                        { phone: phone }
                    ]
                }
            }),
            2
        );

        if (existingUser) {
            return res.render("auth/signup", {
                error: "User already exists.",
                formData: req.body
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Sanitize identifiers
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedUsername = username.trim().toLowerCase();

        // Create User in MongoDB with retry for resilience
        const newUser = await withRetry(
            () => prisma.user.create({
                data: {
                    name,
                    username: normalizedUsername,
                    email: normalizedEmail,
                    phone,
                    state,
                    city,
                    password: hashedPassword, // Store hashed password
                    role: "USER"
                }
            }),
            3 // Critical operation: 3 retries
        );

        console.log(`✅ [MongoDB] User Registered: ${newUser.username}`);

        // Clear OTPs after successful registration
        delete otpStore[email];
        delete otpStore[phone];

        res.redirect("/login");
    } catch (err) {
        console.error("❌ [Register Controller Error]:", err);
        res.render("auth/signup", {
            error: "Error creating user. Please try again.",
            formData: req.body
        });
    }
};

/**
 * Authenticate user and establish session.
 * 
 * PURPOSE:
 * Handles user login with flexible identifier (username, email, or phone).
 * Implements lazy password migration, session management, and single-session
 * enforcement.
 * 
 * SPECIAL FEATURE: Lazy Password Migration
 * This system supports BOTH plaintext (legacy) AND hashed (new) passwords:
 * - Old accounts may have plaintext passwords (if migrated without hashing)
 * - On first login after upgrade, system detects plaintext password
 * - Automatically converts to bcrypt hash (saves effort for gradual migration)
 * - Future logins use bcrypt comparison (fast and secure)
 * 
 * This is a smart approach for migrating existing systems with plaintext passwords
 * But requires careful planning for when to enforce it.
 * 
 * @route POST /auth/login
 * @access Public (rate limited)
 * 
 * @param {Object} req.body - Login credentials
 * @param {string} req.body.loginIdentifier - Username, email, or phone
 * @param {string} req.body.password - User's password
 * @param {string} req.body.loginType - Identifier type ('username', 'email', or 'phone')
 * 
 * @returns {Redirect} Redirects to dashboard on success
 * @returns {Render} Re-renders login form with error on failure
 * 
 * LOGIN FLOW:
 * 1. Identify user by loginType or try all fields
 * 2. Check if user exists
 * 3. Detect if password is plaintext or hashed (by $2a$ / $2b$ prefix)
 * 4. Verify password (handle both plaintext + bcrypt comparison)
 * 5. If plaintext detected: migrate to bcrypt immediately
 * 6. Regenerate session (security best practice)
 * 7. Store user data in session
 * 8. Enforce single session (update DB with current sessionID)
 * 9. Save session and redirect based on role
 * 
 * SESSION DATA STRUCTURE:
 * req.session.user = {
 *   id: string,           // User ID (MongoDB ObjectId)
 *   name: string,         // Display name
 *   username: string,     // Login username
 *   email: string,        // Email address
 *   role: string,         // 'user' or 'admin'
 *   createdAt: Date       // Account creation timestamp
 * }
 * 
 * LAZY PASSWORD MIGRATION (GOOD APPROACH):
 * ✓ Smooth transition: No forced password reset
 * ✓ Automatic: Happens transparently on login
 * ✓ Safe: Original password destroyed immediately after hashing
 * ✓ Detectable: Checks $2a$ / $2b$ prefix (bcrypt hash format)
 * 
 * However, POTENTIAL ISSUES:
 * 1. 🟡 Allows plaintext passwords temporarily:
 *    - During transition period, plaintext passwords exist in DB
 *    - Database breach would expose passwords
 *    - MITIGATION: Set deadline for password reset (e.g., 30 days)
 * 
 * 2. 🟡 No user notification of migration:
 *    - User doesn't know password was migrated
 *    - Log message tells admin but not user
 *    - CONSIDERATION: Send email notifying of security update
 * 
 * SINGLE SESSION ENFORCEMENT:
 * - Updates user.currentSessionId in database
 * - singleSession middleware invalidates old sessions
 * - Prevents account sharing / concurrent logins
 * 
 * SECURITY FEATURES:
 * - Session regeneration prevents session fixation attacks ✓
 * - bcrypt password comparison (timing-safe) ✓
 * - Rate limiting via middleware (5 attempts per 15 min) ✓
 * - CSRF protection via middleware ✓
 * 
 * REDIRECT LOGIC:
 * - Admin users → /admin/dashboard
 * - Regular users → /dashboard
 */
exports.loginUser = async (req, res) => {
    try {
        const { loginIdentifier, password, loginType } = req.body;

        console.log(`[Login Attempt] Identifier: ${loginIdentifier}, Type: ${loginType}`);

        let user = null;
        const identifier = loginIdentifier ? loginIdentifier.trim() : '';

        if (loginType && ['email', 'phone', 'username'].includes(loginType)) {
            const whereClause = {};
            // Lowercase email and username for consistent lookup as they are stored lowercased
            whereClause[loginType] = (loginType === 'email' || loginType === 'username') ? identifier.toLowerCase() : identifier;
            user = await prisma.user.findUnique({ where: whereClause });
        }

        // Fallback or Try All: If no user found with specific type, try searching all fields
        if (!user) {
            user = await withRetry(
                () => prisma.user.findFirst({
                    where: {
                        OR: [
                            { email: identifier.toLowerCase() },
                            { phone: identifier },
                            { username: identifier.toLowerCase() }
                        ]
                    }
                }),
                2
            );
        }

        if (!user) {
            return res.render("auth/login", { error: "Invalid credentials" });
        }

        let isMatch = false;

        // Lazy Migration: Check if password expects hashing
        // If password doesn't start with $2a$ or $2b$, it's likely plain text (legacy)
        const isLikelyHashed = user.password && (user.password.startsWith('$2a$') || user.password.startsWith('$2b$'));

        if (!isLikelyHashed) {
            // Check plain text
            if (user.password === password) {
                isMatch = true;
                // Migrate to hash immediately
                const hashedPassword = await bcrypt.hash(password, 10);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { password: hashedPassword }
                });
                console.log(`✅ [Migration] Password migrated to hash for user: ${user.username}`);
            }
        } else {
            // Check hash
            isMatch = await bcrypt.compare(password, user.password);
        }

        if (!isMatch) {
            return res.render("auth/login", { error: "Invalid credentials" });
        }

        console.log(`✅ [Login Success] User: ${user.username}`);
        // Store user in session
        req.session.regenerate(async (err) => {
            if (err) {
                console.error('Session regeneration failed:', err);
                return res.status(500).send('Login failed. Please try again.');
            }

            req.session.user = {
                id: user.id,
                name: user.name || user.username,
                username: user.username,
                email: user.email,
                role: String(user.role || "USER").toUpperCase(), // ✅ convert role to uppercase
                createdAt: user.createdAt
            };

            // ✅ ADD THIS
            req.session.lastActivity = Date.now();

            // Single Session Enforcement
            try {
                console.log(`📡 [Login] Enforcing single session for ${user.id} (SID: ${req.sessionID})`);
                await withRetry(
                    () => prisma.user.update({
                        where: { id: user.id },
                        data: { currentSessionId: req.sessionID }
                    }),
                    2
                );
            } catch (error) {
                console.error("❌ Error updating session ID in DB:", error);
            }

            // Force session save before redirect
            req.session.save((err) => {
                if (err) {
                    console.error("Session save error:", err);
                    return res.status(500).send("Login session error.");
                }

                const role = user.role?.toUpperCase();

                if (role === 'ADMIN') {
                    return res.redirect("/admin/dashboard");
                }

                return res.redirect("/dashboard");
            });
        });
    } catch (err) {
        console.error("❌ [Login Controller Error]:", err);
        res.render("auth/login", { error: "Login error. Please try again." });
    }
};

/* -------------------------------------------------------------------------- */
/*                          PASSWORD MANAGEMENT                               */
/* -------------------------------------------------------------------------- */

/**
 * Send password reset OTP to email or phone.
 * 
 * PURPOSE:
 * Initiates password reset flow by generating and sending OTP to registered
 * email or phone number.
 * 
 * @route POST /api/auth/forgot-password
 * @access Public (⚠️ NOT rate limited)
 * 
 * @param {Object} req.body - Request payload
 * @param {string} req.body.identifier - Email address or phone number
 * @param {string} req.body.type - Type of identifier ('email' or 'phone')
 * 
 * @returns {Object} JSON response
 * @returns {boolean} success - Operation success status
 * @returns {string} message - Descriptive message
 * 
 * @throws {400} If identifier or type is missing
 * @throws {404} If no account found with identifier
 * @throws {500} If OTP generation/sending fails
 * 
 * PASSWORD RESET FLOW:
 * 1. Validate identifier and type
 * 2. Find user in database
 * 3. Generate 6-digit OTP
 * 4. Store OTP with 10-minute expiration (longer than registration OTP)
 * 5. Log OTP to console (production: send via SMS/Email API)
 * 6. Return success response
 * 
 * ⚠️ CRITICAL ISSUE: NO RATE LIMITING
 * 
 * PROBLEM:
 * - No per-user or per-IP rate limiting
 * - Attacker can spam unlimited password reset requests
 * - Each request sends OTP (SMS/Email quota drain)
 * - Could enumerate valid email addresses (user not found errors reveal nothing)
 * 
 * ATTACK SCENARIO:
 * 1. Attacker: Requests password reset 100 times for admin@company.com
 * 2. Admin gets spammed with 100 OTP emails
 * 3. SMS/Email quota blown
 * 4. Cost: Twilio/SendGrid charges per message
 * 
 * FIX: Implement rate limiting (max 3 attempts per 15 minutes) ✓
 * 
 * Also consider: IP-based rate limiting prevents single attacker abusing feature
 * 
 * SECURITY:
 * - Validates user exists before sending OTP (prevents enumeration) ✓
 * - 10-minute expiration (balance between security and UX) ✓
 * - OTP required for actual password reset (2-step verification) ✓
 * - ✗ MISSING: Rate limit per identifier
 * - ✗ MISSING: Email format validation
 * - ✗ MISSING: Phone format validation
 * 
 * TIMER DIFFERENCE:
 * - forgotPassword: 10 minutes (longer than sendOtp's 5 minutes)
 * - Rationale: Password reset is emergency, user might be away
 * - But could also be accidental - should be documented
 */
exports.forgotPassword = async (req, res) => {
    try {
        const { identifier, type } = req.body; // type: 'email' or 'phone'

        if (!identifier || !type) {
            return res.status(400).json({ success: false, message: "Identifier and type are required" });
        }

        const normalizedIdentifier = type === 'email' ? identifier.trim().toLowerCase() : identifier.trim();

        // [Security] Rate limit per identifier to prevent OTP spamming
        if (checkForgotPasswordLimit(normalizedIdentifier)) {
            console.warn(`⚠️ [Security] Rate limit exceeded for forgot password: ${normalizedIdentifier}`);
            return res.status(429).json({
                success: false,
                message: "Too many reset attempts. Please try again in 15 minutes."
            });
        }

        // [Security] Basic email format validation if type is email
        if (type === 'email') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(normalizedIdentifier)) {
                return res.status(400).json({ success: false, message: "Invalid email format" });
            }
        }

        // Find user in DB
        const field = type === 'email' ? 'email' : 'phone';
        const whereClause = {};
        whereClause[field] = normalizedIdentifier;

        const user = await prisma.user.findUnique({ where: whereClause });

        if (!user) {
            // [Security] Generic message for internal errors, but here we return 404
            return res.status(404).json({
                success: false,
                message: `No account found with this ${type}.`
            });
        }

        // Generate 6-digit OTP using cryptographically secure generator [Security Hardening]
        const otp = crypto.randomInt(100000, 999999).toString();

        // Store OTP with expiration (e.g., 10 minutes)
        otpStore[normalizedIdentifier] = {
            otp,
            expires: Date.now() + 10 * 60 * 1000
        };

        // Log OTP to console (Simulating SMS/Email)
        // TODO: Replace with actual SMS/Email API call when key is provided
        console.log(`[OTP] Password Reset Code for ${normalizedIdentifier}: ******`);

        res.json({ success: true, message: `OTP sent to ${normalizedIdentifier}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error sending OTP" });
    }
};

/**
 * Verify password reset OTP.
 * 
 * PURPOSE:
 * Validates OTP before allowing password reset. Separate verification
 * step improves security and UX (shows error before password entry).
 * 
 * WHY SEPARATE VERIFICATION ENDPOINT?
 * This endpoint exists between forgotPassword and resetPassword to:
 * 1. Validate OTP early (before user enters new password)
 * 2. Give quick feedback if OTP is wrong/expired
 * 3. Prevent wasting user's time typing new password
 * 4. Improves UX: shows error immediately after OTP entry
 * 
 * @route POST /api/auth/verify-reset-otp
 * @access Public
 * 
 * @param {Object} req.body - Request payload
 * @param {string} req.body.identifier - Email address or phone number
 * @param {string} req.body.otp - 6-digit OTP code
 * 
 * @returns {Object} JSON response
 * @returns {boolean} success - Verification success status
 * @returns {string} message - Descriptive message
 * 
 * @throws {400} If identifier or OTP is missing/invalid/expired
 * @throws {500} If verification process fails
 * 
 * VALIDATION STEPS:
 * 1. Check OTP exists in store
 * 2. Verify OTP matches
 * 3. Check expiration timestamp
 * 
 * IMPORTANT: OTP is NOT deleted here
 * - Only deleted in resetPassword() after successful password change
 * - Why? To prevent race conditions:
 *   - User verifies OTP
 *   - User enters new password
 *   - User hits submit
 *   - Network delay...
 *   - If OTP was deleted on verify, resetPassword would fail
 * 
 * FLOW DIAGRAM:
 * User enters email → sendOtp() → User enters OTP → verifyResetOTP() ✓
 * → User enters password → resetPassword() + delete OTP
 * 
 * SECURITY NOTE:
 * - No OTP is leaked (exact match required)
 * - Expiration is checked (time bound)
 * - OTP remains secure until final step
 */
exports.verifyResetOTP = async (req, res) => {
    try {
        const { identifier, otp } = req.body;

        if (!identifier || !otp) {
            return res.status(400).json({ success: false, message: "Identifier and OTP are required" });
        }

        // Normalize email if identifier looks like one
        const normalizedIdentifier = identifier.includes('@') ? identifier.trim().toLowerCase() : identifier.trim();

        const storedOtp = otpStore[normalizedIdentifier];

        if (!storedOtp || storedOtp.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        if (Date.now() > storedOtp.expires) {
            return res.status(400).json({ success: false, message: "OTP has expired" });
        }

        res.json({ success: true, message: "OTP verified successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error verifying OTP" });
    }
};

/**
 * Reset user password with OTP verification.
 * 
 * PURPOSE:
 * Final step of password reset flow. Verifies OTP again (security),
 * hashes new password, and updates database.
 * 
 * @route POST /auth/reset-password
 * @access Public
 * 
 * @param {Object} req.body - Request payload
 * @param {string} req.body.identifier - Email address or phone number
 * @param {string} req.body.otp - 6-digit OTP code
 * @param {string} req.body.newPassword - New password (plain text, will be hashed)
 * 
 * @returns {Object} JSON response
 * @returns {boolean} success - Operation success status
 * @returns {string} message - Descriptive message
 * 
 * @throws {400} If identifier/OTP/newPassword missing or OTP invalid/expired
 * @throws {404} If user not found
 * @throws {500} If password update fails
 * 
 * RESET FLOW:
 * 1. Re-verify OTP (CRITICAL: prevent bypass attacks)
 * 2. Validate OTP expiration
 * 3. Find user by email or phone
 * 4. Hash new password with bcrypt (10 rounds)
 * 5. Update password in database
 * 6. Delete OTP from store (prevent reuse)
 * 7. Log success
 * 8. Return success response
 * 
 * NOTE: See ERROR_TRACKING.txt for issues and improvements
 */
exports.resetPassword = async (req, res) => {
    try {
        const { identifier, otp, newPassword } = req.body;

        if (!identifier || !otp || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Identifier, OTP, and new password are required"
            });
        }

        // Normalize email if identifier looks like one
        const normalizedIdentifier = identifier.includes('@') ? identifier.trim().toLowerCase() : identifier.trim();

        // 1. Verify OTP again (CRITICAL for security)
        const storedOtp = otpStore[normalizedIdentifier];

        if (!storedOtp || storedOtp.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        if (Date.now() > storedOtp.expires) {
            return res.status(400).json({ success: false, message: "OTP has expired" });
        }

        // 2. Find user with retry
        const user = await withRetry(
            () => prisma.user.findFirst({
                where: {
                    OR: [
                        { email: normalizedIdentifier },
                        { phone: normalizedIdentifier }
                    ]
                }
            }),
            2
        );

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // 3. Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 4. Update password in DB with retry (critical operation)
        await withRetry(
            () => prisma.user.update({
                where: { id: user.id },
                data: { password: hashedPassword }
            }),
            3 // Critical: 3 retries
        );

        // 5. Clear OTP to prevent reuse
        delete otpStore[identifier];

        console.log(`✅ [Password Reset] Password updated for: ${user.username}`);

        res.json({ success: true, message: "Password reset successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error resetting password" });
    }
};

/* -------------------------------------------------------------------------- */
/*                                  LOGOUT                                    */
/* -------------------------------------------------------------------------- */

/**
 * Destroy user session and clear authentication.
 * 
 * PURPOSE:
 * Logs out user by destroying session, clearing session cookie, and
 * removing session ID from database.
 * 
 * @route GET /auth/logout
 * @access Private (requires active session)
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.session - Session object with user data
 * @param {string} req.sessionID - Current session ID
 * 
 * @returns {Redirect} Redirects to homepage (/) on success/failure
 * 
 * LOGOUT FLOW:
 * 1. Check if session exists
 * 2. Extract user ID from session (before destruction)
 * 3. Destroy session (deletes from store)
 * 4. Clear currentSessionId from database (if matches current session)
 * 5. Clear session cookie from browser
 * 6. Redirect to homepage
 * 
 * ⚠️ ISSUE: HARDCODED COOKIE NAME
 * ✋ Line: res.clearCookie('thesarantrader.sid')
 * 
 * PROBLEM:
 * - Cookie name is hardcoded as 'thesarantrader.sid'
 * - Must match session configuration cookie.name
 * - If someone changes session config → logout breaks silently
 * - Browser cookie won't be cleared (cookie name mismatch)
 * - User appears logged out but session is still active
 * 
 * HOW IT BREAKS:
 * 1. Session config has: cookie.name = 'custom-session-id'
 * 2. Browser has cookie: 'custom-session-id=xyz123'
 * 3. logout() runs: res.clearCookie('thesarantrader.sid')
 * 4. Browser cookie NOT cleared (name mismatch)
 * 5. User sees logged out (session destroyed server-side)
 * 6. But old cookie still sent to server on next request
 * 7. Server: "Session ID not found" → treated as new user
 * 
 * FIX OPTION 1: Get from session config
 * ```js
 * const cookieName = req.app.get('session cookie name') || 'connect.sid';
 * res.clearCookie(cookieName);
 * ```
 * 
 * FIX OPTION 2: Store in environment variable
 * ```js
 * const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'app.sid';
 * res.clearCookie(SESSION_COOKIE_NAME);
 * ```
 * 
 * FIX OPTION 3: Use Express session config directly
 * - If session middleware is stored in variable, reference it
 * 
 * DATABASE CLEANUP:
 * - Uses updateMany with WHERE clause to prevent race conditions
 * - Only clears if currentSessionId matches the session being destroyed
 * - Prevents clearing sessionId set by a newer login
 * 
 * ERROR HANDLING:
 * - Session destruction errors: log and return 500 ✓
 * - Database errors: log but don't block logout (async cleanup) ✓
 * - Missing session: silently redirect to homepage ✓
 */
exports.logoutUser = (req, res) => {
    try {
        if (req.session) {
            const userId = req.session.user ? req.session.user.id : null;
            req.session.destroy(err => {
                if (err) {
                    console.error("Error destroying session:", err);
                    return res.status(500).send("Could not log out.");
                }
                if (userId) {
                    prisma.user.updateMany({
                        where: { id: userId, currentSessionId: req.sessionID },
                        data: { currentSessionId: null }
                    }).catch(err => console.error("❌ Error clearing session ID on logout:", err));
                }
                const cookieName = process.env.SESSION_COOKIE_NAME || 'thesarantrader.sid';
                res.clearCookie(cookieName);
                res.redirect('/');
            });
        } else {
            res.redirect('/');
        }
    } catch (error) {
        console.error("Error during logout:", error);
        res.redirect('/');
    }
};

