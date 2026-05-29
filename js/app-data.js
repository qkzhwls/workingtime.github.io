// === js/app-data.js ===
// 설명: app.js에서 분리된 핵심 데이터 관리 함수 (ID 생성, Firestore 저장)
// 순환 참조 문제를 해결하기 위해 분리되었습니다.

import { getTodayDateString, debounce } from './utils.js';
import * as State from './state.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from './utils.js';

export const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * Firestore 'daily_data' 문서에 원자적으로 데이터를 업데이트(병합)합니다.
 */
export async function updateDailyData(updates) {
    if (!State.auth || !State.auth.currentUser) {
        console.warn('Cannot update daily data: User not authenticated.');
        return;
    }

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
        // setDoc({ ... }, { merge: true })를 사용하여 문서가 없으면 생성하고, 있으면 병합합니다.
        await setDoc(docRef, updates, { merge: true });

    } catch (error) {
        console.error('Error updating daily data atomically:', error);
        showToast('데이터 저장 중 오류가 발생했습니다.', true);
    }
}

/**
 * appState의 주요 필드들을 Firestore에 저장합니다.
 */
export async function saveStateToFirestore() {
    const updates = {
        taskQuantities: State.appState.taskQuantities || {},
        onLeaveMembers: State.appState.dailyOnLeaveMembers || [],
        partTimers: State.appState.partTimers || [],
        hiddenGroupIds: State.appState.hiddenGroupIds || [],
        lunchPauseExecuted: State.appState.lunchPauseExecuted || false,
        lunchResumeExecuted: State.appState.lunchResumeExecuted || false,
        confirmedZeroTasks: State.appState.confirmedZeroTasks || [],
        dailyAttendance: State.appState.dailyAttendance || {}
    };

    await updateDailyData(updates);
    State.setIsDataDirty(false); // Setter 함수를 통해 상태 변경
}

/**
 * saveStateToFirestore 함수를 디바운스(연속 호출 방지) 처리합니다.
 */
export const debouncedSaveState = debounce(saveStateToFirestore, 1000);