// === js/modal-esc.js ===
// ESC 키로 팝업(모달)을 닫는다. (의존성 없는 단독 스크립트 — 모든 페이지에 포함)
// 이 앱의 모달은 공통적으로 `fixed inset-0 ... flex items-center justify-center ... hidden`
// 형태의 오버레이이며, 열림/닫힘은 'hidden' 클래스로 토글된다.
// ESC를 누르면 현재 보이는 모달 중 z-index가 가장 높은(맨 위) 것 하나를 닫는다.
(function () {
    if (typeof document === 'undefined') return;

    // ESC로 닫지 않을 모달 (로그인 등 — 닫으면 화면이 비어버림)
    const EXCLUDED_IDS = new Set(['login-modal']);

    function isVisible(el) {
        if (!el || el.classList.contains('hidden')) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    }

    function getZ(el) {
        const z = parseInt(getComputedStyle(el).zIndex, 10);
        return Number.isNaN(z) ? 0 : z;
    }

    // 중앙 정렬(justify-center) 오버레이만 "모달"로 간주한다.
    // (사이드바 딤 오버레이·워터마크 등 fixed inset-0 이지만 모달이 아닌 것 제외)
    function findTopModal() {
        const candidates = Array.from(document.querySelectorAll('.fixed.inset-0'));
        const visible = candidates.filter(el =>
            el.className &&
            el.className.indexOf('justify-center') !== -1 &&
            !EXCLUDED_IDS.has(el.id) &&
            isVisible(el)
        );
        if (visible.length === 0) return null;
        // z-index 내림차순, 같으면 DOM에서 나중에 나오는(대개 나중에 열린) 것을 위로 본다.
        visible.sort((a, b) => {
            const dz = getZ(b) - getZ(a);
            if (dz !== 0) return dz;
            const pos = a.compareDocumentPosition(b);
            if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 1;  // b가 뒤 → b 우선
            if (pos & Node.DOCUMENT_POSITION_PRECEDING) return -1;
            return 0;
        });
        return visible[0];
    }

    // 모달 내부의 "닫기" 성격 버튼을 찾는다. (정리 로직이 있는 전용 닫기 핸들러 우선 실행)
    // 취소/삭제 등 다른 동작 버튼은 건드리지 않도록 보수적으로 매칭한다.
    function findCloseButton(modal) {
        // 1) id에 close가 포함된 버튼 (예: close-weekend-modal-btn, admin-date-close-btn)
        const byId = modal.querySelector('button[id*="close" i]');
        if (byId) return byId;
        // 2) 텍스트가 ×/✕/닫기 인 버튼
        const buttons = modal.querySelectorAll('button');
        for (const b of buttons) {
            const t = (b.textContent || '').trim();
            if (t === '×' || t === '✕' || t === '⨯' || t === '╳' || t === '닫기') return b;
        }
        return null;
    }

    function closeTopModal(modal) {
        const btn = findCloseButton(modal);
        if (btn) {
            btn.click(); // 전용 닫기 핸들러 실행 (예: 주말 모달의 리스너 해제)
        } else {
            modal.classList.add('hidden'); // 별도 핸들러가 없으면 직접 숨김
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' && e.key !== 'Esc' && e.keyCode !== 27) return;
        const modal = findTopModal();
        if (!modal) return;
        e.preventDefault();
        e.stopPropagation();
        closeTopModal(modal);
    }, true); // 캡처 단계에서 처리해 다른 핸들러보다 먼저 반응
})();
