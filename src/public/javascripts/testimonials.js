// Testimonials Dynamic Loading

async function loadTestimonials() {
    const grid = document.getElementById('testimonials-grid');

    if (!grid) return; // Not on homepage

    try {
        const response = await fetch('/api/testimonials/approved');
        const data = await response.json();

        if (data.success && data.testimonials.length > 0) {
            // Clear loading state
            grid.innerHTML = '';

            // Limit to 5 testimonials for homepage
            const testimonialsToShow = data.testimonials.slice(0, 5);

            // Gradient colors for avatars
            const gradients = [
                'from-blue-400 to-blue-600',
                'from-purple-400 to-purple-600',
                'from-green-400 to-teal-600',
                'from-orange-400 to-red-600',
                'from-indigo-400 to-blue-600',
                'from-pink-400 to-rose-600'
            ];

            const accentGradients = [
                'from-blue-500 to-purple-500',
                'from-purple-500 to-pink-500',
                'from-green-500 to-teal-500',
                'from-orange-500 to-red-500',
                'from-indigo-500 to-blue-500',
                'from-pink-500 to-rose-500'
            ];

            // Render limited testimonials
            testimonialsToShow.forEach((testimonial, index) => {
                const gradientClass = gradients[index % gradients.length];
                const accentClass = accentGradients[index % accentGradients.length];

                const card = document.createElement('div');
                card.className = 'bg-white p-8 rounded-2xl shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group relative overflow-hidden';

                // Generate star rating HTML
                let starsHTML = '';
                for (let i = 0; i < testimonial.rating; i++) {
                    starsHTML += '<i class="fa-solid fa-star text-yellow-400"></i>';
                }

                card.innerHTML = `
                    <!-- Gradient Accent -->
                    <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${accentClass} opacity-0 group-hover:opacity-100 transition-opacity"></div>

                    <!-- Star Rating -->
                    <div class="flex gap-1 mb-4">
                        ${starsHTML}
                    </div>

                    <!-- Testimonial Text -->
                    <p class="text-slate-600 leading-relaxed mb-6 italic">"${escapeHtml(testimonial.message)}"</p>

                    <!-- Author Info -->
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br ${gradientClass} flex items-center justify-center text-white font-bold text-lg shadow-md">
                            ${testimonial.userName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <p class="text-sm font-bold text-slate-800">${escapeHtml(testimonial.userName)}</p>
                            <p class="text-xs text-slate-500">${escapeHtml(testimonial.userRole)}</p>
                        </div>
                    </div>
                `;

                grid.appendChild(card);
            });
        } else {
            // Empty state
            grid.innerHTML = `
                <div class="col-span-full bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
                    <div class="text-5xl mb-4">💬</div>
                    <h3 class="text-xl font-bold text-slate-800 mb-2">No testimonials yet</h3>
                    <p class="text-slate-500">Be the first to share your experience!</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Failed to load testimonials:', error);
        grid.innerHTML = `
            <div class="col-span-full bg-red-50 rounded-2xl border border-red-200 p-8 text-center">
                <p class="text-red-600">Failed to load testimonials. Please try again later.</p>
            </div>
        `;
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load testimonials when page loads
if (document.getElementById('testimonials-grid')) {
    loadTestimonials();
}
