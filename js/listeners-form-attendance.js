// === js/listeners-form-attendance.js ===
// 설명: 근태 설정(연차/외출 등) 및 수정 모달의 폼 로직을 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getCurrentTime, calculateWorkingDays, isWeekday } from './utils.js';
import { saveStateToFirestore } from './app-data.js';
import { saveLeaveSchedule } from './config.js';
import { renderLeaveTypeModalOptions } from './ui-modals.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 헬퍼: 로컬 이력(allHistoryData)에서 특정 연차 ID 제거/업데이트
const updateLocalHistoryForLeave = (leaveEntry, action = 'add') => {
    const startDt = new Date(leaveEntry.startDate + 'T00:00:00');
    const endDt = new Date((leaveEntry.endDate || leaveEntry.startDate) + 'T00:00:00');

    for(let dt = new Date(startDt); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
        const dateKey = dt.toISOString().slice(0, 10);
        if (!isWeekday(dateKey)) continue; 

        let dayData = State.allHistoryData.find(d => d.id === dateKey);
        
        if (action === 'add') {
            if (!dayData) {
                dayData = { id: dateKey, onLeaveMembers: [], workRecords: [], taskQuantities: {} };
                State.allHistoryData.push(dayData);
                State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
            }
            if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
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

    if (DOM.leaveTypeModal) {
        DOM.leaveTypeModal.addEventListener('click', async (e) => {
            const delBtn = e.target.closest('.btn-delete-leave-history');
            if (delBtn) {
                if(!confirm('정말 이 내역을 삭제하시겠습니까? (병합된 내역은 모두 삭제됩니다)')) return;
                
                const idsString = delBtn.dataset.ids || '';
                const idsToDelete = idsString.split(',').filter(Boolean);
                
                try {
                    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
                    const snap = await getDoc(docRef);
                    let currentLeaves = snap.exists() && snap.data().onLeaveMembers ? snap.data().onLeaveMembers : [];
                    
                    currentLeaves = currentLeaves.filter(l => !idsToDelete.includes(l.id));
                    await setDoc(docRef, { onLeaveMembers: currentLeaves }, { merge: true });
                    State.persistentLeaveSchedule.onLeaveMembers = currentLeaves;

                    idsToDelete.forEach(id => {
                        State.allHistoryData.forEach(dayData => {
                            if (dayData.onLeaveMembers) {
                                dayData.onLeaveMembers = dayData.onLeaveMembers.filter(l => l.id !== id);
                            }
                        });
                    });

                    State.appState.dateBasedOnLeaveMembers = State.appState.dateBasedOnLeaveMembers.filter(l => !idsToDelete.includes(l.id));

                    renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
                    showToast('삭제되었습니다.');
                } catch(err) {
                    console.error("삭제 실패:", err);
                    showToast('삭제 중 오류가 발생했습니다.', true);
                }
                return;
            }

            const editBtn = e.target.closest('.btn-edit-leave-history');
            if (editBtn) {
                const id = editBtn.dataset.id;
                const entry = State.persistentLeaveSchedule.onLeaveMembers.find(l => l.id === id);
                if (entry) {
                    document.getElementById('tab-leave-setting').click();
                    
                    const radio = document.querySelector(`input[name="leave-type"][value="${entry.type}"]`);
                    if(radio) radio.checked = true;
                    document.getElementById('leave-type-options').dispatchEvent(new Event('change'));
                    
                    document.getElementById('leave-start-date-input').value = entry.startDate;
                    document.getElementById('leave-end-date-input').value = entry.endDate || entry.startDate;
                    
                    DOM.confirmLeaveBtn.dataset.editingId = id;
                    DOM.confirmLeaveBtn.textContent = '수정 저장';
                }
            }
        });
    }

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

            // 중복 클릭 방지
            const originalBtnText = DOM.confirmLeaveBtn.textContent;
            DOM.confirmLeaveBtn.disabled = true;
            DOM.confirmLeaveBtn.textContent = '저장 중...';

            if (['연차', '출장', '결근', '매장근무', '재택근무', '휴직', '외근'].includes(type)) {
                if (startDate > endDate) {
                    showToast('종료 날짜는 시작 날짜보다 빠를 수 없습니다.', true);
                    DOM.confirmLeaveBtn.disabled = false;
                    DOM.confirmLeaveBtn.textContent = originalBtnText;
                    return;
                }

                const editingId = DOM.confirmLeaveBtn.dataset.editingId;
                let isDuplicate = false;
                const startDt = new Date(startDate + 'T00:00:00');
                const endDt = new Date(endDate + 'T00:00:00');
                
                for(let dt = new Date(startDt); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
                    const checkDate = dt.toISOString().slice(0, 10);
                    if (!isWeekday(checkDate)) continue; 

                    const conflict = State.persistentLeaveSchedule.onLeaveMembers.some(l => {
                        const lStart = l.startDate;
                        const lEnd = l.endDate || l.startDate;
                        if (l.id === editingId) return false;
                        return l.member === memberName && l.type === type && (checkDate >= lStart && checkDate <= lEnd);
                    });

                    if (conflict) {
                        isDuplicate = true;
                        break;
                    }
                }

                if (isDuplicate) {
                    showToast('이미 해당 기간 평일에 동일한 기록이 존재합니다.', true);
                    DOM.confirmLeaveBtn.disabled = false;
                    DOM.confirmLeaveBtn.textContent = originalBtnText;
                    return;
                }

                try {
                    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
                    const snap = await getDoc(docRef);
                    let currentLeaves = snap.exists() && snap.data().onLeaveMembers ? snap.data().onLeaveMembers : [];

                    let leaveEntry;
                    let isEdit = false;

                    if (editingId) {
                        const idx = currentLeaves.findIndex(l => l.id === editingId);
                        if (idx > -1) {
                            leaveEntry = currentLeaves[idx];
                            updateLocalHistoryForLeave(leaveEntry, 'remove');
                            leaveEntry.type = type;
                            leaveEntry.startDate = startDate;
                            leaveEntry.endDate = endDate;
                            isEdit = true;
                            delete DOM.confirmLeaveBtn.dataset.editingId;
                            DOM.confirmLeaveBtn.textContent = '설정 저장';
                        }
                    } else {
                        leaveEntry = {
                            id: `leave-${Date.now()}`,
                            member: memberName,
                            type,
                            startDate,
                            endDate
                        };
                        currentLeaves.push(leaveEntry);
                    }

                    await setDoc(docRef, { onLeaveMembers: currentLeaves }, { merge: true });
                    State.persistentLeaveSchedule.onLeaveMembers = currentLeaves;
                    updateLocalHistoryForLeave(leaveEntry, 'add');

                    const todayLeaves = currentLeaves.filter(entry => {
                        const ed = entry.endDate || entry.startDate;
                        return today >= entry.startDate && today <= ed;
                    });
                    State.appState.dateBasedOnLeaveMembers = todayLeaves;

                    const diffDays = calculateWorkingDays(startDate, endDate);
                    
                    if (isEdit) {
                        showToast('수정되었습니다.');
                        renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
                    } else {
                        if (type === '연차') showToast(`${memberName}님 ${diffDays}일(평일기준) 연차 처리 완료.`);
                        else showToast(`${memberName}님 ${type} 처리 완료.`);
                    }
                    document.getElementById('leave-start-date-input').value = '';
                    document.getElementById('leave-end-date-input').value = '';

                } catch(err) {
                    console.error("연차 설정 저장 실패:", err);
                    showToast("저장 중 오류가 발생했습니다.", true);
                }

            } else {
                // 🔥 당일 근태(지각, 조퇴, 외출)도 즉각 전송 및 서버 병합
                try {
                    const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                    const snap = await getDoc(todayDocRef);
                    let currentDailyLeaves = snap.exists() && snap.data().onLeaveMembers ? snap.data().onLeaveMembers : [];

                    const newDailyEntry = {
                        id: `daily-${Date.now()}`,
                        member: memberName,
                        type: type,
                        startTime: (type === '외출' || type === '조퇴' || type === '지각') ? getCurrentTime() : null,
                        endTime: null
                    };
                    
                    currentDailyLeaves.push(newDailyEntry);
                    
                    // 1. 서버에 안전하게 병합 저장 (await로 1초 딜레이 제거)
                    await setDoc(todayDocRef, { onLeaveMembers: currentDailyLeaves }, { merge: true });
                    State.appState.dailyOnLeaveMembers = currentDailyLeaves;

                    // 2. 이력(데이터 관리) 화면에 새로고침 없이 즉각 표시되도록 메모리 반영
                    let dayData = State.allHistoryData.find(d => d.id === today);
                    if (dayData) {
                        if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
                        dayData.onLeaveMembers.push(newDailyEntry);
                    }

                    showToast(`${memberName}님 ${type} 처리 완료.`);
                } catch(err) {
                    console.error("일일 근태 설정 저장 실패:", err);
                    showToast("저장 중 오류가 발생했습니다.", true);
                }
            }

            DOM.confirmLeaveBtn.disabled = false;
            if (DOM.confirmLeaveBtn.textContent === '저장 중...') DOM.confirmLeaveBtn.textContent = originalBtnText;
        });
    }

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

                const today = getTodayDateString();
                let currentDailyLeaves = [...State.appState.dailyOnLeaveMembers];
                let currentLeaves = [...State.persistentLeaveSchedule.onLeaveMembers];

                if (originalType === 'daily') {
                    const index = currentDailyLeaves.findIndex(
                        r => r.member === memberName && (r.startTime || '') === originalStart
                    );
                    if (index > -1) {
                        currentDailyLeaves.splice(index, 1);
                        dailyChanged = true;
                        foundAndRemoved = true;
                    }
                } else { 
                    const index = currentLeaves.findIndex(
                        r => r.member === memberName && (r.startDate || '') === originalStart
                    );
                    if (index > -1) {
                        currentLeaves.splice(index, 1);
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
                    currentDailyLeaves.push({
                        id: `daily-${Date.now()}`,
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
                    currentLeaves.push({
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
                        const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                        await setDoc(todayDocRef, { onLeaveMembers: currentDailyLeaves }, { merge: true });
                        State.appState.dailyOnLeaveMembers = currentDailyLeaves;
                    }
                    if (persistentChanged) {
                        const persistDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
                        await setDoc(persistDocRef, { onLeaveMembers: currentLeaves }, { merge: true });
                        State.persistentLeaveSchedule.onLeaveMembers = currentLeaves;
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

    const manualAddHistoryBtn = document.getElementById('btn-manual-add-leave-history');
    if (manualAddHistoryBtn) {
        manualAddHistoryBtn.addEventListener('click', () => {
            const tabSetting = document.getElementById('tab-leave-setting');
            if (tabSetting) tabSetting.click();

            if (DOM.confirmLeaveBtn) {
                delete DOM.confirmLeaveBtn.dataset.editingId;
                DOM.confirmLeaveBtn.textContent = '설정 저장';
            }
            
            const sInput = document.getElementById('leave-start-date-input');
            const eInput = document.getElementById('leave-end-date-input');
            if (sInput) sInput.value = '';
            if (eInput) eInput.value = '';
            
            const radio = document.querySelector('input[name="leave-type"][value="연차"]');
            if (radio) radio.checked = true;
            
            const optionsContainer = document.getElementById('leave-type-options');
            if (optionsContainer) optionsContainer.dispatchEvent(new Event('change'));
        });
    }
}