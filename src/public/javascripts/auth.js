// Auth Logic: Login, Signup, OTP, Password Reset

document.addEventListener('DOMContentLoaded', () => {
    // Login Method Toggle
    const btnUsername = document.getElementById('btn-username');
    const btnEmail = document.getElementById('btn-email');
    const btnPhone = document.getElementById('btn-phone');

    if (btnUsername) btnUsername.addEventListener('click', () => setLoginMethod('username'));
    if (btnEmail) btnEmail.addEventListener('click', () => setLoginMethod('email'));
    if (btnPhone) btnPhone.addEventListener('click', () => setLoginMethod('phone'));

    // Password Toggle
    document.querySelectorAll('.toggle-password-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const inputId = this.getAttribute('data-target');
            togglePassword(inputId, this);
        });
    });

    // Signup Validation
    const signupForm = document.querySelector('form[action="/auth/register"]');
    if (signupForm) {
        signupForm.addEventListener('submit', validateSignup);
    }

    // Live Existence Check
    const checkFields = [
        { id: 'username', field: 'username' },
        { id: 'email', field: 'email' },
        { id: 'phone', field: 'phone' }
    ];

    checkFields.forEach(({ id, field }) => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('blur', async () => {
                const value = input.value.trim();
                if (!value) return;

                try {
                    const response = await fetch('/auth/check-existence', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ field, value })
                    });
                    const data = await response.json();

                    if (data.exists) {
                        alert(data.message);
                        input.classList.add('border-red-500', 'bg-red-50');
                        input.value = ''; // Clear the input
                        input.focus();
                    } else {
                        input.classList.remove('border-red-500', 'bg-red-50');
                    }
                } catch (error) {
                    console.error("Error checking existence:", error);
                }
            });
        }
    });

    // OTP Inputs Auto-focus
    const otpInputs = document.querySelectorAll('.otp-input');
    if (otpInputs.length > 0) {
        otpInputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                if (e.target.value.length === 1) {
                    if (index < otpInputs.length - 1) otpInputs[index + 1].focus();
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && e.target.value === '') {
                    if (index > 0) otpInputs[index - 1].focus();
                }
            });
        });
    }
});


// Login Method Toggle Logic
function setLoginMethod(method) {
    const label = document.getElementById('login-label');
    const input = document.getElementById('login-input');
    const btnUsername = document.getElementById('btn-username');
    const btnEmail = document.getElementById('btn-email');
    const btnPhone = document.getElementById('btn-phone');

    if (!label || !input) return;

    [btnUsername, btnEmail, btnPhone].forEach(btn => {
        if (btn) btn.className = 'hover:text-blue-600 pb-1 transition-colors';
    });

    const activeClass = 'text-blue-600 border-b-2 border-blue-600 pb-1 transition-colors';

    const loginTypeInput = document.getElementById('login-type');
    if (loginTypeInput) loginTypeInput.value = method;

    if (method === 'username') {
        label.textContent = 'Username';
        input.type = 'text';
        input.placeholder = 'Enter your username';
        if (btnUsername) btnUsername.className = activeClass;
    } else if (method === 'email') {
        label.textContent = 'Email Address';
        input.type = 'email';
        input.placeholder = 'kundan@example.com';
        if (btnEmail) btnEmail.className = activeClass;
    } else if (method === 'phone') {
        label.textContent = 'Phone Number';
        input.type = 'tel';
        input.placeholder = '9876543210';
        input.pattern = '[0-9]{10}';
        input.maxLength = 10;
        input.oninput = function () { this.value = this.value.replace(/[^0-9]/g, ''); };
        if (btnPhone) btnPhone.className = activeClass;
        return;
    }

    if (method !== 'phone') {
        input.removeAttribute('pattern');
        input.removeAttribute('maxLength');
        input.oninput = null;
    }
}

// Toggle Password Visibility
function togglePassword(inputId, button) {
    const input = document.getElementById(inputId);
    const icon = button.querySelector('i');
    if (!input || !icon) return;

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// OTP Sending Functions
async function sendOTP() {
    const emailInput = document.getElementById('email');
    if (!emailInput) return;
    const email = emailInput.value;
    const otpContainer = document.getElementById('otp-container');
    const sendBtn = document.getElementById('btn-send-email-otp') || emailInput.nextElementSibling;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (emailRegex.test(email)) {
        try {
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.textContent = "Sending...";
            }

            const response = await fetch('/auth/send-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: email, type: 'email' })
            });

            const data = await response.json();

            if (data.success) {
                alert(data.message);
                if (otpContainer) otpContainer.classList.remove('hidden');
            } else {
                alert(data.message || "Failed to send OTP");
            }
        } catch (error) {
            console.error('Error:', error);
            alert("Error sending OTP");
        } finally {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = "Get OTP";
            }
        }
    } else {
        alert('Please enter a valid email address.');
        emailInput.focus();
    }
}

