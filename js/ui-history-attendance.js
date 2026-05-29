// === js/ui-history-attendance.js ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, calculateDateDifference } from './utils.js';
import { context, LEAVE_TYPES } from './state.js';

/**
 * 헬퍼: 정렬 아이콘 생성
 */
const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 text-[10px] ml-1 opacity-0 group-hover:opacity-50">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

/**
 * 헬퍼: 필터 드롭다운 UI 생성 (엑셀 스타일)
 */
const getFilterDropdown = (mode, key, currentFilterValue, options = []) => {
    const dropdownId = `${mode}-${key}`; // 예: daily-member
    const isActive = context.activeFilterDropdown === dropdownId;
    const hasValue = currentFilterValue && currentFilterValue !== '';
    
    // 필터 아이콘 색상 (값이 있으면 파란색, 없으면 회색)
    const iconColorClass = hasValue ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-200';

    let inputHtml = '';
    if (options.length > 0) {
        // 셀렉트 박스 (유형, 멤버 등)
        const optionsHtml = options.map(opt => 
            `<option value="${opt}" ${currentFilterValue === opt ? 'selected' : ''}>${opt}</option>`
        ).join('');
        
        inputHtml = `
            <select class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer"
                    data-filter-target="${mode}" data-filter-key="${key}">
                <option value="">(전체)</option>
                ${optionsHtml}
            </select>`;
    } else {
        // 텍스트 입력 (옵션이 없을 때 대비)
        inputHtml = `
            <input type="text" class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                   placeholder="검색어 입력..." 
                   value="${currentFilterValue || ''}"
                   data-filter-target="${mode}" data-filter-key="${key}"
                   autocomplete="off">`;
    }

    // ✅ 드롭다운에 z-index 60 적용하여 테이블 헤더 위로 올라오게 함
    return `
        <div class="relative inline-block ml-1 filter-container">
            <button type="button" class="filter-icon-btn p-1 rounded transition ${iconColorClass}" data-dropdown-id="${dropdownId}" title="필터">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" />
                </svg>
            </button>
            
            <div class="filter-dropdown absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-[60] p-3 ${isActive ? 'block' : 'hidden'} text-left cursor-default">
                <div class="text-xs font-bold text-gray-500 mb-2 flex justify-between items-center">
                    <span>필터 조건</span>
                    ${hasValue ? `<button class="text-[10px] text-red-500 hover:underline" onclick="const i=this.closest('.filter-dropdown').querySelector('input,select'); i.value=''; i.dispatchEvent(new Event('input', {bubbles:true}));">지우기</button>` : ''}
                </div>
                ${inputHtml}
            </div>
        </div>
    `;
};


/**
 * 근태 이력 - 일별 상세 렌더링
 */
