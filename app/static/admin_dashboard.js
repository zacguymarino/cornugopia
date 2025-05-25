document.addEventListener("DOMContentLoaded", function () {
    async function fetchSettings() {
        const res = await fetch('/settings');
        const data = await res.json();
        // Populate fields
        document.getElementById('snackbar_active').checked = data.snackbar_active;
        document.getElementById('snackbar_message').value = data.snackbar_message || '';
        document.getElementById('snackbar_timeout_seconds').value = data.snackbar_timeout_seconds;

        document.getElementById('sponsor_active').checked = data.sponsor_active;
        document.getElementById('sponsor_image_desktop').value = data.sponsor_image_desktop || '';
        document.getElementById('sponsor_image_mobile').value = data.sponsor_image_mobile || '';
        document.getElementById('sponsor_target_url').value = data.sponsor_target_url || '';
    }

    async function saveSettings() {
        const payload = {
            snackbar_active: document.getElementById('snackbar_active').checked,
            snackbar_message: document.getElementById('snackbar_message').value,
            snackbar_timeout_seconds: parseInt(document.getElementById('snackbar_timeout_seconds').value, 10),

            sponsor_active: document.getElementById('sponsor_active').checked,
            sponsor_image_desktop: document.getElementById('sponsor_image_desktop').value,
            sponsor_image_mobile: document.getElementById('sponsor_image_mobile').value,
            sponsor_target_url: document.getElementById('sponsor_target_url').value,
        };

        const res = await fetch('/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert('Settings saved!');
            fetchSettings(); // refresh updated_at etc.
        } else {
            alert('Error saving settings');
        }
    }

    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
    window.addEventListener('DOMContentLoaded', fetchSettings);
});