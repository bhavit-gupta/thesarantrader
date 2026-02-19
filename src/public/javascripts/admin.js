// Admin Dashboard Scripts

/* ---------------- HELPER FUNCTIONS ---------------- */
function getLiveSessions() {
    const dataDiv = document.getElementById('admin-data');
    if (!dataDiv) return {};
    try {
        return JSON.parse(dataDiv.getAttribute('data-live-sessions'));
    } catch (e) {
        console.error("Failed to parse live sessions data", e);
        return {};
    }
}

function getAllCourses() {
    const dataDiv = document.getElementById('admin-data');
    if (!dataDiv) return [];
    try {
        return JSON.parse(dataDiv.getAttribute('data-courses')) || [];
    } catch (e) {
        console.error("Failed to parse courses data", e);
        return [];
    }
}

/* ---------------- TIMER LOGIC ---------------- */
function updateTimers() {
    const now = Date.now();
    const timers = document.querySelectorAll('[id^="timer-"]');

    timers.forEach(timer => {
        const startTimeStr = timer.getAttribute('data-start');
        if (!startTimeStr || startTimeStr === 'null') return;

        const startTime = parseInt(startTimeStr, 10);
        if (isNaN(startTime)) return;

        const diff = now - startTime;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        timer.innerText =
            (hours > 0 ? String(hours).padStart(2, '0') + ':' : '') +
            String(minutes).padStart(2, '0') + ':' +
            String(seconds).padStart(2, '0');
    });
}

/* ---------------- API ACTIONS ---------------- */
async function toggleCourseLive(courseId) {
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch('/admin/toggle-live', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ courseId })
        });
        const data = await response.json();

        if (data.success) {
            location.reload();
        } else {
            alert(data.message || 'Failed to toggle live status');
        }
    } catch (error) {
        console.error('Error toggling live:', error);
        alert('Error toggling live status');
    }
}

/* ---------------- EVENT LISTENERS ---------------- */
function setupEventListeners() {
    // Delete Confirmations
    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (form.action && form.action.includes('/admin/courses/delete/')) {
            if (!confirm('Are you sure you want to delete this course?')) {
                e.preventDefault();
            }
        }
    });

    // Event Delegation for Clicks
    document.addEventListener('click', (e) => {
        const target = e.target;

        // Dropdown Toggle Triggers
        const iconTrigger = target.closest('[id$="icon-dropdown-trigger"]');
        const colorTrigger = target.closest('[id$="color-dropdown-trigger"]');

        if (iconTrigger || colorTrigger) {
            e.preventDefault();
            e.stopPropagation(); // CRITICAL: Prevent document click listener from closing it immediately
            const trigger = iconTrigger || colorTrigger;
            const type = trigger.id.includes('edit') ? 'edit' : 'add';
            if (iconTrigger) {
                window.toggleIconDropdown(type);
            } else {
                window.toggleColorDropdown(type);
            }
            return;
        }

        // Edit Button
        const editBtn = target.closest('.edit-course-btn');
        if (editBtn) {
            e.preventDefault();
            const courseId = editBtn.getAttribute('data-course-id');
            const courseData = getAllCourses().find(c => String(c.id) === String(courseId));

            if (courseData) {
                openEditModal(courseData);
            } else {
                console.error("Course data not found for ID:", courseId);
                alert("Error: Course data not found. Please refresh the page.");
            }
            return;
        }

        // Live Toggle Button
        const toggleBtn = target.closest('.toggle-live-btn');
        if (toggleBtn) {
            e.preventDefault();
            if (toggleBtn.hasAttribute('disabled')) return;
            const courseId = toggleBtn.getAttribute('data-course-id');
            toggleCourseLive(courseId);
            return;
        }

        // Modal Close (Backdrop or Close Button)
        const modal = document.getElementById('editCourseModal');
        if (target === modal || target.closest('[onclick="closeEditModal()"]')) {
            e.preventDefault();
            closeEditModal();
            return;
        }

        // ---------------- PAYMENT ACTIONS (CSP Compliant) ----------------
        // Approve Payment
        const approveBtn = target.closest('.approve-payment-btn');
        if (approveBtn) {
            e.preventDefault();
            const purchaseId = approveBtn.getAttribute('data-purchase-id');
            approvePayment(purchaseId);
            return;
        }

        // Reject Payment
        const rejectBtn = target.closest('.reject-payment-btn');
        if (rejectBtn) {
            e.preventDefault();
            const purchaseId = rejectBtn.getAttribute('data-purchase-id');
            rejectPayment(purchaseId);
            return;
        }

        // Close Dropdowns on Outside Click
        const dropdownMenus = [
            { menuId: 'icon-dropdown-menu-edit', triggerId: 'edit-icon-dropdown-trigger' },
            { menuId: 'color-dropdown-menu-edit', triggerId: 'edit-color-dropdown-trigger' },
            { menuId: 'icon-dropdown-menu-add', triggerId: 'icon-dropdown-trigger' },
            { menuId: 'color-dropdown-menu-add', triggerId: 'color-dropdown-trigger' }
        ];

        dropdownMenus.forEach(({ menuId, triggerId }) => {
            const menu = document.getElementById(menuId);
            if (menu && !menu.classList.contains('hidden')) {
                // If click is outside menu AND outside trigger, hide it
                if (!menu.contains(target) && !target.closest(`#${triggerId}`)) {
                    menu.classList.add('hidden');
                }
            }
        });
    });
}

