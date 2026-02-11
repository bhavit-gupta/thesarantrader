// ==========================
// Courses Data
// ==========================
const courses = [
    { id: 1, title: "March Batch: Options Trading", description: "Master the skills of risk management and profitable trading strategies.", rating: 4.6, students: 800, price: 4000, originalPrice: 8000, badge: "Bestseller", badgeColor: "orange", icon: "💹", iconBg: "blue-50", iconColor: "blue-500", demoVideo: "https://www.youtube.com/embed/p7HKvqRI_Bo" },
    { id: 2, title: "Technical Analysis Masterclass", description: "Learn to read charts, patterns, and indicators like a pro.", rating: 4.9, students: 500, price: 3500, originalPrice: 7000, icon: "📊", iconBg: "indigo-50", iconColor: "indigo-500", demoVideo: "https://www.youtube.com/embed/p7HKvqRI_Bo" },
    { id: 3, title: "Long-term Wealth Creation", description: "Understand company fundamentals and build a long-term portfolio.", rating: 4.7, students: 300, price: 2999, originalPrice: 6000, icon: "🏢", iconBg: "green-50", iconColor: "green-500", demoVideo: "https://www.youtube.com/embed/p7HKvqRI_Bo" },
    { id: 4, title: "Options Trading: Zero to Hero", description: "A complete guide from basics to advanced strategies.", rating: 5.0, students: 100, price: 4999, originalPrice: 10000, badgeColor: "purple", icon: "🚀", iconBg: "purple-50", iconColor: "purple-500", demoVideo: "https://www.youtube.com/embed/p7HKvqRI_Bo" }
];

// ==========================
// Star Rating Generator
// ==========================
function generateStars(rating) {
    const fullStars = Math.floor(rating);
    let starsHtml = '';
    for (let i = 0; i < 5; i++) {
        starsHtml += i < fullStars ? '★' : '☆';
    }
    return starsHtml;
}

// ==========================
// Render Courses Grid
// ==========================
function renderCourses() {
    const grid = document.getElementById('courses-grid');
    if (!grid) return;

    grid.innerHTML = courses.map(course => `
        <div class="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 group">
            <div class="relative">
                <div class="aspect-video bg-${course.iconBg} w-full flex items-center justify-center text-${course.iconColor} text-5xl">
                    ${course.icon}
                </div>
                ${course.badge ? `<div class="absolute top-4 right-4 bg-${course.badgeColor}-100 text-${course.badgeColor}-600 text-xs font-bold px-3 py-1 rounded-full border border-${course.badgeColor}-200">${course.badge}</div>` : ''}
            </div>
            <div class="p-6">
                <div class="flex items-center gap-2 mb-3">
                    <div class="flex text-yellow-400 text-xs">${generateStars(course.rating)}</div>
                    <span class="text-xs text-slate-500 font-medium">(${course.rating})</span>
                    <span class="text-xs text-slate-400">•</span>
                    <span class="text-xs text-slate-500 font-medium">${course.students} students enrolled</span>
                </div>
                <h3 class="text-lg font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">${course.title}</h3>
                <p class="text-slate-600 text-sm mb-4 line-clamp-2">${course.description}</p>
                <div class="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                    <div><span class="text-2xl font-bold text-slate-800">₹${course.price}</span><span class="text-sm text-slate-400 line-through ml-2">₹${course.originalPrice}</span></div>
                    <a href="/enroll?id=${course.id}" class="px-4 py-2 rounded-lg bg-slate-50 text-slate-700 font-semibold text-sm hover:bg-blue-600 hover:text-white transition-all transform hover:-translate-y-0.5">Enroll Now</a>
                </div>
            </div>
        </div>
    `).join('');
}

