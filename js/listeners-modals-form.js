// === js/listeners-modals-form.js ===
// 설명: 폼/입력 관련 모달 리스너들을 통합 관리하는 메인 파일입니다.
// (업무기록, 팀원선택, 근태, 처리량, 검수, 업무선택)

import * as DOM from './dom-elements.js?v=202610021042';
import * as State from './state.js?v=202610021042';
import { renderTeamSelectionModalContent } from './ui-modals.js?v=202610021042';

// 분리된 하위 리스너 모듈 임포트
import { setupFormRecordListeners } from './listeners-form-record.js?v=202610021042';
import { setupFormTeamListeners } from './listeners-form-team.js?v=202610021042';
import { setupFormAttendanceListeners } from './listeners-form-attendance.js?v=202610021042';
import { setupFormQuantityListeners } from './listeners-form-quantity.js?v=202610021042';
import { setupFormInspectionListeners } from './listeners-form-inspection.js?v=202610021042';

export function setupFormModalListeners() {
    
    // 1. 하위 모듈 리스너 초기화
    setupFormRecordListeners();      // 업무 기록 (수정/추가/시간변경)
    setupFormTeamListeners();        // 팀원 선택 & 알바 관리
    setupFormAttendanceListeners();  // 근태 설정 & 수정
    setupFormQuantityListeners();    // 처리량 입력
    setupFormInspectionListeners();  // 검수 매니저

    // 2. 업무 선택 모달 리스너 (Task Select)
    // (팀원 선택 모달로 이어지는 중간 단계이므로 여기서 처리)
    if (DOM.taskSelectModal) {
        DOM.taskSelectModal.addEventListener('click', (e) => {
            const taskButton = e.target.closest('.task-select-btn');
            if (taskButton) {
                const taskName = taskButton.dataset.task;
                
                // 컨텍스트 설정
                State.context.selectedTaskForStart = taskName;
                State.context.selectedGroupForAdd = null;
                State.context.tempSelectedMembers = [];
                
                // 업무 선택 모달 닫기
                DOM.taskSelectModal.classList.add('hidden');

                // 팀원 선택 모달 내용 렌더링
                renderTeamSelectionModalContent(taskName, State.appState, State.appConfig.teamGroups);

                // 모달 제목 및 버튼 텍스트 업데이트
                const titleEl = document.getElementById('team-select-modal-title');
                const confirmBtn = document.getElementById('confirm-team-select-btn');
                
                if (titleEl) titleEl.textContent = `'${taskName}' 업무 시작`;
                if (confirmBtn) confirmBtn.textContent = '선택 완료 및 업무 시작';

                // 팀원 선택 모달 열기
                if (DOM.teamSelectModal) DOM.teamSelectModal.classList.remove('hidden');
            }
        });
    }
}