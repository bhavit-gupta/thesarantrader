// AUTH V8 - ROBUST INITIALIZATION
(function () {
    try {
        const userEl = document.getElementById('server-side-auth-user');
        const coursesEl = document.getElementById('server-side-purchased-courses');
        const pendingEl = document.getElementById('server-side-pending-courses');

        window.__AUTH_USER__ = userEl ? JSON.parse(userEl.textContent) : null;
        window.__PURCHASED_COURSES__ = coursesEl ? JSON.parse(coursesEl.textContent) : [];
        window.__PENDING_COURSES__ = pendingEl ? JSON.parse(pendingEl.textContent) : [];

        console.log('🛡️ Auth State Loaded:', {
            loggedIn: !!window.__AUTH_USER__,
            username: window.__AUTH_USER__ ? window.__AUTH_USER__.username : 'guest'
        });
    } catch (e) {
        console.error('❌ Auth State Error:', e);
        window.__AUTH_USER__ = null;
        window.__PURCHASED_COURSES__ = [];
    }
})();

window.logoutUser = function (e) {
    e.preventDefault();
    console.log("Attempting logout...");
    const form = document.getElementById('logout-form');
    if (form) {
        form.submit();
    } else {
        console.error("Logout form not found!");
        const newForm = document.createElement('form');
        newForm.method = 'POST';
        newForm.action = '/auth/logout';
        const csrfInput = document.createElement('input');
        csrfInput.type = 'hidden';
        csrfInput.name = '_csrf';
        const metaToken = document.querySelector('meta[name="csrf-token"]');
        csrfInput.value = metaToken ? metaToken.content : '';
        newForm.appendChild(csrfInput);
        document.body.appendChild(newForm);
        newForm.submit();
    }
}
