(function () {
    function applyTheme(light) {
        document.body.classList.toggle('light-mode', light);
        const btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = light ? 'DARK' : 'LIGHT';
    }

    window.toggleTheme = function () {
        const isLight = !document.body.classList.contains('light-mode');
        localStorage.setItem('dpTheme', isLight ? 'light' : 'dark');
        applyTheme(isLight);
        if (window.updateChartTheme) window.updateChartTheme();
    };

    let saved = localStorage.getItem('dpTheme');
    // Writers who were here before the theme followed the device never chose a
    // theme and have always seen light: keep them on light. Brand-new writers
    // (no data on this device yet) follow the device's light/dark setting.
    if (saved === null) {
        try {
            if (localStorage.getItem('dpThemeAuto') === '1') {
                // a writer who started after this change: keep following the device
            } else if (localStorage.getItem('draftPunkData')) {
                saved = 'light';                                  // existing writer: unchanged
                localStorage.setItem('dpTheme', 'light');
            } else {
                localStorage.setItem('dpThemeAuto', '1');         // new writer: follow the device
            }
        } catch (e) {}
    }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isLight = saved === null ? !prefersDark : saved === 'light';
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { applyTheme(isLight); });
    } else {
        applyTheme(isLight);
    }
})();
