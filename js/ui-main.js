// === js/ui-main.js ===

import { formatTimeTo24H, formatDuration, calcElapsedMinutes, getCurrentTime, isWeekday, calculateDateDifference, calcTotalPauseMinutes } from './utils.js';
import { getAllDashboardDefinitions, taskCardStyles, taskTitleColors } from './ui.js';

// State 전체 임포트
import * as State from './state.js';

/**
 * 연차 표시 라벨 생성 헬퍼 (예: "연차1" or "연차1-3")
 * ✅ [수정] 모달과 동일한 '병합(Merge)' 로직을 적용하여 차수(Nth) 불일치 해결
 */
const getLeaveDisplayLabel = (member, leaveEntry) => {
    if (leaveEntry.type !== '연차') return leaveEntry.type;

    // 1. 해당 멤버의 연차 설정 가져오기 (초기화 기준일 확인)
    const settings = State.appConfig.memberLeaveSettings?.[member] || {};
    const resetDate = settings.leaveResetDate;

    // 2. 초기화 기준일 이후의 '연차' 기록만 필터링 & 날짜순 정렬
    const rawHistory = (State.persistentLeaveSchedule.onLeaveMembers || [])
        .filter(l => {
            if (l.member !== member || l.type !== '연차') return false;
            if (resetDate && l.startDate < resetDate) return false;
            return true;
        })
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    if (rawHistory.length === 0) return '연차';

    // 3. 중복/연속된 날짜 병합 (ui-modals.js와 동일 로직)
    const mergedHistory = [];
    if (rawHistory.length > 0) {
        let current = {
            ...rawHistory[0],
            startDate: rawHistory[0].startDate,
            endDate: rawHistory[0].endDate || rawHistory[0].startDate,
            ids: [rawHistory[0].id] // ID들을 배열로 수집
        };
        
        let currentEndObj = new Date(current.endDate);

        for (let i = 1; i < rawHistory.length; i++) {
            const next = rawHistory[i];
            const nextStartObj = new Date(next.startDate);
            const nextEndObj = new Date(next.endDate || next.startDate);
            
            // '현재 구간의 끝 + 1일' (연속된 날짜 판별용)
            const dayAfterCurrentEnd = new Date(currentEndObj);
            dayAfterCurrentEnd.setDate(dayAfterCurrentEnd.getDate() + 1);

            // 겹치거나(Overlap) 바로 이어지는(Adjacent) 경우 병합
            if (nextStartObj <= dayAfterCurrentEnd) {
                // 종료일 연장
                if (nextEndObj > currentEndObj) {
                    currentEndObj = nextEndObj;
                    current.endDate = next.endDate || next.startDate;
                }
                // ID 병합
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

    // 4. 병합된 리스트를 순회하며 현재 leaveEntry가 속한 구간 찾기
    let cumulativeDays = 0;
    
    for (const block of mergedHistory) {
        const days = calculateDateDifference(block.startDate, block.endDate);
        const startNth = cumulativeDays + 1;
        const endNth = cumulativeDays + days;
        cumulativeDays += days;

        // ID가 포함되어 있거나, 날짜가 겹치는지 확인
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
    
    // 매칭되지 않는 경우 (초기화일 이전 등)
    return '연차';
};

export const renderDashboardLayout = (appConfig) => {
    const container = document.getElementById('summary-content');
    if (!container) return;

    const itemIds = appConfig.dashboardItems || [];
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    container.innerHTML = '';
    let html = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) return;

        const isQuantity = def.isQuantity === true;
        const valueContent = `<p id="${def.valueId}">0</p>`;

        html += `
            <div class="dashboard-card p-4 rounded-lg ${isQuantity ? 'dashboard-card-quantity' : ''}">
                <h4 class="text-sm font-bold uppercase tracking-wider">${def.title}</h4>
                ${valueContent}
            </div>
        `;
    });

    container.innerHTML = html;
};

export const updateSummary = (appState, appConfig) => {
    const allDefinitions = getAllDashboardDefinitions(appConfig);
    const elements = {};
    Object.keys(allDefinitions).forEach(id => {
        const def = allDefinitions[id];
        if (def && def.valueId) {
            elements[id] = document.getElementById(def.valueId);
        }
    });

    const teamGroups = appConfig.teamGroups || [];
    const allStaffMembers = new Set(teamGroups.flatMap(g => g.members));
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));
    const totalStaffCount = allStaffMembers.size;
    const totalPartTimerCount = allPartTimers.size;

    // ✅ 안전한 배열 접근
    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];

    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

    const onLeaveMemberNames = new Set(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime))
            .map(item => item.member)
    );
    const onLeaveTotalCount = onLeaveMemberNames.size;

    const attendanceMap = appState.dailyAttendance || {};
    const currentlyClockedIn = new Set(
        Object.keys(attendanceMap).filter(member => attendanceMap[member].status === 'active')
    );

    const availableStaffCount = [...currentlyClockedIn].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = [...currentlyClockedIn].filter(member => allPartTimers.has(member)).length;

    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused');
    
    const ongoingMembers = new Set(ongoingRecords.map(r => r.member));
    const pausedMembers = new Set(pausedRecords.map(r => r.member));

    const totalWorkingCount = ongoingMembers.size;
    
    const pausedStaffCount = [...pausedMembers].filter(member => allStaffMembers.has(member)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(member => allPartTimers.has(member)).length;
    
    const workingStaffCount = [...ongoingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...ongoingMembers].filter(member => allPartTimers.has(member)).length;

    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    
    const totalIdleCount = idleStaffCount + idlePartTimerCount;

    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;

    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;

    const quantitiesFromState = appState.taskQuantities || {};
    // [추가] 수량 상태(예상/확정) 데이터 가져오기 (없으면 빈 객체)
    const quantityStatuses = appState.taskQuantityStatuses || {};
    
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
    
    for (const task in quantitiesFromState) {
        const quantity = quantitiesFromState[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task];

        if (targetDashboardId && elements[targetDashboardId]) {
            const el = elements[targetDashboardId];
            el.textContent = quantity;

            // [추가] 상태별 클래스 적용 로직
            // 기존 상태 클래스 제거
            el.classList.remove('quantity-estimated', 'quantity-confirmed');

            // 상태 확인 및 클래스 추가
            const status = quantityStatuses[task];
            if (status === 'estimated') {
                el.classList.add('quantity-estimated'); // 빨간색 (예상)
            } else if (status === 'confirmed') {
                el.classList.add('quantity-confirmed'); // 녹색 (확정)
            }
            // status가 없거나 다른 값이면 기본 스타일(노란색) 유지
        }
    }
};

