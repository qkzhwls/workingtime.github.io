// === js/ui-main-board.js ===
import { formatTimeTo24H, formatDuration, calcTotalPauseMinutes } from './utils.js';
import * as State from './state.js';
import { getLeaveDisplayLabel } from './ui-main-utils.js';

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
    
    const taskToggleBtn = document.getElementById('toggle-all-tasks-mobile');
    if (taskToggleBtn && taskToggleBtn.textContent === '간략히') {
        isMobileTaskViewExpanded = true;
    }
    const memberToggleBtn = document.getElementById('toggle-all-members-mobile');
    if (memberToggleBtn && memberToggleBtn.textContent === '간략히') {
        isMobileMemberViewExpanded = true;
    }

    const currentUserRole = appState.currentUserRole || 'user';
    const currentUserName = appState.currentUser || null;
    
    const taskStatusBoard = document.getElementById('task-status-board');
    const memberStatusBoard = document.getElementById('member-status-board');
    if (!taskStatusBoard || !memberStatusBoard) return;
    
    taskStatusBoard.innerHTML = '';
    memberStatusBoard.innerHTML = '';

    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];
    
    const onLeaveStatusMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime) && item.type !== '지각')
            .map(item => [item.member, item])
    );
    const onLeaveMemberNames = new Set(onLeaveStatusMap.keys());

    const presetTaskContainer = document.createElement('div');
    const presetGrid = document.createElement('div');
    presetGrid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5';
    if (isMobileTaskViewExpanded) presetGrid.classList.add('mobile-expanded');

    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    
    const ongoingRecords = (appState.workRecords || []).filter(r => 
        (r.status === 'ongoing' || r.status === 'paused') && !onLeaveMemberNames.has(r.member)
    );
    const tasksToRender = [...new Set([...baseTasks, ...ongoingRecords.map(r => r.task)])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);
        const isCurrentUserWorkingOnThisTask = groupRecords.some(r => r.member === currentUserName);
        const isPaused = groupRecords.length > 0 && groupRecords.every(r => r.status === 'paused');
        const isOngoing = groupRecords.some(r => r.status === 'ongoing');
        const mobileVisibilityClass = (isCurrentUserWorkingOnThisTask || isMobileTaskViewExpanded) ? 'flex' : 'hidden md:flex mobile-task-hidden';
        
        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];
            const headerColor = isPaused ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
            const titleColor = isPaused ? 'text-yellow-800 dark:text-yellow-400' : 'text-blue-800 dark:text-blue-400';
            
            card.className = `${mobileVisibilityClass} flex-col min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden transition-all hover:shadow-md cursor-pointer`;
            card.dataset.task = task; 
            card.dataset.groupId = firstRecord.groupId; 

            let membersHtml = '<div class="p-2 overflow-y-auto max-h-48 space-y-1.5 bg-gray-50/50 dark:bg-gray-900/50 flex-grow">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {
                const isRecPaused = rec.status === 'paused';
                const pauseMin = calcTotalPauseMinutes(rec.pauses);
                const memberPauseText = pauseMin > 0 ? `<span class="text-[10px] text-gray-400 dark:text-gray-500 ml-1">(휴:${formatDuration(pauseMin)})</span>` : '';

                membersHtml += `
                    <div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-gray-800 border ${isRecPaused ? 'border-yellow-200 dark:border-yellow-700' : 'border-gray-100 dark:border-gray-700'} shadow-sm hover:border-blue-300 dark:hover:border-blue-500 transition-colors member-row">
                        <div class="flex items-start gap-2 overflow-hidden flex-1">
                            <div class="w-2 h-2 shrink-0 rounded-full ${isRecPaused ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'} mt-1.5"></div>
                            <div class="flex flex-col min-w-0">
                                <span class="font-bold text-gray-800 dark:text-gray-200 text-sm truncate" title="${rec.member}">${rec.member}</span>
                                <span class="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                    (${formatTimeTo24H(rec.startTime)})${memberPauseText}
                                </span>
                            </div>
                        </div>
                        <div class="flex gap-1 shrink-0 member-actions ml-2">
                            ${isRecPaused 
                                ? `<button data-action="resume-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-800/50 transition" title="재개"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25l14.25 6.75-14.25 6.75V5.25z" /></svg></button>`
                                : `<button data-action="pause-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-800/50 transition" title="정지"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg></button>`
                            }
                            <button data-action="stop-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-800/50 transition" title="종료"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                            <button data-action="edit-individual-start-time" data-record-id="${rec.id}" data-current-start-time="${rec.startTime || ''}" class="w-7 h-7 flex items-center justify-center rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition" title="시작시간 수정"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
                        </div>
                    </div>`;
            });
            membersHtml += '</div>';

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime) || groupRecords[0];
            const pausesJson = JSON.stringify(representativeRecord.pauses || []);
            const totalPauseMinutes = calcTotalPauseMinutes(representativeRecord.pauses);
            const pauseDisplay = totalPauseMinutes > 0 ? `<span class="text-[10px] text-gray-500 font-normal ml-1">(전체휴식: ${formatDuration(totalPauseMinutes)})</span>` : '';

            let specialButtonHtml = '';
            if (task === '샘플검수') {
                specialButtonHtml = `
                    <div class="px-3 pt-3 pb-1 bg-gray-50/50 dark:bg-gray-900/50 shrink-0 border-b border-gray-100 dark:border-gray-800">
                        <button data-action="open-inspection" class="w-full py-2.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800/60 font-extrabold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm border border-purple-200 dark:border-purple-800">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                            정밀검수 매니저 열기
                        </button>
                    </div>
                `;
            } else if (task === '전량검수') {
                specialButtonHtml = `
                    <div class="px-3 pt-3 pb-1 bg-gray-50/50 dark:bg-gray-900/50 shrink-0 border-b border-gray-100 dark:border-gray-800">
                        <button data-action="open-total-inspection" class="w-full py-2.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-800/60 font-extrabold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm border border-indigo-200 dark:border-indigo-800">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                            전량검수 창 열기
                        </button>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="px-4 py-3 ${headerColor} border-b flex justify-between items-start shrink-0">
                    <div>
                        <h3 class="font-bold text-lg ${titleColor} tracking-tight">${task}</h3>
                        <div class="text-[11px] ${isPaused ? 'text-yellow-700 dark:text-yellow-500' : 'text-blue-600 dark:text-blue-400'} mt-1 font-bold group-time-display cursor-pointer" data-action="edit-group-start-time" data-group-id="${firstRecord.groupId}" data-current-start-time="${earliestStartTime || ''}" title="그룹 시작시간 수정">
                            시작: ${formatTimeTo24H(earliestStartTime)}
                            <span class="ongoing-duration ml-1 font-extrabold" data-start-time="${earliestStartTime || ''}" data-status="${isOngoing ? 'ongoing' : 'paused'}" data-pauses-json='${pausesJson}'></span>
                            ${pauseDisplay}
                        </div>
                    </div>
                    <span class="px-2 py-1 ${isPaused ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300' : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'} text-xs font-bold rounded-full shadow-sm">${groupRecords.length}명 참여</span>
                </div>
                ${specialButtonHtml}
                ${membersHtml}
                <div class="p-3 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex gap-2 shrink-0 card-actions">
                    <button data-task="${task}" class="${isPaused ? 'resume-work-group-btn bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800/60' : 'pause-work-group-btn bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-800/60'} flex-1 py-2 font-bold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm">${isPaused ? '▶ 전체재개' : '⏸ 전체정지'}</button>
                    <button data-task="${task}" class="stop-work-group-btn flex-1 py-2 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/60 font-bold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm">⏹ 전체종료</button>
                </div>
            `;
        } else {
            card.className = `${mobileVisibilityClass} flex-col justify-center items-center min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-all group`;
            card.dataset.action = 'start-task';
            card.dataset.task = task;
            card.innerHTML = `
                <div class="w-14 h-14 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full shadow-sm flex items-center justify-center text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 group-hover:border-blue-200 dark:group-hover:border-blue-800 transition-all mb-4 text-2xl font-light">+</div>
                <h3 class="font-bold text-lg text-gray-600 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">${task} 시작</h3>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">클릭하여 인원 선택</p>
            `;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    otherTaskCard.className = `flex flex-col justify-center items-center min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-all group`;
    otherTaskCard.dataset.action = 'other';
    otherTaskCard.innerHTML = `
        <div class="w-14 h-14 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full shadow-sm flex items-center justify-center text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:bg-gray-100 dark:group-hover:bg-gray-600 transition-all mb-4 text-xl">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h3 class="font-bold text-lg text-gray-600 dark:text-gray-300">기타 업무</h3>
        <p class="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">새로운 업무 만들기</p>
    `;
    presetGrid.appendChild(otherTaskCard);
    presetTaskContainer.appendChild(presetGrid);
    
    taskStatusBoard.appendChild(presetTaskContainer);

    const allMembersContainer = document.createElement('div');
    allMembersContainer.id = 'all-members-container';
    if (isMobileMemberViewExpanded) allMembersContainer.classList.add('mobile-expanded');
    
    allMembersContainer.innerHTML = ``;

    const ongoingMembers = new Set(ongoingRecords.filter(r => r.status === 'ongoing').map(r => r.member));
    const pausedMembers = new Set(ongoingRecords.filter(r => r.status === 'paused').map(r => r.member));
    const workingMembersMap = new Map(ongoingRecords.map(r => [r.member, r.task]));

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'), teamGroups.find(g => g.name === '공통파트'), teamGroups.find(g => g.name === '담당파트'), teamGroups.find(g => g.name === '제작파트')
    ].filter(Boolean);

    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'mb-6';
        groupContainer.innerHTML = `<div class="flex items-center gap-2 mb-3 hidden md:flex"><h4 class="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">${group.name}</h4><div class="h-px bg-gray-200 dark:bg-gray-700 flex-grow"></div></div>`;
        const groupGrid = document.createElement('div');
        groupGrid.className = 'flex flex-wrap gap-2.5';
        
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
            
            card.className = `p-2 rounded-xl border text-center transition-all min-h-[76px] ${visibilityClass} ${isSelf ? 'w-full md:w-[110px]' : 'w-[110px]'} flex-col justify-center shadow-sm`;
            card.dataset.memberName = member;

            if (isOnLeave) {
                card.dataset.action = 'member-toggle-leave'; 
                card.dataset.leaveType = leaveInfo.type; 
                card.dataset.startTime = leaveInfo.startTime || ''; 
                card.dataset.startDate = leaveInfo.startDate || ''; 
                card.dataset.endTime = leaveInfo.endTime || ''; 
                card.dataset.endDate = leaveInfo.endDate || '';
                
                card.className += ' bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400';
                if (currentUserRole === 'admin' || isSelf) {
                    card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30';
                } else {
                    card.className += ' cursor-not-allowed';
                }
                
                const displayLabel = getLeaveDisplayLabel(member, leaveInfo);
                let detailText = leaveInfo.startTime ? formatTimeTo24H(leaveInfo.startTime) + (leaveInfo.endTime ? ` - ${formatTimeTo24H(leaveInfo.endTime)}` : (leaveInfo.type === '외출' ? ' ~' : '')) : (leaveInfo.startDate ? leaveInfo.startDate.substring(5) + (leaveInfo.endDate && leaveInfo.endDate !== leaveInfo.startDate ? ` ~ ${leaveInfo.endDate.substring(5)}` : '') : '');
                
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-0.5">${member}</div><div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded inline-block">${displayLabel}</div>${detailText ? `<div class="text-[10px] mt-1 text-gray-400 dark:text-gray-500">${detailText}</div>` : ''}`;
            } else if (isWorking) {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' opacity-80 cursor-not-allowed';
                
                if (ongoingMembers.has(member)) {
                    card.className += ' bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
                } else {
                    card.className += ' bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
                }

                card.innerHTML = `<div class="font-extrabold text-sm ${ongoingMembers.has(member) ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'} mb-1">${member}</div><div class="text-[10px] font-bold ${ongoingMembers.has(member) ? 'text-red-500 dark:text-red-500' : 'text-yellow-600 dark:text-yellow-500'} truncate px-1" title="${workingMembersMap.get(member)}">${ongoingMembers.has(member) ? workingMembersMap.get(member) : '휴식 중'}</div>`;
            } else if (isClockedIn) {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
                if (currentUserRole === 'admin' || isSelf) {
                    card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                } else {
                    card.className += ' cursor-not-allowed opacity-70';
                }
                card.innerHTML = `<div class="font-extrabold text-sm text-green-700 dark:text-green-400 mb-1">${member}</div><div class="text-[11px] font-bold text-green-600 dark:text-green-500">대기 중</div>`;
            } else if (isReturned) {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';
                if (currentUserRole === 'admin' || isSelf) {
                    card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                } else {
                    card.className += ' cursor-not-allowed opacity-60';
                }
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-1">${member}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">퇴근 완료</div>`;
            } else {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 opacity-60';
                 if (currentUserRole === 'admin' || isSelf) {
                     card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                 } else {
                     card.className += ' cursor-not-allowed';
                 }
                card.innerHTML = `<div class="font-extrabold text-sm mb-1">${member}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">출근 전</div>`;
            }
            groupGrid.appendChild(card);
        });
        groupContainer.appendChild(groupGrid);
        allMembersContainer.appendChild(groupContainer);
    });

    const activePartTimers = (appState.partTimers || []).filter(pt => ongoingMembers.has(pt.name) || onLeaveStatusMap.has(pt.name) || appState.dailyAttendance?.[pt.name]);
    if (activePartTimers.length > 0) {
        const albaContainer = document.createElement('div'); albaContainer.className = 'mb-6'; 
        albaContainer.innerHTML = `<div class="flex items-center gap-2 mb-3 hidden md:flex"><h4 class="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">알바</h4><div class="h-px bg-gray-200 dark:bg-gray-700 flex-grow"></div></div>`;
        const albaGrid = document.createElement('div'); albaGrid.className = 'flex flex-wrap gap-2.5';
        
        activePartTimers.forEach(pt => {
             const card = document.createElement('button');
             const isSelfAlba = (pt.name === currentUserName);
             const visibilityClassAlba = (isSelfAlba || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
             
             card.className = `p-2 rounded-xl border text-center transition-all min-h-[76px] ${visibilityClassAlba} ${isSelfAlba ? 'w-full md:w-[110px]' : 'w-[110px]'} flex-col justify-center shadow-sm`;
             
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = workingMembersMap.has(pt.name) || pausedMembers.has(pt.name);
             const albaAttendance = appState.dailyAttendance?.[pt.name];
             const isAlbaClockedIn = albaAttendance && albaAttendance.status === 'active';
             const isAlbaReturned = albaAttendance && albaAttendance.status === 'returned';

            card.dataset.memberName = pt.name;
            
            if (isAlbaOnLeave) {
                card.dataset.action = 'member-toggle-leave'; card.dataset.leaveType = albaLeaveInfo.type; card.dataset.startTime = albaLeaveInfo.startTime || ''; card.dataset.startDate = albaLeaveInfo.startDate || ''; card.dataset.endTime = albaLeaveInfo.endTime || ''; card.dataset.endDate = albaLeaveInfo.endDate || '';
                
                card.className += ' bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400';
                if (currentUserRole === 'admin' || isSelfAlba) {
                    card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30';
                } else {
                    card.className += ' cursor-not-allowed';
                }

                const displayLabel = getLeaveDisplayLabel(pt.name, albaLeaveInfo);
                let detailText = albaLeaveInfo.startTime ? formatTimeTo24H(albaLeaveInfo.startTime) + (albaLeaveInfo.endTime ? ` - ${formatTimeTo24H(albaLeaveInfo.endTime)}` : (albaLeaveInfo.type === '외출' ? ' ~' : '')) : (albaLeaveInfo.startDate ? albaLeaveInfo.startDate.substring(5) + (albaLeaveInfo.endDate && albaLeaveInfo.endDate !== albaLeaveInfo.startDate ? ` ~ ${albaLeaveInfo.endDate.substring(5)}` : '') : '');
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-0.5">${pt.name}</div><div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded inline-block">${displayLabel}</div>${detailText ? `<div class="text-[10px] mt-1 text-gray-400 dark:text-gray-500">${detailText}</div>` : ''}`;
            } else if (isAlbaWorking) {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' opacity-80 cursor-not-allowed';
                
                if (ongoingMembers.has(pt.name)) {
                    card.className += ' bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
                } else {
                    card.className += ' bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
                }

                card.innerHTML = `<div class="font-extrabold text-sm ${ongoingMembers.has(pt.name) ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'} mb-1">${pt.name}</div><div class="text-[10px] font-bold ${ongoingMembers.has(pt.name) ? 'text-red-500 dark:text-red-500' : 'text-yellow-600 dark:text-yellow-500'} truncate px-1">${ongoingMembers.has(pt.name) ? workingMembersMap.get(pt.name) : '휴식 중'}</div>`;
            } else if (isAlbaClockedIn) {
                 card.dataset.action = 'member-toggle-leave';
                 card.className += ' bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
                 if (currentUserRole === 'admin' || isSelfAlba) {
                     card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                 } else {
                     card.className += ' cursor-not-allowed opacity-70';
                 }
                 card.innerHTML = `<div class="font-extrabold text-sm text-green-700 dark:text-green-400 mb-1">${pt.name}</div><div class="text-[11px] font-bold text-green-600 dark:text-green-500">대기 중</div>`;
            } else if (isAlbaReturned) {
                 card.dataset.action = 'member-toggle-leave';
                 card.className += ' bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';
                 if (currentUserRole === 'admin' || isSelfAlba) {
                     card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                 } else {
                     card.className += ' cursor-not-allowed opacity-60';
                 }
                 card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-1">${pt.name}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">퇴근 완료</div>`;
            } else {
                 card.dataset.action = 'member-toggle-leave';
                 card.className += ' bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 opacity-60';
                 if (currentUserRole === 'admin' || isSelfAlba) {
                     card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                 } else {
                     card.className += ' cursor-not-allowed';
                 }
                 card.innerHTML = `<div class="font-extrabold text-sm mb-1">${pt.name}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">출근 전</div>`;
            }
             albaGrid.appendChild(card);
        });
        albaContainer.appendChild(albaGrid); allMembersContainer.appendChild(albaContainer);
    }
    
    memberStatusBoard.appendChild(allMembersContainer);

    renderAttendanceToggle(appState);
};

