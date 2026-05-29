// === js/weekend-calendar.js ===
import * as State from './state.js';
import { store, currentManageDateStr } from './weekend-store.js';
import { showToast } from './utils.js';
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderWeekendStats, renderWeekendList, renderWeekendGrid } from './weekend-ui.js';
import { processSelectedDatesBulkAction, populatePastDateAddSelect, renderPastDateMembers } from './weekend-admin.js';

let currentViewMode = 'list'; 

// ✨ 추가: 읽기(Read) 비용 최적화를 위한 로컬 데이터 캐싱 변수
let currentLoadedYear = null; 
let yearSnapshotData = []; 

export async function initWeekendCalendar() {
    await loadWeekendRequests(store.currentYear, store.currentMonth);

    const selectAllCb = document.getElementById('select-all-dates-checkbox');
    if (selectAllCb) {
        selectAllCb.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.date-select-checkbox').forEach(cb => cb.checked = isChecked);
        });
    }

    const bulkConfirmBtn = document.getElementById('bulk-confirm-btn');
    if (bulkConfirmBtn) bulkConfirmBtn.onclick = () => processSelectedDatesBulkAction('confirmed');
    
    const bulkCancelBtn = document.getElementById('bulk-cancel-btn');
    if (bulkCancelBtn) bulkCancelBtn.onclick = () => processSelectedDatesBulkAction('canceled');
    
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (bulkDeleteBtn) bulkDeleteBtn.onclick = () => processSelectedDatesBulkAction('delete');

    const btnList = document.getElementById('view-toggle-list');
    const btnCalendar = document.getElementById('view-toggle-calendar');

    if (btnList && btnCalendar) {
        btnList.addEventListener('click', () => setViewMode('list'));
        btnCalendar.addEventListener('click', () => setViewMode('calendar'));
    }
}

function setViewMode(mode) {
    currentViewMode = mode;
    const btnList = document.getElementById('view-toggle-list');
    const btnCalendar = document.getElementById('view-toggle-calendar');
    const viewList = document.getElementById('weekend-list-view');
    const viewCalendar = document.getElementById('weekend-calendar-view');
    const bulkBar = document.getElementById('admin-bulk-action-bar');

    if (mode === 'list') {
        btnList.className = 'px-2 py-1 text-xs font-bold bg-blue-50 text-blue-600';
        btnCalendar.className = 'px-2 py-1 text-xs font-bold bg-white text-gray-500 hover:bg-gray-50';
        viewList.classList.remove('hidden');
        viewCalendar.classList.add('hidden');
        
        renderWeekendList(store.currentYear, store.currentMonth);
    } else {
        btnList.className = 'px-2 py-1 text-xs font-bold bg-white text-gray-500 hover:bg-gray-50';
        btnCalendar.className = 'px-2 py-1 text-xs font-bold bg-blue-50 text-blue-600';
        viewList.classList.add('hidden');
        viewCalendar.classList.remove('hidden');
        viewCalendar.classList.add('flex');
        
        if (bulkBar) {
            bulkBar.classList.add('hidden');
            bulkBar.classList.remove('flex');
        }

        renderWeekendGrid(store.currentYear, store.currentMonth);
    }
}

export function changeMonth(offset) {
    store.currentMonth += offset;
    if (store.currentMonth > 11) {
        store.currentMonth = 0;
        store.currentYear++;
    } else if (store.currentMonth < 0) {
        store.currentMonth = 11;
        store.currentYear--;
    }
    loadWeekendRequests(store.currentYear, store.currentMonth);
}