// ==========================
// Render Enrollment Page
// ==========================
function renderEnrollmentPage() {
    const container = document.getElementById('enrollment-container');
    if (!container) return;

    const urlParams = new URLSearchParams(window.location.search);
    const courseId = parseInt(urlParams.get('id'));
    const course = courses.find(c => c.id === courseId);

    if (!course) {
        container.innerHTML = `<div class="col-span-2 text-center py-20"><h2 class="text-3xl font-bold text-slate-800 mb-4">Course not found</h2><a href="/courses" class="text-blue-600 hover:text-blue-700 font-semibold">Browse all courses</a></div>`;
        return;
    }

    container.innerHTML = `
        <div class="space-y-8">
            <div class="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
                ${course.demoVideo ? `<div class="aspect-video w-full rounded-xl overflow-hidden mb-6 shadow-lg"><iframe class="w-full h-full" src="${course.demoVideo}" title="Course Demo Video" frameborder="0" allowfullscreen></iframe></div>` : `<div class="aspect-video bg-${course.iconBg} w-full rounded-xl overflow-hidden flex items-center justify-center text-${course.iconColor} text-6xl mb-6">${course.icon}</div>`}

                <div class="flex items-center gap-2 mb-4">
                    <span class="bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">Course</span>
                    ${course.badge ? `<span class="bg-${course.badgeColor}-100 text-${course.badgeColor}-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">${course.badge}</span>` : ''}
                </div>

                <h1 class="text-3xl font-bold text-slate-800 mb-4">${course.title}</h1>
                <p class="text-slate-600 text-lg mb-6 leading-relaxed">${course.description}</p>

                <div class="border-t border-slate-100 pt-6">
                    <h3 class="text-sm font-bold text-slate-800 uppercase tracking-widest mb-4">What you'll learn</h3>
                    <ul class="space-y-3">
                        <li class="flex items-start gap-3 text-slate-600"><span class="text-green-500 font-bold">✓</span>Comprehensive understanding of market dynamics</li>
                        <li class="flex items-start gap-3 text-slate-600"><span class="text-green-500 font-bold">✓</span>Risk management strategies used by pros</li>
                        <li class="flex items-start gap-3 text-slate-600"><span class="text-green-500 font-bold">✓</span>Real-world case studies and live trading sessions</li>
                    </ul>
                </div>
            </div>
        </div>
    `;
}

// ==========================
// OTP Functions
// ==========================
async function sendOTP() {
    const emailInput = document.getElementById('email');
    const email = emailInput.value;
    const otpContainer = document.getElementById('otp-container');
    const sendBtn = emailInput.nextElementSibling; // The "Get OTP" button

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (emailRegex.test(email)) {
        try {
            sendBtn.disabled = true;
            sendBtn.textContent = "Sending...";

            const response = await fetch('/auth/send-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: email, type: 'email' })
            });

            const data = await response.json();

            if (data.success) {
                alert(data.message);
                otpContainer.style.display = 'block';
            } else {
                alert(data.message || "Failed to send OTP");
            }
        } catch (error) {
            console.error('Error:', error);
            alert("Error sending OTP");
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = "Get OTP";
        }
    } else {
        alert('Please enter a valid email address.');
        emailInput.focus();
    }
}

async function sendMobileOTP() {
    const phoneInput = document.getElementById('phone');
    const phone = phoneInput.value;
    const otpContainer = document.getElementById('mobile-otp-container');
    const sendBtn = phoneInput.nextElementSibling;

    const phoneRegex = /^\d{10}$/;

    if (phoneRegex.test(phone)) {
        try {
            sendBtn.disabled = true;
            sendBtn.textContent = "Sending...";

            const response = await fetch('/auth/send-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: phone, type: 'phone' })
            });

            const data = await response.json();

            if (data.success) {
                alert(data.message);
                otpContainer.style.display = 'block';
            } else {
                alert(data.message || "Failed to send OTP");
            }
        } catch (error) {
            console.error('Error:', error);
            alert("Error sending OTP");
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = "Get OTP";
        }
    } else {
        alert('Please enter a valid 10-digit phone number.');
        phoneInput.focus();
    }
}

