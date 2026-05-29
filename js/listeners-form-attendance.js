// === js/listeners-form-attendance.js ===
// 설명: 근태 설정(연차/외출 등) 및 수정 모달의 폼 로직을 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getCurrentTime, calculateDateDifference } from './utils.js';
import { saveStateToFirestore, debouncedSaveState } from './app-data.js';
import { saveLeaveSchedule } from './config.js';
import { renderLeaveTypeModalOptions } from './ui-modals.js';

// 헬퍼: 로컬 이력(allHistoryData)에서 특정 연차 ID 제거/업데이트
const updateLocalHistoryForLeave = (leaveEntry, action = 'add') => {
    // action: 'add' | 'remove'
    const startDt = new Date(leaveEntry.startDate);
    const endDt = new Date(leaveEntry.endDate || leaveEntry.startDate);

    for(let dt = new Date(startDt); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
        const dateKey = dt.toISOString().slice(0, 10);
        let dayData = State.allHistoryData.find(d => d.id === dateKey);
        
        if (action === 'add') {
            if (!dayData) {
                dayData = { id: dateKey, onLeaveMembers: [], workRecords: [], taskQuantities: {} };
                State.allHistoryData.push(dayData);
                State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
            }
            if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
            // 중복 없으면 추가
            const exists = dayData.onLeaveMembers.some(l => l.id === leaveEntry.id);
            if (!exists) {
                dayData.onLeaveMembers.push({ ...leaveEntry });
            }
        } else if (action === 'remove') {
            if (dayData && dayData.onLeaveMembers) {
                dayData.onLeaveMembers = dayData.onLeaveMembers.filter(l => l.id !== leaveEntry.id);
            }
        }
    }
};

