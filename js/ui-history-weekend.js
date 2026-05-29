// === js/ui-history-weekend.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentWeekendStatsData = [];
let currentWeekendTotalCost = 0;
let currentWeekendTotalCount = 0;
let currentWeekendMonthStr = "";

let weekendSortState = { key: 'count', dir: 'desc' };
let weekendFilterState = { name: '' };

const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 text-[10px] ml-1 opacity-0 group-hover:opacity-50">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

const getFilterDropdown = (key, currentFilterValue) => {
    if (!State.context) State.context = {};
    const dropdownId = `weekend-filter-${key}`; 
    const isActive = State.context.activeFilterDropdown === dropdownId;
    const hasValue = currentFilterValue && currentFilterValue !== '';
    const iconColorClass = hasValue ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-200';

    return `
        <div class="relative inline-block ml-1 filter-container">
            <button type="button" class="filter-icon-btn p-1 rounded transition ${iconColorClass}" data-dropdown-id="${dropdownId}" title="필터">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" />
                </svg>
            </button>
            <div class="filter-dropdown absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-[60] p-3 ${isActive ? 'block' : 'hidden'} text-left cursor-default font-normal text-gray-800">
                <div class="text-xs font-bold text-gray-500 mb-2 flex justify-between items-center">
                    <span>이름 검색</span>
                    ${hasValue ? `<button type="button" class="text-[10px] text-red-500 hover:underline" onclick="const i=this.closest('.filter-dropdown').querySelector('input'); i.value=''; i.dispatchEvent(new Event('input', {bubbles:true}));">지우기</button>` : ''}
                </div>
                <input type="text" class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                       placeholder="이름 입력..." value="${currentFilterValue || ''}" data-filter-key="${key}" autocomplete="off">
            </div>
        </div>
    `;
};

