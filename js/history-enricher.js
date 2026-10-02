// === js/history-enricher.js ===
// 설명: 이력 데이터에 연차/휴무 정보를 병합하는 순수 데이터 처리 로직입니다.

/** 이전에 펼쳐 넣은 사본(__fromSchedule)을 모두 걷어낸다.
 *  이 함수는 근태를 고칠 때마다 다시 불리는데, 옛 사본을 지우지 않으면
 *  같은 근태가 옛 내용 그대로 남고 바뀐 기간에는 새 사본이 또 생겨
 *  '수정이 반영되지 않고 항목만 늘어나는' 현상이 된다. */
function stripInjectedLeave(historyData) {
    (historyData || []).forEach(day => {
        if (!Array.isArray(day.onLeaveMembers)) return;
        if (day.onLeaveMembers.some(e => e && e.__fromSchedule)) {
            day.onLeaveMembers = day.onLeaveMembers.filter(e => !(e && e.__fromSchedule));
        }
    });
}

export function augmentHistoryWithPersistentLeave(historyData, leaveSchedule) {
    // ⚠️ 반드시 맨 앞에서 — 아래 조기 return 경로에서도 옛 사본은 사라져야 한다.
    //    (일정에서 근태를 지웠는데 화면에 계속 남아 있던 문제도 여기서 해결된다)
    stripInjectedLeave(historyData);

    if (!leaveSchedule || !leaveSchedule.onLeaveMembers) {
        return historyData;
    }

    const leaves = Array.isArray(leaveSchedule.onLeaveMembers) 
        ? leaveSchedule.onLeaveMembers 
        : (leaveSchedule.onLeaveMembers ? Object.values(leaveSchedule.onLeaveMembers) : []);

    if (leaves.length === 0) {
        return historyData;
    }

    // ⚠️ 근태 '종류'로 거르지 말 것.
    //    예전에는 연차·출장·결근·매장근무 4종만 날짜별로 펼쳐서,
    //    휴직·재택근무·외근처럼 나중에 추가된 기간형 근태가 개인 리포트 등
    //    day.onLeaveMembers를 읽는 모든 화면에서 통째로 빠졌다.
    //    판단 기준은 '기간(startDate)을 가진 근태인가' 하나면 충분하다.
    //    (외출·조퇴·지각은 startDate 없이 그날 daily_data에 직접 저장되므로 자연히 제외된다)
    const persistentLeaves = leaves.filter(entry => entry && entry.startDate);

    if (persistentLeaves.length === 0) return historyData;

    const existingEntriesMap = new Map();
    
    historyData.forEach(day => {
        const entries = new Set();
        const dayLeaves = Array.isArray(day.onLeaveMembers) 
            ? day.onLeaveMembers 
            : (day.onLeaveMembers ? Object.values(day.onLeaveMembers) : []);

        dayLeaves.forEach(entry => {
            // 기간형(startDate 보유) 근태만 중복 판정 대상 — 종류는 따지지 않는다.
            if (entry && entry.startDate) {
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

            // ⓘ d 는 Date.UTC 로 만들어 setUTCDate 로 넘기므로 toISOString 과 짝이 맞는다.
            //    (로컬 기준 날짜였다면 하루 밀렸을 자리 — utils.toDateString 참고)
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
                    
                    // ⚠️ 이 항목은 그날 문서(daily_data/history)에는 없고
                    //    persistent_data/leaveSchedule 에서 날짜별로 펼쳐 넣은 사본이다.
                    //    수정·삭제 시 어느 문서를 고쳐야 하는지 구분할 수 있도록 표식을 단다.
                    //    enumerable:false → 스프레드·JSON·Firestore 저장에는 절대 섞이지 않는다.
                    const injected = { ...pLeave };
                    Object.defineProperty(injected, '__fromSchedule', { value: true, enumerable: false });
                    dayData.onLeaveMembers.push(injected);
                    existingEntries.add(entryKey);
                }
            }
        }
    });

    return historyData;
}