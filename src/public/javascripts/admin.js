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
    // admin_courses.ejs stores data in window.allCourses
    if (window.allCourses && window.allCourses.length > 0) return window.allCourses;

    // admin.ejs (main dashboard) stores data in a data attribute
    const dataDiv = document.getElementById('admin-data');
    if (!dataDiv) return [];
    try {
        return JSON.parse(dataDiv.getAttribute('data-courses')) || [];
    } catch (e) {
        console.error("Failed to parse courses data", e);
        return [];
    }
}
function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
}

function showToast(message, type = 'info') {
    // Basic fallback if toast library isn't loaded
    console.log(`[Toast ${type}]: ${message}`);

    // Check for custom toast container
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-600' : (type === 'error' ? 'bg-red-600' : 'bg-blue-600');
    toast.className = `${bgColor} text-white px-6 py-3 rounded-lg shadow-xl mb-3 flex items-center gap-3 animate-fade-in-up`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-check' : (type === 'error' ? 'fa-xmark' : 'fa-info')}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2', 'transition-all', 'duration-500');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
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
/**
 * Updates the UI status for a specific course without page reload.
 * Handles button state, timers, and badge visibility.
 */
function updateLiveStatus(courseId, isLive, startTime = null) {
    const card = document.getElementById(`course-meta-${courseId}`);
    if (!card) return;

    // 1. Update Buttons
    const btn = card.querySelector('.toggle-live-btn');
    if (btn) {
        if (isLive) {
            btn.className = 'toggle-live-btn relative px-6 py-2.5 rounded-full font-bold text-sm transition-all focus:outline-none shrink-0 w-32 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200';
            btn.innerHTML = '<i class="fa-solid fa-stop mr-2"></i>End Live';
        } else {
            btn.className = 'toggle-live-btn relative px-6 py-2.5 rounded-full font-bold text-sm transition-all focus:outline-none shrink-0 w-32 bg-slate-800 text-white hover:bg-slate-900 border border-slate-200 shadow-lg shadow-slate-500/20';
            btn.innerHTML = '<i class="fa-solid fa-satellite-dish mr-2"></i>Go Live';
        }
    }

    // 2. Update Status Text and Timer Visibility
    const statusContainer = card.querySelector('.flex.items-center.gap-3.text-sm.mt-1');
    if (statusContainer) {
        // Find existing status markers
        const markers = statusContainer.querySelectorAll('span');
        let usersSpan = markers[0]; // Usually the first one

        // Clear and rebuild to ensure correct order/elements
        statusContainer.innerHTML = '';
        if (usersSpan) statusContainer.appendChild(usersSpan);

        if (isLive) {
            const liveBadge = document.createElement('span');
            liveBadge.className = 'text-green-600 font-semibold flex items-center gap-1';
            liveBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>Live Now';
            statusContainer.appendChild(liveBadge);

            const timerSpan = document.createElement('span');
            timerSpan.id = `timer-${courseId}`;
            timerSpan.className = 'text-slate-400 font-mono live-timer';
            timerSpan.setAttribute('data-start', startTime || Date.now());
            timerSpan.textContent = '00:00:00';
            statusContainer.appendChild(timerSpan);
        } else {
            const offlineBadge = document.createElement('span');
            offlineBadge.className = 'text-slate-400';
            offlineBadge.textContent = 'Offline';
            statusContainer.appendChild(offlineBadge);
        }
    }

    // 3. Update global data tracking (if used by other scripts)
    const dataDiv = document.getElementById('admin-data');
    if (dataDiv) {
        try {
            const sessions = JSON.parse(dataDiv.getAttribute('data-live-sessions') || '{}');
            if (isLive) {
                sessions[courseId] = { isLive: true, startTime: startTime || Date.now() };
            } else {
                delete sessions[courseId];
            }
            dataDiv.setAttribute('data-live-sessions', JSON.stringify(sessions));

            // 4. Update Global Navbar Status
            updateNavbarLiveStatus();
        } catch (e) {
            console.error("Data tracking update failed", e);
        }
    }
}

/**
 * Updates the global navbar live indicator based on ALL sessions
 */
function updateNavbarLiveStatus() {
    const dataDiv = document.getElementById('admin-data');
    if (!dataDiv) return;

    try {
        const sessions = JSON.parse(dataDiv.getAttribute('data-live-sessions') || '{}');
        const isAnyLive = Object.values(sessions).some(s => s.isLive);

        // Update Desktop Navbar Button
        const desktopBtn = document.getElementById('join-live-btn');
        if (desktopBtn) {
            if (isAnyLive) {
                desktopBtn.className = 'join-live-btn px-6 py-2.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer bg-green-500 text-white shadow-lg shadow-green-500/25';
                const dot = desktopBtn.querySelector('.live-dot');
                if (dot) dot.className = 'live-dot w-2 h-2 rounded-full bg-white live-pulse';
                const text = desktopBtn.querySelector('.live-text');
                if (text) text.textContent = 'Live Now';
            } else {
                desktopBtn.className = 'join-live-btn px-6 py-2.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer bg-slate-100 text-slate-400';
                const dot = desktopBtn.querySelector('.live-dot');
                if (dot) dot.className = 'live-dot w-2 h-2 rounded-full bg-slate-400';
                const text = desktopBtn.querySelector('.live-text');
                if (text) text.textContent = 'Live Offline';
            }
        }

        // Update Mobile Navbar Button
        const mobileBtn = document.getElementById('mobile-join-live-btn');
        if (mobileBtn) {
            if (isAnyLive) {
                mobileBtn.className = 'join-live-btn block px-3 py-2 rounded-md text-base font-medium transition-colors cursor-pointer text-green-600 bg-green-50';
                mobileBtn.innerHTML = '<span class="animate-pulse">🔴</span> Live Now';
            } else {
                mobileBtn.className = 'join-live-btn block px-3 py-2 rounded-md text-base font-medium transition-colors cursor-pointer text-slate-400 bg-slate-100';
                mobileBtn.innerHTML = '<span>🔴</span> Live Offline';
            }
        }
    } catch (e) {
        console.error("Navbar update failed", e);
    }
}