// ==========================
// Signup Validation
// ==========================
function validateSignup(event) {
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    const otp = document.getElementById('otp').value;
    const mobileOtp = document.getElementById('mobile-otp').value;

    if (otp.length !== 6 || mobileOtp.length !== 6) {
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

// ==========================
// Toggle Password Visibility
// ==========================
function togglePassword(inputId, button) {
    const input = document.getElementById(inputId);
    const icon = button.querySelector('i');

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

// ==========================
// Login Method Toggle
// ==========================
function setLoginMethod(method) {
    const label = document.getElementById('login-label');
    const input = document.getElementById('login-input');
    const btnUsername = document.getElementById('btn-username');
    const btnEmail = document.getElementById('btn-email');
    const btnPhone = document.getElementById('btn-phone');

    [btnUsername, btnEmail, btnPhone].forEach(btn => btn.className = 'hover:text-blue-600 pb-1 transition-colors');

    const activeClass = 'text-blue-600 border-b-2 border-blue-600 pb-1 transition-colors';

    if (method === 'username') {
        label.textContent = 'Username';
        input.type = 'text';
        input.placeholder = 'Enter your username';
        btnUsername.className = activeClass;
    } else if (method === 'email') {
        label.textContent = 'Email Address';
        input.type = 'email';
        input.placeholder = 'kundan@example.com';
        btnEmail.className = activeClass;
    } else if (method === 'phone') {
        label.textContent = 'Phone Number';
        input.type = 'tel';
        input.placeholder = '9876543210';
        input.pattern = '[0-9]{10}';
        input.maxLength = 10;
        input.oninput = function () { this.value = this.value.replace(/[^0-9]/g, ''); };
        btnPhone.className = activeClass;
        return;
    }

    if (method !== 'phone') {
        input.removeAttribute('pattern');
        input.removeAttribute('maxLength');
        input.oninput = null;
    }
}

// ==========================
// DOMContentLoaded
// ==========================
document.addEventListener('DOMContentLoaded', () => {
    renderCourses();
    renderEnrollmentPage();

    const btn = document.getElementById('mobile-menu-btn');
    const menu = document.getElementById('mobile-menu');
    if (btn && menu) btn.addEventListener('click', () => menu.classList.toggle('hidden'));

    // OTP Auto-Focus Logic
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

    // Real-time Existence Check
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
});

// ==========================
// Verify OTP Page Functions
// ==========================
function verifyOTP() {
    const inputs = document.querySelectorAll('.otp-input');
    let enteredOTP = '';
    inputs.forEach(input => enteredOTP += input.value);

    const errorMsg = document.getElementById('otp-error');
    const verifyBtn = document.getElementById('verify-btn');
    const passwordSection = document.getElementById('password-section');

    // Simulate Verification - Let's say correct OTP is "1234"
    if (enteredOTP === "1234") {
        // Success
        if (errorMsg) errorMsg.classList.add('hidden');
        if (verifyBtn) verifyBtn.classList.add('hidden');
        if (passwordSection) passwordSection.classList.remove('hidden');

        // Disable OTP inputs
        inputs.forEach(input => input.disabled = true);
    } else {
        // Failure
        if (errorMsg) errorMsg.classList.remove('hidden');

        inputs.forEach(input => {
            input.classList.add('border-red-500', 'bg-red-50');
            input.value = ''; // Clear inputs
        });
        if (inputs.length > 0) inputs[0].focus();

        // Clear error styling after 2 seconds
        setTimeout(() => {
            inputs.forEach(input => input.classList.remove('border-red-500', 'bg-red-50'));
        }, 2000);
    }
}

function resendOTP() {
    alert("New OTP sent to your email!");
    // Logic to resend OTP API call
}

function resetPassword() {
    alert('Password reset successfully!');
    window.location.href = '/login';
}

// ==========================
// Password Reset Functions
// ==========================
let resetIdentifier = ''; // Store identifier for later steps
let resetMethod = 'phone'; // Default to phone

function switchToEmail() {
    resetMethod = 'email';
    const container = document.getElementById('identifier-section');
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
    link.innerHTML = '<a href="#" onclick="switchToPhone()" class="text-blue-600 hover:text-blue-700 hover:underline font-medium">Reset using Phone instead</a>';
}

function switchToPhone() {
    resetMethod = 'phone';
    const container = document.getElementById('identifier-section');
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
            placeholder="9876543210" pattern="[0-9]{10}" maxlength="10" required
            oninput="this.value = this.value.replace(/[^0-9]/g, '')">
    `;
    hint.textContent = "We'll send an OTP to verify your identity.";
    link.innerHTML = '<a href="#" onclick="switchToEmail()" class="text-blue-600 hover:text-blue-700 hover:underline font-medium">Reset using Email instead</a>';
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
            document.getElementById('identifier-section').style.display = 'none';
            document.getElementById('otp-section').style.display = 'block';
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
            document.getElementById('otp-section').style.display = 'none';
            document.getElementById('password-section').style.display = 'block';
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