export const renderTaskAnalysis = (appState, appConfig) => {
    const analysisContainer = document.getElementById('analysis-task-summary-panel'); 
    if (!analysisContainer) return;
    analysisContainer.innerHTML = ''; 
    
    const now = getCurrentTime();

    const allRecords = appState.workRecords || [];
    if (allRecords.length === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-500 py-4">기록된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        const memberSelect = document.getElementById('analysis-member-select');
        if (memberSelect) memberSelect.innerHTML = '<option value="">--- 직원/알바 선택 ---</option>';
        return;
    }

    let totalLoggedMinutes = 0;
    let totalBreakMinutes = 0;
    const taskAnalysis = {};

    allRecords.forEach(record => {
        let duration = 0;
        if (record.status === 'completed') {
            duration = record.duration || 0;
        } else {
            duration = calcElapsedMinutes(record.startTime, now, record.pauses);
        }

        if (record.task) {
             taskAnalysis[record.task] = (taskAnalysis[record.task] || 0) + duration;
             totalLoggedMinutes += duration;
        }

        (record.pauses || []).forEach(pause => {
            if (pause.start && (pause.type === 'break' || !pause.type)) { 
                const endTime = pause.end || now;
                const s = new Date(`1970-01-01T${pause.start}:00Z`).getTime();
                const e = new Date(`1970-01-01T${endTime}:00Z`).getTime();
                if (e > s) {
                    totalBreakMinutes += (e - s) / 60000;
                }
            }
        });
    });

    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','검수':'#14b8a6', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280'};
    const sortedTasks = Object.entries(taskAnalysis).sort(([, a], [, b]) => b - a);

    let gradientParts = [];
    let cumulativePercentage = 0;
    let legendHTML = '<div class="flex-grow max-h-72 overflow-y-auto pr-2">';

    sortedTasks.forEach(([task, minutes]) => {
        const percentage = totalLoggedMinutes > 0 ? (minutes / totalLoggedMinutes) * 100 : 0;
        const color = taskColorsHex[task] || '#6b7280';
        if (percentage > 0) {
            gradientParts.push(`${color} ${cumulativePercentage}% ${cumulativePercentage + percentage}%`);
            cumulativePercentage += percentage;
        }
        legendHTML += `<div class="flex items-center justify-between mb-2"><div class="flex items-center"><span class="w-3 h-3 rounded-full mr-2" style="background-color: ${color};"></span><span class="font-semibold text-gray-700">${task}</span></div><div class="text-right"><div class="text-sm font-semibold text-gray-800">${formatDuration(minutes)}</div><div class="text-xs text-gray-500">${percentage.toFixed(1)}%</div></div></div>`;
    });
    legendHTML += '</div>';

    const finalGradient = gradientParts.length > 0 ? `conic-gradient(${gradientParts.join(', ')})` : 'conic-gradient(#e5e7eb 0% 100%)';
    
    analysisContainer.innerHTML = `<div class="flex flex-col md:flex-row items-center gap-6 md:gap-8">
        <div class="flex-shrink-0">
            <div class="chart" style="background: ${finalGradient};">
                <div class="chart-center">
                    <span class="text-sm text-gray-500">총 업무</span>
                    <span class="text-xl font-bold text-blue-600">${formatDuration(totalLoggedMinutes)}</span>
                    <span class="text-xs text-gray-500 mt-1">총 휴식: ${formatDuration(Math.round(totalBreakMinutes))}</span>
                </div>
            </div>
        </div>
        ${legendHTML}
    </div>`;

    const memberSelect = document.getElementById('analysis-member-select');
    if (memberSelect && memberSelect.options.length <= 1) {
        const staff = (appConfig.teamGroups || []).flatMap(g => g.members);
        const partTimers = (appState.partTimers || []).map(p => p.name);
        const allMembers = [...new Set([...staff, ...partTimers])].sort((a, b) => a.localeCompare(b));
        
        let optionsHtml = '<option value="">--- 직원/알바 선택 ---</option>';
        allMembers.forEach(member => {
            optionsHtml += `<option value="${member}">${member}</option>`;
        });
        memberSelect.innerHTML = optionsHtml;
    }
};

