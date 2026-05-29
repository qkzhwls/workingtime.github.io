// === js/listeners-main-board.js ===
// 설명: 메인 화면의 '실시간 현황판'(업무 카드, 팀원 현황) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { render } from './app.js';
import { showToast, formatTimeTo24H } from './utils.js';
import { renderTeamSelectionModalContent, renderLeaveTypeModalOptions } from './ui.js';
import {
    stopWorkIndividual, pauseWorkGroup, resumeWorkGroup,
    pauseWorkIndividual, resumeWorkIndividual,
    processClockIn, processClockOut, cancelClockOut,
    startWorkGroup,
    addMembersToWorkGroup,
    pauseWorkByTask, resumeWorkByTask
} from './app-logic.js';

import { renderTodayInspectionList, initializeInspectionSession } from './inspection-logic.js';

// 근태 설정 모달 열기 헬퍼 함수
const openLeaveModal = (memberName) => {
    if (DOM.leaveMemberNameSpan) DOM.leaveMemberNameSpan.textContent = memberName;
    State.context.memberToSetLeave = memberName;
    renderLeaveTypeModalOptions(State.LEAVE_TYPES);
    if (DOM.leaveTypeModal) DOM.leaveTypeModal.classList.remove('hidden');
};

// [수정] 통합 액션 모달 열기 (관리자/본인 공용)
const openMemberActionModal = (memberName) => {
    State.context.memberToAction = memberName;
    if (DOM.actionMemberName) DOM.actionMemberName.textContent = memberName;

    const ongoingRecord = (State.appState.workRecords || []).find(r => r.member === memberName && r.status === 'ongoing');
    const pausedRecord = (State.appState.workRecords || []).find(r => r.member === memberName && r.status === 'paused');
    const attendance = State.appState.dailyAttendance?.[memberName];
    const status = attendance?.status || 'none';

    // 근태 상태 확인 (일일 근태 + 기간 근태 병합 확인)
    const combinedOnLeaveMembers = [...(State.appState.dailyOnLeaveMembers || []), ...(State.appState.dateBasedOnLeaveMembers || [])];
    // 외출 중이더라도 종료(복귀) 시간이 있으면 근태 중이 아님
    const leaveInfo = combinedOnLeaveMembers.find(m => m.member === memberName && !(m.type === '외출' && m.endTime));

    // 상태 배지 & 시간 정보 업데이트
    if (DOM.actionMemberStatusBadge && DOM.actionMemberTimeInfo) {
         if (ongoingRecord) {
            DOM.actionMemberStatusBadge.textContent = `업무 중 (${ongoingRecord.task})`;
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800';
            DOM.actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance?.inTime)} | 업무시작: ${formatTimeTo24H(ongoingRecord.startTime)}`;
        } else if (pausedRecord) {
            DOM.actionMemberStatusBadge.textContent = '휴식 중';
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-yellow-100 text-yellow-800';
            DOM.actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance?.inTime)}`;
        } else if (leaveInfo) {
            // 근태 중일 때의 배지 표시
            DOM.actionMemberStatusBadge.textContent = `${leaveInfo.type} 중`;
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-200 text-gray-700';
            
            let timeInfo = '';
            if (leaveInfo.startTime) {
                timeInfo = `${formatTimeTo24H(leaveInfo.startTime)} ~ ${leaveInfo.endTime ? formatTimeTo24H(leaveInfo.endTime) : ''}`;
            } else if (leaveInfo.startDate) {
                timeInfo = `${leaveInfo.startDate} ~ ${leaveInfo.endDate || ''}`;
            }
            DOM.actionMemberTimeInfo.textContent = timeInfo;

        } else if (status === 'active') {
            DOM.actionMemberStatusBadge.textContent = '대기 중';
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800';
            DOM.actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance.inTime)}`;
        } else if (status === 'returned') {
            DOM.actionMemberStatusBadge.textContent = '퇴근 완료';
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-600';
            DOM.actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance.inTime)} / 퇴근: ${formatTimeTo24H(attendance.outTime)}`;
        } else {
            DOM.actionMemberStatusBadge.textContent = '출근 전';
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-400';
            DOM.actionMemberTimeInfo.textContent = '';
        }
    }

    // [버튼 표시 로직]
    const isOnLeave = !!leaveInfo;
    
    // 1. 출근/퇴근/복귀(퇴근취소) 버튼: 근태 중이 아닐 때만 상황에 맞춰 표시
    if (DOM.adminClockInBtn) DOM.adminClockInBtn.classList.toggle('hidden', isOnLeave || status === 'active' || status === 'returned');
    if (DOM.adminClockOutBtn) DOM.adminClockOutBtn.classList.toggle('hidden', isOnLeave || status !== 'active');
    if (DOM.adminCancelClockOutBtn) DOM.adminCancelClockOutBtn.classList.toggle('hidden', isOnLeave || status !== 'returned');
    
    // 2. 근태 취소(복귀) 버튼: 근태 중일 때만 표시 (빨간 버튼)
    if (DOM.adminCancelLeaveBtn) {
        DOM.adminCancelLeaveBtn.classList.toggle('hidden', !isOnLeave);
        if (isOnLeave && DOM.adminCancelLeaveText) {
            // "외출", "조퇴" 이면 "복귀", 그 외(연차, 결근 등)면 "취소"
            const actionText = (leaveInfo.type === '외출' || leaveInfo.type === '조퇴') ? '복귀' : '취소';
            DOM.adminCancelLeaveText.textContent = `${leaveInfo.type} ${actionText}`;
        }
    }

    // 3. 근태 설정 버튼: 항상 표시 (파란 버튼) - 근무 중이어도 조퇴/외출 설정 가능
    if (DOM.openLeaveModalBtn) {
        DOM.openLeaveModalBtn.classList.remove('hidden');
    }

    if (DOM.memberActionModal) DOM.memberActionModal.classList.remove('hidden');
};


