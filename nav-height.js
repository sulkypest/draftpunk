// Records the fixed top bar's height as --nav-h, so the open chapter's toolbar
// can stay pinned just below it (see "Toolbar stays on screen" in style.css).
// Runs only on load and resize — never while scrolling or typing.
(function () {
    function setNavHeight() {
        const nav = document.querySelector('.app-nav');
        const h = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
        document.documentElement.style.setProperty('--nav-h', Math.round(h) + 'px');
    }
    document.addEventListener('DOMContentLoaded', setNavHeight);
    window.addEventListener('load', setNavHeight);
    window.addEventListener('resize', setNavHeight);
})();
