// === js/ui-modals.js ===

import { appState, appConfig, persistentLeaveSchedule } from './state.js';
import { calculateDateDifference, getTodayDateString } from './utils.js';

// 근속연수 계산 헬퍼 함수 (#년 #개월 #일째)
const calculateTenure = (joinDateStr) => {
    if (!joinDateStr || joinDateStr === '-') return '';
    
    const start = new Date(joinDateStr);
    const now = new Date();
    
    if (start > now) return '입사 예정';

    let years = now.getFullYear() - start.getFullYear();
    let months = now.getMonth() - start.getMonth();
    let days = now.getDate() - start.getDate();

    if (days < 0) {
        months--;
        const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += prevMonth.getDate();
    }

    if (months < 0) {
        years--;
        months += 12;
    }

    // "일째" 표현을 위해 +1
    return `${years}년 ${months}개월 ${days + 1}일째`;
};

// [신규] 근무 개월 수 계산 헬퍼
const calculateMonthsWorked = (joinDateStr) => {
    if (!joinDateStr || joinDateStr === '-') return 0;
    const start = new Date(joinDateStr);
    const now = new Date();
    
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    // 입사일(일자)이 지나지 않았으면 1개월 차감 (만근 기준)
    if (now.getDate() < start.getDate()) {
        months--;
    }
    return Math.max(0, months);
};

