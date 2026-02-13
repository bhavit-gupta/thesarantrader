// User Dashboard Scripts

// Function to update user-side timers
function updateUserTimers() {
    const now = Date.now();
    const timers = document.querySelectorAll('[id^="user-timer-"]');

    timers.forEach(timer => {
        const startTimeStr = timer.getAttribute('data-start');
        if (!startTimeStr) return;

        const startTime = parseInt(startTimeStr, 10);
        if (isNaN(startTime)) return;

        const diff = now - startTime;

        // Calculate parts
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        // Format
        timer.innerText =
            (hours > 0 ? String(hours).padStart(2, '0') + ':' : '') +
            String(minutes).padStart(2, '0') + ':' +
            String(seconds).padStart(2, '0');
    });
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Initial call
    updateUserTimers();
    // Update every second
    setInterval(updateUserTimers, 1000);
});

// Note: Future live polling logic can be added here
