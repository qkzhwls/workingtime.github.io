// === js/app-logic.js ===

import {
    generateId,
    saveStateToFirestore,
    debouncedSaveState,
    updateDailyData
} from './app-data.js';

import {
    appState, db, auth
} from './state.js';

import { calcElapsedMinutes, getCurrentTime, showToast, getTodayDateString } from './utils.js';
import { doc, collection, setDoc, updateDoc, writeBatch, query, where, getDocs, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ✨ 점심시간 자동화 후 이력(History)에도 즉시 반영하기 위해 추가
import { syncTodayToHistory } from './history-data-manager.js';


const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

const getDailyDocRef = () => {
    return doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
};


// --- 출퇴근 관련 로직 ---

export const processClockIn = async (memberName, isAdminAction = false) => {
    const now = getCurrentTime();
    if (appState.dailyAttendance?.[memberName]?.status === 'active') {
        showToast(`${memberName}님은 이미 출근(Active) 상태입니다.`, true);
        return false;
    }

    try {
        await updateDoc(getDailyDocRef(), {
            [`dailyAttendance.${memberName}`]: {
                inTime: now,
                outTime: null,
                status: 'active' 
            }
        });

        showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}출근 처리되었습니다. (${now})`);
        return true;
    } catch (e) {
        console.error("Clock-in error:", e);
        if (e.code === 'not-found' || e.message.includes('No document to update')) {
             await setDoc(getDailyDocRef(), {
                dailyAttendance: {
                    [memberName]: { inTime: now, outTime: null, status: 'active' }
                }
            }, { merge: true });
             showToast(`${memberName}님 첫 출근 처리되었습니다. (${now})`);
             return true;
        }
        showToast("출근 처리 중 오류가 발생했습니다.", true);
        return false;
    }
};

export const processClockOut = async (memberName, isAdminAction = false) => {
    const isWorking = (appState.workRecords || []).some(r =>
        r.member === memberName && (r.status === 'ongoing' || r.status === 'paused')
    );

    if (isWorking) {
        showToast(`${memberName}님은 현재 업무 진행 중이라 퇴근할 수 없습니다. 먼저 업무를 종료해주세요.`, true);
        return false;
    }

    const now = getCurrentTime();

    try {
         await updateDoc(getDailyDocRef(), {
            [`dailyAttendance.${memberName}.outTime`]: now,
            [`dailyAttendance.${memberName}.status`]: 'returned'
        });

        showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}퇴근 처리되었습니다. (${now})`);
        return true;
    } catch (e) {
        console.error("Clock-out error:", e);
        showToast("퇴근 처리 중 오류가 발생했습니다.", true);
        return false;
    }
};

export const cancelClockOut = async (memberName, isAdminAction = false) => {
    try {
        await updateDoc(getDailyDocRef(), {
            [`dailyAttendance.${memberName}.status`]: 'active',
            [`dailyAttendance.${memberName}.outTime`]: null
        });

        showToast(`${memberName}님의 퇴근이 ${isAdminAction ? '관리자에 의해 ' : ''}취소되었습니다. (다시 근무 상태)`);
        return true;
    } catch (e) {
        console.error("Cancel clock-out error:", e);
        showToast("퇴근 취소 중 오류가 발생했습니다.", true);
        return false;
    }
};


// --- 업무 시작/추가 로직 ---

export const startWorkGroup = async (members, task) => {
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`아직 출근하지 않은 팀원이 있어 업무를 시작할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    const alreadyWorkingMembers = members.filter(member =>
        (appState.workRecords || []).some(r =>
            r.member === member && (r.status === 'ongoing' || r.status === 'paused')
        )
    );
    if (alreadyWorkingMembers.length > 0) {
        showToast(`이미 업무를 진행 중인 팀원이 있습니다: ${alreadyWorkingMembers.join(', ')}`, true);
        return;
    }

    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const groupId = generateId();
        const startTime = getCurrentTime();

        members.forEach(member => {
            const recordId = generateId(); 
            const newRecordRef = doc(workRecordsColRef, recordId);
            const newRecordData = {
                id: recordId, 
                member,
                task,
                startTime,
                endTime: null,
                duration: null,
                status: 'ongoing',
                groupId,
                pauses: []
            };
            batch.set(newRecordRef, newRecordData);
        });

        await batch.commit();
    } catch (e) {
        console.error("Error starting work group: ", e);
        showToast("업무 시작 중 오류가 발생했습니다.", true);
    }
};

export const addMembersToWorkGroup = async (members, task, groupId) => {
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`출근하지 않은 팀원은 추가할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    const alreadyWorkingMembers = members.filter(member =>
        (appState.workRecords || []).some(r =>
            r.member === member && (r.status === 'ongoing' || r.status === 'paused')
        )
    );
    if (alreadyWorkingMembers.length > 0) {
        showToast(`이미 업무를 진행 중인 팀원이 있습니다: ${alreadyWorkingMembers.join(', ')}`, true);
        return;
    }

    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const startTime = getCurrentTime();

        members.forEach(member => {
            const recordId = generateId();
            const newRecordRef = doc(workRecordsColRef, recordId);
            const newRecordData = {
                id: recordId,
                member,
                task,
                startTime,
                endTime: null,
                duration: null,
                status: 'ongoing',
                groupId,
                pauses: []
            };
            batch.set(newRecordRef, newRecordData);
        });

        await batch.commit();
    } catch (e) {
         console.error("Error adding members to work group: ", e);
         showToast("팀원 추가 중 오류가 발생했습니다.", true);
    }
};


