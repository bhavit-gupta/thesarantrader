// Courses Data & Rendering Logic

// Global courses array (fetched from server)
let courses = [];

/* ---------------- DATA LOADING ---------------- */
// Fetch Courses from Server
async function fetchCourses() {
    try {
        const response = await fetch('/api/courses');
        if (!response.ok) throw new Error('Failed to fetch courses');
        courses = await response.json();
    } catch (error) {
        console.error("Error fetching courses:", error);
    }
}

/* ---------------- HELPER FUNCTIONS ---------------- */
// Star Rating Generator
function generateStars(rating) {
    const fullStars = Math.floor(rating);
    let starsHtml = '';
    for (let i = 0; i < 5; i++) {
        starsHtml += i < fullStars ? '★' : '☆';
    }
    return starsHtml;
}

/* ---------------- GLOBAL PURCHASE LOGIC ---------------- */
/* ---------------- GRID RENDERING ---------------- */
// Render Courses Grid (Home Page / Courses Page)
function renderCourses() {
    const grid = document.getElementById('courses-grid');
    if (!grid) return;

    if (courses.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-10 text-slate-500">No courses available at the moment.</div>';
        return;
    }

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
                    <span class="text-xs text-slate-500 font-medium"><i class="fa-solid fa-user-group text-blue-500 mr-1"></i> ${course.students} students enrolled</span>
                </div>
                <h3 class="text-lg font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">${course.title}</h3>
                <p class="text-slate-600 text-sm mb-4 line-clamp-2">${course.description}</p>
                
                ${course.startDate ? `
                <div class="mb-4 space-y-1 text-xs font-medium text-slate-500">
                    <div class="flex items-center gap-2">
                        <i class="fa-regular fa-calendar text-blue-500"></i>
                        <span>Starts: ${formatDate(course.startDate)}</span>
                    </div>
                    ${course.endDate ? `
                    <div class="flex items-center gap-2">
                        <i class="fa-regular fa-flag text-red-500"></i>
                        <span>Ends: ${formatDate(course.endDate)}</span>
                    </div>` : ''}
                    ${course.enrollmentDeadline ? `
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-hourglass-half text-orange-500"></i>
                        <span class="${new Date() > new Date(course.enrollmentDeadline) ? 'text-red-500 font-bold' : ''}">
                            Enroll by: ${formatDate(course.enrollmentDeadline)}
                        </span>
                    </div>` : ''}
                </div>` : ''}

                <div class="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                    <div><span class="text-2xl font-bold text-slate-800">₹${course.price}</span><span class="text-sm text-slate-400 line-through ml-2">₹${course.originalPrice}</span></div>
                    
                    ${(() => {
            const isPending = window.__PENDING_COURSES__ && window.__PENDING_COURSES__.some(id => String(id) === String(course.id));

            if (isPending) {
                return `<div class="px-4 py-2 rounded-lg bg-amber-50 text-amber-600 font-semibold text-sm border border-amber-200 flex items-center gap-1"><i class="fa-solid fa-clock"></i> Awaiting Verification</div>`;
            } else if (course.enrollmentDeadline && new Date() > new Date(course.enrollmentDeadline)) {
                return `<button disabled class="px-4 py-2 rounded-lg bg-slate-100 text-slate-400 font-semibold text-sm cursor-not-allowed">Enrollment Closed</button>`;
            } else {
                return `<a href="/enroll?id=${course.id}" class="px-4 py-2 rounded-lg bg-slate-50 text-slate-700 font-semibold text-sm hover:bg-blue-600 hover:text-white transition-all transform hover:-translate-y-0.5">Enroll Now</a>`;
            }
        })()}
                </div>
            </div>
        </div>
    `).join('');
}

/* ---------------- ENROLLMENT PAGE ---------------- */
// Render Enrollment Page
function renderEnrollmentPage() {
    const container = document.getElementById('enrollment-container');
    if (!container) return;

    const urlParams = new URLSearchParams(window.location.search);
    const courseId = urlParams.get('id');

    // Ensure courses are loaded before finding
    if (courses.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center py-20">Loading course details...</div>';
        return;
    }

    const course = courses.find(c => String(c.id) === String(courseId));

    if (!course) {
        container.innerHTML = `<div class="col-span-2 text-center py-20"><h2 class="text-3xl font-bold text-slate-800 mb-4">Course not found (ID: ${courseId})</h2><a href="/courses" class="text-blue-600 hover:text-blue-700 font-semibold">Browse all courses</a></div>`;
        return;
    }

    // Determine Button State
    let actionButton = '';
    const isPurchased = window.__PURCHASED_COURSES__ && window.__PURCHASED_COURSES__.some(id => String(id) === String(courseId));
    const isPending = window.__PENDING_COURSES__ && window.__PENDING_COURSES__.some(id => String(id) === String(courseId));

    if (!window.__AUTH_USER__) {
        // Guest User
        actionButton = `
            <a href="/login?redirect=${encodeURIComponent(window.location.href)}" class="w-full block text-center py-4 bg-slate-800 text-white font-bold rounded-xl shadow-lg hover:bg-slate-900 transition-all transform hover:-translate-y-0.5 text-lg">
                Login to Enroll
            </a>`;
    } else if (isPurchased) {
        // Already Enrolled
        actionButton = `
            <div class="w-full py-4 bg-green-50 text-green-700 font-bold rounded-xl border border-green-100 flex items-center justify-center gap-2 text-lg">
                <i class="fa-solid fa-circle-check"></i> Already Enrolled
            </div>
            <a href="/dashboard" class="block text-center text-sm font-semibold text-blue-600 hover:text-blue-700 mt-2">
                Go to Learning Dashboard →
            </a>`;
    } else if (isPending) {
        // Payment pending verification
        actionButton = `
            <div class="w-full py-4 bg-amber-50 text-amber-700 font-bold rounded-xl border border-amber-200 flex items-center justify-center gap-2 text-lg">
                <i class="fa-solid fa-clock"></i> Awaiting Verification
            </div>
            <p class="text-center text-sm text-amber-600 mt-2">
                Your payment proof has been submitted. Admin will verify shortly.
            </p>`;
    } else {
        // Logged in but not purchased
        actionButton = `
            <a href="/checkout/${course.id}" class="w-full block text-center py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:bg-blue-700 hover:shadow-blue-500/40 transition-all transform hover:-translate-y-0.5 text-lg">
                Enroll Now — ₹${course.price}
            </a>`;
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

        <!-- Buying / Pricing Card -->
        <div class="lg:sticky lg:top-28">
            <div class="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
                <!-- Price Header -->
                <div class="bg-gradient-to-r from-blue-600 to-blue-500 p-6 text-white text-center">
                    <p class="text-sm font-medium opacity-80 mb-1">Course Price</p>
                    <div class="flex items-center justify-center gap-3">
                        <span class="text-4xl font-bold">₹${course.price}</span>
                        <span class="text-lg line-through opacity-60">₹${course.originalPrice}</span>
                    </div>
                    <span class="inline-block mt-2 px-3 py-1 rounded-full bg-white/20 text-xs font-bold">${Math.round((1 - course.price / course.originalPrice) * 100)}% OFF</span>
                </div>

                <!-- Action Button Container -->
                <div class="p-6 space-y-4">
                    ${actionButton}

                    <!-- Course Highlights -->
                    <div class="space-y-3 pt-4 border-t border-slate-100">
                        <h4 class="text-sm font-bold text-slate-800 uppercase tracking-wider">This course includes</h4>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">📹</span> Live trading sessions with Kundan Sir
                        </div>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">📱</span> Access on Mobile and Web
                        </div>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">📊</span> Real-world case studies
                        </div>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">👥</span> Exclusive Community Access
                        </div>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">💬</span> Doubt clearing support
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="flex items-center justify-between pt-4 border-t border-slate-100 text-sm">
                        <div class="text-center">
                            <p class="font-bold text-slate-800">Verified</p>
                            <p class="text-slate-500 text-xs">Content</p>
                        </div>
                        <div class="text-center">
                            <p class="font-bold text-slate-800">${course.students}+</p>
                            <p class="text-slate-500 text-xs">Students</p>
                        </div>
                        <div class="text-center">
                            <p class="font-bold text-slate-800">24/7</p>
                            <p class="text-slate-500 text-xs">Support</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/* ---------------- INITIALIZATION ---------------- */
// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Fetch courses first
    await fetchCourses();

    // Then render appropriately
    renderCourses();
    renderEnrollmentPage();
});
