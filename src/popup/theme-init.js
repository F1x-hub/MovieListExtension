(function() {
    const theme = localStorage.getItem('movieExtensionTheme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    }
})();
