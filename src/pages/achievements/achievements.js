// Achievements live in the profile's «Достижения» tab; keep old links working.
(() => {
    const params = new URLSearchParams(window.location.search);
    const target = new URLSearchParams({ tab: 'achievements' });
    const userId = params.get('userId');
    if (userId) target.set('userId', userId);
    window.location.replace(`../profile/profile.html?${target}`);
})();