// ✨ 추가: DB에서 받아온 전체 연도 데이터를 월별 화면에 맞게 가공하고 렌더링하는 전담 함수
function processAndRenderWeekend(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    store.myRequestsMap.clear();
    store.blockedDatesSet.clear();
    store.capacityMap.clear(); 
    store.requestsByDate = {};
    
    const memberStats = new Map(); 
    const yearlyStatsMap = new Map(); 
    const excludedMembers = ['박영철', '박호진', '유아라', '이승운'];

    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(group => {
            if (group.members && Array.isArray(group.members)) {
                group.members.forEach(member => {
                    if (!excludedMembers.includes(member)) {
                        memberStats.set(member, { confirmed: 0, requested: 0 });
                        yearlyStatsMap.set(member, 0); 
                    }
                });
            }
        });
    }

    // 로컬에 캐싱된(저장된) 1년 치 데이터에서 화면에 그릴 달(Month)의 정보만 추출
    yearSnapshotData.forEach(data => {
        if (data.type === 'blocked') {
            if (data.month === monthStr) store.blockedDatesSet.add(data.date);
        } else if (data.type === 'capacity') {
            if (data.month === monthStr) store.capacityMap.set(data.date, data.capacity);
        } else {
            if (data.status === 'confirmed' && !excludedMembers.includes(data.member)) {
                yearlyStatsMap.set(data.member, (yearlyStatsMap.get(data.member) || 0) + 1);
            }

            if (data.month === monthStr) {
                if (!store.requestsByDate[data.date]) store.requestsByDate[data.date] = [];
                store.requestsByDate[data.date].push(data);

                if (data.member === State.appState.currentUser) {
                    store.myRequestsMap.set(data.date, data.id);
                }

                if (!excludedMembers.includes(data.member)) {
                    const stat = memberStats.get(data.member) || { confirmed: 0, requested: 0 };
                    if (data.status === 'confirmed') stat.confirmed++;
                    else if (data.status === 'requested') stat.requested++;
                    memberStats.set(data.member, stat);
                }
            }
        }
    });

    store.currentYearlyStats = new Map(yearlyStatsMap);
    store.currentMonthStats = new Map(memberStats);

    renderWeekendStats(memberStats, yearlyStatsMap);
    
    if (currentViewMode === 'list') {
        renderWeekendList(year, month);
    } else {
        renderWeekendGrid(year, month);
    }
    
    const pastPopup = document.getElementById('past-date-edit-popup');
    if (pastPopup && !pastPopup.classList.contains('hidden') && currentManageDateStr) {
        populatePastDateAddSelect(currentManageDateStr);
        renderPastDateMembers(currentManageDateStr);
    }
}

async function loadWeekendRequests(year, month) {
    // ✨ 핵심 최적화: 사용자가 연도(Year)를 바꿀 때만 DB에 새로 요청하고, 
    // 같은 연도 내에서 월(Month)만 앞뒤로 넘길 때는 DB에 요청하지 않고 즉시 화면만 다시 그림!
    if (currentLoadedYear !== year) {
        if (store.unsubscribe) {
            store.unsubscribe();
            store.unsubscribe = null;
        }

        try {
            const startOfYear = `${year}-01-01`;
            const endOfYear = `${year}-12-31`;
            
            const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
            const q = query(colRef, where("date", ">=", startOfYear), where("date", "<=", endOfYear));

            store.unsubscribe = onSnapshot(q, (snapshot) => {
                yearSnapshotData = []; 
                snapshot.forEach(docSnap => {
                    yearSnapshotData.push({ id: docSnap.id, ...docSnap.data() });
                });
                currentLoadedYear = year;
                processAndRenderWeekend(store.currentYear, store.currentMonth);
            }, (error) => {
                console.error("Error in weekend listener:", error);
                showToast("실시간 데이터를 불러오지 못했습니다.", true);
            });

        } catch (e) {
            console.error("Error setting up listener:", e);
        }
    } else {
        // 연도가 같으면 값비싼 DB 호출 없이 로컬 데이터로 화면 렌더링 (초고속 동작)
        processAndRenderWeekend(store.currentYear, store.currentMonth);
    }
}

export { currentManageDateStr } from './weekend-store.js';
export * from './weekend-core.js';
export * from './weekend-admin.js';
export * from './weekend-ui.js';