export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    if (!workLogBody) return;
    workLogBody.innerHTML = '';

    const allRecords = appState.workRecords || [];
    const completedRecords = allRecords.filter(r => r.status === 'completed');

    if (completedRecords.length === 0) {
        workLogBody.innerHTML = `<div class="text-center py-10 text-gray-400 dark:text-gray-500 text-sm font-medium">오늘 완료된 업무가 없습니다.</div>`;
        return;
    }

    completedRecords.sort((a, b) => (b.endTime || '').localeCompare(a.endTime || ''));

    completedRecords.forEach(record => {
        const item = document.createElement('div');
        item.className = 'bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm mb-2.5 hover:border-blue-300 dark:hover:border-blue-500 transition-colors relative group';
        
        const pauseMin = calcTotalPauseMinutes(record.pauses);
        const pauseText = pauseMin > 0 ? `<span class="text-[10px] text-gray-400 dark:text-gray-500 ml-1 font-normal">(휴:${formatDuration(pauseMin)} 포함)</span>` : '';
        
        item.innerHTML = `
            <div class="flex justify-between items-center mb-1.5">
                <span class="font-extrabold text-sm text-gray-800 dark:text-gray-200">${record.task}</span>
                <span class="text-[11px] font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 px-2 py-0.5 rounded-md shadow-sm">${formatDuration(record.duration)}</span>
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 font-medium">
                <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full"></span>
                    ${record.member}
                </div>
                <div>${formatTimeTo24H(record.startTime)} ~ ${formatTimeTo24H(record.endTime)}${pauseText}</div>
            </div>
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 dark:bg-gray-800/95 backdrop-blur px-1.5 py-1 rounded-md shadow-sm border border-gray-100 dark:border-gray-700 flex gap-3">
                <button data-action="edit" data-record-id="${record.id}" class="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-bold tracking-wide">수정</button>
                <div class="w-px bg-gray-200 dark:bg-gray-600"></div>
                <button data-action="delete" data-record-id="${record.id}" class="text-[11px] text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-bold tracking-wide">삭제</button>
            </div>
        `;
        workLogBody.appendChild(item);
    });
};

const setupMobileRefreshButton = () => {
    if (document.getElementById('mobile-refresh-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'mobile-refresh-btn';
    btn.className = 'fixed bottom-6 right-6 w-12 h-12 bg-blue-600/90 text-white rounded-full shadow-lg z-50 md:hidden flex items-center justify-center';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>`;
    btn.onclick = () => window.location.reload();
    document.body.appendChild(btn);
};
setupMobileRefreshButton();