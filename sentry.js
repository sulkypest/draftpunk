// ── Error Monitoring ──────────────────────────────────────────────────────────
// 1. Sign up at https://sentry.io (free tier)
// 2. Create a new project → Browser JavaScript
// 3. Copy your DSN and paste it below
const SENTRY_DSN = 'YOUR_SENTRY_DSN_HERE';

if (SENTRY_DSN !== 'YOUR_SENTRY_DSN_HERE') {
    const script    = document.createElement('script');
    script.src      = 'https://browser.sentry-cdn.com/8.28.0/bundle.min.js';
    script.crossOrigin = 'anonymous';
    script.onload   = function() {
        Sentry.init({
            dsn:              SENTRY_DSN,
            tracesSampleRate: 0.1,
            environment:      (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
                              ? 'development' : 'production',
            ignoreErrors: [
                'ResizeObserver loop limit exceeded',
                'Non-Error promise rejection captured'
            ]
        });
    };
    document.head.appendChild(script);
}
