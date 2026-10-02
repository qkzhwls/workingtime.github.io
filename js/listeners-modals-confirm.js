// === js/listeners-modals-confirm.js ===
// 설명: '예/아니오' 형태의 모든 확인(Confirm) 모달 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610021228';
import * as State from './state.js?v=202610021228';
import { isPersistentLeaveType } from './state.js?v=202610021228';
import { notifyLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610021228';
import { showToast, getTodayDateString, getCurrentTime, showConfirm } from './utils.js?v=202610021228';
import { finalizeStopGroup, stopWorkIndividual, stopWorkByTask } from './app-logic.js?v=202610021228';
import { saveLeaveSchedule } from './config.js?v=202610021228';
import { switchHistoryView } from './app-history-logic.js?v=202610021228';
import { saveDayDataToHistory, clearLocalCache } from './history-data-manager.js?v=202610021228';
import { saveStateToFirestore } from './app-data.js?v=202610021228';

import {
    doc, deleteDoc, writeBatch, collection, updateDoc, getDoc, getDocs, setDoc, query
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
                    const isPersistentType = isPersistentLeaveType(recordToDelete.type);
                    
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
                        // ⚠️ dayData.onLeaveMembers 에는 leaveSchedule에서 날짜별로 펼쳐 넣은
                        //    사본이 섞여 있다. 그대로 덮어쓰면 그날 문서에 원래 없던 기록까지
                        //    저장돼 버리므로, 문서를 다시 읽어 '그 문서에 실제로 있는 기록'만 지운다.
                        //    펼쳐 넣은 사본이면 원본(leaveSchedule)만 지우면 되므로 문서는 건드리지 않는다.
                        if (!recordToDelete.__fromSchedule) {
                            const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2',
                                (dateKey === todayKey) ? 'daily_data' : 'history', dateKey);
                            const snap = await getDoc(docRef);
                            const raw = snap.exists() ? snap.data().onLeaveMembers : null;
                            const stored = Array.isArray(raw) ? raw : (raw ? Object.values(raw) : []);
                            const di = stored.findIndex(l => (recordToDelete.id && l.id)
                                ? l.id === recordToDelete.id
                                : (l.member === recordToDelete.member
                                    && l.type === recordToDelete.type
                                    && (l.startDate || '') === (recordToDelete.startDate || '')
                                    && (l.startTime || '') === (recordToDelete.startTime || '')));
                            if (di > -1) stored.splice(di, 1);
                            await updateDoc(docRef, { onLeaveMembers: stored });
                        }

                        if (deletedFromPersistent) notifyLeaveScheduleChanged('attendance-delete');
                        clearLocalCache(); // 캐시 무효화 → 새로고침 시 최신값 재조회

                        showToast(`${recordToDelete.member}님의 '${recordToDelete.type}' 기록이 삭제되었습니다.`);
                        
                        const gran = State.context.globalGranularity || 'day';
                        const view = { day: 'attendance-daily', week: 'attendance-weekly', month: 'attendance-monthly', year: 'attendance-yearly' }[gran];
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
                        if (dailyChanged) {
                            State.setIsDataDirty(true); 
                            await saveStateToFirestore();
                        }
                        if (persistentChanged) {
                            await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                            notifyLeaveScheduleChanged('leave-cancel-2');
                        }
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

    // 💡 [신규/보완] 삭제 취소 버튼
    if (DOM.cancelDeleteBtn) {
        DOM.cancelDeleteBtn.addEventListener('click', () => {
            if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.add('hidden');
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

    // 💡 [신규/보완] 개별 업무 종료 취소 버튼
    if (DOM.cancelStopIndividualBtn) {
        DOM.cancelStopIndividualBtn.addEventListener('click', () => {
            if (DOM.stopIndividualConfirmModal) DOM.stopIndividualConfirmModal.classList.add('hidden');
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

                    // 🛡️ 외출 시작 전부터 ongoing/paused로 남아있던 workRecord 보호막:
                    // 외출 시작 시각으로 자동 종료. 정상 흐름에서는 외출 등록 시점에 이미
                    // 정리되었어야 하지만 누락된 경우 복귀 시 한 번 더 점검.
                    try {
                        const stale = (State.appState.workRecords || []).filter(r =>
                            r.member === memberName &&
                            (r.status === 'ongoing' || r.status === 'paused') &&
                            r.startTime && dailyEntry.startTime &&
                            r.startTime < dailyEntry.startTime
                        );
                        if (stale.length > 0) {
                            const { forceEndMemberWork } = await import('./app-sync.js?v=202610021228');
                            const r = await forceEndMemberWork(memberName, dailyEntry.startTime);
                            if (r.ended > 0) {
                                console.warn(`[외출 복귀 보호막] ${memberName}: 외출 전부터 진행 중이던 ${r.ended}건을 ${dailyEntry.startTime}로 정리`, r.summaries);
                                showToast(`외출 전부터 진행 중이던 업무 ${r.ended}건이 ${dailyEntry.startTime}로 자동 종료됨`);
                            }
                        }
                    } catch (e) {
                        console.error('return-from-leave guard failed:', e);
                    }
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
                if (dailyChanged) {
                    State.setIsDataDirty(true); 
                    await saveStateToFirestore();
                }
                if (persistentChanged) {
                    await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                    notifyLeaveScheduleChanged('leave-cancel');
                }

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

    // 💡 [신규/보완] 근태 복귀(취소) 취소 버튼
    if (DOM.cancelCancelLeaveBtn) {
        DOM.cancelCancelLeaveBtn.addEventListener('click', () => {
            if (DOM.cancelLeaveConfirmModal) DOM.cancelLeaveConfirmModal.classList.add('hidden');
            State.context.memberToCancelLeave = null;
        });
    }

    // 6. 업무 마감 확인
    if (DOM.confirmEndShiftBtn) {
        DOM.confirmEndShiftBtn.addEventListener('click', async () => {
            // 🕐 마감 기준시각. 이 값이 퇴근 미기록자 전원의 퇴근시각이 되고,
            //    진행 중 기록이 이 시각으로 마감된다. 되돌릴 수 없다.
            //
            // ⚠️ 입력칸이 없으면(옛 modals-confirm.html 이 캐시된 경우) 그냥 넘기지 않는다.
            //    그러면 검증을 통째로 건너뛰고 조용히 예전 동작('누른 시각')으로 돌아간다.
            if (!DOM.endShiftTimeInput) {
                showToast('마감 시각 입력칸을 찾지 못했습니다. 새로고침(Ctrl+F5) 후 다시 시도해 주세요.', true);
                return;
            }
            const t = String(DOM.endShiftTimeInput.value || '').trim();
            if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(t)) {
                showToast('마감 시각을 17:30 형식으로 입력해 주세요.', true);
                return;   // 창을 닫지 않는다 — 고쳐서 다시 누를 수 있게
            }
            // 아직 오지 않은 시각으로 마감하면 하지 않은 근무가 확정된다. (19:30 ← 18:30 오타)
            if (t > getCurrentTime()) {
                const 계속 = await showConfirm(
                    `${t} 는 아직 오지 않은 시각입니다 (지금 ${getCurrentTime()}).\n`
                    + '그 시각까지 일한 것으로 확정됩니다. 계속할까요?',
                    { danger: true, okText: '그대로 마감' });
                if (!계속) return;
            }

            const btn = DOM.confirmEndShiftBtn;
            btn.disabled = true;   // await 동안 두 번 눌리면 마감이 두 번 돈다
            try {
                // 삭제 확인은 saveDayDataToHistory 안에서 **서버 기록으로 다시 세어** 받는다.
                // 여기(라이브 미러)에서 세면 승인받은 건수와 실제 삭제 건수가 다를 수 있다.
                const ok = await saveDayDataToHistory(true, t, {
                    closedVia: '앱',
                    confirmDestructive: (pv, endTime) => showConfirm(
                        `${endTime} 로 마감하면 기록 ${pv.deleted}건이 0분이 되어 삭제됩니다.\n`
                        + '삭제된 기록은 되돌릴 수 없습니다. 그대로 마감할까요?',
                        { danger: true, okText: '삭제하고 마감' }),
                });
                // 실패했으면 창을 닫지 않는다 — 다시 시도해야 하는데 끝난 것처럼 보이면 안 된다.
                if (ok) DOM.endShiftConfirmModal.classList.add('hidden');
            } finally {
                btn.disabled = false;
            }
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

    // 💡 [신규/보완] 앱 초기화 취소 버튼
    if (DOM.cancelResetAppBtn) {
        DOM.cancelResetAppBtn.addEventListener('click', () => {
            if (DOM.resetAppModal) DOM.resetAppModal.classList.add('hidden');
        });
    }
}