export const renderPersonalAnalysis = (selectedMember, appState) => {
    const container = document.getElementById('analysis-personal-stats-container');
    if (!container) return;

    if (!selectedMember) {
        container.innerHTML = `<p class="text-center text-gray-500">통계를 보려면 위에서 직원을 선택하세요.</p>`;
        return;
    }

    const memberRecords = (appState.workRecords || []).filter(r => r.member === selectedMember);
    
    const attendance = appState.dailyAttendance?.[selectedMember];
    const now = getCurrentTime();
    const ongoingRecord = memberRecords.find(r => r.status === 'ongoing');
    const pausedRecord = memberRecords.find(r => r.status === 'paused');
    
    let currentStatusHtml = '';
    if (ongoingRecord) {
        currentStatusHtml = `<span class="text-sm font-semibold text-red-600">업무 중: ${ongoingRecord.task}</span>`;
    } else if (pausedRecord) {
        currentStatusHtml = `<span class="text-sm font-semibold text-yellow-600">휴식 중</span>`;
    } else {
        // ✅ 안전한 배열 접근
        const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
        const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
        const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

        const leaveInfo = combinedOnLeaveMembers.find(m => m.member === selectedMember && !(m.type === '외출' && m.endTime));
        if (leaveInfo) {
             const label = getLeaveDisplayLabel(selectedMember, leaveInfo);
             currentStatusHtml = `<span class="text-sm font-semibold text-gray-600">${label} 중</span>`;
        } else {
             if (attendance && attendance.status === 'active') {
                 currentStatusHtml = `<span class="text-sm font-semibold text-green-600">대기 중</span>`;
             } else if (attendance && attendance.status === 'returned') {
                 currentStatusHtml = `<span class="text-sm font-semibold text-gray-500">퇴근 완료</span>`;
             } else {
                 currentStatusHtml = `<span class="text-sm font-semibold text-gray-400">출근 전</span>`;
             }
        }
    }

    if (memberRecords.length === 0) {
         container.innerHTML = `
            <h4 class="text-lg font-bold text-gray-800 mb-3">${selectedMember} 님 요약</h4>
            <div class="bg-gray-50 p-4 rounded-lg text-center mb-4">
                <div class="text-xs text-gray-500 mb-1">현재 상태</div>
                <div>${currentStatusHtml}</div>
            </div>
            <p class="text-center text-gray-500">오늘 업무 기록이 없습니다.</p>`;
        return;
    }

    const taskTimes = memberRecords.reduce((acc, r) => {
        let duration = 0;
        if (r.status === 'completed') {
            duration = r.duration || 0;
        } else {
            duration = calcElapsedMinutes(r.startTime, now, r.pauses);
        }
        acc[r.task] = (acc[r.task] || 0) + duration;
        return acc;
    }, {});
    const sortedTasks = Object.entries(taskTimes).sort(([, a], [, b]) => b - a);
    const totalLiveMinutes = sortedTasks.reduce((sum, [, minutes]) => sum + minutes, 0);

    let baseStartTime = null;
    if (attendance && attendance.inTime) {
        baseStartTime = attendance.inTime;
    } else {
        memberRecords.forEach(r => {
            if (r.startTime && (!baseStartTime || r.startTime < baseStartTime)) baseStartTime = r.startTime;
        });
    }

    let lastEffectiveEndTime = null;
    memberRecords.forEach(r => {
        if (r.status === 'completed' && r.endTime) {
            if (!lastEffectiveEndTime || r.endTime > lastEffectiveEndTime) lastEffectiveEndTime = r.endTime;
        }
    });
    if (ongoingRecord || pausedRecord) lastEffectiveEndTime = now;
    if (attendance && attendance.outTime && attendance.status === 'returned') {
         if (!lastEffectiveEndTime || attendance.outTime > lastEffectiveEndTime) lastEffectiveEndTime = attendance.outTime;
    }

    let totalTimeSpanMinutes = 0;
    if (baseStartTime && lastEffectiveEndTime) {
        totalTimeSpanMinutes = calcElapsedMinutes(baseStartTime, lastEffectiveEndTime, []); 
    }
    const totalNonWorkMinutes = Math.max(0, totalTimeSpanMinutes - totalLiveMinutes);

    let html = `
        <h4 class="text-lg font-bold text-gray-800 mb-3">${selectedMember} 님 요약</h4>
        <div class="grid grid-cols-3 gap-4 mb-4 text-center">
            <div class="bg-gray-50 p-2 rounded-lg flex flex-col justify-center min-h-[80px]">
                <div class="text-xs text-gray-500 mb-1">현재 상태</div>
                <div>${currentStatusHtml}</div>
            </div>
            <div class="bg-gray-50 p-2 rounded-lg flex flex-col justify-center min-h-[80px]">
                <div class="text-xs text-gray-500 mb-1">총 업무 시간 (실시간)</div>
                <div class="text-lg font-bold text-blue-600">${formatDuration(totalLiveMinutes)}</div>
            </div>
             <div class="bg-gray-50 p-2 rounded-lg flex flex-col justify-center min-h-[80px]">
                <div class="text-xs text-gray-500 mb-1">총 비업무 시간 (추정)</div>
                <div class="text-lg font-bold text-gray-700">${formatDuration(Math.round(totalNonWorkMinutes))}</div>
            </div>
        </div>
        <div>
            <h5 class="text-md font-semibold text-gray-700 mb-2">오늘 수행한 업무 (전체)</h5>
            <ul class="space-y-1 max-h-40 overflow-y-auto">
    `;
    if (sortedTasks.length > 0) {
        sortedTasks.forEach(([task, minutes]) => {
            if (minutes > 0) {
                html += `<li class="text-sm flex justify-between p-1 rounded hover:bg-gray-50"><span class="font-semibold">${task}</span><span class="text-gray-600">${formatDuration(minutes)}</span></li>`;
            }
        });
    } else {
        html += `<li class="text-sm text-gray-500">데이터 없음</li>`;
    }
    html += `</ul></div>`;
    container.innerHTML = html;
};