export const renderAttendanceDailyHistory = (dateKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">근태 기록 로딩 중...</div>';

    const data = allHistoryData.find(d => d.id === dateKey);

    let html = `
        <div class="mb-4 pb-2 border-b flex justify-between items-center">
            <h3 class="text-xl font-bold text-gray-800">${dateKey} 근태 현황</h3>
            <div>
                <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm"
                        data-action="open-add-attendance-modal" data-date-key="${dateKey}">
                    수동 추가
                </button>
                <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" 
                        data-action="request-history-deletion" data-date-key="${dateKey}">
                    삭제
                </button>
            </div>
        </div>
    `;
    
    if (!data || !data.onLeaveMembers || data.onLeaveMembers.length === 0) {
        html += `<div class="bg-white p-4 rounded-lg shadow-sm text-center text-gray-500">해당 날짜의 근태 기록이 없습니다.</div>`;
        view.innerHTML = html;
        return;
    }

    // ✅ 현재 데이터에 존재하는 멤버 목록 추출 (필터 옵션용)
    const allMembers = [...new Set(data.onLeaveMembers.map(e => e.member))].sort();

    // --- 1. 필터링 및 정렬 로직 ---
    let leaveEntries = [...data.onLeaveMembers];
    
    // ✅ 안전한 참조
    const filterState = context.attendanceFilterState?.daily || { member: '', type: '' };
    const sortState = context.attendanceSortState?.daily || { key: 'member', dir: 'asc' };

    // 1-1. 필터링
    if (filterState.member) {
        leaveEntries = leaveEntries.filter(e => e.member === filterState.member);
    }
    if (filterState.type) {
        leaveEntries = leaveEntries.filter(e => e.type === filterState.type);
    }

    // 1-2. 정렬
    leaveEntries.sort((a, b) => {
        let valA = '', valB = '';
        if (sortState.key === 'member') { valA = a.member || ''; valB = b.member || ''; }
        else if (sortState.key === 'type') { valA = a.type || ''; valB = b.type || ''; }
        else if (sortState.key === 'time') { valA = a.startTime || a.startDate || ''; valB = b.startTime || b.startDate || ''; }
        
        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

    // --- 2. 테이블 헤더 생성 ---
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm min-h-[400px]">
            <table class="w-full text-sm text-left text-gray-600">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none group relative" data-sort-target="daily" data-sort-key="member">
                            <div class="flex items-center justify-between">
                                <span class="flex items-center">이름 ${getSortIcon(sortState.key, sortState.dir, 'member')}</span>
                                ${getFilterDropdown('daily', 'member', filterState.member, allMembers)}
                            </div>
                        </th>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none group relative" data-sort-target="daily" data-sort-key="type">
                            <div class="flex items-center justify-between">
                                <span class="flex items-center">유형 ${getSortIcon(sortState.key, sortState.dir, 'type')}</span>
                                ${getFilterDropdown('daily', 'type', filterState.type, LEAVE_TYPES)}
                            </div>
                        </th>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none group" data-sort-target="daily" data-sort-key="time">
                            <div class="flex items-center">
                                시간 / 기간 ${getSortIcon(sortState.key, sortState.dir, 'time')}
                            </div>
                        </th>
                        <th scope="col" class="px-6 py-3 text-right">관리</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
    `;

    if (leaveEntries.length === 0) {
        html += `<tr><td colspan="4" class="px-6 py-8 text-center text-gray-500">조건에 맞는 기록이 없습니다.</td></tr>`;
        html += `</tbody></table></div>`;
        view.innerHTML = html;
        return;
    }

    // --- 3. 테이블 바디 생성 ---
    const isGroupedView = (sortState.key === 'member');

    if (isGroupedView) {
        const groupedEntries = new Map();
        leaveEntries.forEach((entry) => {
            const originalIndex = data.onLeaveMembers.indexOf(entry);
            const member = entry.member || 'N/A';
            if (!groupedEntries.has(member)) groupedEntries.set(member, []);
            groupedEntries.get(member).push({ ...entry, originalIndex });
        });

        let isFirstMemberGroup = true; 
        groupedEntries.forEach((entries, member) => {
            const memberEntryCount = entries.length;
            entries.forEach((entry, entryIndex) => {
                const detailText = _formatDetailText(entry);
                const isFirstRowOfGroup = (entryIndex === 0);
                const rowClass = `bg-white hover:bg-gray-50 ${isFirstRowOfGroup && !isFirstMemberGroup ? 'border-t' : ''}`;

                html += `<tr class="${rowClass}">`;
                if (isFirstRowOfGroup) {
                    html += `<td class="px-6 py-4 font-medium text-gray-900 align-top border-r border-gray-50" rowspan="${memberEntryCount}">${member}</td>`;
                }
                html += `
                    <td class="px-6 py-4">
                        <span class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">${entry.type}</span>
                    </td>
                    <td class="px-6 py-4 text-gray-500 font-mono text-xs">${detailText}</td>
                    <td class="px-6 py-4 text-right space-x-2">
                        <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">수정</button>
                        <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">삭제</button>
                    </td>
                </tr>`;
            });
            isFirstMemberGroup = false; 
        });

    } else {
        leaveEntries.forEach((entry) => {
            const originalIndex = data.onLeaveMembers.indexOf(entry);
            const detailText = _formatDetailText(entry);
            
            html += `
                <tr class="bg-white hover:bg-gray-50">
                    <td class="px-6 py-4 font-medium text-gray-900">${entry.member}</td>
                    <td class="px-6 py-4">
                        <span class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">${entry.type}</span>
                    </td>
                    <td class="px-6 py-4 text-gray-500 font-mono text-xs">${detailText}</td>
                    <td class="px-6 py-4 text-right space-x-2">
                        <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${originalIndex}" class="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">수정</button>
                        <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${originalIndex}" class="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">삭제</button>
                    </td>
                </tr>`;
        });
    }

    html += `</tbody></table></div>`;
    view.innerHTML = html;
};

// 헬퍼: 상세 텍스트 포맷팅
const _formatDetailText = (entry) => {
    if (entry.startTime) {
        let text = formatTimeTo24H(entry.startTime);
        if (entry.type === '외출') {
            text += entry.endTime ? ` ~ ${formatTimeTo24H(entry.endTime)}` : ' ~';
        } else if (entry.endTime) {
            text += ` ~ ${formatTimeTo24H(entry.endTime)}`;
        }
        return text;
    } else if (entry.startDate) {
        let text = entry.startDate;
        if (entry.endDate && entry.endDate !== entry.startDate) {
            text += ` ~ ${entry.endDate}`;
        }
        return text;
    }
    return '-';
};

/**
 * 주별/월별 근태 요약 렌더링
 */
const renderAggregatedAttendanceSummary = (viewElement, aggregationMap, periodKey, mode) => {
    const data = aggregationMap[periodKey];
    if (!data) {
        viewElement.innerHTML = `<div class="text-center text-gray-500">${periodKey} 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }

    const sortState = context.attendanceSortState?.[mode] || { key: 'member', dir: 'asc' };
    const filterState = context.attendanceFilterState?.[mode] || { member: '' };

    // 1. 집계
    let summary = [];
    const memberMap = {};
    const allMemberSet = new Set(); // ✅ 멤버 목록 수집용

    data.leaveEntries.forEach(entry => {
        const member = entry.member;
        allMemberSet.add(member); // 멤버 추가

        if (!memberMap[member]) {
            memberMap[member] = {
                member: member,
                counts: { '지각': 0, '외출': 0, '조퇴': 0, '결근': 0, '연차': 0, '출장': 0 },
                totalCount: 0,
                totalAbsenceDays: 0,
                totalLeaveDays: 0
            };
        }
        const rec = memberMap[member];
        const type = entry.type;
        if (rec.counts.hasOwnProperty(type)) {
            rec.counts[type] += 1;
        } else if (type) {
            rec.counts[type] = (rec.counts[type] || 0) + 1;
        }
        
        // ✅ [수정] '연차'가 아닐 때만 총 횟수에 포함
        if (type !== '연차') {
            rec.totalCount += 1;
        }

        if (type === '결근') {
            rec.totalAbsenceDays += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        } else if (type === '연차') {
            rec.totalLeaveDays += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        }
    });
    summary = Object.values(memberMap);

    // ✅ 멤버 리스트 정렬 (필터 드롭다운용)
    const allMembers = [...allMemberSet].sort();

    // 2. 필터링 (정확히 일치)
    if (filterState.member) {
        summary = summary.filter(item => item.member === filterState.member);
    }

    // 3. 정렬
    summary.sort((a, b) => {
        let valA = 0, valB = 0;
        const k = sortState.key;
        if (['member'].includes(k)) { valA = a[k]; valB = b[k]; }
        else if (['totalCount', 'totalAbsenceDays', 'totalLeaveDays'].includes(k)) { valA = a[k]; valB = b[k]; }
        else { valA = a.counts[k] || 0; valB = b.counts[k] || 0; }

        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

    // 4. HTML 생성
    const th = (key, label, width='') => `
        <th scope="col" class="px-4 py-3 border-b cursor-pointer hover:bg-gray-200 select-none group ${width}" data-sort-target="${mode}" data-sort-key="${key}">
            <div class="flex items-center justify-center relative">
                <span>${label} ${getSortIcon(sortState.key, sortState.dir, key)}</span>
                ${key === 'member' ? getFilterDropdown(mode, 'member', filterState.member, allMembers) : ''}
            </div>
        </th>`;

    let html = `
        <div class="bg-white p-4 rounded-lg shadow-sm mb-6 min-h-[400px]">
            <h3 class="text-xl font-bold mb-4 text-gray-800">${periodKey} 근태 요약</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-600 border border-gray-200">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                        <tr>
                            ${th('member', '이름', 'sticky left-0 bg-gray-100 z-10')}
                            ${th('지각', '지각')} ${th('외출', '외출')} ${th('조퇴', '조퇴')} ${th('결근', '결근')} ${th('연차', '연차')} ${th('출장', '출장')}
                            ${th('totalCount', '총 횟수')} ${th('totalAbsenceDays', '총 결근일')} ${th('totalLeaveDays', '총 연차일')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">`;

    if (summary.length === 0) {
         html += `<tr><td colspan="10" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    } else {
        summary.forEach(item => {
            const cell = (k, color='text-gray-400') => `<td class="px-4 py-3 text-center ${item.counts[k]>0 ? 'text-gray-800 font-medium' : color}">${item.counts[k]||0}</td>`;
            html += `
                <tr class="bg-white hover:bg-gray-50">
                    <td class="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white shadow-sm">${item.member}</td>
                    ${cell('지각', 'text-gray-300')}
                    ${cell('외출', 'text-gray-300')}
                    ${cell('조퇴', 'text-gray-300')}
                    <td class="px-4 py-3 text-center ${item.counts['결근']>0?'text-red-600 font-bold':'text-gray-300'}">${item.counts['결근']||0}</td>
                    <td class="px-4 py-3 text-center ${item.counts['연차']>0?'text-blue-600 font-bold':'text-gray-300'}">${item.counts['연차']||0}</td>
                    ${cell('출장', 'text-gray-300')}
                    <td class="px-4 py-3 text-center font-bold text-indigo-600 bg-indigo-50">${item.totalCount}</td>
                    <td class="px-4 py-3 text-center font-bold text-red-600 bg-red-50">${item.totalAbsenceDays}</td>
                    <td class="px-4 py-3 text-center font-bold text-blue-600 bg-blue-50">${item.totalLeaveDays}</td>
                </tr>`;
        });
    }

    html += `       </tbody>
                </table>
            </div>
        </div>`;

    viewElement.innerHTML = html;
};

export const renderAttendanceWeeklyHistory = (selectedWeekKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터 집계 중...</div>';

    const weeklyData = (allHistoryData || []).reduce((acc, day) => {
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string') return acc;
        try {
             const dateObj = new Date(day.id);
             if (isNaN(dateObj.getTime())) return acc;
             const weekKey = getWeekOfYear(dateObj);
             if (!weekKey) return acc;

            if (!acc[weekKey]) acc[weekKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => {
                if (entry && entry.type && entry.member) {
                    if (entry.startDate) {
                        const currentDate = day.id;
                        const startDate = entry.startDate;
                        const endDate = entry.endDate || entry.startDate;
                        if (currentDate >= startDate && currentDate <= endDate) {
                            acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    } else {
                        acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                    }
                }
            });
            acc[weekKey].dateKeys.add(day.id);
        } catch (e) { console.error("Error processing day in attendance weekly aggregation:", day.id, e); }
        return acc;
    }, {});

    renderAggregatedAttendanceSummary(view, weeklyData, selectedWeekKey, 'weekly');
};

export const renderAttendanceMonthlyHistory = (selectedMonthKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터 집계 중...</div>';

    const monthlyData = (allHistoryData || []).reduce((acc, day) => {
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string' || day.id.length < 7) return acc;
         try {
            const monthKey = day.id.substring(0, 7);
             if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;

            if (!acc[monthKey]) acc[monthKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => {
                 if (entry && entry.type && entry.member) {
                    if (entry.startDate) {
                        const currentDate = day.id;
                        const startDate = entry.startDate;
                        const endDate = entry.endDate || entry.startDate;
                        if (currentDate >= startDate && currentDate <= endDate) {
                            acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    } else {
                        acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                    }
                }
            });
            acc[monthKey].dateKeys.add(day.id);
        } catch (e) { console.error("Error processing day in attendance monthly aggregation:", day.id, e); }
        return acc;
    }, {});

    renderAggregatedAttendanceSummary(view, monthlyData, selectedMonthKey, 'monthly');
};