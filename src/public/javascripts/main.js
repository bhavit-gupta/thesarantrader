// Main Global Scripts (Navbar, Live Status)

// Mobile Menu Toggle
function setupMobileMenu() {
    const btn = document.getElementById('mobile-menu-btn');
    const menu = document.getElementById('mobile-menu');
    if (btn && menu) {
        btn.addEventListener('click', () => {
            menu.classList.toggle('hidden');
        });
    }
}

// Live Status Polling
function pollLiveStatus() {
    const liveButtons = document.querySelectorAll('.join-live-btn');
    if (liveButtons.length === 0) return; // No live buttons on this page

    async function checkLive() {
        try {
            const response = await fetch('/api/live-status');
            const data = await response.json();
            updateLiveUI(data.isLive);
        } catch (err) {
            console.error('Error polling live status:', err);
        }
    }

    function updateLiveUI(isLive) {
        // Update all navbar join-live buttons
        liveButtons.forEach(btn => {
            const dot = btn.querySelector('.live-dot');
            const text = btn.querySelector('.live-text');

            if (isLive) {
                // Activate button
                btn.classList.remove('bg-slate-300', 'text-slate-500', 'cursor-not-allowed', 'pointer-events-none', 'bg-slate-200', 'text-slate-400', 'bg-slate-100');
                btn.classList.add('bg-green-500', 'text-white', 'shadow-lg', 'shadow-green-500/25', 'hover:bg-green-600', 'hover:-translate-y-0.5');
                btn.setAttribute('aria-disabled', 'false');
                if (dot) {
                    dot.classList.remove('bg-slate-400');
                    dot.classList.add('bg-white', 'live-pulse');
                }
                if (text) text.textContent = 'Join Live Now';
                // For mobile button without inner spans
                if (!text && !dot) btn.textContent = '🟢 Join Live Now';
            } else {
                // Deactivate button
                btn.classList.remove('bg-green-500', 'text-white', 'shadow-lg', 'shadow-green-500/25', 'hover:bg-green-600', 'hover:-translate-y-0.5');
                btn.classList.add('bg-slate-300', 'text-slate-500', 'cursor-not-allowed', 'pointer-events-none');
                btn.setAttribute('aria-disabled', 'true');
                if (dot) {
                    dot.classList.remove('bg-white', 'live-pulse');
                    dot.classList.add('bg-slate-400');
                }
                if (text) text.textContent = 'Live Offline';
                if (!text && !dot) btn.textContent = '🔴 Live Offline';
            }
        });

        // Update dashboard-specific elements (if present)
        const statusText = document.getElementById('live-status-text');
        const cornerDot = document.getElementById('live-corner-dot');

        if (statusText) {
            statusText.innerHTML = isLive
                ? '🟢 Session is <span class="text-green-600 font-semibold">LIVE NOW</span> — Join to trade with Kundan Sir!'
                : 'The live session is currently offline. You\'ll be notified when Kundan Sir goes live.';
        }

        if (cornerDot) {
            cornerDot.innerHTML = isLive
                ? '<span class="w-3 h-3 rounded-full bg-green-500 live-pulse"></span><span class="text-xs font-bold text-green-600 uppercase tracking-wider">Live</span>'
                : '<span class="w-3 h-3 rounded-full bg-slate-300"></span><span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Offline</span>';
        }
    }

    // Initial check + poll every 5 seconds
    checkLive();
    setInterval(checkLive, 5000);
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    setupMobileMenu();
    pollLiveStatus();
});
