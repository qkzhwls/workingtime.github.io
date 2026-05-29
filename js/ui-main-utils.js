// === js/ui-main-utils.js ===
import * as State from './state.js';
import { calculateWorkingDays } from './utils.js';

export const getLeaveDisplayLabel = (member, leaveEntry) => {
    if (leaveEntry.type !== '연차') return leaveEntry.type;
    const settings = State.appConfig.memberLeaveSettings?.[member] || {};
    const resetDate = settings.leaveResetDate;

    const rawHistory = (State.persistentLeaveSchedule.onLeaveMembers || [])
        .filter(l => {
            if (l.member !== member || l.type !== '연차') return false;
            if (resetDate && l.startDate < resetDate) return false;
            return true;
        })
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    if (rawHistory.length === 0) return '연차';

    const mergedHistory = [];
    if (rawHistory.length > 0) {
        let current = {
            ...rawHistory[0],
            startDate: rawHistory[0].startDate,
            endDate: rawHistory[0].endDate || rawHistory[0].startDate,
            ids: [rawHistory[0].id]
        };
        
        let currentEndObj = new Date(current.endDate);

        for (let i = 1; i < rawHistory.length; i++) {
            const next = rawHistory[i];
            const nextStartObj = new Date(next.startDate);
            const nextEndObj = new Date(next.endDate || next.startDate);
            
            const dayAfterCurrentEnd = new Date(currentEndObj);
            dayAfterCurrentEnd.setDate(dayAfterCurrentEnd.getDate() + 1);

            if (nextStartObj <= dayAfterCurrentEnd) {
                if (nextEndObj > currentEndObj) {
                    currentEndObj = nextEndObj;
                    current.endDate = next.endDate || next.startDate;
                }
                if (next.id) current.ids.push(next.id);
            } else {
                mergedHistory.push(current);
                current = {
                    ...next,
                    startDate: next.startDate,
                    endDate: next.endDate || next.startDate,
                    ids: [next.id]
                };
                currentEndObj = new Date(current.endDate);
            }
        }
        mergedHistory.push(current);
    }

    let cumulativeDays = 0;
    
    for (const block of mergedHistory) {
        const days = calculateWorkingDays(block.startDate, block.endDate);
        if (days === 0) continue;

        const startNth = cumulativeDays + 1;
        const endNth = cumulativeDays + days;
        cumulativeDays += days;

        const isIdMatch = leaveEntry.id && block.ids.includes(leaveEntry.id);
        const isDateMatch = (leaveEntry.startDate >= block.startDate && 
                             (leaveEntry.endDate || leaveEntry.startDate) <= block.endDate);

        if (isIdMatch || isDateMatch) {
            if (days === 1) {
                return `연차${startNth}`;
            } else {
                return `연차${startNth}-${endNth}`;
            }
        }
    }
    return '연차';
};