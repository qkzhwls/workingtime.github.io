// === js/listeners-weekend.js ===
import * as WeekendCalendar from './weekend-calendar.js';

export function setupWeekendListeners() {
    // DOM 요소 캐싱
    const modal = document.getElementById('weekend-work-modal');
    const modalContent = document.getElementById('weekend-modal-content');
    const modalHeader = document.getElementById('weekend-modal-header');
    const statsSidebar = document.getElementById('weekend-stats-sidebar');
    
    // --- 1. 모달 열기/닫기 관련 ---
    const openBtn = document.getElementById('open-weekend-modal-btn');
    const openBtnMobile = document.getElementById('open-weekend-modal-btn-mobile');
    const closeBtn = document.getElementById('close-weekend-modal-btn');
    const closeBtnDesktop = document.getElementById('close-weekend-modal-btn-desktop');

    const openModal = () => {
        if (modal) {
            modal.classList.remove('hidden');
            WeekendCalendar.initWeekendCalendar();
        }
    };

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (openBtnMobile) openBtnMobile.addEventListener('click', openModal);

    const closeModal = () => {
        if (modal) {
            modal.classList.add('hidden');
            if (modalContent) {
                modalContent.style.transform = ''; 
            }
            if (statsSidebar && window.innerWidth < 768) {
                statsSidebar.classList.add('hidden');
                statsSidebar.classList.remove('flex');
            }
        }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (closeBtnDesktop) closeBtnDesktop.addEventListener('click', closeModal);

    // --- 2. 모바일 통계 사이드바 토글 ---
    const toggleStatsBtn = document.getElementById('toggle-weekend-stats-btn');
    const closeStatsMobileBtn = document.getElementById('close-weekend-stats-mobile-btn');

    if (toggleStatsBtn && statsSidebar) {
        toggleStatsBtn.addEventListener('click', () => {
            statsSidebar.classList.remove('hidden');
            statsSidebar.classList.add('flex');
        });
    }

    if (closeStatsMobileBtn && statsSidebar) {
        closeStatsMobileBtn.addEventListener('click', () => {
            statsSidebar.classList.add('hidden');
            statsSidebar.classList.remove('flex');
        });
    }

    // --- 3. 창 드래그 앤 드롭 기능 (PC 전용) ---
    if (modalContent && modalHeader) {
        let isDragging = false;
        let startX, startY, initialX, initialY;

        modalHeader.addEventListener('mousedown', (e) => {
            if (window.innerWidth < 768) return; 
            if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
            
            isDragging = true;
            
            const transform = window.getComputedStyle(modalContent).getPropertyValue('transform');
            let matrixX = 0, matrixY = 0;
            
            if (transform !== 'none') {
                const matrix = transform.split('(')[1].split(')')[0].split(',');
                matrixX = parseFloat(matrix[4]);
                matrixY = parseFloat(matrix[5]);
            }

            startX = e.clientX;
            startY = e.clientY;
            initialX = matrixX;
            initialY = matrixY;
            
            modalContent.style.transition = 'none'; 
            document.body.style.userSelect = 'none'; 
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            modalContent.style.transform = `translate(${initialX + dx}px, ${initialY + dy}px)`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.userSelect = '';
                modalContent.style.transition = 'transform 0.2s ease-out';
            }
        });
    }

    // --- 4. 월 이동 버튼 ---
    const prevBtn = document.getElementById('prev-month-btn');
    const nextBtn = document.getElementById('next-month-btn');

    if (prevBtn) prevBtn.addEventListener('click', () => WeekendCalendar.changeMonth(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => WeekendCalendar.changeMonth(1));


    // --- 5. 관리자 날짜 관리 팝업 관련 리스너 ---
    const adminDatePopup = document.getElementById('weekend-admin-date-popup');
    const adminDateCloseBtn = document.getElementById('admin-date-close-btn');
    const adminDateCapacityBtn = document.getElementById('admin-date-capacity-btn');
    const adminDateCapacityInput = document.getElementById('admin-date-capacity');
    const adminDateAddBtn = document.getElementById('admin-date-add-btn');
    const adminDateAddInput = document.getElementById('admin-date-add-member');
    const adminDateRandomBtn = document.getElementById('admin-date-random-btn');
    const adminDateRandomCount = document.getElementById('admin-date-random-count');
    const adminDateBlockToggle = document.getElementById('admin-date-block-toggle');
    const smartCalcBtn = document.getElementById('admin-date-smart-calc-btn');

    if (adminDateCloseBtn && adminDatePopup) {
        adminDateCloseBtn.addEventListener('click', () => adminDatePopup.classList.add('hidden'));
    }

    if (adminDateCapacityBtn && adminDateCapacityInput) {
        adminDateCapacityBtn.addEventListener('click', () => {
            WeekendCalendar.setDateCapacity(adminDateCapacityInput.value);
        });
        adminDateCapacityInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                WeekendCalendar.setDateCapacity(e.target.value);
            }
        });
    }

    if (adminDateAddBtn) {
        adminDateAddBtn.addEventListener('click', () => WeekendCalendar.adminAddMemberToDate());
    }

    if (adminDateAddInput) {
        adminDateAddInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                WeekendCalendar.adminAddMemberToDate();
            }
        });
    }

    if (adminDateRandomBtn && adminDateRandomCount) {
        adminDateRandomBtn.addEventListener('click', () => {
            const count = parseInt(adminDateRandomCount.value, 10);
            if (isNaN(count) || count <= 0) {
                alert("올바른 인원 수를 입력하세요.");
                return;
            }
            if (confirm(`관리자를 제외한 인원 중 ${count}명을 무작위로 뽑아 '승인 대기' 상태로 등록하시겠습니까?`)) {
                 WeekendCalendar.adminRandomSelectMembers(count);
            }
        });
    }

    if (adminDateBlockToggle) {
        adminDateBlockToggle.addEventListener('change', (e) => {
            WeekendCalendar.toggleBlockDate(e.target.checked);
        });
    }

    if (smartCalcBtn) {
        smartCalcBtn.addEventListener('click', () => {
            WeekendCalendar.calculateSmartAllocation();
        });
    }


    // ⭐ [신규] 과거 날짜 편집 팝업 관련 리스너
    const pastDatePopup = document.getElementById('past-date-edit-popup');
    const pastDateCloseBtn = document.getElementById('past-date-close-btn');
    const pastDateAddBtn = document.getElementById('past-date-add-btn');

    if (pastDateCloseBtn && pastDatePopup) {
        pastDateCloseBtn.addEventListener('click', () => pastDatePopup.classList.add('hidden'));
    }

    if (pastDateAddBtn) {
        pastDateAddBtn.addEventListener('click', () => WeekendCalendar.pastDateAddMember());
    }

    // 동적으로 생성되는 버튼들에 대한 이벤트 위임 (스마트 배분 적용 및 과거 날짜 확정/삭제)
    document.addEventListener('click', (e) => {
        // 스마트 배분
        if (e.target && e.target.id === 'apply-smart-calc-btn') {
            WeekendCalendar.applySmartAllocation();
        }
        
        // 과거 주차 인원 상태 변경 (대기 -> 확정)
        if (e.target.classList.contains('past-date-confirm-btn')) {
            const id = e.target.getAttribute('data-id');
            WeekendCalendar.pastDateChangeStatus(id, 'confirmed');
        }

        // 과거 주차 인원 완전 삭제
        if (e.target.classList.contains('past-date-delete-btn')) {
            const id = e.target.getAttribute('data-id');
            const member = e.target.getAttribute('data-member');
            if (confirm(`${member}님의 기록을 완전히 삭제하시겠습니까? (삭제된 내역은 복구할 수 없으며 실적에서 제외됩니다.)`)) {
                WeekendCalendar.pastDateDeleteMember(id);
            }
        }
    });
}