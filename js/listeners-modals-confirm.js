// === js/listeners-modals-confirm.js ===
// 설명: '예/아니오' 형태의 모든 확인(Confirm) 모달 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getCurrentTime } from './utils.js';
import { finalizeStopGroup, stopWorkIndividual, stopWorkByTask } from './app-logic.js';
import { saveLeaveSchedule } from './config.js';
import { switchHistoryView } from './app-history-logic.js';
import { saveDayDataToHistory } from './history-data-manager.js';

// ✅ [수정] saveStateToFirestore 함수를 app-data.js에서 가져오도록 추가
import { saveStateToFirestore } from './app-data.js';

import {
    doc, deleteDoc, writeBatch, collection, updateDoc, getDocs, setDoc, query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 헬퍼: 단일 업무 기록 문서 삭제
const deleteWorkRecordDocument = async (recordId) => {
    if (!recordId) return;
    try {
        const today = getTodayDateString();
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords', recordId);
        await deleteDoc(docRef);
    } catch (e) {
        console.error("Error deleting work record document: ", e);
        showToast("문서 삭제 중 오류 발생.", true);
    }
};

// 헬퍼: 여러 업무 기록 문서 일괄 삭제
const deleteWorkRecordDocuments = async (recordIds) => {
    if (!recordIds || recordIds.length === 0) return;
    try {
        const today = getTodayDateString();
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
        const batch = writeBatch(State.db);

        recordIds.forEach(recordId => {
            const docRef = doc(colRef, recordId);
            batch.delete(docRef);
        });

        await batch.commit();
    } catch (e) {
        console.error("Error batch deleting work record documents: ", e);
        showToast("여러 문서 삭제 중 오류 발생.", true);
    }
};


export function setupConfirmationModalListeners() {

    // 1. 삭제 확인 모달 (Delete Confirm)
    if (DOM.confirmDeleteBtn) {
        DOM.confirmDeleteBtn.addEventListener('click', async () => {

            if (State.context.deleteMode === 'group') {
                const groupMembers = (State.appState.workRecords || [])
                    .filter(r => String(r.groupId) === String(State.context.recordToDeleteId) && (r.status === 'ongoing' || r.status === 'paused'))
                    .map(r => r.id);

                if (groupMembers.length > 0) {
                    await deleteWorkRecordDocuments(groupMembers);
                    showToast('그룹 업무가 삭제되었습니다.');
                }
            } else if (State.context.deleteMode === 'single') {
                await deleteWorkRecordDocument(State.context.recordToDeleteId);
                showToast('업무 기록이 삭제되었습니다.');
            } else if (State.context.deleteMode === 'all-completed') {
                 const completedIds = (State.appState.workRecords || [])
                    .filter(r => r.status === 'completed')
                    .map(r => r.id);

                if (completedIds.length > 0) {
                    await deleteWorkRecordDocuments(completedIds);
                    showToast(`완료된 업무 ${completedIds.length}건이 삭제되었습니다.`);
                } else {
                    showToast('삭제할 완료된 업무가 없습니다.');
                }
            }
            else if (State.context.deleteMode === 'attendance') {
                // 근태 기록 삭제
                const { dateKey, index } = State.context.attendanceRecordToDelete;
                const todayKey = getTodayDateString();
                
                const dayData = State.allHistoryData.find(d => d.id === dateKey);
                if (dayData && dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const recordToDelete = dayData.onLeaveMembers[index];
                    const isPersistentType = ['연차', '출장', '결근'].includes(recordToDelete.type);
                    
                    let deletedFromPersistent = false;
                    if (isPersistentType) {
                        const pIndex = State.persistentLeaveSchedule.onLeaveMembers.findIndex(p => {
                            if (recordToDelete.id && p.id) return p.id === recordToDelete.id;
                            return p.member === recordToDelete.member && 
                                   p.startDate === recordToDelete.startDate && 
                                   p.type === recordToDelete.type;
                        });
                        
                        if (pIndex > -1) {
                            State.persistentLeaveSchedule.onLeaveMembers.splice(pIndex, 1);
                            try {
                                await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                                deletedFromPersistent = true;
                            } catch (e) {
                                console.error("Error deleting from persistent schedule:", e);
                            }
                        }
                    }

                    dayData.onLeaveMembers.splice(index, 1);

                    try {
                        let docRef;
                        if (dateKey === todayKey) {
                            docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey);
                        } else {
                            docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                        }

                        await updateDoc(docRef, { onLeaveMembers: dayData.onLeaveMembers });
                        
                        showToast(`${recordToDelete.member}님의 '${recordToDelete.type}' 기록이 삭제되었습니다.`);
                        
                        const activeAttendanceTab = document.querySelector('#attendance-history-tabs button.font-semibold');
                        const view = activeAttendanceTab ? activeAttendanceTab.dataset.view : 'attendance-daily';
                        await switchHistoryView(view);

                    } catch (e) {
                         console.error('Error updating attendance doc:', e);
                         showToast('삭제 내용을 저장하는 중 오류가 발생했습니다.', true);
                    }
                } else {
                    showToast('삭제할 기록을 찾을 수 없습니다.', true);
                }
                
                State.context.attendanceRecordToDelete = null;
            }
            else if (State.context.deleteMode === 'leave-record') {
                // 모달을 통한 근태 기록 삭제 (상세 수정 팝업에서 호출됨)
                const { memberName, startIdentifier, type, displayType } = State.context.attendanceRecordToDelete;
                let dailyChanged = false;
                let persistentChanged = false;
                
                if (type === 'daily') {
                    const index = State.appState.dailyOnLeaveMembers.findIndex(
                        r => r.member === memberName && (r.startTime || '') === startIdentifier
                    );
                    if (index > -1) {
                        State.appState.dailyOnLeaveMembers.splice(index, 1);
                        dailyChanged = true;
                    }
                } else { 
                    const index = State.persistentLeaveSchedule.onLeaveMembers.findIndex(
                        r => r.member === memberName && (r.startDate || '') === startIdentifier
                    );
                    if (index > -1) {
                        State.persistentLeaveSchedule.onLeaveMembers.splice(index, 1);
                        persistentChanged = true;
                    }
                }

                if (dailyChanged || persistentChanged) {
                    try {
                        if (dailyChanged) await saveStateToFirestore();
                        if (persistentChanged) await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                        showToast(`${memberName}님의 '${displayType}' 기록이 삭제되었습니다.`);
                    } catch (e) {
                        console.error("Error deleting leave record:", e);
                        showToast('기록 삭제 중 오류가 발생했습니다.', true);
                    }
                } else {
                    showToast('삭제할 기록을 찾지 못했습니다.', true);
                }
                
                State.context.attendanceRecordToDelete = null;
            }

            DOM.deleteConfirmModal.classList.add('hidden');
            State.context.recordToDeleteId = null;
            State.context.deleteMode = 'single';
        });
    }

    // 2. 처리량 입력 모달 확인 (Quantity On Stop)
    if (DOM.confirmQuantityOnStopBtn) {
        DOM.confirmQuantityOnStopBtn.addEventListener('click', async () => {
            const quantity = document.getElementById('quantity-on-stop-input').value;
            if (State.context.taskToStop) {
                await stopWorkByTask(State.context.taskToStop, quantity);
                State.context.taskToStop = null;
            } else if (State.context.groupToStopId) {
                await finalizeStopGroup(State.context.groupToStopId, quantity);
                State.context.groupToStopId = null;
            }
            DOM.quantityOnStopModal.classList.add('hidden');
        });
    }
    
    if (DOM.cancelQuantityOnStopBtn) {
        DOM.cancelQuantityOnStopBtn.addEventListener('click', async () => {
            if (State.context.taskToStop) {
                await stopWorkByTask(State.context.taskToStop, null);
                State.context.taskToStop = null;
            } else if (State.context.groupToStopId) {
                await finalizeStopGroup(State.context.groupToStopId, null);
                State.context.groupToStopId = null;
            }
            DOM.quantityOnStopModal.classList.add('hidden');
        });
    }

    // 3. 개별 업무 종료 확인
    if (DOM.confirmStopIndividualBtn) {
        DOM.confirmStopIndividualBtn.addEventListener('click', async () => {
            await stopWorkIndividual(State.context.recordToStopId);
            DOM.stopIndividualConfirmModal.classList.add('hidden');
            State.context.recordToStopId = null;
        });
    }

    // 4. 그룹(전체) 업무 종료 확인
    if (DOM.confirmStopGroupBtn) {
        DOM.confirmStopGroupBtn.addEventListener('click', async () => {
            if (DOM.stopGroupConfirmModal) DOM.stopGroupConfirmModal.classList.add('hidden');

            // 1. Task 기준 일괄 종료 (우선순위)
            if (State.context.taskToStop) {
                // quantity에 null을 전달하여 처리량 입력을 건너뛰고 종료
                await stopWorkByTask(State.context.taskToStop, null);
                State.context.taskToStop = null;
            }
            // 2. 기존 Group ID 기준 (호환성 유지)
            else if (State.context.groupToStopId) {
                await finalizeStopGroup(State.context.groupToStopId, null);
                State.context.groupToStopId = null;
            }
        });
    }

    if (DOM.cancelStopGroupBtn) {
        DOM.cancelStopGroupBtn.addEventListener('click', () => {
            if (DOM.stopGroupConfirmModal) DOM.stopGroupConfirmModal.classList.add('hidden');
            State.context.groupToStopId = null;
            State.context.taskToStop = null; 
        });
    }
    
    // 5. 근태 취소(복귀) 확인
    if (DOM.confirmCancelLeaveBtn) {
        DOM.confirmCancelLeaveBtn.addEventListener('click', async () => {
            const memberName = State.context.memberToCancelLeave;
            if (!memberName) return;

            let dailyChanged = false;
            let persistentChanged = false;
            let actionMessage = '취소';

            const dailyEntry = State.appState.dailyOnLeaveMembers.find(entry => 
                entry.member === memberName && 
                (entry.type === '외출' || entry.type === '조퇴' || entry.type === '지각') && 
                !entry.endTime
            );

            if (dailyEntry) {
                if (dailyEntry.type === '외출') {
                    dailyEntry.endTime = getCurrentTime();
                    dailyChanged = true;
                    actionMessage = '복귀 완료';
                } else {
                    State.appState.dailyOnLeaveMembers = State.appState.dailyOnLeaveMembers.filter(entry => entry !== dailyEntry);
                    dailyChanged = true;
                }
            } else {
                const today = getTodayDateString();
                const originalLength = State.persistentLeaveSchedule.onLeaveMembers.length;
                
                State.persistentLeaveSchedule.onLeaveMembers = (State.persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
                    if (entry.member === memberName) {
                        const endDate = entry.endDate || entry.startDate;
                        if (today >= entry.startDate && today <= (endDate || entry.startDate)) {
                            return false;
                        }
                    }
                    return true;
                });

                if (State.persistentLeaveSchedule.onLeaveMembers.length !== originalLength) {
                    persistentChanged = true;
                }
            }

            try {
                // ✅ [수정] 이제 함수가 정상적으로 import되어 실행됩니다.
                if (dailyChanged) await saveStateToFirestore();
                if (persistentChanged) await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);

                if (dailyChanged || persistentChanged) {
                    showToast(`${memberName}님 ${actionMessage} 처리되었습니다.`);
                } else {
                    showToast('처리할 근태 기록을 찾지 못했습니다.', true);
                }
            } catch (e) {
                console.error("Error confirming cancel leave:", e);
                showToast("처리 중 오류가 발생했습니다.", true);
            }

            DOM.cancelLeaveConfirmModal.classList.add('hidden');
            State.context.memberToCancelLeave = null;
        });
    }

    // 6. 업무 마감 확인
    if (DOM.confirmEndShiftBtn) {
        DOM.confirmEndShiftBtn.addEventListener('click', async () => {
            // ✅ [수정] false -> true 로 변경
            // 설명: 업무를 이력으로 저장한 후, 현재 라이브 데이터를 '완전 삭제(초기화)'합니다.
            // 이렇게 하면 다른 기기에서 켜져 있던 창(좀비 탭)이 서버 데이터를 덮어쓰려 할 때
            // 원본 문서가 없거나 초기화되어 있어 덮어쓰기에 실패하거나 오류가 발생해 멈추게 됩니다.
            await saveDayDataToHistory(true); 
            
            DOM.endShiftConfirmModal.classList.add('hidden');
        });
    }

    // 업무 마감 취소 버튼
    if (DOM.cancelEndShiftBtn) {
        DOM.cancelEndShiftBtn.addEventListener('click', () => {
            if (DOM.endShiftConfirmModal) DOM.endShiftConfirmModal.classList.add('hidden');
        });
    }

    // 7. 앱 초기화 확인
    if (DOM.confirmResetAppBtn) {
        DOM.confirmResetAppBtn.addEventListener('click', async () => {
            const today = getTodayDateString();

            try {
                const workRecordsColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
                const q = query(workRecordsColRef);
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const batch = writeBatch(State.db);
                    querySnapshot.forEach(doc => {
                        batch.delete(doc.ref);
                    });
                    await batch.commit();
                }

                const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                await setDoc(docRef, {});

                State.appState.workRecords = [];
                State.appState.taskQuantities = {};
                State.appState.partTimers = [];
                State.appState.dailyOnLeaveMembers = [];
                State.appState.dailyAttendance = {};

                showToast('오늘 데이터가 모두 초기화되었습니다.');
                DOM.resetAppModal.classList.add('hidden');

            } catch (e) {
                console.error("오늘 데이터 초기화 실패: ", e);
                showToast("데이터 초기화 중 오류가 발생했습니다.", true);
            }
        });
    }
}