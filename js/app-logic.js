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
        // Dot Notation을 사용한 원자적 업데이트
        await updateDoc(getDailyDocRef(), {
            [`dailyAttendance.${memberName}`]: {
                inTime: now,
                outTime: null,
                status: 'active' // 활동 중(출근 상태)
            }
        });

        showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}출근 처리되었습니다. (${now})`);
        return true;
    } catch (e) {
        console.error("Clock-in error:", e);
        // 문서가 없을 경우(하루 첫 출근) 대비한 setDoc fallback
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
    // 1. 출근 여부 체크
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`아직 출근하지 않은 팀원이 있어 업무를 시작할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    // 2. 이미 업무 중인지 체크
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
            const recordId = generateId(); // Firestore 문서 ID로 사용
            const newRecordRef = doc(workRecordsColRef, recordId);
            const newRecordData = {
                id: recordId, // 데이터 내부에도 ID 저장
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
    // 1. 출근 여부 체크
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`출근하지 않은 팀원은 추가할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    // 2. 이미 업무 중인지 체크
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
    // 호환성을 위해 유지, 실제로는 finalizeStopGroup 사용
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

            // 0분 이하 자동 삭제 로직
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

        // 처리량 원자적 증가
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

// ✅ [신규] 업무명(Task) 기준으로 일괄 종료하는 함수
export const stopWorkByTask = async (taskName, quantity) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        // 해당 업무명의 진행중/일시정지인 모든 기록 조회
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
            
            // 일시정지 상태라면 마지막 휴식 종료 처리
            if (record.status === 'paused') {
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                if (lastPause && lastPause.end === null) {
                    lastPause.end = endTime;
                }
            }
            const duration = calcElapsedMinutes(record.startTime, endTime, pauses);

            // 0분 이하 삭제
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

        // 처리량 업데이트
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

// ✅ [신규] 업무명(Task) 기준으로 일괄 정지하는 함수
export const pauseWorkByTask = async (taskName) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("task", "==", taskName), where("status", "==", "ongoing"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) return; // 이미 정지 상태거나 대상 없음

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

// ✅ [신규] 업무명(Task) 기준으로 일괄 재개하는 함수
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

            // 0분 이하 자동 삭제 로직
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

export const autoPauseForLunch = async () => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("status", "==", "ongoing"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.log("Auto-pause: No ongoing tasks to pause.");
            return 0; // 0건 처리
        }

        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let tasksPaused = 0;

        querySnapshot.forEach(doc => {
            const record = doc.data();
            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'lunch' });

            batch.update(doc.ref, {
                status: 'paused',
                pauses: newPauses
            });
            tasksPaused++;
        });

        await batch.commit();
        return tasksPaused; // 처리한 건수 반환

    } catch (e) {
        console.error("Error during auto-pause for lunch: ", e);
        showToast("점심시간 자동 정지 중 오류 발생", true);
        return 0;
    }
};

export const autoResumeFromLunch = async () => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("status", "==", "paused"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.log("Auto-resume: No paused tasks to resume.");
            return 0;
        }

        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let tasksResumed = 0;

        querySnapshot.forEach(doc => {
            const record = doc.data();
            const pauses = record.pauses || [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;

            if (lastPause && lastPause.type === 'lunch' && lastPause.end === null) {
                lastPause.end = currentTime;

                batch.update(doc.ref, {
                    status: 'ongoing',
                    pauses: pauses
                });
                tasksResumed++;
            }
        });

        if (tasksResumed > 0) {
            await batch.commit();
        }
        return tasksResumed; // 처리한 건수 반환

    } catch (e) {
        console.error("Error during auto-resume from lunch: ", e);
        showToast("점심시간 자동 재개 중 오류 발생", true);
        return 0;
    }
};

// ✅ [신규] 수동 처리량 입력 저장 (상태 포함)
export const saveManualTaskQuantities = async (newQuantities, confirmedZeroTasks, newStatuses) => {
    try {
        const updates = {};

        // 수량 데이터 준비
        if (newQuantities && Object.keys(newQuantities).length > 0) {
            updates.taskQuantities = newQuantities;
        }

        // 상태 데이터 준비 (예: 'estimated' or 'confirmed')
        if (newStatuses && Object.keys(newStatuses).length > 0) {
            updates.taskQuantityStatuses = newStatuses;
        }
        
        // 0건 확인된 태스크 처리
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