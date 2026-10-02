// === js/connection-banner.js ===
// 네트워크 오프라인 상태를 화면 하단 배너로 알려준다. (의존성 없는 단독 스크립트)
// 물류 현장에서 와이파이가 끊겼을 때 입력이 저장되지 않을 수 있음을 사용자에게 알림.
(function () {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const ID = 'global-offline-banner';

    function ensureBanner() {
        let el = document.getElementById(ID);
        if (!el && document.body) {
            el = document.createElement('div');
            el.id = ID;
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'assertive');
            el.style.cssText = [
                'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:99999',
                'background:#b91c1c', 'color:#fff', 'font-weight:700',
                'font-size:13px', 'line-height:1.4', 'text-align:center',
                'padding:8px 14px', 'box-shadow:0 -2px 12px rgba(0,0,0,.25)',
                'transition:transform .25s ease', 'transform:translateY(100%)'
            ].join(';');
            el.innerHTML = '⚠️ 오프라인 상태입니다 — 네트워크 연결을 확인하세요. 연결되기 전 변경사항은 저장되지 않을 수 있습니다.';
            document.body.appendChild(el);
        }
        return el;
    }

    function update() {
        const el = ensureBanner();
        if (!el) return;
        const offline = (typeof navigator !== 'undefined') && navigator.onLine === false;
        el.style.transform = offline ? 'translateY(0)' : 'translateY(100%)';
    }

    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', update);
    } else {
        update();
    }

    // PWA 서비스워커 등록 (network-first 전략 — 오프라인 대비 + 홈 화면 설치)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        });
    }
})();
