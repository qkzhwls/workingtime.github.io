// === js/listeners-weekend.js ===
import * as WeekendCalendar from './weekend-calendar.js';

export function setupWeekendListeners() {
    // 1. 메인 메뉴에서 '주말 근무' 버튼 클릭 시 모달 열기
    // (index.html에 버튼을 추가한 뒤 ID를 'open-weekend-modal-btn'으로 지정해야 합니다)
    const openBtn = document.getElementById('open-weekend-modal-btn');
    const modal = document.getElementById('weekend-work-modal');
    const closeBtn = document.getElementById('close-weekend-modal-btn');

    if (openBtn && modal) {
        openBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
            WeekendCalendar.initWeekendCalendar(); // 모달 열릴 때 로드
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    // 2. 월 이동 버튼
    const prevBtn = document.getElementById('prev-month-btn');
    const nextBtn = document.getElementById('next-month-btn');

    if (prevBtn) prevBtn.addEventListener('click', () => WeekendCalendar.changeMonth(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => WeekendCalendar.changeMonth(1));

    // 3. 신청 팝업 관련 버튼
    const submitBtn = document.getElementById('submit-request-btn');
    const cancelPopupBtn = document.getElementById('cancel-popup-btn');
    const popup = document.getElementById('weekend-request-popup');

    if (submitBtn) submitBtn.addEventListener('click', WeekendCalendar.submitRequest);
    
    if (cancelPopupBtn && popup) {
        cancelPopupBtn.addEventListener('click', () => {
            popup.classList.add('hidden');
        });
    }

    // Enter 키로 신청 제출
    const reasonInput = document.getElementById('weekend-reason-input');
    if (reasonInput) {
        reasonInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') WeekendCalendar.submitRequest();
        });
    }
}