/* ---------------- DROPDOWN LOGIC ---------------- */
window.toggleIconDropdown = function (type) {
    // Close ALL dropdowns (icons and colors) first to ensure exclusivity
    document.querySelectorAll('[id$="-dropdown-menu-add"], [id$="-dropdown-menu-edit"]').forEach(el => {
        const targetId = `icon-dropdown-menu-${type}`;
        if (el.id !== targetId) el.classList.add('hidden');
    });
    const menu = document.getElementById(`icon-dropdown-menu-${type}`);
    if (menu) menu.classList.toggle('hidden');
};

window.selectIcon = function (element, emoji, label) {
    const input = document.getElementById('icon-input');
    if (input) input.value = emoji;
    const displaySpan = document.getElementById('selected-icon-display');
    const labelSpan = document.getElementById('selected-icon-label');
    if (displaySpan) displaySpan.textContent = emoji;
    if (labelSpan) labelSpan.textContent = label;

    document.querySelectorAll('.icon-btn').forEach(btn => {
        btn.classList.remove('bg-blue-50', 'border-blue-500');
        btn.classList.add('bg-white');
    });
    element.classList.add('bg-blue-50', 'border-blue-500');
    const menu = document.getElementById('icon-dropdown-menu-add');
    if (menu) menu.classList.add('hidden');
};

window.selectEditIcon = function (element, emoji, label) {
    const input = document.getElementById('edit-icon-input');
    if (input) input.value = emoji;
    const displaySpan = document.getElementById('edit-selected-icon-display');
    const labelSpan = document.getElementById('edit-selected-icon-label');
    if (displaySpan) displaySpan.textContent = emoji;
    if (labelSpan) labelSpan.textContent = label;

    document.querySelectorAll('.edit-icon-btn').forEach(btn => {
        btn.classList.remove('bg-blue-50', 'border-blue-500');
        btn.classList.add('bg-white');
    });
    element.classList.add('bg-blue-50', 'border-blue-500');
    const menu = document.getElementById('icon-dropdown-menu-edit');
    if (menu) menu.classList.add('hidden');
};

window.toggleColorDropdown = function (type) {
    // Close ALL dropdowns first
    document.querySelectorAll('[id$="-dropdown-menu-add"], [id$="-dropdown-menu-edit"]').forEach(el => {
        const targetId = `color-dropdown-menu-${type}`;
        if (el.id !== targetId) el.classList.add('hidden');
    });
    const menu = document.getElementById(`color-dropdown-menu-${type}`);
    if (menu) menu.classList.toggle('hidden');
};

window.selectColor = function (element, value, label, bgClass, textClass) {
    const input = document.getElementById('color-input');
    if (input) input.value = value;
    const labelSpan = document.getElementById('selected-color-label');
    const previewDiv = document.getElementById('selected-color-preview');
    if (labelSpan) labelSpan.textContent = label;
    if (previewDiv) previewDiv.className = `w-8 h-8 rounded-full ${bgClass} ${textClass} flex items-center justify-center border border-blue-100`;

    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.classList.remove('bg-slate-50', 'border-blue-500');
        btn.classList.add('bg-white');
    });
    element.classList.add('bg-slate-50', 'border-blue-500');
    const menu = document.getElementById('color-dropdown-menu-add');
    if (menu) menu.classList.add('hidden');
};