export const renderAttendanceToggle = (appState) => {
    const currentUser = appState.currentUser;
    if (!currentUser) return;

    const attendance = appState.dailyAttendance?.[currentUser];
    const status = attendance?.status;
    const isClockedIn = status === 'active';
    const isReturned = status === 'returned';

    const pcToggle = document.getElementById('pc-attendance-checkbox');
    const mobileToggle = document.getElementById('mobile-attendance-checkbox');
    const pcCancelBtn = document.getElementById('pc-clock-out-cancel-btn');
    const mobileCancelBtn = document.getElementById('mobile-clock-out-cancel-btn');

    if (pcToggle) pcToggle.checked = isClockedIn;
    if (mobileToggle) mobileToggle.checked = isClockedIn;

    if (pcCancelBtn) pcCancelBtn.classList.toggle('hidden', !isReturned);
    if (mobileCancelBtn) mobileCancelBtn.classList.toggle('hidden', !isReturned);
};

export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = [], isMobileTaskViewExpanded = false, isMobileMemberViewExpanded = false) => {
    const currentUserRole = appState.currentUserRole || 'user';
    const currentUserName = appState.currentUser || null;
    const teamStatusBoard = document.getElementById('team-status-board');
    if (!teamStatusBoard) return;
    teamStatusBoard.innerHTML = '';

    const presetTaskContainer = document.createElement('div');
    presetTaskContainer.className = 'mb-6';
    presetTaskContainer.innerHTML = `<div class="flex justify-end items-center border-b pb-2 mb-4 md:hidden"><button id="toggle-all-tasks-mobile" class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">${isMobileTaskViewExpanded ? '간략히' : '전체보기'}</button></div>`;
    const presetGrid = document.createElement('div');
    presetGrid.className = 'grid grid-cols-1 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4';
    if (isMobileTaskViewExpanded) presetGrid.classList.add('mobile-expanded');

    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const tasksToRender = [...new Set([...baseTasks, ...ongoingRecords.map(r => r.task)])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);
        const isCurrentUserWorkingOnThisTask = groupRecords.some(r => r.member === currentUserName);
        const isPaused = groupRecords.length > 0 && groupRecords.every(r => r.status === 'paused');
        const isOngoing = groupRecords.some(r => r.status === 'ongoing');
        const currentStyle = isPaused ? taskCardStyles['paused'] : (isOngoing || groupRecords.length > 0 ? taskCardStyles['ongoing'] : taskCardStyles['default']);
        const titleClass = isPaused ? currentStyle.title : (taskTitleColors[task] || taskTitleColors['default']);
        const mobileVisibilityClass = (isCurrentUserWorkingOnThisTask || isMobileTaskViewExpanded) ? 'flex' : 'hidden md:flex mobile-task-hidden';
        
        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];
            card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 ${currentStyle.card.join(' ')} ${currentStyle.hover} cursor-pointer`;
            
            card.dataset.task = task; 
            card.dataset.groupId = firstRecord.groupId; 

            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-64 members-list">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {
                const isRecPaused = rec.status === 'paused';
                const pauseMin = calcTotalPauseMinutes(rec.pauses);
                const memberPauseText = pauseMin > 0 ? ` <span class="text-xs text-gray-400">(휴: ${formatDuration(pauseMin)})</span>` : '';

                const pauseResumeButtonHtml = rec.status === 'ongoing' 
                    ? `<button data-action="pause-individual" title="정지" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-yellow-100 hover:bg-yellow-200 text-yellow-700 transition"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg></button>`
                    : `<button data-action="resume-individual" title="재개" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-green-100 hover:bg-green-200 text-green-700 transition"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25l14.25 6.75-14.25 6.75V5.25z" /></svg></button>`;
                
                membersHtml += `<div class="text-sm ${isRecPaused ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50'} rounded p-1 group flex justify-between items-center member-row">
                    <span class="font-semibold ${isRecPaused ? 'text-yellow-800' : 'text-gray-800'} break-keep mr-1 inline-block text-left" title="${rec.member}">${rec.member}</span>
                    <span class="text-xs ${isRecPaused ? 'text-yellow-600' : 'text-gray-500'} flex-grow text-center">(${formatTimeTo24H(rec.startTime)}) ${isRecPaused ? '(휴식중)' : ''}${memberPauseText}</span>
                    <div class="flex-shrink-0 flex items-center space-x-1 member-actions">
                        ${pauseResumeButtonHtml}
                        <button data-action="stop-individual" title="종료" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-200 text-red-700 transition"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                        <button data-action="edit-individual-start-time" title="시작 시간 변경" data-record-id="${rec.id}" data-current-start-time="${rec.startTime || ''}" class="w-7 h-7 flex items-center justify-center rounded-full bg-blue-100 hover:bg-blue-200 text-blue-700 transition"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
                    </div></div>`;
            });
            membersHtml += '</div>';

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime) || groupRecords[0];
            const pausesJson = JSON.stringify(representativeRecord.pauses || []);
            
            const totalPauseMinutes = calcTotalPauseMinutes(representativeRecord.pauses);
            const pauseDisplay = totalPauseMinutes > 0 ? ` <span class="text-xs text-gray-400">(휴식: ${formatDuration(totalPauseMinutes)})</span>` : '';

            card.innerHTML = `<div class="flex flex-col h-full"><div class="font-bold text-lg ${titleClass} break-keep">${firstRecord.task} ${isPaused ? ' (일시정지)' : ''}</div><div class="text-xs ${currentStyle.subtitle} my-2 cursor-pointer group-time-display" data-action="edit-group-start-time" data-group-id="${firstRecord.groupId}" data-current-start-time="${earliestStartTime || ''}">시작: ${formatTimeTo24H(earliestStartTime)} <span class="ongoing-duration" data-start-time="${earliestStartTime || ''}" data-status="${isOngoing ? 'ongoing' : 'paused'}" data-pauses-json='${pausesJson}'></span>${pauseDisplay}</div><div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">${groupRecords.length}명 참여중:</div><div class="flex-grow">${membersHtml}</div><div class="mt-3 border-t border-gray-300/60 pt-3 flex gap-2 card-actions"><button data-task="${task}" class="${isPaused ? 'resume-work-group-btn bg-green-500 hover:bg-green-600' : 'pause-work-group-btn bg-yellow-500 hover:bg-yellow-600'} flex-1 text-white rounded-md transition text-xs font-semibold py-1.5 px-1 shadow-sm text-center">${isPaused ? '전체 재개' : '전체 정지'}</button><button data-task="${task}" class="stop-work-group-btn bg-red-600 hover:bg-red-700 flex-1 text-white rounded-md transition text-xs font-semibold py-1.5 px-1 shadow-sm text-center">전체 종료</button></div></div>`;
        } else {
            card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 cursor-pointer ${currentStyle.card.join(' ')} ${currentStyle.hover}`;
            card.dataset.action = 'start-task';
            card.dataset.task = task;
            card.innerHTML = `<div class="flex-grow"><div class="font-bold text-lg ${titleClass} break-keep">${task}</div><div class="text-xs ${currentStyle.subtitle} my-2">시작: 시작 전</div><div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">참여 인원 (0명):</div><div class="text-xs ${currentStyle.subtitle} italic flex-grow flex items-center justify-center text-center">카드를 클릭하여 팀원 선택</div></div><div class="mt-3 border-t border-gray-300/60 pt-3 flex gap-2"><div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 rounded-md transition text-xs font-semibold py-1.5 px-1 shadow-sm text-center opacity-50 cursor-not-allowed"><span>전체 정지</span></div><div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 rounded-md transition text-xs font-semibold py-1.5 px-1 shadow-sm text-center opacity-50 cursor-not-allowed"><span>전체 종료</span></div></div>`;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    const otherStyle = taskCardStyles['default'];
    otherTaskCard.className = `p-3 rounded-lg border flex flex-col justify-center items-center min-h-[300px] transition-all duration-200 cursor-pointer ${otherStyle.card.join(' ')} ${otherStyle.hover}`;
    otherTaskCard.dataset.action = 'other';
    otherTaskCard.innerHTML = `<div class="font-bold text-lg text-gray-700">기타 업무</div><svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mt-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><div class="text-xs text-gray-500 mt-3">새로운 업무 시작</div>`;
    presetGrid.appendChild(otherTaskCard);
    presetTaskContainer.appendChild(presetGrid);
    teamStatusBoard.appendChild(presetTaskContainer);

    // --- ALL TEAM MEMBER STATUS ---
    const allMembersContainer = document.createElement('div');
    allMembersContainer.id = 'all-members-container';
    if (isMobileMemberViewExpanded) allMembersContainer.classList.add('mobile-expanded');
    allMembersContainer.innerHTML = `<div class="flex justify-between items-center border-b pb-2 mb-4 mt-8"><h3 class="text-lg font-bold text-gray-700 hidden md:block">전체 팀원 현황 (클릭하여 근태 설정/취소/수정)</h3><h3 class="text-lg font-bold text-gray-700 md:hidden">팀원 현황</h3><button id="toggle-all-members-mobile" class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">${isMobileMemberViewExpanded ? '간략히' : '전체보기'}</button></div>`;

    const ongoingMembers = new Set(ongoingRecords.filter(r => r.status === 'ongoing').map(r => r.member));
    const pausedMembers = new Set(ongoingRecords.filter(r => r.status === 'paused').map(r => r.member));
    const workingMembersMap = new Map(ongoingRecords.map(r => [r.member, r.task]));
    
    // ✅ 안전한 배열 접근 및 병합
    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

    const onLeaveStatusMap = new Map(combinedOnLeaveMembers.filter(item => !(item.type === '외출' && item.endTime)).map(item => [item.member, item]));

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'), teamGroups.find(g => g.name === '공통파트'), teamGroups.find(g => g.name === '담당파트'), teamGroups.find(g => g.name === '제작파트')
    ].filter(Boolean);

    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'mb-4';
        groupContainer.innerHTML = `<div class="flex items-center gap-2 mb-2 hidden md:flex"><h4 class="text-md font-semibold text-gray-600">${group.name}</h4></div>`;
        const groupGrid = document.createElement('div');
        groupGrid.className = 'flex flex-wrap gap-2';
        [...new Set(group.members)].forEach(member => {
            const card = document.createElement('button');
            const leaveInfo = onLeaveStatusMap.get(member);
            const isOnLeave = !!leaveInfo;
            const isWorking = ongoingMembers.has(member) || pausedMembers.has(member);
            
            const attendance = appState.dailyAttendance?.[member];
            const isClockedIn = attendance && attendance.status === 'active';
            const isReturned = attendance && attendance.status === 'returned';
            
            const isSelf = (member === currentUserName);
            const visibilityClass = (isSelf || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
            card.className = `p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibilityClass} ${isSelf ? 'w-full md:w-28' : 'w-28'} flex-col justify-center`;
            card.dataset.memberName = member;

            if (isOnLeave) {
                card.dataset.action = 'member-toggle-leave'; 
                
                card.dataset.leaveType = leaveInfo.type; 
                card.dataset.startTime = leaveInfo.startTime || ''; 
                card.dataset.startDate = leaveInfo.startDate || ''; 
                card.dataset.endTime = leaveInfo.endTime || ''; 
                card.dataset.endDate = leaveInfo.endDate || '';
                
                card.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500');
                
                if (currentUserRole === 'admin' || isSelf) {
                    card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                } else {
                    card.classList.add('cursor-not-allowed');
                }
                
                const displayLabel = getLeaveDisplayLabel(member, leaveInfo);
                const labelHtml = `<div class="text-xs font-bold text-gray-600">${displayLabel}</div>`;

                let detailText = leaveInfo.startTime ? formatTimeTo24H(leaveInfo.startTime) + (leaveInfo.endTime ? ` - ${formatTimeTo24H(leaveInfo.endTime)}` : (leaveInfo.type === '외출' ? ' ~' : '')) : (leaveInfo.startDate ? leaveInfo.startDate.substring(5) + (leaveInfo.endDate && leaveInfo.endDate !== leaveInfo.startDate ? ` ~ ${leaveInfo.endDate.substring(5)}` : '') : '');
                
                card.innerHTML = `<div class="font-semibold text-sm break-keep">${member}</div>${labelHtml}${detailText ? `<div class="text-[10px] leading-tight mt-0.5">${detailText}</div>` : ''}`;
            } else if (isWorking) {
                card.dataset.action = 'member-toggle-leave';
                card.classList.add('opacity-70', 'cursor-not-allowed', ongoingMembers.has(member) ? 'bg-red-50' : 'bg-yellow-50', ongoingMembers.has(member) ? 'border-red-200' : 'border-yellow-200');
                card.innerHTML = `<div class="font-semibold text-sm ${ongoingMembers.has(member) ? 'text-red-800' : 'text-yellow-800'} break-keep">${member}</div><div class="text-xs ${ongoingMembers.has(member) ? 'text-gray-600' : 'text-yellow-600'} truncate" title="${workingMembersMap.get(member)}">${ongoingMembers.has(member) ? workingMembersMap.get(member) : '휴식 중'}</div>`;
            } else if (isClockedIn) {
                card.dataset.action = 'member-toggle-leave';
                if (currentUserRole === 'admin' || isSelf) card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400'); else card.classList.add('cursor-not-allowed', 'opacity-70');
                card.classList.add('bg-green-50', 'border-green-200');
                card.innerHTML = `<div class="font-semibold text-sm text-green-800 break-keep">${member}</div><div class="text-xs text-green-600">대기 중</div>`;
            } else if (isReturned) {
                card.dataset.action = 'member-toggle-leave';
                if (currentUserRole === 'admin' || isSelf) card.classList.add('cursor-pointer', 'hover:shadow-sm'); else card.classList.add('cursor-not-allowed', 'opacity-60');
                card.classList.add('bg-gray-100', 'border-gray-300', 'text-gray-500');
                card.innerHTML = `<div class="font-semibold text-sm break-keep">${member}</div><div class="text-xs">퇴근 완료</div>`;
            } else {
                card.dataset.action = 'member-toggle-leave';
                card.classList.add('bg-gray-100', 'border-gray-200', 'text-gray-400', 'opacity-60');
                 if (currentUserRole === 'admin' || isSelf) card.classList.add('cursor-pointer', 'hover:shadow-sm'); else card.classList.add('cursor-not-allowed');
                card.innerHTML = `<div class="font-semibold text-sm break-keep">${member}</div><div class="text-xs">출근 전</div>`;
            }
            groupGrid.appendChild(card);
        });
        groupContainer.appendChild(groupGrid);
        allMembersContainer.appendChild(groupContainer);
    });

    const activePartTimers = (appState.partTimers || []).filter(pt => ongoingMembers.has(pt.name) || onLeaveStatusMap.has(pt.name) || appState.dailyAttendance?.[pt.name]);
    if (activePartTimers.length > 0) {
        const albaContainer = document.createElement('div'); albaContainer.className = 'mb-4'; albaContainer.innerHTML = `<h4 class="text-md font-semibold text-gray-600 mb-2 hidden md:block">알바</h4>`;
        const albaGrid = document.createElement('div'); albaGrid.className = 'flex flex-wrap gap-2';
        activePartTimers.forEach(pt => {
             const card = document.createElement('button');
             const isSelfAlba = (pt.name === currentUserName);
             const visibilityClassAlba = (isSelfAlba || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
             card.className = `relative p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibilityClassAlba} ${isSelfAlba ? 'w-full md:w-28' : 'w-28'} flex-col justify-center`;
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = workingMembersMap.has(pt.name) || pausedMembers.has(pt.name);
             
             const albaAttendance = appState.dailyAttendance?.[pt.name];
             const isAlbaClockedIn = albaAttendance && albaAttendance.status === 'active';
             const isAlbaReturned = albaAttendance && albaAttendance.status === 'returned';

            card.dataset.memberName = pt.name;
            if (isAlbaOnLeave) {
                card.dataset.action = 'member-toggle-leave'; 
                
                card.dataset.leaveType = albaLeaveInfo.type; 
                card.dataset.startTime = albaLeaveInfo.startTime || ''; 
                card.dataset.startDate = albaLeaveInfo.startDate || ''; 
                card.dataset.endTime = albaLeaveInfo.endTime || ''; 
                card.dataset.endDate = albaLeaveInfo.endDate || '';
                
                card.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500');
                
                if (currentUserRole === 'admin' || isSelfAlba) {
                    card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                } else {
                    card.classList.add('cursor-not-allowed');
                }
                
                const displayLabel = getLeaveDisplayLabel(pt.name, albaLeaveInfo);
                const labelHtml = `<div class="text-xs font-bold text-gray-600">${displayLabel}</div>`;

                let detailText = albaLeaveInfo.startTime ? formatTimeTo24H(albaLeaveInfo.startTime) + (albaLeaveInfo.endTime ? ` - ${formatTimeTo24H(albaLeaveInfo.endTime)}` : (albaLeaveInfo.type === '외출' ? ' ~' : '')) : (albaLeaveInfo.startDate ? albaLeaveInfo.startDate.substring(5) + (albaLeaveInfo.endDate && albaLeaveInfo.endDate !== albaLeaveInfo.startDate ? ` ~ ${albaLeaveInfo.endDate.substring(5)}` : '') : '');
                
                card.innerHTML = `<div class="font-semibold text-sm break-keep">${pt.name}</div>${labelHtml}${detailText ? `<div class="text-[10px] leading-tight mt-0.5">${detailText}</div>` : ''}`;
            } else if (isAlbaWorking) {
                card.dataset.action = 'member-toggle-leave';
                card.classList.add('opacity-70', 'cursor-not-allowed', ongoingMembers.has(pt.name) ? 'bg-red-50' : 'bg-yellow-50', ongoingMembers.has(pt.name) ? 'border-red-200' : 'border-yellow-200');
                card.innerHTML = `<div class="font-semibold text-sm ${ongoingMembers.has(pt.name) ? 'text-red-800' : 'text-yellow-800'}">${pt.name}</div><div class="text-xs ${ongoingMembers.has(pt.name) ? 'text-gray-600' : 'text-yellow-600'} truncate" title="${workingMembersMap.get(pt.name)}">${ongoingMembers.has(pt.name) ? workingMembersMap.get(pt.name) : '휴식 중'}</div>`;
            } else if (isAlbaClockedIn) {
                 card.dataset.action = 'member-toggle-leave';
                 if (currentUserRole === 'admin' || isSelfAlba) card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400'); else card.classList.add('cursor-not-allowed', 'opacity-70');
                 card.classList.add('bg-green-50', 'border-green-200');
                 card.innerHTML = `<div class="font-semibold text-sm text-green-800 break-keep">${pt.name}</div><div class="text-xs text-green-600">대기 중</div>`;
            } else if (isAlbaReturned) {
                 card.dataset.action = 'member-toggle-leave';
                 if (currentUserRole === 'admin' || isSelfAlba) card.classList.add('cursor-pointer', 'hover:shadow-sm'); else card.classList.add('cursor-not-allowed', 'opacity-60');
                 card.classList.add('bg-gray-100', 'border-gray-300', 'text-gray-500');
                 card.innerHTML = `<div class="font-semibold text-sm break-keep">${pt.name}</div><div class="text-xs">퇴근 완료</div>`;
            } else {
                 card.dataset.action = 'member-toggle-leave';
                 card.classList.add('bg-gray-100', 'border-gray-200', 'text-gray-400', 'opacity-60');
                 if (currentUserRole === 'admin' || isSelfAlba) card.classList.add('cursor-pointer', 'hover:shadow-sm'); else card.classList.add('cursor-not-allowed');
                 card.innerHTML = `<div class="font-semibold text-sm break-keep">${pt.name}</div><div class="text-xs">출근 전</div>`;
            }
             albaGrid.appendChild(card);
        });
        albaContainer.appendChild(albaGrid); allMembersContainer.appendChild(albaContainer);
    }
    teamStatusBoard.appendChild(allMembersContainer);

    // 호출 순서 보장
    renderAttendanceToggle(appState);
};

