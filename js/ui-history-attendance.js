// === js/ui-history-attendance.js ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, escapeHtml } from './utils.js?v=202610021228';
import { context, LEAVE_TYPES, appState, appConfig } from './state.js?v=202610021228';
import { systemAccountSet } from './attendance-stats.js?v=202610021228';

// 근태 요약 표의 열 순서. 기존 순서를 유지하되, LEAVE_TYPES에 있는데 여기 없는 종류는
// 뒤에 자동으로 붙는다 → 근태 종류가 추가돼도 표에서 누락되지 않는다.
const ATT_COL_BASE = ['지각', '외출', '조퇴', '결근', '연차', '출장', '매장근무', '재택근무', '기타', '외근'];
const ATT_COLS = [...ATT_COL_BASE, ...LEAVE_TYPES.filter(t => !ATT_COL_BASE.includes(t))];
// 데이터에 실제로 존재하는 종류만 뒤에 덧붙인다(예: 예전 '휴직' 기록).
// 쓰지 않는 옛 종류로 빈 열이 생기지 않으면서, 남아 있는 기록도 숨겨지지 않는다.
const attColsFor = (types) => [...ATT_COLS, ...[...new Set(types)].filter(t => t && !ATT_COLS.includes(t))];

const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 text-[10px] ml-1 opacity-0 group-hover:opacity-50">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