async function toggleCourseLive(courseId) {
    const btn = document.querySelector(`button[data-course-id="${courseId}"]`);
    if (!btn || btn.disabled) return;

    // Capture state BEFORE changing button content to spinner
    const isCurrentlyLive = btn.innerText.includes('End Live');
    const targetState = !isCurrentlyLive;

    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const response = await fetch('/admin/toggle-live', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify({ courseId, isLive: targetState })
        });

        const data = await response.json();

        if (data.success) {
            // SUCCESS: Update UI immediately without reload
            updateLiveStatus(courseId, data.isLive, data.startTime);
            showToast(data.isLive ? 'Stream started!' : 'Stream ended.', 'success');
        } else {
            throw new Error(data.message || 'Toggle failed');
        }
    } catch (error) {
        console.error('Live toggle error:', error);
        showToast(error.message, 'error');
        btn.innerHTML = originalContent;
        btn.disabled = false;
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
        setVal('edit-demoVideoUrl', course.demoVideoUrl);
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
            document.querySelector('.edit-icon-btn[data-icon="📚"]');

        if (iconBtn) {
            window.selectEditIcon(iconBtn, icon, iconBtn.getAttribute('data-label'));
        }

        // Initialize Color
        const color = course.colorTheme || 'blue';
        const colorBtn = document.querySelector(`.edit-color-btn[data-color="${color}"]`) ||
            document.querySelector('.edit-color-btn[data-color="blue"]');

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
    const reason = prompt("Enter REJECTION REASON (visible to user):", "Invalid or blurry payment proof. Please re-upload.");
    if (reason === null) return; // Cancelled

    if (!confirm("Are you sure you want to REJECT this payment?")) return;

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch('/api/admin/reject-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ purchaseId, reason })
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



/* ---------------- HERO IMAGE UPLOAD + CROP ---------------- */

let cropperInstance = null;

function openCropModal(file) {
    const modal = document.getElementById('cropModal');
    const cropImg = document.getElementById('crop-image');
    if (!modal || !cropImg) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        cropImg.src = e.target.result;
        modal.classList.remove('hidden');

        if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }

        cropperInstance = new Cropper(cropImg, {
            aspectRatio: 16 / 9,
            viewMode: 1,
            autoCropArea: 1,
            movable: true,
            zoomable: true,
            rotatable: false,
            scalable: false,
            responsive: true,
        });
    };
    reader.readAsDataURL(file);
}

function closeCropModal() {
    const modal = document.getElementById('cropModal');
    if (modal) modal.classList.add('hidden');
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    const heroInput = document.getElementById('hero-image-input');
    if (heroInput) heroInput.value = '';
}

window.setCropRatio = function (ratio) {
    if (cropperInstance) cropperInstance.setAspectRatio(ratio);
    document.querySelectorAll('.crop-ratio-btn').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('bg-slate-100', 'text-slate-700');
    });
    if (event && event.target) {
        event.target.classList.add('bg-blue-600', 'text-white');
        event.target.classList.remove('bg-slate-100', 'text-slate-700');
    }
};

async function cropAndUpload() {
    if (!cropperInstance) return;

    const canvas = cropperInstance.getCroppedCanvas({ width: 1200, height: 675, imageSmoothingQuality: 'high' });
    if (!canvas) { showToast('Could not process image. Please try again.', 'error'); return; }

    const confirmBtn = document.getElementById('crop-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Uploading...';

    canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('heroImage', blob, 'hero-image.jpg');

        try {
            const response = await fetch('/api/admin/settings/hero-image', {
                method: 'POST',
                headers: { 'X-CSRF-Token': getCsrfToken() },
                body: formData
            });
            const data = await response.json();
            if (data.success) {
                closeCropModal();
                showToast('Hero image updated!', 'success');
                const preview = document.getElementById('hero-preview');
                if (preview) preview.src = data.imageUrl + '?t=' + Date.now();
            } else {
                throw new Error(data.message || 'Upload failed');
            }
        } catch (error) {
            console.error('Hero upload error:', error);
            showToast(error.message, 'error');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-crop mr-1.5"></i>Crop &amp; Upload';
        }
    }, 'image/jpeg', 0.92);
}

/* ---------------- INITIALIZATION ---------------- */
document.addEventListener('DOMContentLoaded', () => {
    updateTimers();
    setInterval(updateTimers, 1000);
    setupEventListeners();

    const heroInput = document.getElementById('hero-image-input');
    const heroBtn = document.getElementById('hero-upload-btn');
    if (heroBtn && heroInput) {
        heroBtn.addEventListener('click', () => heroInput.click());
        heroInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const allowed = ['image/jpeg', 'image/png', 'image/webp'];
            if (!allowed.includes(file.type)) { showToast('Upload JPG, PNG or WebP only', 'error'); heroInput.value = ''; return; }
            if (file.size > 10 * 1024 * 1024) { showToast('Image must be under 10MB', 'error'); heroInput.value = ''; return; }
            openCropModal(file);
        });
    }

    const cancelBtn = document.getElementById('crop-cancel-btn');
    const cancelBtn2 = document.getElementById('crop-cancel-btn2');
    const confirmBtn = document.getElementById('crop-confirm-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeCropModal);
    if (cancelBtn2) cancelBtn2.addEventListener('click', closeCropModal);
    if (confirmBtn) confirmBtn.addEventListener('click', cropAndUpload);
});