// 연차 사용 내역 계산 & 자동 병합 로직 (초기화 기준일 적용 + 자동 발생 로직)
const calculateLeaveUsage = (memberName) => {
    const leaveSettings = (appConfig.memberLeaveSettings && appConfig.memberLeaveSettings[memberName]) || { totalLeave: 15, joinDate: '-', leaveResetDate: '', expirationDate: '' };
    let totalLeave = leaveSettings.totalLeave;
    const joinDate = leaveSettings.joinDate;
    const leaveResetDate = leaveSettings.leaveResetDate; // 적용 시작일
    const expirationDate = leaveSettings.expirationDate; // 만료일

    let isAutoCalculated = false;

    // ✅ [수정] 우선순위 로직 적용
    // 1순위: 관리자가 '적용 시작일(leaveResetDate)'을 직접 설정한 경우 -> 자동 계산 무시하고 설정값(totalLeave) 우선 사용
    if (leaveResetDate && leaveResetDate !== '') {
        isAutoCalculated = false;
        // totalLeave는 leaveSettings.totalLeave 그대로 유지
    } 
    // 2순위: 입사일이 있고, 12개월 미만 근속자인 경우 -> 근무 개월 수만큼 연차 자동 부여
    else if (joinDate && joinDate !== '-') {
        const monthsWorked = calculateMonthsWorked(joinDate);
        if (monthsWorked < 12) { // 13개월 -> 12개월로 변경됨
            totalLeave = monthsWorked; // 1개월 만근 시 1개, 2개월 시 2개...
            isAutoCalculated = true;
        }
        // 12개월 이상인 경우: 관리자가 설정한 totalLeave(기본값 등) 유지
    }

    // 1. 해당 멤버의 '연차' 기록 필터링 & 날짜순 정렬
    // leaveResetDate(초기화 기준일)가 설정되어 있으면 그 이후의 기록만 가져옴
    const rawHistory = (persistentLeaveSchedule.onLeaveMembers || [])
        .filter(item => {
            if (item.member !== memberName || item.type !== '연차') return false;
            // 초기화 기준일 적용
            if (leaveResetDate && item.startDate < leaveResetDate) return false;
            return true;
        })
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    // 2. 중복/연속된 날짜 병합 (Merge Intervals)
    const mergedHistory = [];
    if (rawHistory.length > 0) {
        // 첫 번째 기록으로 초기화
        let current = {
            ...rawHistory[0],
            startDate: rawHistory[0].startDate,
            endDate: rawHistory[0].endDate || rawHistory[0].startDate,
            ids: [rawHistory[0].id] // 원본 ID들을 배열로 관리 (삭제 시 사용)
        };
        
        // 날짜 비교를 위한 Date 객체 생성
        let currentEndObj = new Date(current.endDate);

        for (let i = 1; i < rawHistory.length; i++) {
            const next = rawHistory[i];
            const nextStartObj = new Date(next.startDate);
            const nextEndObj = new Date(next.endDate || next.startDate);
            
            // '현재 구간의 끝 + 1일' 계산 (연속된 날짜 판별용)
            const dayAfterCurrentEnd = new Date(currentEndObj);
            dayAfterCurrentEnd.setDate(dayAfterCurrentEnd.getDate() + 1);

            // 겹치거나(Overlap) 바로 이어지는(Adjacent) 경우 병합
            if (nextStartObj <= dayAfterCurrentEnd) {
                // 종료일 연장 (더 늦은 날짜로)
                if (nextEndObj > currentEndObj) {
                    currentEndObj = nextEndObj;
                    current.endDate = next.endDate || next.startDate;
                }
                // ID 병합
                current.ids.push(next.id);
            } else {
                // 끊기면 현재 구간 저장 후 새로 시작
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

    // 3. 차수(Nth) 및 총 사용일 계산
    let realUsedCount = 0;
    let cumulativeDays = 0;

    const finalHistory = mergedHistory.map((item) => {
        const days = calculateDateDifference(item.startDate, item.endDate);
        realUsedCount += days;
        
        const startNth = cumulativeDays + 1;
        const endNth = cumulativeDays + days;
        cumulativeDays += days;

        // 1일이면 "1", 2일 이상이면 "1~3" 형태로 표시
        const nthStr = (days > 1) ? `${startNth}~${endNth}` : `${startNth}`;

        return {
            ...item,
            days,
            nth: nthStr,
            isMerged: item.ids.length > 1 // 병합된 기록인지 여부
        };
    });

    return {
        total: totalLeave,
        used: realUsedCount,
        remaining: totalLeave - realUsedCount,
        joinDate: joinDate,
        leaveResetDate: leaveResetDate, // 반환
        expirationDate: expirationDate, // 반환
        isAutoCalculated: isAutoCalculated, // ✅ 자동 계산 여부 반환
        history: finalHistory.reverse() // 최신순 정렬
    };
};

export const renderQuantityModalInputs = (sourceQuantities = {}, quantityTaskTypes = [], missingTasksList = [], confirmedZeroTasks = []) => {
    const container = document.getElementById('modal-task-quantity-inputs');
    if (!container) return;
    container.innerHTML = '';

    const missingTaskSet = new Set(missingTasksList);
    const confirmedZeroSet = new Set(confirmedZeroTasks);

    quantityTaskTypes.forEach(task => {
        const div = document.createElement('div');
        const isConfirmed = confirmedZeroSet.has(task);
        const isMissing = missingTaskSet.has(task) && !isConfirmed;
        const warningClass = isMissing ? 'warning-missing-quantity' : '';

        div.innerHTML = `
            <div class="flex justify-between items-end mb-1">
                <label for="modal-quantity-${task}" class="block text-sm font-medium text-gray-700 ${isMissing ? 'text-yellow-700 font-bold' : ''}">
                    ${task} ${isMissing ? '(누락됨)' : ''}
                </label>
                 <div class="flex items-center">
                    <input type="checkbox" id="modal-confirm-zero-${task}" data-task="${task}"
                           class="confirm-zero-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 transition"
                           ${isConfirmed ? 'checked' : ''}>
                    <label for="modal-confirm-zero-${task}" class="ml-1 text-xs text-gray-500 cursor-pointer select-none">0건 확인</label>
                </div>
            </div>
            <input type="number" id="modal-quantity-${task}" data-task="${task}" value="${sourceQuantities[task] || 0}" min="0"
                   class="mt-1 w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500 transition ${warningClass}">
        `;
        container.appendChild(div);
    });

    container.querySelectorAll('.confirm-zero-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const task = e.target.dataset.task;
            const input = container.querySelector(`#modal-quantity-${task}`);
            const label = container.querySelector(`label[for="modal-quantity-${task}"]`);

            if (e.target.checked) {
                input.classList.remove('warning-missing-quantity');
                label.classList.remove('text-yellow-700', 'font-bold');
                label.textContent = task;
            } else {
                if (Number(input.value) <= 0 && missingTaskSet.has(task)) {
                     input.classList.add('warning-missing-quantity');
                     label.classList.add('text-yellow-700', 'font-bold');
                     if (!label.textContent.includes('(누락됨)')) {
                         label.textContent = `${task} (누락됨)`;
                     }
                }
            }
        });
    });
};

