// === js/weekend-ui.js ===
import * as State from './state.js';
import { store } from './weekend-store.js';
import { handleDateClick } from './weekend-core.js';
import { openAdminDatePopup, openPastDateEditPopup, handleAdminBadgeClick } from './weekend-admin.js';

// 🔥 법정 공휴일 데이터를 반환하는 헬퍼 함수 (달력 뷰에서만 사용)
export function getHolidayName(year, month, day) {
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const md = `${mm}-${dd}`;
    const ymd = `${year}-${mm}-${dd}`;

    const fixedHolidays = {
        '01-01': '신정', '03-01': '3·1절', '05-05': '어린이날', '06-06': '현충일',
        '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '기독탄신일(크리스마스)'
    };

    const variableHolidays = {
        '2024-02-09': '설날 연휴', '2024-02-10': '설날', '2024-02-11': '설날 연휴', '2024-02-12': '대체공휴일',
        '2024-04-10': '국회의원선거', '2024-05-06': '대체공휴일', '2024-05-15': '부처님오신날',
        '2024-09-16': '추석 연휴', '2024-09-17': '추석', '2024-09-18': '추석 연휴',
        '2025-01-28': '설날 연휴', '2025-01-29': '설날', '2025-01-30': '설날 연휴',
        '2025-03-03': '대체공휴일', '2025-05-05': '어린이날/부처님오신날', '2025-05-06': '대체공휴일',
        '2025-10-05': '추석 연휴', '2025-10-06': '추석', '2025-10-07': '추석 연휴', '2025-10-08': '대체공휴일',
        '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
        '2026-03-02': '대체공휴일', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
        '2026-06-03': '지방선거', '2026-08-16': '대체공휴일',
        '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-04': '대체공휴일', '2026-10-05': '대체공휴일'
    };

    if (variableHolidays[ymd]) return variableHolidays[ymd];
    if (fixedHolidays[md]) return fixedHolidays[md];
    return null;
}

export function renderWeekendStats(memberStats, yearlyStatsMap) {
    const sidebar = document.getElementById('weekend-stats-sidebar');
    const list = document.getElementById('weekend-stats-list');
    
    if (!sidebar || !list) return;

    const excludedMembers = ['박영철', '박호진', '유아라', '이승운'];
    
    const filteredMembers = [...memberStats.entries()].filter(([name, counts]) => !excludedMembers.includes(name));

    if (filteredMembers.length === 0) {
        sidebar.classList.add('!hidden');
        const toggleBtn = document.getElementById('toggle-weekend-stats-btn');
        if(toggleBtn) toggleBtn.classList.add('!hidden');
        return;
    } else {
        sidebar.classList.remove('!hidden');
        const toggleBtn = document.getElementById('toggle-weekend-stats-btn');
        if(toggleBtn) toggleBtn.classList.remove('!hidden');
    }

    list.innerHTML = '';

    filteredMembers.sort((a, b) => {
        const totalA = a[1].confirmed + a[1].requested;
        const totalB = b[1].confirmed + b[1].requested;
        if (totalB !== totalA) return totalB - totalA; 
        
        const yearlyA = yearlyStatsMap.get(a[0]) || 0;
        const yearlyB = yearlyStatsMap.get(b[0]) || 0;
        if (yearlyA !== yearlyB) return yearlyA - yearlyB;
        
        return a[0].localeCompare(b[0]);
    });

    filteredMembers.forEach(([name, counts]) => {
        const item = document.createElement('div');
        const opacityClass = (counts.confirmed === 0 && counts.requested === 0) ? "opacity-60 hover:opacity-100" : "";
        const yearlyCount = yearlyStatsMap.get(name) || 0;

        item.className = `bg-white border border-indigo-100 p-2 rounded-md shadow-sm flex justify-between items-center transition-all hover:-translate-y-0.5 ${opacityClass}`;
        
        item.innerHTML = `
            <div class="flex items-center">
                <span class="font-bold text-gray-700 text-sm whitespace-nowrap">${name}</span>
                <span class="text-[10px] text-gray-400 font-medium ml-1.5 whitespace-nowrap">(연누적 ${yearlyCount}회)</span>
            </div>
            <div class="text-xs bg-gray-50 px-2 py-1 rounded border border-gray-200 font-mono tracking-wider ml-2 flex-shrink-0">
                <span class="text-blue-600 font-bold w-4 inline-block text-center" title="확정됨">${counts.confirmed}</span><span class="text-gray-300">|</span><span class="text-orange-500 font-medium w-4 inline-block text-center" title="승인 대기">${counts.requested}</span>
            </div>
        `;
        list.appendChild(item);
    });
}