async function sendMobileOTP() {
    const phoneInput = document.getElementById('phone');
    if (!phoneInput) return;
    const phone = phoneInput.value;
    const otpContainer = document.getElementById('mobile-otp-container');
    const sendBtn = document.getElementById('btn-send-mobile-otp') || phoneInput.nextElementSibling;

    // Check if sendBtn is actually a button (in case structure changed)
    const btn = (sendBtn && sendBtn.tagName === 'BUTTON') ? sendBtn : null;

    const phoneRegex = /^\d{10}$/;

    if (phoneRegex.test(phone)) {
        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = "Sending...";
            }

            const response = await fetch('/auth/send-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: phone, type: 'phone' })
            });

            const data = await response.json();

            if (data.success) {
                alert(data.message);
                if (otpContainer) otpContainer.classList.remove('hidden');
            } else {
                alert(data.message || "Failed to send OTP");
            }
        } catch (error) {
            console.error('Error:', error);
            alert("Error sending OTP");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "Get OTP";
            }
        }
    } else {
        alert('Please enter a valid 10-digit phone number.');
        phoneInput.focus();
    }
}

// Signup Validation
function validateSignup(event) {
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const otpInput = document.getElementById('otp');
    const mobileOtpInput = document.getElementById('mobile-otp');

    if (!passwordInput || !confirmPasswordInput) return true;

    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    // Optional: Only validate OTPs if containers are visible or required
    // Assuming forced OTP check for now as per original code
    const otp = otpInput ? otpInput.value : '';
    const mobileOtp = mobileOtpInput ? mobileOtpInput.value : '';

    if ((otpInput && otp.length !== 6) || (mobileOtpInput && mobileOtp.length !== 6)) {
        event.preventDefault();
        alert("Please enter valid 6-digit OTPs for both Email and Mobile.");
        return false;
    }

    if (password !== confirmPassword) {
        event.preventDefault();
        alert("Passwords do not match!");
        return false;
    }
    return true;
}


// Password Reset Logic
let resetIdentifier = '';
let resetMethod = 'phone';

function switchToEmail() {
    resetMethod = 'email';
    const container = document.getElementById('identifier-section');
    if (!container) return;

    const label = container.querySelector('label');
    const inputWrapper = container.querySelector('.relative');
    const hint = container.querySelector('p.text-xs');
    const link = container.querySelector('p.text-sm');

    label.textContent = 'Email Address';
    inputWrapper.innerHTML = `
        <span class="absolute inset-y-0 left-0 w-11 flex items-center justify-center text-slate-400 pointer-events-none">
            <i class="fa-solid fa-envelope text-sm"></i>
        </span>
        <input type="email" id="reset-email"
            class="w-full pl-10 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            placeholder="your@email.com" required>
    `;
    hint.textContent = "We'll send an OTP to verify your identity.";
    link.innerHTML = '<a href="#" id="switch-phone-btn" class="text-blue-600 hover:text-blue-700 hover:underline font-medium">Reset using Phone instead</a>';

    // Re-attach listener
    document.getElementById('switch-phone-btn').addEventListener('click', (e) => {
        e.preventDefault();
        switchToPhone();
    });
}

function switchToPhone() {
    resetMethod = 'phone';
    const container = document.getElementById('identifier-section');
    if (!container) return;

    const label = container.querySelector('label');
    const inputWrapper = container.querySelector('.relative');
    const hint = container.querySelector('p.text-xs');
    const link = container.querySelector('p.text-sm');

    label.textContent = 'Phone Number';
    inputWrapper.innerHTML = `
        <span class="absolute inset-y-0 left-0 w-11 flex items-center justify-center text-slate-400 pointer-events-none">
            <i class="fa-solid fa-phone text-sm"></i>
        </span>
        <input type="tel" id="reset-phone"
            class="w-full pl-10 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
            placeholder="9876543210" pattern="[0-9]{10}" maxlength="10" required>
    `;
    // Re-attach constraint
    const input = document.getElementById('reset-phone');
    input.oninput = function () { this.value = this.value.replace(/[^0-9]/g, ''); };

    hint.textContent = "We'll send an OTP to verify your identity.";
    link.innerHTML = '<a href="#" id="switch-email-btn" class="text-blue-600 hover:text-blue-700 hover:underline font-medium">Reset using Email instead</a>';

    // Re-attach listener
    document.getElementById('switch-email-btn').addEventListener('click', (e) => {
        e.preventDefault();
        switchToEmail();
    });
}