export const renderTaskSelectionModal = (taskGroups = []) => {
    const container = document.getElementById('task-modal-content');
    if (!container) return;
    container.innerHTML = '';

    taskGroups.forEach((group) => {
        const groupName = group.name;
        const tasks = group.tasks || [];

        const groupDiv = document.createElement('div');
        groupDiv.className = 'flex-1';

        let tasksHtml = tasks.map(task => `<button type="button" data-task="${task}" class="task-select-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:ring-2 focus:ring-blue-300">${task}</button>`).join('');

        groupDiv.innerHTML = `
            <div class="bg-gray-50 rounded-lg border">
                <h3 class="text-lg font-bold text-gray-800 mb-0 p-3 border-b bg-gray-100 rounded-t-lg">${groupName}</h3>
                <div class="p-3 grid grid-cols-1 gap-2">${tasksHtml}</div>
            </div>
        `;
        container.appendChild(groupDiv);
    });
};

export const renderTeamSelectionModalContent = (task, appState, teamGroups = []) => {
    const titleEl = document.getElementById('team-select-modal-title');
    const container = document.getElementById('team-select-modal-content');
    if (!titleEl || !container) return;

    titleEl.textContent = `'${task || '기타 업무'}' 팀원 선택`;
    container.innerHTML = '';

    const ongoingMembers = new Set(
        (appState.workRecords || []).filter(r => r.status === 'ongoing').map(r => r.member)
    );
    const pausedMembers = new Set(
        (appState.workRecords || []).filter(r => r.status === 'paused').map(r => r.member)
    );

    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];

    const onLeaveMemberMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime))
            .map(item => [item.member, item])
    );

    const baseClasses = "member-select-btn w-full p-2 rounded-lg border-2 text-center transition-all duration-200 min-h-[50px] flex flex-col justify-center";
    const disabledClasses = "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-60";
    const unselectedClasses = "bg-white border-gray-300 text-gray-900 hover:bg-blue-50 hover:border-blue-300";

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'),
        teamGroups.find(g => g.name === '공통파트'),
        teamGroups.find(g => g.name === '담당파트'),
        teamGroups.find(g => g.name === '제작파트'),
    ].filter(Boolean);

    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'flex-shrink-0 w-48 bg-gray-100 rounded-lg flex flex-col';
        groupContainer.innerHTML = `
            <div class="flex justify-between items-center p-2 border-b border-gray-200">
                <h4 class="text-md font-bold text-gray-800">${group.name}</h4>
                <button type="button" class="group-select-all-btn text-xs bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-2 py-1 rounded shadow-sm transition-all" data-group-name="${group.name}">전체</button>
            </div>`;

        const memberList = document.createElement('div');
        memberList.className = 'space-y-2 flex-grow overflow-y-auto p-2';
        memberList.dataset.groupName = group.name;

        [...new Set(group.members)].forEach(member => {
            const isOngoing = ongoingMembers.has(member);
            const isPaused = pausedMembers.has(member);
            const leaveEntry = onLeaveMemberMap.get(member);
            const isOnLeave = !!leaveEntry;
            
            const attendance = appState.dailyAttendance?.[member];
            const isClockedIn = attendance && attendance.status === 'active';
            const isReturned = attendance && attendance.status === 'returned';

            const isDisabled = isOngoing || isPaused || isOnLeave || !isClockedIn;

            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.memberName = member;
            card.className = `${baseClasses} ${isDisabled ? disabledClasses : unselectedClasses}`;
            if (isDisabled) card.disabled = true;

            let statusLabel = '';
            if (isOngoing) { statusLabel = '<div class="text-xs text-red-400 font-medium">업무 중</div>'; }
            else if (isPaused) { statusLabel = '<div class="text-xs text-yellow-600 font-medium">휴식 중</div>'; }
            else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500 font-medium">${leaveEntry.type} 중</div>`; }
            else if (isReturned) { statusLabel = '<div class="text-xs text-gray-400 font-medium">퇴근 완료</div>'; }
            else if (!isClockedIn) { statusLabel = '<div class="text-xs text-gray-400 font-medium">출근 전</div>'; }
            
            card.innerHTML = `<div class="font-bold">${member}</div>${statusLabel}`;

            memberList.appendChild(card);
        });
        groupContainer.appendChild(memberList);
        container.appendChild(groupContainer);
    });

    const albaGroupContainer = document.createElement('div');
    albaGroupContainer.className = 'flex-shrink-0 w-48 bg-gray-100 rounded-lg flex flex-col';
    albaGroupContainer.innerHTML = `<div class="flex justify-between items-center p-2 border-b border-gray-200">
                                         <h4 class="text-md font-bold text-gray-800">알바</h4>
                                         <div>
                                             <button type="button" class="group-select-all-btn text-xs bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-2 py-1 rounded shadow-sm transition-all" data-group-name="알바">전체</button>
                                             <button id="add-part-timer-modal-btn" class="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded ml-1 transition-all">+ 추가</button>
                                         </div>
                                    </div>`;
    const albaMemberList = document.createElement('div');
    albaMemberList.className = 'space-y-2 flex-grow overflow-y-auto p-2';
    albaMemberList.dataset.groupName = '알바';

    (appState.partTimers || []).forEach(pt => {
        const isOngoing = ongoingMembers.has(pt.name);
        const isPaused = pausedMembers.has(pt.name);
        const leaveEntry = onLeaveMemberMap.get(pt.name);
        const isOnLeave = !!leaveEntry;

        const attendance = appState.dailyAttendance?.[pt.name];
        const isClockedIn = attendance && attendance.status === 'active';
        const isReturned = attendance && attendance.status === 'returned';
        const isDisabled = isOngoing || isPaused || isOnLeave || !isClockedIn;

        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'relative';

        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.memberName = pt.name;
        card.className = `${baseClasses} ${isDisabled ? disabledClasses : unselectedClasses}`;
        if (isDisabled) card.disabled = true;

        let statusLabel = '';
        if (isOngoing) { statusLabel = '<div class="text-xs text-red-400 font-medium">업무 중</div>'; }
        else if (isPaused) { statusLabel = '<div class="text-xs text-yellow-600 font-medium">휴식 중</div>'; }
        else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500 font-medium">${leaveEntry.type} 중</div>`; }
        else if (isReturned) { statusLabel = '<div class="text-xs text-gray-400 font-medium">퇴근 완료</div>'; }
        else if (!isClockedIn) { statusLabel = '<div class="text-xs text-gray-400 font-medium">출근 전</div>'; }

        card.innerHTML = `<div class="font-bold">${pt.name}</div>${statusLabel}`;

        cardWrapper.appendChild(card);

        const editBtn = document.createElement('button');
        editBtn.dataset.partTimerId = pt.id;
        editBtn.className = 'edit-part-timer-btn absolute top-1 right-6 p-1 text-gray-400 hover:text-blue-600 transition-colors';
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L13.196 5.2z" /></svg>`;
        cardWrapper.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.dataset.partTimerId = pt.id;
        deleteBtn.className = 'delete-part-timer-btn absolute top-1 right-1 p-1 text-gray-400 hover:text-red-600 transition-colors';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;
        cardWrapper.appendChild(deleteBtn);

        albaMemberList.appendChild(cardWrapper);
    });

    albaGroupContainer.appendChild(albaMemberList);
    container.appendChild(albaGroupContainer);
};

