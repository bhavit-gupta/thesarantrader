// Admin Testimonials Management

async function approveTestimonial(id) {
    if (!confirm('Approve this testimonial? It will be displayed on the homepage.')) {
        return;
    }

    try {
        const response = await fetch(`/admin/testimonials/approve/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            // Show success message
            showNotification('Testimonial approved successfully!', 'success');

            // Reload page to update lists
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            showNotification(data.message || 'Failed to approve testimonial', 'error');
        }
    } catch (error) {
        console.error('Error approving testimonial:', error);
        showNotification('Failed to approve testimonial. Please try again.', 'error');
    }
}

async function rejectTestimonial(id) {
    if (!confirm('Reject this testimonial? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/admin/testimonials/reject/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            // Show success message
            showNotification('Testimonial rejected', 'success');

            // Reload page to update lists
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            showNotification(data.message || 'Failed to reject testimonial', 'error');
        }
    } catch (error) {
        console.error('Error rejecting testimonial:', error);
        showNotification('Failed to reject testimonial. Please try again.', 'error');
    }
}

function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `fixed top-24 right-4 px-6 py-4 rounded-xl shadow-lg z-50 flex items-center gap-3 animate-slide-in ${type === 'success'
            ? 'bg-green-600 text-white'
            : 'bg-red-600 text-white'
        }`;

    notification.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
        <span class="font-semibold">${message}</span>
    `;

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add CSS for animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slide-in {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    .animate-slide-in {
        animation: slide-in 0.3s ease-out;
        transition: all 0.3s ease-out;
    }
`;
document.head.appendChild(style);