/**
 * 6. 메인 화면 - 업무 기록 렌더링 (완료 + 진행 중)
 */
export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    const toggleHeader = document.querySelector('#toggle-completed-log h2'); 
    if (toggleHeader) toggleHeader.textContent = '오늘의 업무 기록 (실시간)'; 

    if (!workLogBody) return;
    workLogBody.innerHTML = '';

    const allRecords = appState.workRecords || [];
    if (!allRecords || allRecords.length === 0) {
        workLogBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">기록된 업무가 없습니다.</td></tr>`;
        return;
    }

    const now = getCurrentTime();
    const groupedRecords = allRecords.reduce((acc, record) => {
        if (!acc[record.task]) acc[record.task] = [];
        acc[record.task].push(record);
        return acc;
    }, {});
    const sortedTasks = Object.keys(groupedRecords).sort();

    sortedTasks.forEach(task => {
        const groupHeaderRow = document.createElement('tr');
        groupHeaderRow.className = 'bg-gray-100';
        groupHeaderRow.innerHTML = `<th colspan="6" class="px-6 py-3 text-left text-base text-blue-700 font-bold">${task}</th>`;
        workLogBody.appendChild(groupHeaderRow);

        groupedRecords[task].sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(record => {
            const row = document.createElement('tr');
            const isCompleted = record.status === 'completed';
            
            let statusClass = 'bg-white hover:bg-gray-50';
            let endTimeText = formatTimeTo24H(record.endTime);
            let durationText = formatDuration(record.duration);

            // 휴식 시간 계산 및 표시
            const pauseMinutes = calcTotalPauseMinutes(record.pauses);
            const pauseText = pauseMinutes > 0 ? ` <span class="text-xs text-gray-400 block">(휴: ${formatDuration(pauseMinutes)})</span>` : '';

            if (!isCompleted) {
                statusClass = record.status === 'ongoing' ? 'bg-red-50 hover:bg-red-100' : 'bg-yellow-50 hover:bg-yellow-100';
                endTimeText = `<span class="${record.status === 'ongoing' ? 'text-red-600' : 'text-yellow-600'} font-semibold">${record.status === 'ongoing' ? '진행 중' : '휴식 중'}</span>`;
                const elapsed = calcElapsedMinutes(record.startTime, now, record.pauses);
                durationText = `<span class="font-semibold">${formatDuration(elapsed)}</span>${pauseText}`;
            } else {
                durationText = `${formatDuration(record.duration)}${pauseText}`;
            }

            row.className = `${statusClass} border-b border-gray-200`;
            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${record.member || 'N/A'}</td>
                <td class="px-6 py-4">${record.task || 'N/A'}</td>
                <td class="px-6 py-4">${formatTimeTo24H(record.startTime)}</td>
                <td class="px-6 py-4">${endTimeText}</td>
                <td class="px-6 py-4">${durationText}</td>
                <td class="px-6 py-4 text-right space-x-2">
                    ${isCompleted ? `<button data-action="edit" data-record-id="${record.id}" class="font-medium text-blue-500 hover:underline">수정</button>` : ''}
                    <button data-action="delete" data-record-id="${record.id}" class="font-medium text-red-500 hover:underline">삭제</button>
                </td>`;
            workLogBody.appendChild(row);
        });
    });
};