export const renderLeaveTypeModalOptions = (leaveTypes = [], initialTab = 'setting') => {
    const container = document.getElementById('leave-type-options');
    const dateInputsDiv = document.getElementById('leave-date-inputs');
    const confirmBtn = document.getElementById('confirm-leave-btn');
    
    const tabSetting = document.getElementById('tab-leave-setting');
    const tabStatus = document.getElementById('tab-leave-status');
    const panelSetting = document.getElementById('panel-leave-setting');
    const panelStatus = document.getElementById('panel-leave-status');
    const memberNameEl = document.getElementById('leave-member-name');
    
    if (!container || !dateInputsDiv) return;

    const memberName = memberNameEl ? memberNameEl.textContent : '';

    // --- 현황판 데이터 업데이트 함수 ---
    const updateStatusView = () => {
        const stats = calculateLeaveUsage(memberName);
        const today = getTodayDateString();
        
        const totalEl = document.getElementById('status-total-days');
        const usedEl = document.getElementById('status-used-days');
        const remainEl = document.getElementById('status-remaining-days');
        const joinDateEl = document.getElementById('status-join-date');
        const historyListEl = document.getElementById('status-history-list');

        if (totalEl) {
            // ✅ [신규] 자동 계산 여부 표시
            const autoCalcBadge = stats.isAutoCalculated ? '<span class="text-xs text-blue-500 block font-normal">(12개월 미만 자동 계산)</span>' : '';
            totalEl.innerHTML = `${stats.total}일 ${autoCalcBadge}`;
        }
        if (usedEl) usedEl.textContent = `${stats.used}일`;
        
        if (remainEl) {
            remainEl.className = stats.remaining < 0 ? "text-3xl font-bold text-red-600" : "text-3xl font-bold text-blue-600";
            
            // 사용 가능 기한 표시 (잔여 연차 하단에 작게)
            let periodHtml = '';
            if (stats.leaveResetDate || stats.expirationDate) {
                const start = stats.leaveResetDate || '';
                const end = stats.expirationDate || '';
                const rangeStr = (start && end) ? `${start} ~ ${end}` : (start ? `${start} ~` : `~ ${end}`);
                
                const isExpired = stats.expirationDate && today > stats.expirationDate;
                const expiredBadge = isExpired ? '<span class="text-red-500 font-bold ml-1">(만료됨)</span>' : '';
                
                periodHtml = `<div class="text-xs text-gray-500 font-normal mt-1">사용 가능 기한: ${rangeStr}${expiredBadge}</div>`;
            }
            
            remainEl.innerHTML = `<div>${stats.remaining}일</div>${periodHtml}`;
        }
        
        if (joinDateEl) {
            const tenureText = calculateTenure(stats.joinDate);
            let dateText = stats.joinDate && stats.joinDate !== '-' ? stats.joinDate : '-';
            
            // 하단에 표시되던 시작일/만료일 제거됨
            joinDateEl.innerHTML = `${dateText} <span class="text-blue-600 font-bold ml-1">(${tenureText})</span>`;
        }

        if (historyListEl) {
            historyListEl.innerHTML = '';
            if (stats.history.length === 0) {
                historyListEl.innerHTML = '<li class="text-center text-gray-400 py-4">사용 내역이 없습니다.</li>';
            } else {
                stats.history.forEach(h => {
                    const idsString = h.ids.join(',');
                    const mergedBadge = h.isMerged ? '<span class="text-[9px] text-purple-600 bg-purple-50 border border-purple-200 px-1 rounded ml-1">병합됨</span>' : '';
                    const editBtnHtml = h.isMerged ? '' : `<button type="button" class="text-xs text-gray-400 hover:text-blue-600 underline transition btn-edit-leave-history" data-id="${h.ids[0]}" data-member="${h.member}">수정</button>`;

                    historyListEl.innerHTML += `
                        <li class="flex justify-between items-center bg-white p-2 rounded border border-gray-100 shadow-sm">
                            <div>
                                <span class="font-semibold text-gray-700 text-xs block flex items-center">
                                    <span class="text-blue-500 mr-1">[${h.nth}차]</span> ${h.startDate} ${h.endDate && h.endDate !== h.startDate ? '~ ' + h.endDate.slice(5) : ''}
                                    ${mergedBadge}
                                </span>
                                <span class="text-[10px] text-gray-400">-${h.days}일 차감</span>
                            </div>
                            <div class="flex items-center gap-2">
                                ${editBtnHtml}
                                <button type="button" class="text-xs text-gray-400 hover:text-red-600 underline transition btn-delete-leave-history" data-ids="${idsString}" data-member="${h.member}">삭제</button>
                            </div>
                        </li>`;
                });
            }
        }
    };

    const activateTab = (tab) => {
        if (tab === 'status') {
            tabStatus.className = "flex-1 py-3 text-sm font-semibold text-blue-600 border-b-2 border-blue-600 transition";
            tabSetting.className = "flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition";
            panelStatus.classList.remove('hidden');
            panelSetting.classList.add('hidden');
            if(confirmBtn) confirmBtn.classList.add('hidden'); 
            updateStatusView();
        } else {
            tabSetting.className = "flex-1 py-3 text-sm font-semibold text-blue-600 border-b-2 border-blue-600 transition";
            tabStatus.className = "flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition";
            panelSetting.classList.remove('hidden');
            panelStatus.classList.add('hidden');
            if(confirmBtn) {
                confirmBtn.classList.remove('hidden');
                confirmBtn.textContent = '설정 저장';
                delete confirmBtn.dataset.editingId;
                const sInput = document.getElementById('leave-start-date-input');
                const eInput = document.getElementById('leave-end-date-input');
                if(sInput) sInput.value = '';
                if(eInput) eInput.value = '';
                document.querySelectorAll('input[name="leave-type"]').forEach((r,i) => r.checked = i===0);
            }
        }
    };

    if (tabSetting) tabSetting.onclick = () => activateTab('setting');
    if (tabStatus) tabStatus.onclick = () => activateTab('status');

    activateTab(initialTab);

    container.innerHTML = '';
    leaveTypes.forEach((type, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center';
        div.innerHTML = `
            <input id="leave-type-${index}" name="leave-type" type="radio" value="${type}" class="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 leave-type-radio">
            <label for="leave-type-${index}" class="ml-2 block text-sm font-medium text-gray-700">${type}</label>
        `;
        container.appendChild(div);
    });

    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('leave-type-radio')) {
            const selectedType = e.target.value;
            if (selectedType === '연차' || selectedType === '출장' || selectedType === '결근') {
                dateInputsDiv.classList.remove('hidden');
            } else {
                dateInputsDiv.classList.add('hidden');
            }
        }
    });

    const firstRadio = container.querySelector('input[type="radio"]');
    if (firstRadio) {
        firstRadio.checked = true;
        if (firstRadio.value === '연차' || firstRadio.value === '출장' || firstRadio.value === '결근') {
            dateInputsDiv.classList.remove('hidden');
        } else {
            dateInputsDiv.classList.add('hidden');
        }
    }

    const sInput = document.getElementById('leave-start-date-input');
    const eInput = document.getElementById('leave-end-date-input');
    const preview = document.getElementById('leave-count-preview');
    
    const updatePreview = () => {
        if (!preview) return;
        if (sInput.value && eInput.value) {
            const diff = calculateDateDifference(sInput.value, eInput.value);
            preview.textContent = `총 ${diff}일 차감 예정`;
        } else if (sInput.value) {
            preview.textContent = `1일 차감 예정`;
        } else {
            preview.textContent = '';
        }
    };
    if (sInput) sInput.addEventListener('change', updatePreview);
    if (eInput) eInput.addEventListener('change', updatePreview);
};

export const renderManualAddModalDatalists = (appState, appConfig) => {
    const memberDatalist = document.getElementById('manual-add-member-list');
    const taskDatalist = document.getElementById('manual-add-task-list');

    if (!memberDatalist || !taskDatalist) return;

    memberDatalist.innerHTML = '';
    const staffMembers = (appConfig.teamGroups || []).flatMap(g => g.members);
    const partTimerMembers = (appState.partTimers || []).map(p => p.name);

    const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();

    allMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        memberDatalist.appendChild(option);
    });

    taskDatalist.innerHTML = '';
    const allTasks = [...new Set((appConfig.taskGroups || []).flatMap(group => group.tasks))].sort();

    allTasks.forEach(task => {
        const option = document.createElement('option');
        option.value = task;
        taskDatalist.appendChild(option);
    });
};