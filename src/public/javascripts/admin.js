// Admin Dashboard Scripts

// Helper: Get Live Sessions Data
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

// Timer Logic for Multiple Courses
function updateTimers() {
    const now = Date.now();

    // We select all elements with id starting with 'timer-'
    const timers = document.querySelectorAll('[id^="timer-"]');

    timers.forEach(timer => {
        const startTimeStr = timer.getAttribute('data-start');
        if (!startTimeStr || startTimeStr === 'null') return;

        const startTime = parseInt(startTimeStr, 10);
        if (isNaN(startTime)) return;

        const diff = now - startTime;

        // Calculate time components
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        // Format string
        timer.innerText =
            (hours > 0 ? String(hours).padStart(2, '0') + ':' : '') +
            String(minutes).padStart(2, '0') + ':' +
            String(seconds).padStart(2, '0');
    });
}

// Admin: Toggle Course Live Status
async function toggleCourseLive(courseId) {
    try {
        const response = await fetch('/admin/toggle-live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

// Delete Confirmation Logic
function setupDeleteConfirmations() {
    const deleteForms = document.querySelectorAll('form[action^="/admin/courses/delete/"]');
    deleteForms.forEach(form => {
        form.addEventListener('submit', (e) => {
            if (!confirm('Are you sure you want to delete this course?')) {
                e.preventDefault();
            }
        });
    });
}

function setupLiveToggleButtons() {
    const toggleBtns = document.querySelectorAll('.toggle-live-btn');
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const courseId = btn.getAttribute('data-course-id');
            toggleCourseLive(courseId);
        });
    });
}

// Edit Button Logic (Updated to use Safe Global Data)
function setupEditButtons() {
    const editBtns = document.querySelectorAll('.edit-course-btn');
    editBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const courseId = parseInt(btn.getAttribute('data-course-id'));
            const courseData = window.allCourses.find(c => c.id === courseId);

            if (courseData) {
                openEditModal(courseData);
            } else {
                console.error("Course data not found for ID:", courseId);
            }
        });
    });
}

// Edit Modal Logic
window.openEditModal = function (course) {
    const modal = document.getElementById('editCourseModal');
    const form = document.getElementById('editCourseForm');

    // Set form action
    form.action = `/admin/courses/edit/${course.id}`;

    // Populate fields
    document.getElementById('edit-title').value = course.title;
    document.getElementById('edit-description').value = course.description;
    document.getElementById('edit-price').value = course.price;
    document.getElementById('edit-originalPrice').value = course.originalPrice;
    document.getElementById('edit-icon').value = course.icon;

    // Handle Color Theme (derive from iconBg e.g., 'blue-50' -> 'blue')
    const theme = course.iconBg.split('-')[0];
    const themeSelect = document.getElementById('edit-colorTheme');
    if (themeSelect) themeSelect.value = theme;

    // Show modal
    modal.classList.remove('hidden');
}

window.closeEditModal = function () {
    const modal = document.getElementById('editCourseModal');
    modal.classList.add('hidden');
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('editCourseModal');
    if (e.target === modal) {
        closeEditModal();
    }
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Initial call
    updateTimers();
    // Update every second
    setInterval(updateTimers, 1000);
    // Setup delete confirmations
    setupDeleteConfirmations();
    // Setup edit buttons
    setupEditButtons();
    // Setup live toggle buttons
    setupLiveToggleButtons();
});
