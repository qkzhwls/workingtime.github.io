// === js/weekend-store.js ===
export let currentManageDateStr = null;
export function setCurrentManageDateStr(val) { currentManageDateStr = val; }

export const store = {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    myRequestsMap: new Map(),
    blockedDatesSet: new Set(),
    capacityMap: new Map(),
    requestsByDate: {},
    currentYearlyStats: new Map(),
    currentMonthStats: new Map(),
    smartCalcCache: null,
    recommendOffset: 0,
    unsubscribe: null
};