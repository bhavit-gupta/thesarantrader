// User Dashboard Scripts

/* ---------------- TIMER LOGIC ---------------- */
// Live session timer
function startUserTimers() {
    const timers = document.querySelectorAll('[id^="live-timer-"]');
    timers.forEach(timer => {
        const startTime = parseInt(timer.dataset.start);
        if (!startTime) return;

        function updateTimer() {
            const elapsed = Date.now() - startTime;
            const hours = Math.floor(elapsed / 3600000);
            const minutes = Math.floor((elapsed % 3600000) / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            timer.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        updateTimer();
        setInterval(updateTimer, 1000);
    });
}

// Testimonial functionality
let selectedRating = 0;

/* ---------------- TESTIMONIAL LOGIC ---------------- */
function initTestimonialForm() {
    const form = document.getElementById('testimonial-form');
    const starBtns = document.querySelectorAll('.star-btn');
    const ratingInput = document.getElementById('rating-input');
    const messageTextarea = document.getElementById('testimonial-message');
    const charCount = document.getElementById('char-count');
    const feedback = document.getElementById('testimonial-feedback');

    if (!form) return; // Form not on this page

    // Load existing testimonials
    loadExistingTestimonials();

    // Star rating interaction
    starBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const rating = parseInt(btn.dataset.rating);
            selectedRating = rating;
            ratingInput.value = rating;
            updateStarDisplay(rating);
        });
    });

    // Character counter
    messageTextarea.addEventListener('input', () => {
        const length = messageTextarea.value.length;
        charCount.textContent = `${length} / 500`;
        if (length > 450) {
            charCount.classList.add('text-orange-500', 'font-bold');
        } else {
            charCount.classList.remove('text-orange-500', 'font-bold');
        }
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Validation
        if (!selectedRating) {
            showFeedback('Please select a star rating', 'error');
            return;
        }

        const message = messageTextarea.value.trim();
        if (!message) {
            showFeedback('Please write your testimonial', 'error');
            return;
        }

        const userRole = document.getElementById('user-role').value.trim();

        // Submit
        const submitBtn = document.getElementById('submit-testimonial-btn');
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

        console.log(`[Testimonial] Submitting: Rating=${selectedRating}, CSRF=${!!csrfToken}`);

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

        try {
            const response = await fetch('/api/testimonials/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({ message, rating: selectedRating, userRole: userRole || 'Student' })
            });

            const data = await response.json();

            if (data.success) {
                console.log('[Testimonial] Success:', data.message);
                showFeedback(data.message, 'success');
                form.reset();
                selectedRating = 0;
                updateStarDisplay(0);
                charCount.textContent = '0 / 500';

                // Reload testimonials list
                setTimeout(() => {
                    loadExistingTestimonials();
                }, 1000);
            } else {
                showFeedback(data.message, 'error');
            }
        } catch (error) {
            showFeedback('Failed to submit testimonial. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Testimonial';
        }
    });
}

/* ---------------- HELPER FUNCTIONS ---------------- */
function updateStarDisplay(rating) {
    const starBtns = document.querySelectorAll('.star-btn');
    starBtns.forEach((btn, index) => {
        if (index < rating) {
            btn.classList.remove('text-slate-300');
            btn.classList.add('text-yellow-400');
        } else {
            btn.classList.add('text-slate-300');
            btn.classList.remove('text-yellow-400');
        }
    });
}