export function setupFormAttendanceListeners() {

    // 1. 연차 현황(내 연차관리) 모달 리스너 (리스트 내 수정/삭제 버튼 처리)
    if (DOM.leaveTypeModal) {
        DOM.leaveTypeModal.addEventListener('click', async (e) => {
            // A. 연차 삭제 버튼
            const delBtn = e.target.closest('.btn-delete-leave-history');
            if (delBtn) {
                if(!confirm('정말 이 내역을 삭제하시겠습니까? (병합된 내역은 모두 삭제됩니다)')) return;
                
                // data-ids에 쉼표로 구분된 ID 목록이 있음 (병합된 경우 대비)
                const idsString = delBtn.dataset.ids || '';
                const idsToDelete = idsString.split(',').filter(Boolean);
                
                // 1) Persistent 저장소에서 삭제
                State.persistentLeaveSchedule.onLeaveMembers = State.persistentLeaveSchedule.onLeaveMembers.filter(l => !idsToDelete.includes(l.id));
                await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);

                // 2) 로컬 이력 데이터에서 삭제
                idsToDelete.forEach(id => {
                     State.allHistoryData.forEach(dayData => {
                        if (dayData.onLeaveMembers) {
                            dayData.onLeaveMembers = dayData.onLeaveMembers.filter(l => l.id !== id);
                        }
                    });
                });

                // 3) 오늘 날짜 실시간 근태 배열에서도 제거
                State.appState.dateBasedOnLeaveMembers = State.appState.dateBasedOnLeaveMembers.filter(l => !idsToDelete.includes(l.id));

                // 4) 리스트 갱신
                renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
                showToast('삭제되었습니다.');
                return;
            }

            // B. 연차 수정 버튼
            const editBtn = e.target.closest('.btn-edit-leave-history');
            if (editBtn) {
                const id = editBtn.dataset.id;
                const entry = State.persistentLeaveSchedule.onLeaveMembers.find(l => l.id === id);
                if (entry) {
                    // 설정 탭으로 이동
                    document.getElementById('tab-leave-setting').click();
                    
                    // 값 채우기
                    const radio = document.querySelector(`input[name="leave-type"][value="${entry.type}"]`);
                    if(radio) radio.checked = true;
                    document.getElementById('leave-type-options').dispatchEvent(new Event('change')); // 입력창 표시 트리거
                    
                    document.getElementById('leave-start-date-input').value = entry.startDate;
                    document.getElementById('leave-end-date-input').value = entry.endDate || entry.startDate;
                    
                    // 버튼을 수정 모드로 변경
                    DOM.confirmLeaveBtn.dataset.editingId = id;
                    DOM.confirmLeaveBtn.textContent = '수정 저장';
                }
            }
        });
    }

    // 2. 근태 설정 저장 버튼 (수정 모드 지원 및 중복 체크 강화)
    if (DOM.confirmLeaveBtn) {
        DOM.confirmLeaveBtn.addEventListener('click', async () => {
            const memberName = State.context.memberToSetLeave;
            const selectedTypeRadio = document.querySelector('input[name="leave-type"]:checked');
            if (!memberName || !selectedTypeRadio) {
                showToast('선택이 필요합니다.', true);
                return;
            }

            const type = selectedTypeRadio.value;
            const today = getTodayDateString();
            const startDate = document.getElementById('leave-start-date-input').value || today;
            const endDate = document.getElementById('leave-end-date-input').value || startDate;

            if (type === '연차' || type === '출장' || type === '결근') {
                if (startDate > endDate) {
                    showToast('종료 날짜는 시작 날짜보다 빠를 수 없습니다.', true);
                    return;
                }

                // 수정 모드 확인
                const editingId = DOM.confirmLeaveBtn.dataset.editingId;

                // 중복 체크 (수정 시 자기 자신은 제외)
                let isDuplicate = false;
                const startDt = new Date(startDate);
                const endDt = new Date(endDate);
                
                for(let dt = new Date(startDt); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
                    const checkDate = dt.toISOString().slice(0, 10);
                    const conflict = State.persistentLeaveSchedule.onLeaveMembers.some(l => {
                        const lStart = l.startDate;
                        const lEnd = l.endDate || l.startDate;
                        // ID가 같으면(수정 중인 자기 자신) 중복 아님
                        if (l.id === editingId) return false;
                        // 멤버와 타입이 같고, 날짜가 겹치면 중복
                        return l.member === memberName && l.type === type && (checkDate >= lStart && checkDate <= lEnd);
                    });

                    if (conflict) {
                        isDuplicate = true;
                        break;
                    }
                }

                if (isDuplicate) {
                    showToast('이미 해당 기간에 동일한 유형의 기록이 존재합니다.', true);
                    return;
                }

                let leaveEntry;
                let isEdit = false;

                if (editingId) {
                    // 수정
                    leaveEntry = State.persistentLeaveSchedule.onLeaveMembers.find(l => l.id === editingId);
                    if (leaveEntry) {
                        // 기존 데이터 이력에서 제거 (날짜가 바뀔 수 있으므로)
                        updateLocalHistoryForLeave(leaveEntry, 'remove');
                        
                        // 값 업데이트
                        leaveEntry.type = type;
                        leaveEntry.startDate = startDate;
                        leaveEntry.endDate = endDate;
                        isEdit = true;
                        
                        // 수정 모드 해제
                        delete DOM.confirmLeaveBtn.dataset.editingId;
                        DOM.confirmLeaveBtn.textContent = '설정 저장';
                    }
                } else {
                    // 신규 생성
                    leaveEntry = {
                        id: `leave-${Date.now()}`,
                        member: memberName,
                        type,
                        startDate,
                        endDate
                    };
                    State.persistentLeaveSchedule.onLeaveMembers.push(leaveEntry);
                }

                // 1. Persistent 저장소 업데이트
                await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                
                // 2. 로컬 이력 데이터 반영 (추가/수정된 내용 반영)
                updateLocalHistoryForLeave(leaveEntry, 'add');

                // 3. 오늘 날짜에 해당하면 실시간 반영
                const todayLeaves = State.persistentLeaveSchedule.onLeaveMembers.filter(entry => {
                    const ed = entry.endDate || entry.startDate;
                    return today >= entry.startDate && today <= ed;
                });
                State.appState.dateBasedOnLeaveMembers = todayLeaves;

                const diffDays = calculateDateDifference(startDate, endDate);
                
                if (isEdit) {
                    showToast('수정되었습니다.');
                    // 목록으로 돌아가기
                    renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
                    
                    // 입력 폼 초기화
                    document.getElementById('leave-start-date-input').value = '';
                    document.getElementById('leave-end-date-input').value = '';

                } else {
                    if (type === '연차') {
                         showToast(`${memberName}님 ${diffDays}일 연차 처리 완료.`);
                    } else {
                         showToast(`${memberName}님 ${type} 처리 완료.`);
                    }
                    
                    // ✅ [수정] 창을 닫지 않고(주석처리), 입력 필드만 초기화하여 연속 입력 지원
                    // DOM.leaveTypeModal.classList.add('hidden'); 
                    
                    document.getElementById('leave-start-date-input').value = '';
                    document.getElementById('leave-end-date-input').value = '';
                }

            } else {
                // '지각', '외출', '조퇴' 등 Daily 근태
                const newDailyEntry = {
                    member: memberName,
                    type: type,
                    startTime: (type === '외출' || type === '조퇴' || type === '지각') ? getCurrentTime() : null,
                    endTime: null
                };
                State.appState.dailyOnLeaveMembers.push(newDailyEntry);
                debouncedSaveState();
                showToast(`${memberName}님 ${type} 처리 완료.`);
                
                // ✅ [수정] 창을 닫지 않고 유지 (연속 입력 지원)
                // DOM.leaveTypeModal.classList.add('hidden');
            }
        });
    }

    // 3. 근태 기록 수정 모달 (Edit Leave Record Modal)
    const editLeaveModal = DOM.editLeaveModal || document.getElementById('edit-leave-record-modal');

    if (editLeaveModal) {
        
        const cancelEditLeaveBtn = document.getElementById('cancel-edit-leave-record-btn');
        if (cancelEditLeaveBtn) {
            cancelEditLeaveBtn.addEventListener('click', () => {
                editLeaveModal.classList.add('hidden');
            });
        }

        const deleteLeaveBtn = document.getElementById('delete-leave-record-btn');
        if (deleteLeaveBtn) {
            deleteLeaveBtn.addEventListener('click', () => {
                const memberName = document.getElementById('edit-leave-original-member-name').value;
                const type = document.getElementById('edit-leave-type').value; 
                
                State.context.deleteMode = 'leave-record';
                State.context.attendanceRecordToDelete = { 
                    memberName: memberName,
                    startIdentifier: document.getElementById('edit-leave-original-start-identifier').value,
                    type: document.getElementById('edit-leave-original-type').value,
                    displayType: type
                };

                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = `${memberName}님의 '${type}' 기록을 삭제하시겠습니까?`;
                
                editLeaveModal.classList.add('hidden');
                if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
            });
        }

        const confirmEditLeaveBtn = document.getElementById('confirm-edit-leave-record-btn');
        if (confirmEditLeaveBtn) {
            confirmEditLeaveBtn.addEventListener('click', async () => {
                const memberName = document.getElementById('edit-leave-original-member-name').value;
                const originalStart = document.getElementById('edit-leave-original-start-identifier').value;
                const originalType = document.getElementById('edit-leave-original-type').value;

                const newType = document.getElementById('edit-leave-type').value;
                const newStartTime = document.getElementById('edit-leave-start-time').value;
                const newEndTime = document.getElementById('edit-leave-end-time').value;
                const newStartDate = document.getElementById('edit-leave-start-date').value;
                const newEndDate = document.getElementById('edit-leave-end-date').value;

                const isNewTimeBased = (newType === '외출' || newType === '조퇴' || newType === '지각');

                let dailyChanged = false;
                let persistentChanged = false;
                let foundAndRemoved = false;

                if (originalType === 'daily') {
                    const index = State.appState.dailyOnLeaveMembers.findIndex(
                        r => r.member === memberName && (r.startTime || '') === originalStart
                    );
                    if (index > -1) {
                        State.appState.dailyOnLeaveMembers.splice(index, 1);
                        dailyChanged = true;
                        foundAndRemoved = true;
                    }
                } else { 
                    const index = State.persistentLeaveSchedule.onLeaveMembers.findIndex(
                        r => r.member === memberName && (r.startDate || '') === originalStart
                    );
                    if (index > -1) {
                        State.persistentLeaveSchedule.onLeaveMembers.splice(index, 1);
                        persistentChanged = true;
                        foundAndRemoved = true;
                    }
                }

                if (!foundAndRemoved) {
                    showToast('수정할 원본 기록을 찾지 못했습니다.', true);
                    return;
                }

                if (isNewTimeBased) {
                    if (!newStartTime) {
                        showToast('시간 기반 근태는 시작 시간이 필수입니다.', true);
                        return;
                    }
                    State.appState.dailyOnLeaveMembers.push({
                        member: memberName,
                        type: newType,
                        startTime: newStartTime,
                        endTime: (newType === '외출') ? newEndTime : null 
                    });
                    dailyChanged = true;
                } else { 
                    if (!newStartDate) {
                        showToast('날짜 기반 근태는 시작일이 필수입니다.', true);
                        return;
                    }
                    State.persistentLeaveSchedule.onLeaveMembers.push({
                        id: `leave-${Date.now()}`,
                        member: memberName,
                        type: newType,
                        startDate: newStartDate,
                        endDate: newEndDate || newStartDate
                    });
                    persistentChanged = true;
                }

                try {
                    if (dailyChanged) {
                        await saveStateToFirestore();
                    }
                    if (persistentChanged) {
                        await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                    }
                    showToast('근태 기록이 수정되었습니다.');
                    editLeaveModal.classList.add('hidden');
                } catch (e) {
                    console.error("Error saving updated leave record:", e);
                    showToast('기록 저장 중 오류가 발생했습니다.', true);
                }
            });
        }

        const editLeaveTypeSelect = document.getElementById('edit-leave-type');
        if (editLeaveTypeSelect) {
            editLeaveTypeSelect.addEventListener('change', (e) => {
                const newType = e.target.value;
                const isTimeBased = (newType === '외출' || newType === '조퇴' || newType === '지각');
                const isOuting = (newType === '외출');
                
                document.getElementById('edit-leave-time-fields').classList.toggle('hidden', !isTimeBased);
                document.getElementById('edit-leave-date-fields').classList.toggle('hidden', isTimeBased);
                
                const endTimeWrapper = document.getElementById('edit-leave-end-time-wrapper');
                if (endTimeWrapper) {
                    endTimeWrapper.classList.toggle('hidden', !isOuting);
                }
            });
        }
    }

    // 4. 연차 현황 탭 내 '수동 추가' 버튼 리스너
    const manualAddHistoryBtn = document.getElementById('btn-manual-add-leave-history');
    if (manualAddHistoryBtn) {
        manualAddHistoryBtn.addEventListener('click', () => {
            // 1. 설정 탭으로 전환
            const tabSetting = document.getElementById('tab-leave-setting');
            if (tabSetting) tabSetting.click();

            // 2. 폼 초기화 (수정 모드 해제 및 값 비우기)
            if (DOM.confirmLeaveBtn) {
                delete DOM.confirmLeaveBtn.dataset.editingId;
                DOM.confirmLeaveBtn.textContent = '설정 저장';
            }
            
            const sInput = document.getElementById('leave-start-date-input');
            const eInput = document.getElementById('leave-end-date-input');
            if (sInput) sInput.value = '';
            if (eInput) eInput.value = '';
            
            // 기본값(연차) 선택 및 UI 갱신 (날짜 입력창 표시 등)
            const radio = document.querySelector('input[name="leave-type"][value="연차"]');
            if (radio) radio.checked = true;
            
            const optionsContainer = document.getElementById('leave-type-options');
            if (optionsContainer) optionsContainer.dispatchEvent(new Event('change'));
        });
    }
}