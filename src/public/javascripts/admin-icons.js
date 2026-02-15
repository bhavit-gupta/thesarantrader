// Toggle Dropdown Visibility
function toggleIconDropdown(type) {
    const menu = document.getElementById(`icon-dropdown-menu-${type}`);
    const isHidden = menu.classList.contains('hidden');

    // Close all other dropdowns first
    document.querySelectorAll('[id^="icon-dropdown-menu-"]').forEach(el => el.classList.add('hidden'));

    if (isHidden) {
        menu.classList.remove('hidden');
    }
}

// Icon Selection Logic for Add Course
function selectIcon(btn, icon, label) {
    // Update hidden input
    document.getElementById('icon-input').value = icon;

    // Update trigger display
    document.getElementById('selected-icon-display').textContent = icon;
    if (label) document.getElementById('selected-icon-label').textContent = label;

    // Close dropdown
    document.getElementById('icon-dropdown-menu-add').classList.add('hidden');

    // Reset all buttons visual state
    document.querySelectorAll('.icon-btn').forEach(b => {
        b.classList.remove('bg-blue-50', 'border-blue-500');
        b.classList.add('bg-white');

        const emojiSpan = b.querySelector('span:first-child');
        const textSpan = b.querySelector('span:last-child');

        if (emojiSpan) emojiSpan.classList.add('grayscale');
        if (emojiSpan) emojiSpan.classList.remove('grayscale-0');
        if (textSpan) textSpan.classList.remove('text-slate-900');
    });

    // Highlight selected
    btn.classList.remove('bg-white');
    btn.classList.add('bg-blue-50', 'border-blue-500');

    const activeEmoji = btn.querySelector('span:first-child');
    const activeText = btn.querySelector('span:last-child');

    if (activeEmoji) activeEmoji.classList.remove('grayscale');
    if (activeEmoji) activeEmoji.classList.add('grayscale-0');
    if (activeText) activeText.classList.add('text-slate-900');
}

// Icon Selection Logic for Edit Course
function selectEditIcon(btn, icon, label) {
    // Update hidden input
    document.getElementById('edit-icon-input').value = icon;

    // Update trigger display
    document.getElementById('edit-selected-icon-display').textContent = icon;
    if (label) document.getElementById('edit-selected-icon-label').textContent = label;

    // Close dropdown
    document.getElementById('icon-dropdown-menu-edit').classList.add('hidden');

    // Reset all buttons in edit grid
    document.querySelectorAll('.edit-icon-btn').forEach(b => {
        b.classList.remove('bg-blue-50', 'border-blue-500');
        b.classList.add('bg-white');

        const emojiSpan = b.querySelector('span:first-child');
        const textSpan = b.querySelector('span:last-child');

        if (emojiSpan) emojiSpan.classList.add('grayscale');
        if (emojiSpan) emojiSpan.classList.remove('grayscale-0');
        if (textSpan) textSpan.classList.remove('text-slate-900');
    });

    // Highlight selected
    btn.classList.remove('bg-white');
    btn.classList.add('bg-blue-50', 'border-blue-500');

    const activeEmoji = btn.querySelector('span:first-child');
    const activeText = btn.querySelector('span:last-child');

    if (activeEmoji) activeEmoji.classList.remove('grayscale');
    if (activeEmoji) activeEmoji.classList.add('grayscale-0');
    if (activeText) activeText.classList.add('text-slate-900');
}

// Toggle Color Dropdown Visibility
function toggleColorDropdown(type) {
    const menu = document.getElementById(`color-dropdown-menu-${type}`);
    const isHidden = menu.classList.contains('hidden');

    // Close all other dropdowns
    document.querySelectorAll('[id^="color-dropdown-menu-"]').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('[id^="icon-dropdown-menu-"]').forEach(el => el.classList.add('hidden'));

    if (isHidden) {
        menu.classList.remove('hidden');
    }
}

// Color Selection Logic for Add Course
function selectColor(btn, value, label, bgClass, textClass) {
    document.getElementById('color-input').value = value;
    document.getElementById('selected-color-label').textContent = label;

    const preview = document.getElementById('selected-color-preview');
    preview.className = `w-8 h-8 rounded-full ${bgClass} ${textClass} flex items-center justify-center border border-blue-100`;

    document.getElementById('color-dropdown-menu-add').classList.add('hidden');

    document.querySelectorAll('.color-btn').forEach(b => {
        b.classList.remove('bg-slate-50', 'border-blue-500');
        b.classList.add('bg-white');
    });

    btn.classList.remove('bg-white');
    btn.classList.add('bg-slate-50', 'border-blue-500');
}

// Color Selection Logic for Edit Course
function selectEditColor(btn, value, label, bgClass, textClass) {
    document.getElementById('edit-color-input').value = value;
    document.getElementById('edit-selected-color-label').textContent = label;

    const preview = document.getElementById('edit-selected-color-preview');
    preview.className = `w-8 h-8 rounded-full ${bgClass} ${textClass} flex items-center justify-center border border-blue-100`;

    document.getElementById('color-dropdown-menu-edit').classList.add('hidden');

    document.querySelectorAll('.edit-color-btn').forEach(b => {
        b.classList.remove('bg-slate-50', 'border-blue-500');
        b.classList.add('bg-white');
    });

    btn.classList.remove('bg-white');
    btn.classList.add('bg-slate-50', 'border-blue-500');
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    // Icon dropdowns
    if (!e.target.closest('#icon-dropdown-trigger') && !e.target.closest('#icon-dropdown-menu-add')) {
        const menu = document.getElementById('icon-dropdown-menu-add');
        if (menu) menu.classList.add('hidden');
    }
    if (!e.target.closest('#edit-icon-dropdown-trigger') && !e.target.closest('#icon-dropdown-menu-edit')) {
        const menu = document.getElementById('icon-dropdown-menu-edit');
        if (menu) menu.classList.add('hidden');
    }

    // Color dropdowns
    if (!e.target.closest('#color-dropdown-trigger') && !e.target.closest('#color-dropdown-menu-add')) {
        const menu = document.getElementById('color-dropdown-menu-add');
        if (menu) menu.classList.add('hidden');
    }
    if (!e.target.closest('#edit-color-dropdown-trigger') && !e.target.closest('#color-dropdown-menu-edit')) {
        const menu = document.getElementById('color-dropdown-menu-edit');
        if (menu) menu.classList.add('hidden');
    }
});