// 🌟 리스트 뷰 렌더링 함수 (공휴일 표시 제외)
export function renderWeekendList(year, month) {
    const listView = document.getElementById('weekend-list-view');
    const label = document.getElementById('current-month-label');
    
    if (!listView || !label) return;

    label.textContent = `${year}년 ${month + 1}월`;
    listView.innerHTML = '';

    const lastDate = new Date(year, month + 1, 0).getDate();
    let hasWeekend = false;
    const isAdmin = (State.appState.currentUserRole === 'admin');

    const bulkBar = document.getElementById('admin-bulk-action-bar');
    if (bulkBar && document.getElementById('weekend-list-view').classList.contains('hidden') === false) {
        if (isAdmin) {
            bulkBar.classList.remove('hidden');
            bulkBar.classList.add('flex');
        } else {
            bulkBar.classList.add('hidden');
            bulkBar.classList.remove('flex');
        }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();

        if (dayOfWeek === 0 || dayOfWeek === 6) {
            hasWeekend = true;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayName = dayOfWeek === 0 ? '일' : '토';
            
            const isBlocked = store.blockedDatesSet.has(dateStr);
            const isAppliedByMe = store.myRequestsMap.has(dateStr);
            const capacity = store.capacityMap.get(dateStr); 
            const isPast = dateObj < today;

            // 주말 색상만 적용 (공휴일 무시)
            let dayColor = dayOfWeek === 0 ? 'text-red-600' : 'text-blue-600';
            let bgColor = dayOfWeek === 0 ? 'bg-red-50' : 'bg-blue-50';

            const rowItem = document.createElement('div');
            rowItem.className = 'flex flex-row items-stretch gap-2 p-1.5 rounded-lg border shadow-sm hover:shadow-md transition-all mb-2';
            
            if (isPast || isBlocked) rowItem.classList.add('bg-gray-50', 'opacity-80', 'grayscale');
            else rowItem.classList.add('bg-white');

            rowItem.id = `row-${dateStr}`;

            if (isAdmin) {
                const chkWrapper = document.createElement('div');
                chkWrapper.className = 'flex items-center justify-center pl-2 pr-1';
                chkWrapper.onclick = (e) => e.stopPropagation();
                chkWrapper.innerHTML = `<input type="checkbox" class="date-select-checkbox w-4 h-4 cursor-pointer text-blue-600 border-gray-300 rounded" data-date="${dateStr}">`;
                rowItem.appendChild(chkWrapper);
            }

            const dateArea = document.createElement('div');
            dateArea.className = `w-[64px] md:w-[76px] flex-shrink-0 flex flex-col items-center justify-center rounded-md border overflow-hidden select-none`;
            
            if (isPast || isBlocked) {
                dateArea.classList.add('bg-gray-200', 'text-gray-500', 'border-gray-300');
            } else {
                dateArea.classList.add(bgColor, dayColor);
            }

            if (isAdmin && !isPast) {
                dateArea.classList.add('cursor-pointer', 'hover:opacity-80', 'hover:ring-2', 'hover:ring-indigo-300', 'transition-all');
                dateArea.title = "설정 변경";
                dateArea.onclick = () => openAdminDatePopup(dateStr);
            }
            
            // 공휴일 라벨 제외
            dateArea.innerHTML = `
                <span class="text-[17px] md:text-xl font-black tracking-tight mt-1 md:mt-2">${d}.${dayName}</span>
                ${capacity ? `<span class="mt-1 mb-1 md:mb-2 text-[9px] md:text-[10px] font-bold ${(isPast || isBlocked) ? 'bg-gray-300 text-gray-600 border-gray-400' : 'bg-emerald-100 text-emerald-700 border-emerald-200'} px-1.5 py-0.5 rounded border">정원 ${capacity}</span>` : '<span class="h-1 md:h-2"></span>'}
            `;

            const rightArea = document.createElement('div');
            rightArea.className = 'flex-1 flex flex-col justify-center rounded-md border p-2 transition-colors relative';
            const rightHeader = document.createElement('div');
            rightHeader.className = "flex justify-between items-center text-[10px] md:text-xs mb-1.5";

            if (isPast) {
                rightArea.classList.add('bg-gray-100', 'border-gray-300');
                if (isAdmin) {
                    rightArea.classList.add('cursor-pointer', 'hover:bg-gray-200');
                    rightArea.onclick = () => openPastDateEditPopup(dateStr);
                    rightHeader.innerHTML = `<span class="text-blue-600 font-bold">🛠️ 터치하여 인원 편집 (관리자)</span><span class="text-gray-600 font-bold bg-gray-200 px-1.5 rounded border border-gray-300">마감됨</span>`;
                } else {
                    rightArea.classList.add('cursor-not-allowed');
                    rightArea.onclick = () => showToast("지나간 주차는 관리자만 편집할 수 있습니다.", true);
                    rightHeader.innerHTML = `<span class="text-gray-500 font-bold">마감된 주차입니다.</span><span class="text-gray-500 font-bold bg-gray-200 px-1.5 rounded border border-gray-300">완료됨</span>`;
                }
            } else {
                if (isBlocked) {
                    rightArea.classList.add('bg-gray-100', 'border-gray-300', 'cursor-not-allowed');
                } else if (isAppliedByMe) {
                    rightArea.classList.add('bg-indigo-50', 'border-indigo-300', 'border-dashed', 'cursor-pointer');
                } else {
                    rightArea.classList.add('bg-white', 'border-gray-200', 'border-dashed', 'hover:bg-gray-50', 'cursor-pointer');
                }

                rightArea.onclick = () => handleDateClick(dateStr, isBlocked);
                rightHeader.innerHTML = `<span class="text-gray-500 font-medium">영역을 터치하여 신청/취소</span>${isBlocked ? '<span class="text-gray-600 font-bold bg-gray-200 border border-gray-300 px-1.5 rounded">마감됨</span>' : isAppliedByMe ? '<span class="text-indigo-600 font-bold bg-indigo-100 px-1.5 rounded">✅ 신청됨</span>' : ''}`;
            }

            const badgesArea = document.createElement('div');
            badgesArea.className = "flex flex-wrap gap-1.5 items-center justify-end";
            badgesArea.id = `weekend-list-${dateStr}`; 
            badgesArea.style.minHeight = "28px";

            rightArea.appendChild(rightHeader);
            rightArea.appendChild(badgesArea);

            rowItem.appendChild(dateArea);
            rowItem.appendChild(rightArea);
            listView.appendChild(rowItem);

            if (store.requestsByDate[dateStr]) {
                const adminMembers = ['박영철', '박호진', '유아라', '이승운'];
                
                store.requestsByDate[dateStr].sort((a, b) => {
                    if (a.status === 'canceled' && b.status !== 'canceled') return 1;
                    if (a.status !== 'canceled' && b.status === 'canceled') return -1;
                    
                    const aIsAdmin = adminMembers.includes(a.member);
                    const bIsAdmin = adminMembers.includes(b.member);
                    
                    if (aIsAdmin && !bIsAdmin) return 1;  
                    if (!aIsAdmin && bIsAdmin) return -1; 
                    
                    const timeA = a.createdAt || "";
                    const timeB = b.createdAt || "";
                    return timeA.localeCompare(timeB);
                });

                store.requestsByDate[dateStr].forEach(req => {
                    addBadgeToCalendar(dateStr, req, isAdmin && !isPast); 
                });
            }
        }
    }

    if (!hasWeekend) {
        listView.innerHTML = `<div class="text-center text-gray-400 py-10">이 달에는 주말이 없습니다.</div>`;
    }
}


