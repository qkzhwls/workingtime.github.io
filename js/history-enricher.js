// === js/history-enricher.js ===
// 설명: 이력 데이터에 연차/휴무 정보를 병합하는 순수 데이터 처리 로직입니다.
// (기존 app-history-logic.js에서 분리됨)

/**
 * 로컬 이력 데이터(historyData)에 영구 보관된 연차 일정(leaveSchedule)을 병합합니다.
 */
export function augmentHistoryWithPersistentLeave(historyData, leaveSchedule) {
    // leaveSchedule 자체가 없거나 onLeaveMembers가 없을 경우 대비
    if (!leaveSchedule || !leaveSchedule.onLeaveMembers) {
        return historyData;
    }

    // ✅ [수정] leaveSchedule.onLeaveMembers가 배열인지 확인하고 변환
    const leaves = Array.isArray(leaveSchedule.onLeaveMembers) 
        ? leaveSchedule.onLeaveMembers 
        : (leaveSchedule.onLeaveMembers ? Object.values(leaveSchedule.onLeaveMembers) : []);

    if (leaves.length === 0) {
        return historyData;
    }

    const persistentLeaves = leaves.filter(
        entry => entry.type === '연차' || entry.type === '출장' || entry.type === '결근'
    );

    if (persistentLeaves.length === 0) return historyData;

    const existingEntriesMap = new Map();
    
    historyData.forEach(day => {
        const entries = new Set();
        // ✅ [수정] day.onLeaveMembers가 배열인지 확인하고 안전하게 변환 (핵심 수정 부분)
        const dayLeaves = Array.isArray(day.onLeaveMembers) 
            ? day.onLeaveMembers 
            : (day.onLeaveMembers ? Object.values(day.onLeaveMembers) : []);

        dayLeaves.forEach(entry => {
            if (entry.startDate || entry.type === '연차' || entry.type === '출장' || entry.type === '결근') {
                entries.add(`${entry.member}::${entry.type}`);
            }
        });
        existingEntriesMap.set(day.id, entries);
    });

    persistentLeaves.forEach(pLeave => {
        if (!pLeave.startDate) return;

        const [sY, sM, sD] = pLeave.startDate.split('-').map(Number);
        const effectiveEndDate = pLeave.endDate || pLeave.startDate;
        const [eY, eM, eD] = effectiveEndDate.split('-').map(Number);

        const startDate = new Date(Date.UTC(sY, sM - 1, sD));
        const endDate = new Date(Date.UTC(eY, eM - 1, eD));

        for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
            const dateKey = d.toISOString().slice(0, 10);
            const dayData = historyData.find(day => day.id === dateKey);
            const existingEntries = existingEntriesMap.get(dateKey);

            if (dayData && existingEntries) {
                const entryKey = `${pLeave.member}::${pLeave.type}`;
                if (!existingEntries.has(entryKey)) {
                    if (!dayData.onLeaveMembers) {
                        dayData.onLeaveMembers = [];
                    }
                    // 만약 dayData.onLeaveMembers가 객체라면 배열로 초기화하고 기존 데이터 보존
                    if (!Array.isArray(dayData.onLeaveMembers)) {
                        dayData.onLeaveMembers = dayData.onLeaveMembers ? Object.values(dayData.onLeaveMembers) : [];
                    }
                    
                    dayData.onLeaveMembers.push({ ...pLeave });
                    existingEntries.add(entryKey);
                }
            }
        }
    });

    return historyData;
}