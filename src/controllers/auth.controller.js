/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require("../utils/prisma");
const bcrypt = require("bcryptjs");

/* -------------------------------------------------------------------------- */
/*                                  OTP STORE                                 */
/* -------------------------------------------------------------------------- */

/** 
 * In-memory store for OTPs. 
 * NOTE: For production scalability, move this to Redis.
 */
const otpStore = {};

/* -------------------------------------------------------------------------- */
/*                              AUTH CONTROLLERS                              */
/* -------------------------------------------------------------------------- */

/**
 * API to check if a username, email, or phone is already taken.
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
        whereClause[field] = value;

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

/* ---------------- SEND OTP ---------------- */
exports.sendOtp = async (req, res) => {
    try {
        const { identifier, type } = req.body; // type: 'email' or 'phone'

        if (!identifier) {
            return res.status(400).json({ success: false, message: "Identifier is required" });
        }

        // Check if Email/Phone exists in Database
        const field = type === 'email' ? 'email' : 'phone';
        const whereClause = {};
        whereClause[field] = identifier;

        const user = await prisma.user.findUnique({ where: whereClause });

        if (user) {
            return res.status(400).json({ success: false, message: `${type === 'email' ? 'Email' : 'Phone number'} is already registered.` });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Store OTP with expiration (e.g., 5 minutes)
        otpStore[identifier] = {
            otp,
            expires: Date.now() + 5 * 60 * 1000
        };

        // Log OTP to console (Simulating SMS/Email) - In production, this should be removed or handled by SMS provider
        console.log(`[OTP] Code for ${identifier}: ****** (Check SMS/Email)`);

        res.json({ success: true, message: `OTP sent to ${identifier}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error sending OTP" });
    }
};


/* ---------------- REGISTRATION ---------------- */
exports.registerUser = async (req, res) => {
    try {
        const { name, username, email, phone, state, city, password, otp } = req.body;

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
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { username: username },
                    { email: email },
                    { phone: phone }
                ]
            }
        });

        if (existingUser) {
            return res.render("auth/signup", {
                error: "User already exists.",
                formData: req.body
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create User in MongoDB
        const newUser = await prisma.user.create({
            data: {
                name,
                username,
                email,
                phone,
                state,
                city,
                password: hashedPassword, // Store hashed password
                role: "user"
            }
        });

        console.log(`✅ [MongoDB] User Registered: ${newUser.username}`);

        // Clear OTPs after successful registration
        delete otpStore[email];
        delete otpStore[phone];

        res.redirect("/login");
    } catch (err) {
        console.error(err);
        res.render("auth/signup", {
            error: "Error creating user. Please try again.",
            formData: req.body
        });
    }
};

/* ---------------- LOGIN ---------------- */
exports.loginUser = async (req, res) => {
    try {
        const { loginIdentifier, password, loginType } = req.body;

        console.log(`[Login Attempt] Identifier: ${loginIdentifier}, Type: ${loginType}`);

        let user = null;

        if (loginType && ['email', 'phone', 'username'].includes(loginType)) {
            const whereClause = {};
            whereClause[loginType] = loginIdentifier;
            user = await prisma.user.findUnique({ where: whereClause });
        } else {
            // Fallback: Try all fields
            user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { email: loginIdentifier },
                        { phone: loginIdentifier },
                        { username: loginIdentifier }
                    ]
                }
            });
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
                id: user.id, // Store ID for DB references
                name: user.name || user.username,
                username: user.username,
                email: user.email,
                role: user.role || "user",
                createdAt: user.createdAt
            };

            // Single Session Enforcement: Save new session ID to DB
            try {
                console.log(`📡 [Login] Enforcing single session for ${user.id} (SID: ${req.sessionID})`);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { currentSessionId: req.sessionID }
                });
            } catch (error) {
                console.error("❌ Error updating session ID in DB:", error);
            }

            // Force session save before redirect to ensure cookie is set
            req.session.save((err) => {
                if (err) {
                    console.error("Session save error:", err);
                    return res.status(500).send("Login session error.");
                }

                if (user.role === 'admin') {
                    res.redirect("/admin/dashboard");
                } else {
                    res.redirect("/dashboard");
                }
            });
        });
    } catch (err) {
        console.error(err);
        res.render("auth/login", { error: "Login error. Please try again." });
    }
};

/* ---------------- PASSWORD MANAGEMENT ---------------- */

// ===== Forgot Password (Send Reset OTP) =====
exports.forgotPassword = async (req, res) => {
    try {
        const { identifier, type } = req.body; // type: 'email' or 'phone'

        if (!identifier || !type) {
            return res.status(400).json({ success: false, message: "Identifier and type are required" });
        }

        // Find user in DB
        const field = type === 'email' ? 'email' : 'phone';
        const whereClause = {};
        whereClause[field] = identifier;

        const user = await prisma.user.findUnique({ where: whereClause });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: `No account found with this ${type}.`
            });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Store OTP with expiration (e.g., 10 minutes)
        otpStore[identifier] = {
            otp,
            expires: Date.now() + 10 * 60 * 1000
        };

        // Log OTP to console (Simulating SMS/Email)
        // TODO: Replace with actual SMS/Email API call when key is provided
        console.log(`[OTP] Password Reset Code for ${identifier}: ******`);

        res.json({ success: true, message: `OTP sent to ${identifier}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error sending OTP" });
    }
};

// ===== Verify Reset OTP =====
exports.verifyResetOTP = async (req, res) => {
    try {
        const { identifier, otp } = req.body;

        if (!identifier || !otp) {
            return res.status(400).json({ success: false, message: "Identifier and OTP are required" });
        }

        const storedOtp = otpStore[identifier];

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

// ===== Reset Password =====
exports.resetPassword = async (req, res) => {
    try {
        const { identifier, otp, newPassword } = req.body;

        if (!identifier || !otp || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Identifier, OTP, and new password are required"
            });
        }

        // 1. Verify OTP again (CRITICAL for security)
        const storedOtp = otpStore[identifier];

        if (!storedOtp || storedOtp.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        if (Date.now() > storedOtp.expires) {
            return res.status(400).json({ success: false, message: "OTP has expired" });
        }

        // 2. Find user
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: identifier },
                    { phone: identifier }
                ]
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // 3. Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 4. Update password in DB
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword }
        });

        // 5. Clear OTP to prevent reuse
        delete otpStore[identifier];

        console.log(`✅ [Password Reset] Password updated for: ${user.username}`);

        res.json({ success: true, message: "Password reset successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error resetting password" });
    }
};

/* ---------------- LOGOUT ---------------- */
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
                    // Only clear if the DB session matches the one we're destroying
                    prisma.user.updateMany({
                        where: { id: userId, currentSessionId: req.sessionID },
                        data: { currentSessionId: null }
                    }).catch(err => console.error("❌ Error clearing session ID on logout:", err));
                }

                res.clearCookie('thesarantrader.sid'); // 👈 must match session name
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


/* ---------------- AUTH MIDDLEWARE ---------------- */

exports.isAuthenticated = (req, res, next) => {
    if (!req.session || !req.session.user) {
        if (req.accepts('html')) {
            return res.redirect('/login');
        }
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

exports.isAdmin = (req, res, next) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        if (req.accepts('html')) {
            return res.status(403).send('Forbidden');
        }
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
};