// --- 업무 종료/정지/재개 로직 ---

export const stopWorkGroup = (groupId) => {
    finalizeStopGroup(groupId, null);
};

export const finalizeStopGroup = async (groupId, quantity) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("groupId", "==", String(groupId)), where("status", "in", ["ongoing", "paused"]));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.warn(`Finalize stop: Group ${groupId} not found or already completed.`);
            return;
        }

        const batch = writeBatch(db);
        const endTime = getCurrentTime();
        let taskName = '';
        let removedCount = 0;

        querySnapshot.forEach(docSnap => {
            const record = docSnap.data();
            taskName = record.task;

            let pauses = record.pauses || [];
            if (record.status === 'paused') {
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                if (lastPause && lastPause.end === null) {
                    lastPause.end = endTime;
                }
            }
            const duration = calcElapsedMinutes(record.startTime, endTime, pauses);

            if (Math.round(duration) <= 0) {
                batch.delete(docSnap.ref);
                removedCount++;
            } else {
                batch.update(docSnap.ref, {
                    status: 'completed',
                    endTime: endTime,
                    duration: duration,
                    pauses: pauses
                });
            }
        });

        await batch.commit();
        
        if (removedCount > 0) {
             showToast(`${removedCount}건의 기록이 0분 소요로 인해 자동 삭제되었습니다.`);
        }

        if (quantity !== null && taskName && Number(quantity) > 0) {
             await updateDoc(getDailyDocRef(), {
                [`taskQuantities.${taskName}`]: increment(Number(quantity))
            });
        }

    } catch (e) {
         console.error("Error finalizing work group: ", e);
         showToast("그룹 업무 종료 중 오류가 발생했습니다.", true);
    }
};

export const stopWorkByTask = async (taskName, quantity) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("task", "==", taskName), where("status", "in", ["ongoing", "paused"]));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            showToast(`'${taskName}' 업무의 진행 중인 기록을 찾을 수 없습니다.`, true);
            return;
        }

        const batch = writeBatch(db);
        const endTime = getCurrentTime();
        let removedCount = 0;

        querySnapshot.forEach(docSnap => {
            const record = docSnap.data();
            let pauses = record.pauses || [];
            
            if (record.status === 'paused') {
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                if (lastPause && lastPause.end === null) {
                    lastPause.end = endTime;
                }
            }
            const duration = calcElapsedMinutes(record.startTime, endTime, pauses);

            if (Math.round(duration) <= 0) {
                batch.delete(docSnap.ref);
                removedCount++;
            } else {
                batch.update(docSnap.ref, { status: 'completed', endTime: endTime, duration: duration, pauses: pauses });
            }
        });

        await batch.commit();
        
        if (removedCount > 0) {
             showToast(`${removedCount}건의 기록이 0분 소요로 인해 자동 삭제되었습니다.`);
        }

        if (quantity !== null && Number(quantity) > 0) {
             await updateDoc(getDailyDocRef(), {
                [`taskQuantities.${taskName}`]: increment(Number(quantity))
            });
        }
        showToast(`'${taskName}' 업무가 모두 종료되었습니다.`);

    } catch (e) {
         console.error("Error stopping work by task: ", e);
         showToast("업무 일괄 종료 중 오류가 발생했습니다.", true);
    }
};

export const pauseWorkByTask = async (taskName) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("task", "==", taskName), where("status", "==", "ongoing"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) return; 

        const batch = writeBatch(db);
        const currentTime = getCurrentTime();

        querySnapshot.forEach(docSnap => {
            const record = docSnap.data();
            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'break' });

            batch.update(docSnap.ref, {
                status: 'paused',
                pauses: newPauses
            });
        });

        await batch.commit();
        showToast(`'${taskName}' 업무가 전체 일시정지 되었습니다.`);
    } catch (e) {
         console.error("Error pausing work by task: ", e);
         showToast("업무 일괄 정지 중 오류가 발생했습니다.", true);
    }
};