// 🌟 달력 뷰(Grid) 렌더링 함수 (공휴일 표시 유지)
export function renderWeekendGrid(year, month) {
    const gridView = document.getElementById('calendar-grid');
    const label = document.getElementById('current-month-label');
    
    if (!gridView || !label) return;

    label.textContent = `${year}년 ${month + 1}월`;
    gridView.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay(); 
    const lastDate = new Date(year, month + 1, 0).getDate(); 
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isAdmin = (State.appState.currentUserRole === 'admin');

    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = "bg-transparent p-1";
        gridView.appendChild(emptyCell);
    }

    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        
        const holidayName = getHolidayName(year, month + 1, d); 

        const cell = document.createElement('div');
        cell.className = "flex flex-col border rounded-md p-1 min-h-[80px] md:min-h-[100px] overflow-hidden transition-all bg-white relative";
        
        let headerColorClass = "text-gray-700";
        if (dayOfWeek === 0 || holidayName) headerColorClass = "text-red-600";
        else if (dayOfWeek === 6) headerColorClass = "text-blue-600";

        if (dayOfWeek === 0 || dayOfWeek === 6) {
            const isBlocked = store.blockedDatesSet.has(dateStr);
            const isAppliedByMe = store.myRequestsMap.has(dateStr);
            const capacity = store.capacityMap.get(dateStr); 
            const isPast = dateObj < today;

            if (isPast || isBlocked) {
                cell.classList.add('bg-gray-50', 'opacity-80', 'grayscale', 'border-gray-200');
            } else if (isAppliedByMe) {
                cell.classList.add('bg-indigo-50', 'border-indigo-300', 'border-dashed');
            } else {
                cell.classList.add('hover:bg-blue-50', 'cursor-pointer', 'border-blue-100');
            }

            if (!isPast) {
                cell.onclick = () => handleDateClick(dateStr, isBlocked);
            } else if (isAdmin) {
                cell.onclick = () => openPastDateEditPopup(dateStr);
                cell.classList.add('cursor-pointer', 'hover:bg-gray-200');
            } else {
                cell.onclick = () => showToast("지나간 주차는 관리자만 편집할 수 있습니다.", true);
            }

            let headerHtml = `<div class="flex justify-between items-start mb-1">
                                <div class="flex flex-col">
                                    <span class="font-bold text-xs md:text-sm ${headerColorClass}">${d}</span>
                                    ${holidayName ? `<span class="text-[9px] md:text-[10px] text-red-500 font-bold tracking-tighter leading-none mt-0.5 break-keep">${holidayName}</span>` : ''}
                                </div>
                                <div class="flex flex-col items-end gap-1">`;

            if (capacity) {
                headerHtml += `<span class="text-[8px] md:text-[9px] font-bold px-1 py-0.5 rounded border ${(isPast || isBlocked) ? 'bg-gray-200 text-gray-500 border-gray-300' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}">정원 ${capacity}</span>`;
            } 
            if (isAdmin && !isPast) {
                headerHtml += `<button title="날짜 설정" class="text-gray-400 hover:text-indigo-600 transition p-0.5 ml-auto" onclick="event.stopPropagation(); window.openAdminDatePopup('${dateStr}');">
                                 <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                               </button>`;
                window.openAdminDatePopup = openAdminDatePopup; 
            }

            headerHtml += `</div></div>`;
            
            let badgesHtml = `<div class="flex flex-col gap-0.5" id="grid-list-${dateStr}"></div>`;
            cell.innerHTML = headerHtml + badgesHtml;

            setTimeout(() => {
                if (store.requestsByDate[dateStr]) {
                    const adminMembers = ['박영철', '박호진', '유아라', '이승운'];
                    store.requestsByDate[dateStr].sort((a, b) => {
                        if (a.status === 'canceled' && b.status !== 'canceled') return 1;
                        if (a.status !== 'canceled' && b.status === 'canceled') return -1;
                        const aIsAdmin = adminMembers.includes(a.member);
                        const bIsAdmin = adminMembers.includes(b.member);
                        if (aIsAdmin && !bIsAdmin) return 1;  
                        if (!aIsAdmin && bIsAdmin) return -1; 
                        return (a.createdAt || "").localeCompare(b.createdAt || "");
                    });

                    store.requestsByDate[dateStr].forEach(req => {
                        addBadgeToGrid(dateStr, req, isAdmin && !isPast); 
                    });
                }
            }, 0);

        } else {
            // 평일
            if (holidayName) {
                cell.classList.add('bg-red-50/20', 'border-red-100');
                cell.innerHTML = `<div class="flex flex-col p-1">
                                    <span class="font-bold text-xs md:text-sm text-red-500">${d}</span>
                                    <span class="text-[9px] md:text-[10px] text-red-400 font-bold leading-tight mt-0.5 break-keep">${holidayName}</span>
                                  </div>`;
            } else {
                cell.classList.add('bg-gray-50', 'border-gray-100');
                cell.innerHTML = `<span class="font-medium text-xs md:text-sm text-gray-400 p-1">${d}</span>`;
            }
        }

        gridView.appendChild(cell);
    }
}