window.selectEditColor = function (element, value, label, bgClass, textClass) {
    const input = document.getElementById('edit-color-input');
    if (input) input.value = value;
    const labelSpan = document.getElementById('edit-selected-color-label');
    const previewDiv = document.getElementById('edit-selected-color-preview');
    if (labelSpan) labelSpan.textContent = label;
    if (previewDiv) previewDiv.className = `w-8 h-8 rounded-full ${bgClass} ${textClass} flex items-center justify-center border border-blue-100`;

    document.querySelectorAll('.edit-color-btn').forEach(btn => {
        btn.classList.remove('bg-slate-50', 'border-blue-500');
        btn.classList.add('bg-white');
    });
    element.classList.add('bg-slate-50', 'border-blue-500');
    const menu = document.getElementById('color-dropdown-menu-edit');
    if (menu) menu.classList.add('hidden');
};


/* ---------------- MODAL LOGIC ---------------- */
window.openEditModal = function (course) {
    try {
        const modal = document.getElementById('editCourseModal');
        const form = document.getElementById('editCourseForm');
        if (!modal || !form) return;

        form.action = `/admin/courses/edit/${course.id}`;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val !== undefined && val !== null ? val : '';
        };

        setVal('edit-title', course.title);
        setVal('edit-description', course.description);
        setVal('edit-liveLink', course.liveLink);
        setVal('edit-price', course.price);
        setVal('edit-originalPrice', course.originalPrice);

        const formatDate = (dateString) => {
            if (!dateString) return '';
            try {
                return new Date(dateString).toISOString().split('T')[0];
            } catch (e) { return ''; }
        };

        setVal('edit-startDate', formatDate(course.startDate));
        setVal('edit-endDate', formatDate(course.endDate));
        setVal('edit-enrollmentDeadline', formatDate(course.enrollmentDeadline));

        // Initialize Icon
        const icon = course.icon || '📚';
        const iconBtn = document.querySelector(`.edit-icon-btn[data-icon="${icon}"]`) ||
            document.querySelector(`.edit-icon-btn[data-icon="📚"]`);

        if (iconBtn) {
            window.selectEditIcon(iconBtn, icon, iconBtn.getAttribute('data-label'));
        }

        // Initialize Color
        const color = course.colorTheme || 'blue';
        const colorBtn = document.querySelector(`.edit-color-btn[data-color="${color}"]`) ||
            document.querySelector(`.edit-color-btn[data-color="blue"]`);

        if (colorBtn) {
            window.selectEditColor(colorBtn, color, colorBtn.getAttribute('data-label'), colorBtn.getAttribute('data-bg'), colorBtn.getAttribute('data-text'));
        }

        modal.classList.remove('hidden');
        document.body.classList.add('overflow-hidden'); // Prevent scroll
    } catch (e) {
        console.error("Error opening edit modal:", e);
    }
}

window.closeEditModal = function () {
    const modal = document.getElementById('editCourseModal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

/* ---------------- PAYMENT VERIFICATION ---------------- */
async function approvePayment(purchaseId) {
    if (!confirm("Are you sure you want to approve this payment? User will be enrolled immediately.")) return;

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch('/api/admin/approve-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ purchaseId })
        });
        const data = await response.json();

        if (data.success) {
            alert("Payment Approved!");
            location.reload();
        } else {
            alert(data.message || "Failed to approve payment");
        }
    } catch (e) {
        console.error(e);
        alert("Error approving payment");
    }
}

async function rejectPayment(purchaseId) {
    if (!confirm("Are you sure you want to REJECT this payment?")) return;

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch('/api/admin/reject-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ purchaseId })
        });
        const data = await response.json();

        if (data.success) {
            alert("Payment Rejected!");
            location.reload();
        } else {
            alert(data.message || "Failed to reject payment");
        }
    } catch (e) {
        console.error(e);
        alert("Error rejecting payment");
    }
}



/* ---------------- INITIALIZATION ---------------- */
document.addEventListener('DOMContentLoaded', () => {
    updateTimers();
    setInterval(updateTimers, 1000);
    setupEventListeners();
});