export const resumeWorkByTask = async (taskName) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("task", "==", taskName), where("status", "==", "paused"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) return;

        const batch = writeBatch(db);
        const currentTime = getCurrentTime();

        querySnapshot.forEach(docSnap => {
            const record = docSnap.data();
            const pauses = record.pauses || [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;

            if (lastPause && lastPause.end === null) {
                lastPause.end = currentTime;
            }

            batch.update(docSnap.ref, {
                status: 'ongoing',
                pauses: pauses
            });
        });

        await batch.commit();
        showToast(`'${taskName}' 업무가 전체 재개되었습니다.`);
    } catch (e) {
         console.error("Error resuming work by task: ", e);
         showToast("업무 일괄 재개 중 오류가 발생했습니다.", true);
    }
};

export const stopWorkIndividual = async (recordId) => {
    try {
        const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
        if (record && (record.status === 'ongoing' || record.status === 'paused')) {
            const workRecordsColRef = getWorkRecordsCollectionRef();
            const recordRef = doc(workRecordsColRef, recordId);
            const endTime = getCurrentTime();

            let pauses = record.pauses || [];
            if (record.status === 'paused') {
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                if (lastPause && lastPause.end === null) {
                    lastPause.end = endTime;
                }
            }
            const duration = calcElapsedMinutes(record.startTime, endTime, pauses);

            if (Math.round(duration) <= 0) {
                await deleteDoc(recordRef);
                showToast(`${record.member}님의 '${record.task}' 기록이 0분 소요로 인해 삭제되었습니다.`);
            } else {
                await updateDoc(recordRef, {
                    status: 'completed',
                    endTime: endTime,
                    duration: duration,
                    pauses: pauses
                });
                showToast(`${record.member}님의 ${record.task} 업무가 종료되었습니다.`);
            }
        } else {
            showToast('이미 완료되었거나 찾을 수 없는 기록입니다.', true);
        }
    } catch (e) {
         console.error("Error stopping individual work: ", e);
         showToast("개별 업무 종료 중 오류가 발생했습니다.", true);
    }
};

export const pauseWorkGroup = async (groupId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let changed = false;

        (appState.workRecords || []).forEach(record => {
            if (String(record.groupId) === String(groupId) && record.status === 'ongoing') {
                const recordRef = doc(workRecordsColRef, record.id);
                const newPauses = record.pauses || [];
                newPauses.push({ start: currentTime, end: null, type: 'break' });

                batch.update(recordRef, {
                    status: 'paused',
                    pauses: newPauses
                });
                changed = true;
            }
        });

        if (changed) {
            await batch.commit();
            showToast('그룹 업무가 일시정지 되었습니다.');
        }
    } catch (e) {
         console.error("Error pausing work group: ", e);
         showToast("그룹 업무 정지 중 오류가 발생했습니다.", true);
    }
};

export const resumeWorkGroup = async (groupId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let changed = false;

        (appState.workRecords || []).forEach(record => {
            if (String(record.groupId) === String(groupId) && record.status === 'paused') {
                const recordRef = doc(workRecordsColRef, record.id);
                const pauses = record.pauses || [];
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;

                if (lastPause && lastPause.end === null) {
                    lastPause.end = currentTime;
                }

                batch.update(recordRef, {
                    status: 'ongoing',
                    pauses: pauses
                });
                changed = true;
            }
        });

        if (changed) {
            await batch.commit();
            showToast('그룹 업무를 다시 시작합니다.');
        }
    } catch (e) {
         console.error("Error resuming work group: ", e);
         showToast("그룹 업무 재개 중 오류가 발생했습니다.", true);
    }
};

export const pauseWorkIndividual = async (recordId) => {
    try {
        const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
        if (record && record.status === 'ongoing') {
            const workRecordsColRef = getWorkRecordsCollectionRef();
            const recordRef = doc(workRecordsColRef, recordId);
            const currentTime = getCurrentTime();

            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'break' });

            await updateDoc(recordRef, {
                status: 'paused',
                pauses: newPauses
            });

            showToast(`${record.member}님 ${record.task} 업무 일시정지.`);
        }
    } catch (e) {
         console.error("Error pausing individual work: ", e);
         showToast("개별 업무 정지 중 오류가 발생했습니다.", true);
    }
};