async function sendResetOTP() {
    let identifier;

    if (resetMethod === 'phone') {
        const phoneInput = document.getElementById('reset-phone');
        identifier = phoneInput.value.trim();
        if (!identifier || identifier.length !== 10) {
            alert('Please enter a valid 10-digit phone number');
            return;
        }
    } else {
        const emailInput = document.getElementById('reset-email');
        identifier = emailInput.value.trim();
        if (!identifier || !identifier.includes('@')) {
            alert('Please enter a valid email address');
            return;
        }
    }

    try {
        const response = await fetch('/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, type: resetMethod })
        });

        const data = await response.json();

        if (data.success) {
            resetIdentifier = identifier;
            alert(data.message);
            document.getElementById('identifier-section').classList.add('hidden');
            document.getElementById('otp-section').classList.remove('hidden');
        } else {
            alert(data.message || 'Error sending OTP');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error sending OTP. Please try again.');
    }
}

async function verifyResetOTP() {
    const otpInput = document.getElementById('reset-otp');
    const otp = otpInput.value.trim();

    if (!otp || otp.length !== 6) {
        alert('Please enter the 6-digit OTP');
        return;
    }

    try {
        const response = await fetch('/auth/verify-reset-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: resetIdentifier, otp })
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('otp-section').classList.add('hidden');
            document.getElementById('password-section').classList.remove('hidden');
        } else {
            alert(data.message || 'Invalid OTP');
            otpInput.value = '';
            otpInput.focus();
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error verifying OTP. Please try again.');
    }
}

async function submitPasswordReset() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;

    if (!newPassword || !confirmPassword) {
        alert('Please fill in both password fields');
        return;
    }

    if (newPassword !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }

    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters long');
        return;
    }

    const otp = document.getElementById('reset-otp').value.trim();

    try {
        const response = await fetch('/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifier: resetIdentifier,
                otp,
                newPassword
            })
        });

        const data = await response.json();

        if (data.success) {
            alert('Password reset successfully! Redirecting to login...');
            window.location.href = '/login';
        } else {
            alert(data.message || 'Error resetting password');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error resetting password. Please try again.');
    }
}

// Expose functions required for inline onclicks if we haven't removed all of them yet
// But the goal is to remove them.
// We will bind sendOTP and sendMobileOTP via event listeners in the EJS setup or document-ready if IDs are present.
document.addEventListener('DOMContentLoaded', () => {
    // Bind Send OTP Buttons if they exist
    // Signup Email OTP
    const emailInput = document.getElementById('email');
    if (emailInput) {
        const sendEmailBtn = emailInput.nextElementSibling;
        // Better: ensure button has ID or class
        if (sendEmailBtn && sendEmailBtn.tagName === 'BUTTON') {
            sendEmailBtn.addEventListener('click', sendOTP);
        }
    }

    // Signup Mobile OTP
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        const sendPhoneBtn = phoneInput.nextElementSibling;
        if (sendPhoneBtn && sendPhoneBtn.tagName === 'BUTTON') {
            sendPhoneBtn.addEventListener('click', sendMobileOTP);
        }
    }

    // Password Reset Buttons
    const sendResetBtn = document.querySelector('button[onclick="sendResetOTP()"]');
    if (sendResetBtn) {
        sendResetBtn.removeAttribute('onclick');
        sendResetBtn.addEventListener('click', sendResetOTP);
    }

    const verifyResetBtn = document.querySelector('button[onclick="verifyResetOTP()"]');
    if (verifyResetBtn) {
        verifyResetBtn.removeAttribute('onclick');
        verifyResetBtn.addEventListener('click', verifyResetOTP);
    }

    const submitResetBtn = document.querySelector('button[onclick="submitPasswordReset()"]');
    if (submitResetBtn) {
        submitResetBtn.removeAttribute('onclick');
        submitResetBtn.addEventListener('click', submitPasswordReset);
    }

    // Switch Links
    const switchPhoneLink = document.querySelector('a[onclick="switchToPhone()"]');
    if (switchPhoneLink) {
        switchPhoneLink.removeAttribute('onclick');
        switchPhoneLink.addEventListener('click', (e) => { e.preventDefault(); switchToPhone(); });
    }
});