// 캘린더용 초소형 뱃지 생성기
function addBadgeToGrid(dateStr, data, isClickableAdmin) {
    const container = document.getElementById(`grid-list-${dateStr}`);
    if (!container) return;

    const badge = document.createElement('div');
    
    let colorClass = '';

    if (data.status === 'confirmed') {
        colorClass = 'bg-blue-600 text-white';
    } else if (data.status === 'canceled') {
        colorClass = 'bg-yellow-100 text-yellow-700 opacity-70 line-through';
    } else {
        colorClass = 'bg-white text-orange-600 border border-orange-200';
    }
    
    badge.className = `px-1 py-0.5 rounded text-[10px] md:text-[11px] font-medium truncate w-full text-center shadow-sm ${colorClass}`;
    badge.textContent = data.member;
    badge.title = data.status === 'confirmed' ? '확정' : (data.status === 'canceled' ? '취소' : '대기중');

    if (isClickableAdmin) {
        badge.style.cursor = 'pointer';
        badge.onclick = (e) => {
            e.stopPropagation(); 
            handleAdminBadgeClick(data.id, data);
        };
    } else {
        badge.onclick = (e) => e.stopPropagation(); 
    }

    container.appendChild(badge);
}

// 기존 리스트 뷰용 뱃지 생성기
export function addBadgeToCalendar(dateStr, data, isClickableAdmin) {
    const container = document.getElementById(`weekend-list-${dateStr}`);
    if (!container) return;

    const badge = document.createElement('div');
    
    let colorClass = '';
    let icon = '';

    if (data.status === 'confirmed') {
        colorClass = 'bg-blue-600 text-white border-blue-600 shadow-sm';
        icon = '👌';
    } else if (data.status === 'canceled') {
        colorClass = 'bg-yellow-100 text-yellow-700 border-yellow-400 shadow-sm opacity-80 line-through';
        icon = '❌';
    } else {
        colorClass = 'bg-white text-orange-600 border-orange-300 border shadow-sm';
        icon = '⏳';
    }
    
    badge.className = `px-2.5 md:px-3 py-0.5 md:py-1 rounded-full text-[11px] md:text-sm font-medium border flex items-center gap-1 transition-transform hover:scale-105 ${colorClass}`;
    badge.innerHTML = `<span class="text-[10px] md:text-xs">${icon}</span> ${data.member}`;

    if (isClickableAdmin) {
        badge.style.cursor = 'pointer';
        badge.onclick = (e) => {
            e.stopPropagation(); 
            handleAdminBadgeClick(data.id, data);
        };
    } else {
        badge.onclick = (e) => e.stopPropagation(); 
    }

    container.appendChild(badge);
}