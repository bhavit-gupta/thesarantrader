// Admin Testimonials Management
console.log('✅ admin-testimonials.js loaded');

/* ---------------- INITIALIZATION ---------------- */
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Testimonial event listeners initializing');

    // Use event delegation for approve/reject buttons
    document.addEventListener('click', async (e) => {
        const approveBtn = e.target.closest('.approve-btn');
        const rejectBtn = e.target.closest('.reject-btn');

        if (approveBtn) {
            const id = approveBtn.getAttribute('data-id');
            await handleApprove(id);
        } else if (rejectBtn) {
            const id = rejectBtn.getAttribute('data-id');
            await handleReject(id);
        }
    });
});

/* ---------------- API ACTIONS ---------------- */
async function handleApprove(id) {
    console.log('🚀 Approve Testimonial triggered for ID:', id);
    if (!confirm('Approve this testimonial? It will be displayed on the homepage.')) {
        console.log('❌ Approval cancelled by user');
        return;
    }

    try {
        const metaToken = document.querySelector('meta[name="csrf-token"]')?.content;
        console.log('🔑 Found CSRF Token in Meta:', metaToken);

        const response = await fetch(`/admin/testimonials/${id}/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': metaToken
            }
        });

        console.log('📡 Fetch response status:', response.status);

        const data = await response.json();

        if (data.success) {
            showNotification('Testimonial approved successfully!', 'success');
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

async function handleReject(id) {
    console.log('🚀 Reject clicked for:', id);
    if (!confirm('Reject this testimonial? This action cannot be undone.')) {
        return;
    }

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        const response = await fetch(`/admin/testimonials/${id}/reject`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Testimonial rejected', 'success');
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

/* ---------------- UI FEEDBACK ---------------- */
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
