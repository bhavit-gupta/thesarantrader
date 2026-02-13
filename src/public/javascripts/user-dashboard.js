// User Dashboard Scripts

// Live session timer
function startUserTimers() {
    const timers = document.querySelectorAll('[id^="user-timer-"]');
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
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

        try {
            const response = await fetch('/api/testimonials/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, rating: selectedRating, userRole: userRole || 'Student' })
            });

            const data = await response.json();

            if (data.success) {
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
                }

                testimonialCard.innerHTML = `
                    <div class="flex items-start justify-between gap-4 mb-2">
                        <div class="flex items-center gap-2">
                            <span class="text-xs text-slate-500">#${data.testimonials.length - index}</span>
                            ${statusBadgeHTML}
                        </div>
                        <span class="text-xs text-slate-400">${new Date(testimonial.submittedAt).toLocaleDateString()}</span>
                    </div>
                    <div class="flex gap-1 mb-2">${starsHTML}</div>
                    <p class="text-slate-600 text-sm leading-relaxed italic">"${testimonial.message}"</p>
                `;

                existingDiv.appendChild(testimonialCard);
            });

            existingDiv.classList.remove('hidden');
            // Don't hide the form - allow multiple submissions
        }
    } catch (error) {
        console.error('Failed to load existing testimonials:', error);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    startUserTimers();
    initTestimonialForm();
});
