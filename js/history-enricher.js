// === js/history-enricher.js ===
// 설명: 이력 데이터에 연차/휴무 정보를 병합하는 순수 데이터 처리 로직입니다.

export function augmentHistoryWithPersistentLeave(historyData, leaveSchedule) {
    if (!leaveSchedule || !leaveSchedule.onLeaveMembers) {
        return historyData;
    }

    const leaves = Array.isArray(leaveSchedule.onLeaveMembers) 
        ? leaveSchedule.onLeaveMembers 
        : (leaveSchedule.onLeaveMembers ? Object.values(leaveSchedule.onLeaveMembers) : []);

    if (leaves.length === 0) {
        return historyData;
    }

    const persistentLeaves = leaves.filter(
        entry => entry.type === '연차' || entry.type === '출장' || entry.type === '결근' || entry.type === '매장근무'
    );

    if (persistentLeaves.length === 0) return historyData;

    const existingEntriesMap = new Map();
    
    historyData.forEach(day => {
        const entries = new Set();
        const dayLeaves = Array.isArray(day.onLeaveMembers) 
            ? day.onLeaveMembers 
            : (day.onLeaveMembers ? Object.values(day.onLeaveMembers) : []);

        dayLeaves.forEach(entry => {
            if (entry.startDate || entry.type === '연차' || entry.type === '출장' || entry.type === '결근' || entry.type === '매장근무') {
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
            // ✅ [신규] 병합 과정에서도 주말(0:일요일, 6:토요일)은 완전히 무시
            const dayOfWeek = d.getUTCDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) continue;

            const dateKey = d.toISOString().slice(0, 10);
            const dayData = historyData.find(day => day.id === dateKey);
            const existingEntries = existingEntriesMap.get(dateKey);

            if (dayData && existingEntries) {
                const entryKey = `${pLeave.member}::${pLeave.type}`;
                if (!existingEntries.has(entryKey)) {
                    if (!dayData.onLeaveMembers) {
                        dayData.onLeaveMembers = [];
                    }
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