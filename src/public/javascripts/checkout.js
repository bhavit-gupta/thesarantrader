/* ---------------- CHECKOUT LOGIC ---------------- */
// DEBUG: Confirm script loaded
console.log('Checkout script loaded');
// alert('Checkout script loaded!'); // Uncomment if needed

/* ---------------- CHECKOUT LOGIC ---------------- */

// Modal State Management
function openPaymentModal() {
    const modal = document.getElementById('payment-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex'); // Add flex to center content
        document.body.style.overflow = 'hidden'; // Prevent scrolling
    }
}

function closePaymentModal() {
    const modal = document.getElementById('payment-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';

        // Reset steps
        showStep1();
    }
}

function showStep1() {
    const s1 = document.getElementById('modal-step-1');
    const s2 = document.getElementById('modal-step-2');
    if (s1) s1.style.display = '';
    if (s2) s2.style.display = 'none';
}

function showStep2() {
    const s1 = document.getElementById('modal-step-1');
    const s2 = document.getElementById('modal-step-2');
    if (s1) s1.style.display = 'none';
    if (s2) s2.style.display = '';
}

// Image Preview
function previewImage(input) {
    const previewContainer = document.getElementById('upload-preview');
    const imageElement = document.getElementById('image-preview-element');

    if (input.files && input.files[0]) {
        const reader = new FileReader();

        reader.onload = function (e) {
            imageElement.src = e.target.result;
            imageElement.style.display = '';
            previewContainer.style.display = 'none';
        }

        reader.readAsDataURL(input.files[0]);
    } else {
        imageElement.style.display = 'none';
        previewContainer.style.display = '';
    }
}

// Main Entry Point (Button Click)
// Main Entry Point (Button Click)
function openQRModal(courseId) {
    console.log('Opening Payment Modal for:', courseId);
    const modal = document.getElementById('payment-modal');
    if (!modal) {
        alert('Error: Payment Modal not found in DOM');
        return;
    }
    openPaymentModal();
}

// Form Submission
// Form Submission
async function submitPaymentProof(event) {
    event.preventDefault();

    // Get Course ID from the confirm button
    const courseId = document.getElementById('confirm-purchase-btn').getAttribute('data-course-id');

    const btn = document.getElementById('submit-proof-btn');
    const form = document.getElementById('payment-proof-form');

    // UI Lock
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Verifying...';

    const formData = new FormData(form);
    formData.append('courseId', courseId);

    try {
        // Get CSRF Token if needed (Multer/Multipart might need it in headers or body?)
        // Usually CSRF token is needed in headers.
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

        const response = await fetch('/api/payment/submit-proof', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': csrfToken
            },
            body: formData // Fetch automatically sets Content-Type for FormData
        });

        let data;
        try {
            data = await response.json();
        } catch (e) {
            throw new Error('Invalid server response');
        }

        if (response.ok && data.success) {
            // Success
            btn.innerHTML = '<i class="fa-solid fa-check-circle mr-2"></i> Sent for Approval';
            btn.classList.replace('bg-green-600', 'bg-blue-600');

            setTimeout(() => {
                alert('Payment proof submitted successfully! \n\nAdmin will verify your payment shortly. You will be notified once approved.');
                window.location.href = '/dashboard';
            }, 1000);
        } else {
            throw new Error(data.message || 'Submission failed');
        }

    } catch (error) {
        console.error('Submission Error:', error);
        alert('Error: ' + error.message);
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

// Attach global functions (Keep these for Modal internal buttons like "Back" or "Payment Done" if they use inline onclick)
// But preferably we should attach those too. For now, let's just fix the main button.
window.openQRModal = openQRModal;
window.submitPaymentProof = submitPaymentProof;
window.previewImage = previewImage;
window.showStep2 = showStep2;
window.showStep1 = showStep1;
window.closePaymentModal = closePaymentModal;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log('Checkout JS Initialized');

    // Confirm Purchase → Open QR Modal
    const confirmBtn = document.getElementById('confirm-purchase-btn');
    if (confirmBtn) {
        console.log('Confirm Button Found');
        confirmBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const courseId = confirmBtn.getAttribute('data-course-id');
            console.log('Confirm Button Clicked. Course:', courseId);
            openQRModal(courseId);
        });
    } else {
        console.error('Confirm Button NOT Found');
    }

    // Close Modal (X button)
    const closeBtn = document.getElementById('close-modal-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Close Modal Clicked');
            closePaymentModal();
        });
    }

    // Payment Done → Show Upload Step
    const paymentDoneBtn = document.getElementById('payment-done-btn');
    if (paymentDoneBtn) {
        paymentDoneBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Payment Done Clicked');
            showStep2();
        });
    }

    // Back to QR Code
    const backBtn = document.getElementById('back-to-qr-btn');
    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Back to QR Clicked');
            showStep1();
        });
    }

    // Screenshot file input preview
    const fileInput = document.getElementById('payment-screenshot');
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            previewImage(fileInput);
        });
    }

    // Copy UPI ID
    const copyUpiBtn = document.getElementById('copy-upi-btn');
    if (copyUpiBtn) {
        copyUpiBtn.addEventListener('click', () => {
            const upiText = document.getElementById('upi-id-text')?.textContent?.trim();
            if (upiText) {
                navigator.clipboard.writeText(upiText).then(() => {
                    const icon = copyUpiBtn.querySelector('i');
                    if (icon) {
                        icon.classList.replace('fa-copy', 'fa-check');
                        icon.classList.replace('fa-regular', 'fa-solid');
                        setTimeout(() => {
                            icon.classList.replace('fa-check', 'fa-copy');
                            icon.classList.replace('fa-solid', 'fa-regular');
                        }, 2000);
                    }
                }).catch(() => {
                    const textArea = document.createElement('textarea');
                    textArea.value = upiText;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    alert('UPI ID copied!');
                });
            }
        });
    }

    // Payment Form Submit Listener
    const paymentForm = document.getElementById('payment-proof-form');
    if (paymentForm) {
        paymentForm.addEventListener('submit', submitPaymentProof);
    }
});