const getFilterDropdown = (mode, key, currentFilterValue, options = []) => {
    const dropdownId = `${mode}-${key}`; 
    const isActive = context.activeFilterDropdown === dropdownId;
    const hasValue = currentFilterValue && currentFilterValue !== '';
    
    const iconColorClass = hasValue ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-200';

    let inputHtml = '';
    if (options.length > 0) {
        const optionsHtml = options.map(opt => 
            `<option value="${opt}" ${currentFilterValue === String(opt) ? 'selected' : ''}>${opt}</option>`
        ).join('');
        
        inputHtml = `
            <select class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer"
                    data-filter-target="${mode}" data-filter-key="${key}">
                <option value="">(전체)</option>
                ${optionsHtml}
            </select>`;
    } else {
        inputHtml = `
            <input type="text" class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                   placeholder="검색어 입력..." 
                   value="${currentFilterValue || ''}"
                   data-filter-target="${mode}" data-filter-key="${key}"
                   autocomplete="off">`;
    }

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
 * 출퇴근 시각 표. 마감된 날의 퇴근시각이 틀렸을 때 고칠 수 있는 **유일한** 화면이다.
 *
 * 왜 필요했나
 *   마감은 아직 퇴근을 찍지 않은 사람 전원의 퇴근시각을 그 시각으로 확정한다. 늦게 마감하면
 *   전원이 그 시각 퇴근으로 박히고, 이력 저장은 마감된 날의 근태를 **서버 우선**으로 지킨다
 *   (그래야 마감 전 상태를 들고 있던 탭이 되돌리지 못한다). 그 결과 틀린 퇴근시각을
 *   화면에서 고칠 방법이 0개였다 — 2026-10-01 에는 스크립트로 직접 고쳐야 했다.
 */
const renderClockInOutTable = (dateKey, data) => {
    const att = (data && data.dailyAttendance) || {};
    const 멤버들 = Object.keys(att).filter(m => att[m] && typeof att[m] === 'object').sort();
    const 관리자 = appState.currentUserRole === 'admin';
    // 시스템계정은 근무시간 집계에서 빠진다. 표에 아무 표시 없이 섞여 있으면
    // '표엔 5명인데 인력운영은 4명' 이 되어 숫자가 틀린 것처럼 보인다.
    let 시스템 = new Set();
    try { 시스템 = systemAccountSet(appConfig); } catch (_) {}

    if (멤버들.length === 0) {
        return `<div class="bg-white p-4 rounded-lg shadow-sm mb-4 text-center text-sm text-gray-400">
                    출퇴근 기록이 없는 날입니다.
                </div>`;
    }

    const 시각 = (v) => (v ? String(v) : '—');
    const 분 = (v) => {
        const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ''));
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };

    const 행들 = 멤버들.map(m => {
        const a = att[m] || {};
        const 들 = 분(a.inTime), 나 = 분(a.outTime);
        // 근무시간 집계(attendance-stats)가 이 사람을 세지 못하는 상태를 눈에 보이게 한다.
        // 그냥 '—' 로 두면 왜 인원 수가 안 맞는지 아무도 알 수 없다.
        const 셀수없음 = (들 == null || 나 == null || 나 <= 들);
        return `
            <tr class="border-b last:border-0 ${셀수없음 ? 'bg-amber-50' : ''}">
                <td class="px-3 py-2 font-medium text-gray-700">${escapeHtml(m)}</td>
                <td class="px-3 py-2 font-mono text-xs text-gray-600">${escapeHtml(시각(a.inTime))}</td>
                <td class="px-3 py-2 font-mono text-xs text-gray-600">${escapeHtml(시각(a.outTime))}</td>
                <td class="px-3 py-2 text-xs">${(a.status === 'returned' || a.outTime)
                    ? '<span class="text-gray-500">퇴근</span>'
                    : '<span class="font-bold text-emerald-600">근무 중</span>'}</td>
                <td class="px-3 py-2 text-xs text-amber-700">${시스템.has(m)
                    ? '<span class="text-gray-400">시스템 계정 — 집계 제외</span>'
                    : (셀수없음 ? '근무시간 집계에서 빠집니다' : '')}</td>
                <td class="px-3 py-2 text-right">${관리자 ? `
                    <button class="text-xs text-blue-600 hover:underline font-semibold"
                            data-action="edit-clockinout"
                            data-date-key="${escapeHtml(dateKey)}" data-member="${escapeHtml(m)}">수정</button>` : ''}</td>
            </tr>`;
    }).join('');

    return `
        <div class="bg-white p-4 rounded-lg shadow-sm mb-4">
            <div class="flex justify-between items-center mb-2">
                <h4 class="font-bold text-gray-800">출퇴근 시각 <span class="text-xs font-normal text-gray-400">${멤버들.length}명</span></h4>
                ${관리자 ? '' : '<span class="text-xs text-gray-400">수정은 관리자만 가능합니다</span>'}
            </div>
            <table class="w-full text-sm text-left">
                <thead class="text-xs text-gray-500 border-b">
                    <tr>
                        <th class="px-3 py-2 font-bold">이름</th>
                        <th class="px-3 py-2 font-bold">출근</th>
                        <th class="px-3 py-2 font-bold">퇴근</th>
                        <th class="px-3 py-2 font-bold">상태</th>
                        <th class="px-3 py-2 font-bold"></th>
                        <th class="px-3 py-2"></th>
                    </tr>
                </thead>
                <tbody>${행들}</tbody>
            </table>
        </div>`;
};

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
    
    // 출퇴근 시각 표 — 휴가성 기록(onLeaveMembers)과 다른 데이터(dailyAttendance)다.
    // 아래 '근태 기록이 없습니다' 조기 return **앞에** 있어야 한다. 휴가 기록이 없는 날이
    // 대부분이라, 뒤에 두면 정작 출퇴근을 고쳐야 하는 날에 화면이 비어 버린다.
    html += renderClockInOutTable(dateKey, data);

    if (!data || !data.onLeaveMembers || data.onLeaveMembers.length === 0) {
        html += `<div class="bg-white p-4 rounded-lg shadow-sm text-center text-gray-500">해당 날짜의 근태 기록이 없습니다.</div>`;
        view.innerHTML = html;
        return;
    }

    const allMembers = [...new Set(data.onLeaveMembers.map(e => e.member))].sort();
    let leaveEntries = [...data.onLeaveMembers];
    
    const filterState = context.attendanceFilterState?.daily || {};
    const sortState = context.attendanceSortState?.daily || { key: 'member', dir: 'asc' };

    if (filterState.member) leaveEntries = leaveEntries.filter(e => e.member === filterState.member);
    if (filterState.type) leaveEntries = leaveEntries.filter(e => e.type === filterState.type);

    leaveEntries.sort((a, b) => {
        let valA = '', valB = '';
        if (sortState.key === 'member') { valA = a.member || ''; valB = b.member || ''; }
        else if (sortState.key === 'type') { valA = a.type || ''; valB = b.type || ''; }
        else if (sortState.key === 'time') { valA = a.startTime || a.startDate || ''; valB = b.startTime || b.startDate || ''; }
        
        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

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

const renderAggregatedAttendanceSummary = (viewElement, aggregationMap, periodKey, mode) => {
    const data = aggregationMap[periodKey];
    if (!data) {
        viewElement.innerHTML = `<div class="text-center text-gray-500">${periodKey} 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }

    const sortState = context.attendanceSortState?.[mode] || { key: 'member', dir: 'asc' };
    const filterState = context.attendanceFilterState?.[mode] || {};

    let summaryAll = [];
    const memberMap = {};
    const seenAttTypes = new Set();  // 실제 데이터에 등장한 근태 종류(옛 종류 포함)
    const allMemberSet = new Set(); 

    data.leaveEntries.forEach(entry => {
        const member = entry.member;
        allMemberSet.add(member); 

        if (!memberMap[member]) {
            memberMap[member] = {
                member: member,
                counts: ATT_COLS.reduce((acc, t) => { acc[t] = 0; return acc; }, {}),
                totalCount: 0,
                totalAbsenceDays: 0,
                totalLeaveDays: 0
            };
        }
        const rec = memberMap[member];
        const type = entry.type;
        if (type) seenAttTypes.add(type);
        if (rec.counts.hasOwnProperty(type)) {
            rec.counts[type] += 1;
        } else if (type) {
            rec.counts[type] = (rec.counts[type] || 0) + 1;
        }
        
        if (type !== '연차') {
            rec.totalCount += 1;
        }

        if (type === '결근') {
            rec.totalAbsenceDays += 1;
        } else if (type === '연차') {
            rec.totalLeaveDays += 1;
        }
    });
    
    summaryAll = Object.values(memberMap);
    let summary = [...summaryAll];

    const allMembers = [...allMemberSet].sort();

    // 💡 [신규] 다중 필터 적용 (각 헤더별로 선택된 필터가 있으면 모두 만족하는 행만 남김)
    Object.keys(filterState).forEach(fKey => {
        const fVal = filterState[fKey];
        if (!fVal) return;

        summary = summary.filter(item => {
            if (fKey === 'member') return item.member === fVal;

            let val = 0;
            if (['totalCount', 'totalAbsenceDays', 'totalLeaveDays'].includes(fKey)) {
                val = item[fKey];
            } else {
                val = item.counts[fKey] || 0;
            }
            return String(val) === String(fVal);
        });
    });

    // 정렬 적용
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

    // 💡 [신규] th 생성 함수 강화 (숫자 필드도 유니크 값들을 모아 select 옵션으로 제공)
    const th = (key, label, width='') => {
        let filterOptions = [];
        if (key === 'member') {
            filterOptions = allMembers;
        } else {
            const valSet = new Set();
            summaryAll.forEach(item => {
                let val = 0;
                if (['totalCount', 'totalAbsenceDays', 'totalLeaveDays'].includes(key)) {
                    val = item[key];
                } else {
                    val = item.counts[key] || 0;
                }
                valSet.add(val);
            });
            filterOptions = [...valSet].sort((a, b) => a - b).map(String);
        }

        return `
        <th scope="col" class="px-4 py-3 border-b cursor-pointer hover:bg-gray-200 select-none group ${width}" data-sort-target="${mode}" data-sort-key="${key}">
            <div class="flex items-center justify-center relative">
                <span class="flex items-center whitespace-nowrap">${label} ${getSortIcon(sortState.key, sortState.dir, key)}</span>
                ${getFilterDropdown(mode, key, filterState[key], filterOptions)}
            </div>
        </th>`;
    };

    // 데이터에 실제로 있는 종류까지 포함해 열을 구성한다(예전 '휴직' 기록 등이 숨지 않도록)
    const cols = attColsFor(seenAttTypes);
    let html = `
        <div class="bg-white p-4 rounded-lg shadow-sm mb-6 min-h-[400px]">
            <h3 class="text-xl font-bold mb-4 text-gray-800">${periodKey} 근태 요약</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-600 border border-gray-200">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                        <tr>
                            ${th('member', '이름', 'sticky left-0 bg-gray-100 z-10')}
                            ${cols.map(t => th(t, t)).join(' ')}
                            ${th('totalCount', '총 횟수')} ${th('totalAbsenceDays', '총 결근일')} ${th('totalLeaveDays', '총 연차일')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">`;

    if (summary.length === 0) {
         html += `<tr><td colspan="${cols.length + 4}" class="text-center py-8 text-gray-500">필터 조건에 맞는 데이터가 없습니다.</td></tr>`;
    } else {
        summary.forEach(item => {
            const cell = (k, color='text-gray-400') => `<td class="px-4 py-3 text-center ${item.counts[k]>0 ? 'text-gray-800 font-medium' : color}">${item.counts[k]||0}</td>`;
            html += `
                <tr class="bg-white hover:bg-gray-50">
                    <td class="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white shadow-sm">${item.member}</td>
                    ${cols.map(t => {
                        const v = item.counts[t] || 0;
                        if (t === '결근') return `<td class="px-4 py-3 text-center ${v>0?'text-red-600 font-bold':'text-gray-300'}">${v}</td>`;
                        if (t === '연차') return `<td class="px-4 py-3 text-center ${v>0?'text-blue-600 font-bold':'text-gray-300'}">${v}</td>`;
                        return cell(t, 'text-gray-300');
                    }).join('')}
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

export const renderAttendanceYearlyHistory = (selectedYearKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-yearly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">연간 근태 데이터 집계 중...</div>';

    const yearlyData = (allHistoryData || []).reduce((acc, day) => {
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string' || day.id.length < 4) return acc;
        try {
            const yearKey = day.id.substring(0, 4);
            if (!/^\d{4}$/.test(yearKey)) return acc;

            if (!acc[yearKey]) acc[yearKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => {
                if (entry && entry.type && entry.member) {
                    if (entry.startDate) {
                        const currentDate = day.id;
                        const startDate = entry.startDate;
                        const endDate = entry.endDate || entry.startDate;
                        if (currentDate >= startDate && currentDate <= endDate) {
                            acc[yearKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    } else {
                        acc[yearKey].leaveEntries.push({ ...entry, date: day.id });
                    }
                }
            });
            acc[yearKey].dateKeys.add(day.id);
        } catch (e) { console.error("Error processing day in attendance yearly aggregation:", day.id, e); }
        return acc;
    }, {});

    renderAggregatedAttendanceSummary(view, yearlyData, selectedYearKey, 'yearly');
};