export async function loadAndRenderWeekendStats() {
    const tbody = document.getElementById('weekend-history-table-body');
    const monthPicker = document.getElementById('weekend-stats-month-picker');
    if (!tbody || !monthPicker) return;

    const table = tbody.closest('table');
    let thead = table.querySelector('thead');
    if (!thead) {
        thead = document.createElement('thead');
        table.insertBefore(thead, tbody);
    }

    if (!currentWeekendStatsData.length || currentWeekendMonthStr !== monthPicker.value) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-blue-500 font-bold">데이터를 불러오는 중입니다...</td></tr>`;

        if (!monthPicker.value) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            monthPicker.value = `${y}-${m}`;
        }

        currentWeekendMonthStr = monthPicker.value;
        const [year, month] = currentWeekendMonthStr.split('-');
        const startDate = `${currentWeekendMonthStr}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${currentWeekendMonthStr}-${lastDay}`;

        try {
            const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
            const q = query(colRef, where("date", ">=", startDate), where("date", "<=", endDate));
            const snap = await getDocs(q);

            const stats = new Map(); 
            let totalCount = 0;

            snap.forEach(doc => {
                const data = doc.data();
                if (data.status === 'confirmed') {
                    if (!stats.has(data.member)) stats.set(data.member, { count: 0, dates: [] });
                    const st = stats.get(data.member);
                    st.count++;
                    st.dates.push(data.date);
                    totalCount++;
                }
            });

            currentWeekendStatsData = [...stats.entries()];
            currentWeekendTotalCount = totalCount;

        } catch (e) {
            console.error("주말 통계 불러오기 오류:", e);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-red-500 font-bold">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
            return;
        }
    }

    thead.innerHTML = `
        <tr class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
            <th class="px-6 py-4 w-20 text-center font-bold text-gray-500 border-r border-gray-100 select-none">순위</th>
            <th class="px-6 py-4 w-40 cursor-pointer hover:bg-gray-200 transition select-none group relative" data-sort-key="name">
                <div class="flex items-center justify-between font-bold">
                    <span class="flex items-center">이름 ${getSortIcon(weekendSortState.key, weekendSortState.dir, 'name')}</span>
                    ${getFilterDropdown('name', weekendFilterState.name)}
                </div>
            </th>
            <th class="px-6 py-4 w-32 cursor-pointer hover:bg-gray-200 transition select-none group relative" data-sort-key="count">
                <div class="flex items-center justify-center font-bold">
                    확정 횟수 ${getSortIcon(weekendSortState.key, weekendSortState.dir, 'count')}
                </div>
            </th>
            <th class="px-6 py-4 w-40 cursor-pointer hover:bg-gray-200 transition select-none group relative" data-sort-key="cost">
                <div class="flex items-center justify-end font-bold">
                    정산 비용 ${getSortIcon(weekendSortState.key, weekendSortState.dir, 'cost')}
                </div>
            </th>
            <th class="px-6 py-4 font-bold text-gray-500 text-center select-none">근무 일자</th>
        </tr>
    `;

    let filteredData = [...currentWeekendStatsData];
    
    if (weekendFilterState.name) {
        filteredData = filteredData.filter(([name]) => name.includes(weekendFilterState.name));
    }

    filteredData.sort((a, b) => {
        let valA, valB;
        if (weekendSortState.key === 'name') {
            valA = a[0]; valB = b[0];
        } else {
            valA = a[1].count; valB = b[1].count; 
        }

        if (valA < valB) return weekendSortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return weekendSortState.dir === 'asc' ? 1 : -1;
        
        return a[0].localeCompare(b[0]);
    });

    tbody.innerHTML = '';
    let totalCost = 0;
    const COST_PER_TIME = 110000;

    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-gray-400 font-medium">검색 결과가 없습니다.</td></tr>`;
    } else {
        filteredData.forEach(([name, data], idx) => {
            data.dates.sort();
            const cost = data.count * COST_PER_TIME;
            totalCost += cost;
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-blue-50/50 transition-colors bg-white";
            tr.innerHTML = `
                <td class="px-6 py-4 text-center font-bold text-gray-400 border-r border-gray-50">${idx + 1}</td>
                <td class="px-6 py-4 font-extrabold text-gray-800">${name}</td>
                <td class="px-6 py-4 text-center font-bold text-blue-600 bg-blue-50/30">${data.count}회</td>
                <td class="px-6 py-4 text-right font-black text-gray-800">${cost.toLocaleString()} 원</td>
                <td class="px-6 py-4 text-xs font-medium text-gray-500 leading-relaxed">${data.dates.join(', ')}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    currentWeekendTotalCount = totalCount;
    currentWeekendTotalCost = totalCost;
    const countEl = document.getElementById('weekend-total-count');
    const costEl = document.getElementById('weekend-total-cost');
    if (countEl) countEl.textContent = currentWeekendTotalCount;
    if (costEl) costEl.textContent = currentWeekendTotalCost.toLocaleString();
}

export function setupWeekendListeners() {
    const monthPicker = document.getElementById('weekend-stats-month-picker');
    if (monthPicker) {
        monthPicker.addEventListener('change', () => {
            currentWeekendStatsData = []; 
            loadAndRenderWeekendStats();
        });
    }

    const downloadWeekendBtn = document.getElementById('weekend-stats-download-btn');
    if (downloadWeekendBtn) {
        downloadWeekendBtn.addEventListener('click', () => {
            if (currentWeekendStatsData.length === 0) {
                showToast('다운로드할 데이터가 없습니다.', true);
                return;
            }
            let csvContent = "\uFEFF"; 
            csvContent += "순위,이름,확정 횟수,정산 비용(원),근무 일자\n";
            const COST_PER_TIME = 110000;
            currentWeekendStatsData.forEach(([name, data], idx) => {
                const cost = data.count * COST_PER_TIME;
                const datesStr = `"${data.dates.join(', ')}"`;
                csvContent += `${idx + 1},${name},${data.count},${cost},${datesStr}\n`;
            });
            csvContent += `총계,-,${currentWeekendTotalCount},${currentWeekendTotalCost},-\n`;

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `주말근무_정산통계_${currentWeekendMonthStr}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showToast('엑셀(CSV) 파일이 다운로드되었습니다.');
        });
    }

    // 전역 이벤트 위임 (검색/정렬용)
    document.addEventListener('click', (e) => {
        const isWeekendPanel = e.target.closest('#history-weekend-panel') || e.target.closest('table:has(#weekend-history-table-body)');
        if (!isWeekendPanel) return;

        if (e.target.closest('.filter-dropdown')) return;
        
        const filterIconBtn = e.target.closest('.filter-icon-btn');
        if (filterIconBtn) {
            e.stopPropagation();
            if (!State.context) State.context = {};
            const dropdownId = filterIconBtn.dataset.dropdownId;
            State.context.activeFilterDropdown = (State.context.activeFilterDropdown === dropdownId) ? null : dropdownId;
            loadAndRenderWeekendStats();
            return;
        }

        const sortTh = e.target.closest('th[data-sort-key]');
        if (sortTh) {
            const key = sortTh.dataset.sortKey;
            if (!key) return;
            if (weekendSortState.key === key) weekendSortState.dir = weekendSortState.dir === 'asc' ? 'desc' : 'asc';
            else { weekendSortState.key = key; weekendSortState.dir = 'asc'; }
            loadAndRenderWeekendStats();
        }
    });

    document.addEventListener('input', (e) => {
        const isWeekendPanel = e.target.closest('#history-weekend-panel') || e.target.closest('table:has(#weekend-history-table-body)');
        if (!isWeekendPanel) return;

        const filterInput = e.target.closest('input[data-filter-key]');
        if (filterInput && filterInput.dataset.filterKey === 'name') {
            weekendFilterState.name = filterInput.value;
            loadAndRenderWeekendStats();
            setTimeout(() => {
                const newInputs = document.querySelectorAll(`input[data-filter-key="name"]`);
                newInputs.forEach(newInput => {
                    if (newInput.closest('#history-weekend-panel') || newInput.closest('table:has(#weekend-history-table-body)')) {
                        newInput.focus();
                        const val = newInput.value; newInput.value = ''; newInput.value = val;
                    }
                });
            }, 0);
        }
    });
}