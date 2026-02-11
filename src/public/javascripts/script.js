const courses = [
    {
        id: 1,
        title: "March Batch: Options Trading",
        description: "Master the skills of risk management and profitable trading strategies.",
        rating: 4.6,
        students: 800,
        price: 4000,
        originalPrice: 8000,
        badge: "Bestseller",
        badgeColor: "orange",
        icon: "💹",
        iconBg: "blue-50",
        iconColor: "blue-500",
        demoVideo: "https://www.youtube.com/embed/p7HKvqRI_Bo"
    },
    {
        id: 2,
        title: "Technical Analysis Masterclass",
        description: "Learn to read charts, patterns, and indicators like a pro.",
        rating: 4.9,
        students: 500,
        price: 3500,
        originalPrice: 7000,
        icon: "📊",
        iconBg: "indigo-50",
        iconColor: "indigo-500",
        demoVideo: "https://www.youtube.com/embed/p7HKvqRI_Bo"
    },
    {
        id: 3,
        title: "Long-term Wealth Creation",
        description: "Understand company fundamentals and build a long-term portfolio.",
        rating: 4.7,
        students: 300,
        price: 2999,
        originalPrice: 6000,
        icon: "🏢",
        iconBg: "green-50",
        iconColor: "green-500",
        demoVideo: "https://www.youtube.com/embed/p7HKvqRI_Bo"
    },
    {
        id: 4,
        title: "Options Trading: Zero to Hero",
        description: "A complete guide from basics to advanced strategies.",
        rating: 5.0,
        students: 100,
        price: 4999,
        originalPrice: 10000,
        badgeColor: "purple",
        icon: "🚀",
        iconBg: "purple-50",
        iconColor: "purple-500",
        demoVideo: "https://www.youtube.com/embed/p7HKvqRI_Bo"
    }
];

function generateStars(rating) {
    const fullStars = Math.floor(rating);
    let starsHtml = '';
    for (let i = 0; i < 5; i++) {
        if (i < fullStars) {
            starsHtml += '★';
        } else {
            starsHtml += '☆';
        }
    }
    return starsHtml;
}

function renderCourses() {
    const grid = document.getElementById('courses-grid');
    if (!grid) return;

    grid.innerHTML = courses.map(course => `
        <div class="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-slate-100 overflow-hidden hover:shadow-xl transition-all duration-300 group">
            <div class="relative">
                <div class="aspect-video bg-${course.iconBg} w-full overflow-hidden flex items-center justify-center text-${course.iconColor} text-5xl">
                    ${course.icon}
                </div>
                ${course.badge ? `
                <div class="absolute top-4 right-4 bg-${course.badgeColor}-100 text-${course.badgeColor}-600 text-xs font-bold px-3 py-1 rounded-full border border-${course.badgeColor}-200">
                    ${course.badge}
                </div>` : ''}
            </div>
            <div class="p-6">
                <div class="flex items-center gap-2 mb-3">
                    <div class="flex text-yellow-400 text-xs">${generateStars(course.rating)}</div>
                    <span class="text-xs text-slate-500 font-medium">(${course.rating})</span>
                    <span class="text-xs text-slate-400">•</span>
                    <span class="text-xs text-slate-500 font-medium">${course.students} students enrolled</span>
                </div>
                <h3 class="text-lg font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
                    ${course.title}
                </h3>
                <p class="text-slate-600 text-sm mb-4 line-clamp-2">${course.description}</p>
                <div class="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                    <div>
                        <span class="text-2xl font-bold text-slate-800">₹${course.price}</span>
                        <span class="text-sm text-slate-400 line-through ml-2">₹${course.originalPrice}</span>
                    </div>
                    <a href="/enroll?id=${course.id}" class="px-4 py-2 rounded-lg bg-slate-50 text-slate-700 font-semibold text-sm hover:bg-blue-600 hover:text-white transition-all transform hover:-translate-y-0.5">
                        Enroll Now
                    </a>
                </div>
            </div>
        </div>
    `).join('');
}