function showFeedback(message, type) {
    const feedback = document.getElementById('testimonial-feedback');
    feedback.classList.remove('hidden', 'bg-green-50', 'border-green-200', 'text-green-700', 'bg-red-50', 'border-red-200', 'text-red-700');

    if (type === 'success') {
        feedback.classList.add('bg-green-50', 'border', 'border-green-200', 'text-green-700');
        feedback.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i>${message}`;
    } else {
        feedback.classList.add('bg-red-50', 'border', 'border-red-200', 'text-red-700');
        feedback.innerHTML = `<i class="fa-solid fa-exclamation-circle mr-2"></i>${message}`;
    }

    feedback.classList.remove('hidden');

    setTimeout(() => {
        feedback.classList.add('hidden');
    }, 5000);
}

async function loadExistingTestimonials() {
    try {
        const response = await fetch('/api/testimonials/my-testimonials');
        const data = await response.json();

        if (data.success && data.testimonials && data.testimonials.length > 0) {
            const existingDiv = document.getElementById('existing-testimonial');
            const form = document.getElementById('testimonial-form');

            // Clear existing content
            existingDiv.innerHTML = '';

            // Create header
            const header = document.createElement('div');
            header.className = 'mb-4';
            header.innerHTML = '<h3 class="text-sm font-bold text-slate-800">Your Testimonials</h3>';
            existingDiv.appendChild(header);

            // Display all testimonials
            data.testimonials.forEach((testimonial, index) => {
                const testimonialCard = document.createElement('div');
                testimonialCard.className = 'mb-4 p-4 rounded-xl border border-blue-100 bg-blue-50';

                // Generate stars
                let starsHTML = '';
                for (let i = 0; i < testimonial.rating; i++) {
                    starsHTML += '<i class="fa-solid fa-star text-yellow-400 text-sm"></i>';
                }

                // Status badge
                let statusBadgeHTML = '';
                if (testimonial.status === 'pending') {
                    statusBadgeHTML = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-yellow-100 text-yellow-700">Pending Review</span>';
                } else if (testimonial.status === 'approved') {
                    statusBadgeHTML = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700">Approved ✓</span>';
                } else if (testimonial.status === 'rejected') {
                    statusBadgeHTML = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">Rejected</span>';
                }

                // Delete button (visible for all statuses on user dashboard)
                const deleteBtnHTML = `<button class="delete-testimonial-btn text-xs text-red-400 hover:text-red-600 transition-colors" data-id="${testimonial.id}">
                    <i class="fa-solid fa-trash-can"></i>
                </button>`;

                testimonialCard.innerHTML = `
                    <div class="flex items-start justify-between gap-4 mb-2">
                        <div class="flex items-center gap-2">
                            <span class="text-xs text-slate-500">#${data.testimonials.length - index}</span>
                            ${statusBadgeHTML}
                        </div>
                        <div class="flex items-center gap-3">
                            <span class="text-xs text-slate-400">${formatDate(testimonial.submittedAt)}</span>
                            ${deleteBtnHTML}
                        </div>
                    </div>
                    <div class="flex gap-1 mb-2">${starsHTML}</div>
                    <p class="text-slate-600 text-sm leading-relaxed italic">"${testimonial.message}"</p>
                `;

                existingDiv.appendChild(testimonialCard);
            });

            existingDiv.classList.remove('hidden');

            existingDiv.classList.remove('hidden');
        } else {
            document.getElementById('existing-testimonial').classList.add('hidden');
        }
    } catch (error) {
        console.error('Failed to load existing testimonials:', error);
    }
}

// Use Event Delegation for the container
const existingDiv = document.getElementById('existing-testimonial');
if (existingDiv) {
    console.log('🔗 Attaching master listener to existing-testimonial container');
    existingDiv.addEventListener('click', async (e) => {
        // Find the button (could be the icon inside being clicked)
        const btn = e.target.closest('.delete-testimonial-btn');
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        console.log('🖱️ Delete button clicked (via delegation)');
        const id = btn.dataset.id;
        console.log('🆔 Testimonial ID found:', id);

        if (confirm('Are you sure you want to delete this testimonial?')) {
            console.log('✅ Deletion confirmed for ID:', id);
            await deleteTestimonial(id);
        } else {
            console.log('❌ Deletion cancelled');
        }
    });
} else {
    console.warn('⚠️ #existing-testimonial container not found for delegation');
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
}

async function deleteTestimonial(id) {
    console.log('🗑️ Attempting to delete testimonial:', id);
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        console.log('🔑 CSRF Token for deletion:', csrfToken);

        const response = await fetch(`/api/testimonials/delete/${id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            }
        });

        console.log('📡 Delete response status:', response.status);
        const data = await response.json();
        console.log('📦 Delete response data:', data);

        if (data.success) {
            showFeedback('Testimonial deleted successfully', 'success');
            loadExistingTestimonials();
        } else {
            showFeedback(data.message || 'Failed to delete testimonial', 'error');
        }
    } catch (error) {
        console.error('Error deleting testimonial:', error);
        showFeedback('Failed to delete testimonial. Please try again.', 'error');
    }
}

/* ---------------- INITIALIZATION ---------------- */
// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    startUserTimers();
    initTestimonialForm();
});