export function setupMainBoardListeners() {

    // '업무 시작' 버튼 클릭 시 '검수' 업무라면 자동으로 검수 모달 띄우기
    if (DOM.confirmTeamSelectBtn) {
        DOM.confirmTeamSelectBtn.addEventListener('click', () => {
            if (State.context.selectedTaskForStart === '검수') {
                setTimeout(() => {
                    initializeInspectionSession();
                    if (DOM.inspectionManagerModal) DOM.inspectionManagerModal.classList.remove('hidden');
                    if (DOM.inspProductNameInput) DOM.inspProductNameInput.focus();
                }, 300);
            }
        });
    }

    if (DOM.teamStatusBoard) {
        DOM.teamStatusBoard.addEventListener('click', (e) => {

            const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
            if (toggleMobileBtn) {
                e.stopPropagation();
                State.context.isMobileTaskViewExpanded = !State.context.isMobileTaskViewExpanded;
                render();
                return;
            }

            const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
            if (toggleMemberBtn) {
                e.stopPropagation();
                State.context.isMobileMemberViewExpanded = !State.context.isMobileMemberViewExpanded;
                render();
                return;
            }

            // 그룹 종료 버튼 클릭 시 Task 기준으로 종료 준비
            const stopGroupButton = e.target.closest('.stop-work-group-btn');
            if (stopGroupButton) {
                const taskName = stopGroupButton.dataset.task;
                
                State.context.taskToStop = taskName; 
                State.context.groupToStopId = null; 

                const msgEl = document.getElementById('stop-group-confirm-message');
                if (msgEl) msgEl.textContent = `'${taskName}' 업무를 전체 종료하시겠습니까? (모든 참여 인원)`;
                
                if (DOM.stopGroupConfirmModal) {
                    DOM.stopGroupConfirmModal.classList.remove('hidden');
                }
                return;
            }

            const pauseGroupButton = e.target.closest('.pause-work-group-btn');
            if (pauseGroupButton) {
                pauseWorkByTask(pauseGroupButton.dataset.task); return;
            }
            const resumeGroupButton = e.target.closest('.resume-work-group-btn');
            if (resumeGroupButton) {
                resumeWorkByTask(resumeGroupButton.dataset.task); return;
            }
            const individualPauseBtn = e.target.closest('[data-action="pause-individual"]');
            if (individualPauseBtn) {
                pauseWorkIndividual(individualPauseBtn.dataset.recordId); return;
            }
            const individualResumeBtn = e.target.closest('[data-action="resume-individual"]');
            if (individualResumeBtn) {
                resumeWorkIndividual(individualResumeBtn.dataset.recordId); return;
            }
            const individualStopBtn = e.target.closest('button[data-action="stop-individual"]');
            if (individualStopBtn) {
                State.context.recordToStopId = individualStopBtn.dataset.recordId;
                const record = (State.appState.workRecords || []).find(r => String(r.id) === String(State.context.recordToStopId));
                if (DOM.stopIndividualConfirmMessage && record) {
                    DOM.stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
                }
                if (DOM.stopIndividualConfirmModal) DOM.stopIndividualConfirmModal.classList.remove('hidden');
                return;
            }
            const individualEditTimeBtn = e.target.closest('button[data-action="edit-individual-start-time"]');
            if (individualEditTimeBtn) {
                const recordId = individualEditTimeBtn.dataset.recordId;
                const currentStartTime = individualEditTimeBtn.dataset.currentStartTime;
                const record = (State.appState.workRecords || []).find(r => String(r.id) === String(recordId));
                if (!record) return;
                State.context.recordIdOrGroupIdToEdit = recordId;
                State.context.editType = 'individual';
                if (DOM.editStartTimeModalTitle) DOM.editStartTimeModalTitle.textContent = '개별 시작 시간 변경';
                if (DOM.editStartTimeModalMessage) DOM.editStartTimeModalMessage.textContent = `${record.member}님의 시작 시간을 변경합니다.`;
                if (DOM.editStartTimeInput) DOM.editStartTimeInput.value = currentStartTime;
                if (DOM.editStartTimeContextIdInput) DOM.editStartTimeContextIdInput.value = recordId;
                if (DOM.editStartTimeContextTypeInput) DOM.editStartTimeContextTypeInput.value = 'individual';
                if (DOM.editStartTimeModal) DOM.editStartTimeModal.classList.remove('hidden');
                return;
            }
            const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
            if (groupTimeDisplay) {
                const groupId = groupTimeDisplay.dataset.groupId;
                const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
                if (!groupId || !currentStartTime) return;
                State.context.recordIdOrGroupIdToEdit = groupId;
                State.context.editType = 'group';
                if (DOM.editStartTimeModalTitle) DOM.editStartTimeModalTitle.textContent = '그룹 시작 시간 변경';
                if (DOM.editStartTimeModalMessage) DOM.editStartTimeModalMessage.textContent = '이 그룹의 모든 팀원의 시작 시간이 변경됩니다.';
                if (DOM.editStartTimeInput) DOM.editStartTimeInput.value = currentStartTime;
                if (DOM.editStartTimeContextIdInput) DOM.editStartTimeContextIdInput.value = groupId;
                if (DOM.editStartTimeContextTypeInput) DOM.editStartTimeContextTypeInput.value = 'group';
                if (DOM.editStartTimeModal) DOM.editStartTimeModal.classList.remove('hidden');
                return;
            }
            
            // --- 근태 기록 수정 (리스트 카드 내 수정) ---
            const editLeaveCard = e.target.closest('[data-action="edit-leave-record"]');
            if (editLeaveCard) {
                const memberName = editLeaveCard.dataset.memberName;
                // ... (생략 없이 유지)
                const currentType = editLeaveCard.dataset.leaveType;
                const currentStartTime = editLeaveCard.dataset.startTime;
                const currentStartDate = editLeaveCard.dataset.startDate;
                const currentEndTime = editLeaveCard.dataset.endTime;
                const currentEndDate = editLeaveCard.dataset.endDate;

                const role = State.appState.currentUserRole || 'user';
                const selfName = State.appState.currentUser || null;
                if (role !== 'admin' && memberName !== selfName) {
                    showToast('본인의 근태 기록만 수정할 수 있습니다.', true); return;
                }

                if (currentType === '외출') {
                    State.context.memberToCancelLeave = memberName;
                    if (DOM.cancelLeaveConfirmMessage) DOM.cancelLeaveConfirmMessage.textContent = `${memberName}님을 '${currentType}' 상태에서 복귀(취소) 처리하시겠습니까?`;
                    if (DOM.cancelLeaveConfirmModal) DOM.cancelLeaveConfirmModal.classList.remove('hidden');
                    return;
                }

                const modal = document.getElementById('edit-leave-record-modal');
                const titleEl = document.getElementById('edit-leave-modal-title');
                const nameEl = document.getElementById('edit-leave-member-name');
                const typeSelect = document.getElementById('edit-leave-type');
                const timeFields = document.getElementById('edit-leave-time-fields');
                const dateFields = document.getElementById('edit-leave-date-fields');
                const startTimeInput = document.getElementById('edit-leave-start-time');
                const endTimeInput = document.getElementById('edit-leave-end-time');
                const startDateInput = document.getElementById('edit-leave-start-date');
                const endDateInput = document.getElementById('edit-leave-end-date');
                const originalNameInput = document.getElementById('edit-leave-original-member-name');
                const originalStartInput = document.getElementById('edit-leave-original-start-identifier');
                const originalTypeInput = document.getElementById('edit-leave-original-type');

                if (!modal || !typeSelect) return;

                titleEl.textContent = `${memberName}님 근태 수정`;
                nameEl.textContent = memberName;
                typeSelect.innerHTML = '';
                State.LEAVE_TYPES.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type; option.textContent = type;
                    if (type === currentType) option.selected = true;
                    typeSelect.appendChild(option);
                });
                const isTimeBased = (currentType === '외출' || currentType === '조퇴');
                timeFields.classList.toggle('hidden', !isTimeBased);
                dateFields.classList.toggle('hidden', isTimeBased);
                if (isTimeBased) { startTimeInput.value = currentStartTime || ''; endTimeInput.value = currentEndTime || ''; }
                else { startDateInput.value = currentStartDate || ''; endDateInput.value = currentEndDate || ''; }
                originalNameInput.value = memberName;
                originalStartInput.value = isTimeBased ? currentStartTime : currentStartDate;
                originalTypeInput.value = isTimeBased ? 'daily' : 'persistent';
                modal.classList.remove('hidden');
                return;
            }

            // --- [핵심 수정] 팀원 카드 클릭 (근태 토글 및 관리) ---
            const memberCard = e.target.closest('[data-action="member-toggle-leave"]');
            if (memberCard) {
                const memberName = memberCard.dataset.memberName;
                const role = State.appState.currentUserRole || 'user';
                const selfName = State.appState.currentUser || null;

                // 1. 권한 체크 (타인 수정 불가, 관리자 제외)
                if (role !== 'admin' && memberName !== selfName) {
                    showToast('본인의 근태 현황만 설정할 수 있습니다.', true); return;
                }

                // 2. 통합 관리 모달 열기 (관리자/본인 모두)
                // 기존에는 본인일 경우 상태에 따라 분기했지만, 이제는 모달로 통합하여
                // 모달 내부에서 복귀/취소/설정 버튼을 선택하도록 함.
                openMemberActionModal(memberName);
                return;
            }

            if (e.target.closest('.members-list, .card-actions, .group-time-display')) { e.stopPropagation(); return; }
            
            const card = e.target.closest('div[data-group-id], div[data-action]');
            if (card) {
                const action = card.dataset.action;
                const groupId = card.dataset.groupId;
                const task = card.dataset.task;
                if (action === 'start-task') {
                    State.context.selectedTaskForStart = task;
                    State.context.selectedGroupForAdd = null;
                    State.context.tempSelectedMembers = [];
                    renderTeamSelectionModalContent(task, State.appState, State.appConfig.teamGroups);
                    const titleEl = document.getElementById('team-select-modal-title');
                    if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
                    if (DOM.teamSelectModal) DOM.teamSelectModal.classList.remove('hidden');
                    return;
                } else if (action === 'other') {
                    if (DOM.taskSelectModal) DOM.taskSelectModal.classList.remove('hidden');
                    return;
                } else if (groupId && task) {
                    if (task === '검수') {
                        renderTodayInspectionList();
                        if (DOM.inspectionManagerModal) DOM.inspectionManagerModal.classList.remove('hidden');
                        if (DOM.inspProductNameInput) DOM.inspProductNameInput.focus();
                        return;
                    }
                    State.context.selectedTaskForStart = task;
                    State.context.selectedGroupForAdd = groupId;
                    State.context.tempSelectedMembers = [];
                    renderTeamSelectionModalContent(task, State.appState, State.appConfig.teamGroups);
                    const titleEl = document.getElementById('team-select-modal-title');
                    if (titleEl) titleEl.textContent = `'${task}' 인원 추가`;
                    if (DOM.teamSelectModal) DOM.teamSelectModal.classList.remove('hidden');
                    return;
                }
            }
        });
    }
    
    // 모달 내부 버튼 리스너 (DOM ID는 admin- prefix를 쓰지만 공용으로 사용)
    if (DOM.adminClockInBtn) {
        DOM.adminClockInBtn.addEventListener('click', () => {
            if (State.context.memberToAction) {
                processClockIn(State.context.memberToAction, true);
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
            }
        });
    }
    if (DOM.adminClockOutBtn) {
        DOM.adminClockOutBtn.addEventListener('click', () => {
             if (State.context.memberToAction) {
                processClockOut(State.context.memberToAction, true);
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
            }
        });
    }
    if (DOM.adminCancelClockOutBtn) {
        DOM.adminCancelClockOutBtn.addEventListener('click', () => {
             if (State.context.memberToAction) {
                cancelClockOut(State.context.memberToAction, true);
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
            }
        });
    }
    
    // [설정] 버튼 클릭 시 -> 근태 설정(입력) 모달로 이동
    if (DOM.openLeaveModalBtn) {
        DOM.openLeaveModalBtn.addEventListener('click', () => {
            if (State.context.memberToAction) {
                // 근무 중이어도 '조퇴', '외출' 등의 설정이 가능해야 하므로 차단 로직 제거
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
                setTimeout(() => openLeaveModal(State.context.memberToAction), 100);
            }
        });
    }

    // [복귀/취소] 버튼 클릭 시 -> 확인 모달 띄우기
    if (DOM.adminCancelLeaveBtn) {
        DOM.adminCancelLeaveBtn.addEventListener('click', () => {
            const memberName = State.context.memberToAction;
            if (memberName) {
                State.context.memberToCancelLeave = memberName;
                
                const combinedOnLeaveMembers = [...(State.appState.dailyOnLeaveMembers || []), ...(State.appState.dateBasedOnLeaveMembers || [])];
                const leaveInfo = combinedOnLeaveMembers.find(m => m.member === memberName && !(m.type === '외출' && m.endTime));
                const leaveType = leaveInfo ? leaveInfo.type : '근태';
                const actionText = (leaveType === '외출' || leaveType === '조퇴') ? '복귀' : '취소';

                if (DOM.cancelLeaveConfirmMessage) {
                    DOM.cancelLeaveConfirmMessage.textContent = `${memberName}님의 '${leaveType}' 상태를 ${actionText} 하시겠습니까?`;
                }
                
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
                if (DOM.cancelLeaveConfirmModal) DOM.cancelLeaveConfirmModal.classList.remove('hidden');
            }
        });
    }
}