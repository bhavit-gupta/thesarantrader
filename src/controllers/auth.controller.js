// const User = require("../models/user.model"); // Removed MongoDB dependency
const bcrypt = require("bcryptjs"); // Ensure bcryptjs is installed

// In-memory OTP store (Global variable for demo purposes)
const otpStore = {};

// In-memory User Store (For new registrations in this session)
const registeredUsers = [];

// Mock User Data for Validation (Hardcoded users with passwords)
const mockUsers = [
    { username: "admin", email: "admin@example.com", phone: "9876543210", password: "password123", role: "admin" },
    { username: "testuser", email: "test@example.com", phone: "9999999999", password: "password123", role: "user" },
    { username: "kundan_raj", email: "kundan@example.com", phone: "9876543211", password: "password123", role: "user" }
];

// ===== Check Existence API =====
exports.checkExistence = async (req, res) => {
    try {
        const { field, value } = req.body; // field: 'username', 'email', or 'phone'

        if (!field || !value) {
            return res.json({ exists: false });
        }

        // Check both hardcoded mock users and newly registered users
        const existsInMock = mockUsers.some(user => user[field] === value);
        const existsInSession = registeredUsers.some(user => user[field] === value);
        const exists = existsInMock || existsInSession;

        if (exists) {
            return res.json({ exists: true, message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists.` });
        }

        return res.json({ exists: false });
    } catch (err) {
        console.error(err);
        return res.json({ exists: false });
    }
};

// ===== Send OTP =====
exports.sendOtp = async (req, res) => {
    try {
        const { identifier, type } = req.body; // type: 'email' or 'phone'

        if (!identifier) {
            return res.status(400).json({ success: false, message: "Identifier is required" });
        }

        // Check if Email/Phone exists in Mock DB or Session DB
        const field = type === 'email' ? 'email' : 'phone';
        const existsInMock = mockUsers.some(user => user[field] === identifier);
        const existsInSession = registeredUsers.some(user => user[field] === identifier);
        const exists = existsInMock || existsInSession;

        if (exists) {
            return res.status(400).json({ success: false, message: `${type === 'email' ? 'Email' : 'Phone number'} is already registered.` });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Store OTP with expiration (e.g., 5 minutes)
        otpStore[identifier] = {
            otp,
            expires: Date.now() + 5 * 60 * 1000
        };

        // Log OTP to console (Simulating SMS/Email)
        console.log(`[OTP] Code for ${identifier}: ${otp}`);

        res.json({ success: true, message: `OTP sent to ${identifier}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error sending OTP" });
    }
};


// ===== Signup =====
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

        // Check Mock DB & Session DB for Existing User (Double check)
        const exists = [...mockUsers, ...registeredUsers].find(u => u.username === username || u.email === email || u.phone === phone);
        if (exists) {
            return res.render("auth/signup", {
                error: "User already exists.",
                formData: req.body
            });
        }

        // Mock User Creation - Save to Session Memory
        const newUser = { name, username, email, phone, state, city, password, role: "user" }; // Storing password plainly for mock demo
        registeredUsers.push(newUser);

        console.log("✅ [Mock DB] User Registered & Saved to Session Memory:");
        console.log(newUser);

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

// ===== Login =====
exports.loginUser = async (req, res) => {
    try {
        const { loginIdentifier, password, loginType } = req.body;

        console.log(`[Login Attempt] Identifier: ${loginIdentifier}, Type: ${loginType}`);

        // Find by specific field based on loginType (strict mode)
        const allUsers = [...mockUsers, ...registeredUsers];
        const user = allUsers.find(u => {
            if (loginType === 'email') return u.email === loginIdentifier;
            if (loginType === 'phone') return u.phone === loginIdentifier;
            if (loginType === 'username') return u.username === loginIdentifier;

            // Fallback for API calls without loginType (legacy/flexible behavior)
            return u.email === loginIdentifier || u.username === loginIdentifier || u.phone === loginIdentifier;
        });

        if (!user) {
            return res.render("auth/login", { error: "Invalid credentials (User not found)" });
        }

        // Simple string comparison for mock (Real app uses bcrypt)
        if (user.password !== password) {
            return res.render("auth/login", { error: "Invalid credentials (Password mismatch)" });
        }

        console.log(`✅ [Login Success] User: ${user.username}`);
        // Store user in session
        req.session.user = {
            name: user.name || user.username,
            username: user.username,
            email: user.email,
            role: user.role || "user"
        };
        if (user.username === 'admin') {
            res.redirect("/admin/dashboard");
        } else {
            res.redirect("/dashboard");
        }
    } catch (err) {
        console.error(err);
        res.render("auth/login", { error: "Login error. Please try again." });
    }
};

// ===== Forgot Password (Send Reset OTP) =====
// TODO: Integrate OTP API here
exports.forgotPassword = async (req, res) => {
    try {
        const { identifier, type } = req.body; // type: 'email' or 'phone'

        if (!identifier || !type) {
            return res.status(400).json({ success: false, message: "Identifier and type are required" });
        }

        // Find user in Mock DB or Session DB
        const field = type === 'email' ? 'email' : 'phone';
        const allUsers = [...mockUsers, ...registeredUsers];
        const user = allUsers.find(u => u[field] === identifier);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: `No account found with this ${type}.`
            });
        }

        // TODO: Client will provide OTP sending API
        // Example: await sendOTPViaClientAPI(identifier, type);
        console.log(`[TODO] Send OTP to ${identifier} via client API`);

        res.json({ success: true, message: `OTP will be sent to ${identifier} (Client API pending)` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error sending OTP" });
    }
};

// ===== Verify Reset OTP =====
// TODO: Integrate client's OTP verification API here  
exports.verifyResetOTP = async (req, res) => {
    try {
        const { identifier, otp } = req.body;

        if (!identifier || !otp) {
            return res.status(400).json({ success: false, message: "Identifier and OTP are required" });
        }

        // TODO: Client will provide OTP verification API
        // Example: const isValid = await verifyOTPViaClientAPI(identifier, otp);
        console.log(`[TODO] Verify OTP ${otp} for ${identifier} via client API`);

        res.json({ success: true, message: "OTP verification ready for client API integration" });
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

        // TODO: Verify OTP via API before resetting password
        console.log(`[TODO] Verify OTP ${otp} for ${identifier} via API before reset`);

        // Find user in Mock DB or Session DB
        const allUsers = [...mockUsers, ...registeredUsers];
        const user = allUsers.find(u => u.email === identifier || u.phone === identifier);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Update password (plain text for mock)
        user.password = newPassword;

        console.log(`✅ [Password Reset] Password updated for: ${user.username}`);

        res.json({ success: true, message: "Password reset successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error resetting password" });
    }
};

// ===== Logout =====
exports.logoutUser = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
};
