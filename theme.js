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

    const saved = localStorage.getItem('dpTheme');
    const isLight = saved === null ? true : saved === 'light';
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { applyTheme(isLight); });
    } else {
        applyTheme(isLight);
    }
})();
