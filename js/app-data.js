// === js/app-data.js ===
import { getTodayDateString, debounce } from './utils.js';
import * as State from './state.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from './utils.js';

export const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export async function updateDailyData(updates) {
    if (!State.auth || !State.auth.currentUser) {
        console.warn('Cannot update daily data: User not authenticated.');
        return;
    }

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
        await setDoc(docRef, updates, { merge: true });
    } catch (error) {
        console.error('Error updating daily data atomically:', error);
        showToast('데이터 저장 중 오류가 발생했습니다.', true);
    }
}

export async function saveStateToFirestore() {
    // ✨ 핵심 방어막: 데이터에 변경 사항이 없으면(dirty가 아니면) 통신을 차단합니다. (쓰기 요금 방어)
    if (!State.isDataDirty) {
        return; 
    }

    const updates = {
        taskQuantities: State.appState.taskQuantities || {},
        onLeaveMembers: State.appState.dailyOnLeaveMembers || [],
        partTimers: State.appState.partTimers || [],
        hiddenGroupIds: State.appState.hiddenGroupIds || [],
        lunchPauseExecuted: State.appState.lunchPauseExecuted || false,
        lunchResumeExecuted: State.appState.lunchResumeExecuted || false,
        confirmedZeroTasks: State.appState.confirmedZeroTasks || [],
        dailyAttendance: State.appState.dailyAttendance || {},
        inspectionList: State.appState.inspectionList || [] // 🔥 누락 방지를 위해 추가
    };

    await updateDailyData(updates);
    
    // 저장 완료 후 상태 초기화
    State.setIsDataDirty(false);
}

export const debouncedSaveState = debounce(saveStateToFirestore, 1000);