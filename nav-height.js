// Keeps the open chapter's toolbar visible (see "Toolbar stays on screen" in
// style.css) by setting two CSS variables. Never scrolls the page, never moves
// any element in the page; it only reports numbers to the stylesheet.
//  --nav-h  : height of the fixed top bar (set on load and resize)
//  --vv-top : how far iOS has slid the page up behind the browser bar while
//             the on-screen keyboard is open (window.visualViewport.offsetTop;
//             0 on desktop and whenever the keyboard is closed)
(function () {
    const root = document.documentElement.style;
    function setNavHeight() {
        const nav = document.querySelector('.app-nav');
        const h = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
        root.setProperty('--nav-h', Math.round(h) + 'px');
    }
    document.addEventListener('DOMContentLoaded', setNavHeight);
    window.addEventListener('load', setNavHeight);
    window.addEventListener('resize', setNavHeight);

    const vv = window.visualViewport;
    if (!vv) return;
    let queued = false, last = -1;
    function setVvTop() {
        queued = false;
        const t = Math.max(0, Math.round(vv.offsetTop));
        if (t !== last) { last = t; root.setProperty('--vv-top', t + 'px'); }
    }
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(setVvTop); } };
    vv.addEventListener('resize', queue);
    vv.addEventListener('scroll', queue);
    setVvTop();
})();
