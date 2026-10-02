// === js/app-data.js ===
import { getTodayDateString, debounce } from './utils.js?v=202610021042';
import * as State from './state.js?v=202610021042';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from './utils.js?v=202610021042';

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
        // ⚠️ dailyAttendance는 여기서 쓰지 않는다.
        //  출퇴근(processClockIn/Out)·퇴근취소·업무마감(saveDayDataToHistory)·알바 추가/삭제/이름변경이
        //  각자 dailyAttendance를 직접 저장한다. 1분 자동저장이 근태 전체 객체를 merge로 덮어쓰면,
        //  상태가 아직 갱신 안 된 탭/이전 상태가 마감된 '퇴근'을 다시 '출근'으로 되돌리는 문제가 있어 제외.
        inspectionList: State.appState.inspectionList || [] // 🔥 누락 방지를 위해 추가
    };

    await updateDailyData(updates);
    
    // 저장 완료 후 상태 초기화
    State.setIsDataDirty(false);
}

export const debouncedSaveState = debounce(saveStateToFirestore, 1000);