export const resumeWorkIndividual = async (recordId) => {
    try {
        const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
        if (record && record.status === 'paused') {
            const workRecordsColRef = getWorkRecordsCollectionRef();
            const recordRef = doc(workRecordsColRef, recordId);
            const currentTime = getCurrentTime();

            const pauses = record.pauses || [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
            if (lastPause && lastPause.end === null) {
                lastPause.end = currentTime;
            }

            await updateDoc(recordRef, {
                status: 'ongoing',
                pauses: pauses
            });

            showToast(`${record.member}님 ${record.task} 업무 재개.`);
        }
    } catch (e) {
         console.error("Error resuming individual work: ", e);
         showToast("개별 업무 재개 중 오류가 발생했습니다.", true);
    }
};

// ✨ 완벽 개선된 점심시간 자동 정지 로직 (일괄 처리 + 글로벌 잠금)
export const autoPauseForLunch = async () => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const dailyDocRef = getDailyDocRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let tasksPaused = 0;

        // DB에서 읽지 않고, 브라우저 화면에 떠있는 실시간 메모리 데이터만 딱 집어서 처리!
        const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');

        ongoingRecords.forEach(record => {
            const docRef = doc(workRecordsColRef, record.id);
            const newPauses = record.pauses ? [...record.pauses] : [];
            
            const hasLunchPause = newPauses.some(p => p.type === 'lunch' && p.start === currentTime);
            if (!hasLunchPause) {
                newPauses.push({ start: currentTime, end: null, type: 'lunch' });
                batch.update(docRef, {
                    status: 'paused',
                    pauses: newPauses
                });
                
                // 로컬 상태 즉시 반영으로 화면 갱신
                record.status = 'paused';
                record.pauses = newPauses;
                tasksPaused++;
            }
        });

        // 진행 중이던 업무가 있거나, 아무도 점심시간 잠금을 켜지 않았을 때 실행
        if (tasksPaused > 0 || !appState.lunchPauseExecuted) {
            batch.set(dailyDocRef, { lunchPauseExecuted: true }, { merge: true });
            appState.lunchPauseExecuted = true;
            
            await batch.commit(); // 단 1회의 서버 통신으로 모두 안전하게 정지!
            await syncTodayToHistory(); // 변경된 이력을 즉시 동기화
        }
        return tasksPaused; 

    } catch (e) {
        console.error("Error during auto-pause for lunch: ", e);
        return 0;
    }
};

// ✨ 완벽 개선된 점심시간 자동 재개 로직 (일괄 처리 + 글로벌 잠금)
export const autoResumeFromLunch = async () => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const dailyDocRef = getDailyDocRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let tasksResumed = 0;

        const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused');

        pausedRecords.forEach(record => {
            const docRef = doc(workRecordsColRef, record.id);
            const pauses = record.pauses ? [...record.pauses] : [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;

            // 점심시간(lunch)에 의해 멈춘 업무들만 찾아서 재개시킴
            if (lastPause && lastPause.type === 'lunch' && lastPause.end === null) {
                lastPause.end = currentTime;
                batch.update(docRef, {
                    status: 'ongoing',
                    pauses: pauses
                });
                
                record.status = 'ongoing';
                record.pauses = pauses;
                tasksResumed++;
            }
        });

        // 재개할 업무가 있거나, 아무도 점심시간 재개 잠금을 켜지 않았을 때 실행
        if (tasksResumed > 0 || !appState.lunchResumeExecuted) {
            batch.set(dailyDocRef, { lunchResumeExecuted: true }, { merge: true });
            appState.lunchResumeExecuted = true;
            
            await batch.commit(); // 단 1회의 서버 통신으로 모두 안전하게 재개!
            await syncTodayToHistory(); // 변경된 이력을 즉시 동기화
        }
        return tasksResumed; 

    } catch (e) {
        console.error("Error during auto-resume from lunch: ", e);
        return 0;
    }
};

export const saveManualTaskQuantities = async (newQuantities, confirmedZeroTasks, newStatuses) => {
    try {
        const updates = {};

        if (newQuantities && Object.keys(newQuantities).length > 0) {
            updates.taskQuantities = newQuantities;
        }

        if (newStatuses && Object.keys(newStatuses).length > 0) {
            updates.taskQuantityStatuses = newStatuses;
        }
        
        if (confirmedZeroTasks && confirmedZeroTasks.length > 0) {
            updates.confirmedZeroTasks = confirmedZeroTasks;
        }

        if (Object.keys(updates).length > 0) {
            await updateDailyData(updates);
            showToast('처리량 및 상태가 저장되었습니다.');
        }

    } catch (e) {
        console.error("Error saving manual quantities:", e);
        showToast("처리량 저장 중 오류가 발생했습니다.", true);
    }
};