function renderEnrollmentPage() {
    const container = document.getElementById('enrollment-container');
    if (!container) return;

    const urlParams = new URLSearchParams(window.location.search);
    const courseId = parseInt(urlParams.get('id'));
    const course = courses.find(c => c.id === courseId);

    if (!course) {
        container.innerHTML = `
            <div class="col-span-2 text-center py-20">
                <h2 class="text-3xl font-bold text-slate-800 mb-4">Course not found</h2>
                <a href="/courses" class="text-blue-600 hover:text-blue-700 font-semibold">Browse all courses</a>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <!-- Left Column: Course Details -->
        <div class="space-y-8">
            <div class="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
                 <!-- Video Section or Icon -->
                 ${course.demoVideo ? `
                 <div class="aspect-video w-full rounded-xl overflow-hidden mb-6 shadow-lg">
                    <iframe class="w-full h-full" src="${course.demoVideo}" title="Course Demo Video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                 </div>` : `
                 <div class="aspect-video bg-${course.iconBg} w-full rounded-xl overflow-hidden flex items-center justify-center text-${course.iconColor} text-6xl mb-6">
                    ${course.icon}
                </div>`}
                
                <div class="flex items-center gap-2 mb-4">
                    <span class="bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">Course</span>
                     ${course.badge ? `<span class="bg-${course.badgeColor}-100 text-${course.badgeColor}-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">${course.badge}</span>` : ''}
                </div>

                <h1 class="text-3xl font-bold text-slate-800 mb-4">${course.title}</h1>
                <p class="text-slate-600 text-lg mb-6 leading-relaxed">${course.description}</p>
                
                <div class="flex items-center gap-4 mb-8 text-sm text-slate-500">
                    <div class="flex items-center gap-1">
                        <span class="text-yellow-400">★</span> ${course.rating} Rating
                    </div>
                    <div>•</div>
                    <div>${course.students} Students Enrolled</div>
                </div>

                <div class="border-t border-slate-100 pt-6">
                    <h3 class="text-sm font-bold text-slate-800 uppercase tracking-widest mb-4">What you'll learn</h3>
                    <ul class="space-y-3">
                        <li class="flex items-start gap-3 text-slate-600">
                            <span class="text-green-500 font-bold">✓</span>
                            <span>Comprehensive understanding of market dynamics</span>
                        </li>
                        <li class="flex items-start gap-3 text-slate-600">
                            <span class="text-green-500 font-bold">✓</span>
                            <span>Risk management strategies used by pros</span>
                        </li>
                         <li class="flex items-start gap-3 text-slate-600">
                            <span class="text-green-500 font-bold">✓</span>
                            <span>Real-world case studies and live trading sessions</span>
                        </li>
                    </ul>
                </div>
            </div>
        </div>

        <!-- Right Column: Checkout Form -->
        <div class="bg-white rounded-2xl p-8 shadow-lg shadow-blue-500/5 border border-slate-100 sticky top-24">
            <div class="mb-8 pb-8 border-b border-slate-100">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-slate-500">Total Price</span>
                    <span class="text-3xl font-bold text-slate-800">₹${course.price}</span>
                </div>
                <div class="flex justify-end items-center gap-2">
                    <span class="text-slate-400 line-through text-sm">₹${course.originalPrice}</span>
                    <span class="text-green-600 text-sm font-semibold">${Math.round(((course.originalPrice - course.price) / course.originalPrice) * 100)}% OFF</span>
                </div>
            </div>

            <form class="space-y-4" onsubmit="event.preventDefault(); alert('Enrollment logic to be implemented!');">
                <div>
                    <label for="name" class="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                    <input type="text" id="name" class="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="John Doe" required>
                </div>
                <div>
                    <label for="email" class="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                    <input type="email" id="email" class="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="john@example.com" required>
                </div>
                <div>
                    <label for="phone" class="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                    <input type="tel" id="phone" class="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="+91 98765 43210" required>
                </div>

                <button type="submit" class="w-full py-4 mt-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:bg-blue-700 hover:shadow-blue-500/40 transition-all transform hover:-translate-y-0.5">
                    Complete Enrollment
                </button>

                <p class="text-xs text-center text-slate-400 mt-4">
                    By enrolling, you agree to our Terms of Service and Privacy Policy.
                </p>
            </form>
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    renderCourses();
    renderEnrollmentPage();

    // Mobile Menu Toggle
    const btn = document.getElementById('mobile-menu-btn');
    const menu = document.getElementById('mobile-menu');

    if (btn && menu) {
        btn.addEventListener('click', () => {
            menu.classList.toggle('hidden');
        });
    }
});




function sendOTP() {
    const emailInput = document.getElementById('email');
    const email = emailInput.value;
    const otpContainer = document.getElementById('otp-container');

    // Simple email regex for validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (emailRegex.test(email)) {
        alert(`OTP sent to ${email}`);
        // Show OTP input field
        otpContainer.style.display = 'block';
        // Here you would typically make an API call to send the OTP
    } else {
        alert('Please enter a valid email address first.');
        emailInput.focus();
    }
}

function sendMobileOTP() {
    const phoneInput = document.getElementById('phone');
    const phone = phoneInput.value;
    const otpContainer = document.getElementById('mobile-otp-container');

    // Strict 10-digit number validation
    const phoneRegex = /^\d{10}$/;

    if (phoneRegex.test(phone)) {
        alert(`OTP sent to ${phone}`);
        // Show Mobile OTP input field
        otpContainer.style.display = 'block';
        // Here you would typically make an API call to send the OTP
    } else {
        alert('Please enter a valid 10-digit phone number.');
        phoneInput.focus();
    }
}

function validateSignup(event) {
    event.preventDefault();

    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (password !== confirmPassword) {
        alert("Passwords do not match!");
        return false;
    }

    window.location.href = 'index.html';
    return true;
}

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

function setLoginMethod(method) {
    const label = document.getElementById('login-label');
    const input = document.getElementById('login-input');
    const btnUsername = document.getElementById('btn-username');
    const btnEmail = document.getElementById('btn-email');
    const btnPhone = document.getElementById('btn-phone');

    // Reset styles
    [btnUsername, btnEmail, btnPhone].forEach(btn => {
        btn.className = 'hover:text-blue-600 pb-1 transition-colors';
    });

    // Set active style
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
        input.oninput = function () { this.value = this.value.replace(/[^0-9]/g, '') };
        btnPhone.className = activeClass;
        return; // Exit early to avoid overwriting oninput/pattern if we switch away from phone
    }

    // Clear specific phone attributes if not phone
    if (method !== 'phone') {
        input.removeAttribute('pattern');
        input.removeAttribute('maxLength');
        input.oninput = null;
    }
}