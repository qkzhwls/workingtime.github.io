// === js/ui-main-analysis.js ===
import { formatDuration, calcElapsedMinutes, getCurrentTime, formatTimeTo24H } from './utils.js';
import * as State from './state.js';
import { getLeaveDisplayLabel } from './ui-main-utils.js';

export const renderTaskAnalysis = (appState, appConfig) => {
    const analysisContainer = document.getElementById('analysis-task-summary-panel'); 
    if (!analysisContainer) return;
    analysisContainer.innerHTML = ''; 
    
    const now = getCurrentTime();
    const allRecords = appState.workRecords || [];
    
    if (allRecords.length === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-400 py-8 text-sm">기록된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        const memberSelect = document.getElementById('analysis-member-select');
        if (memberSelect) memberSelect.innerHTML = '<option value="">--- 직원/알바 선택 ---</option>';
        return;
    }

    let totalLoggedMinutes = 0;
    let totalBreakMinutes = 0;
    const taskAnalysis = {};
    const overallMembers = new Set();
    const breakMembers = new Set();

    allRecords.forEach(record => {
        let duration = 0;
        if (record.status === 'completed') {
            duration = record.duration || 0;
        } else {
            duration = calcElapsedMinutes(record.startTime, now, record.pauses);
        }

        if (record.task) {
             if (!taskAnalysis[record.task]) {
                 taskAnalysis[record.task] = { duration: 0, members: new Set() };
             }
             taskAnalysis[record.task].duration += duration;
             if (record.member) {
                 taskAnalysis[record.task].members.add(record.member);
                 overallMembers.add(record.member);
             }
             totalLoggedMinutes += duration;
        }

        (record.pauses || []).forEach(pause => {
            if (pause.start && (pause.type === 'break' || !pause.type)) { 
                const endTime = pause.end || now;
                const s = new Date(`1970-01-01T${pause.start}:00Z`).getTime();
                const e = new Date(`1970-01-01T${endTime}:00Z`).getTime();
                if (e > s) {
                    const breakDur = (e - s) / 60000;
                    totalBreakMinutes += breakDur;
                    if (record.member) breakMembers.add(record.member);
                }
            }
        });
    });

    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','샘플검수':'#14b8a6', '전량검수':'#9333ea', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280'};
    
    // duration 기준으로 내림차순 정렬
    const sortedTasks = Object.entries(taskAnalysis).sort(([, a], [, b]) => b.duration - a.duration);

    let gradientParts = [];
    let cumulativePercentage = 0;
    let legendHTML = '<div class="flex-grow max-h-[300px] overflow-y-auto pr-2 space-y-2">';

    sortedTasks.forEach(([task, data]) => {
        const minutes = data.duration;
        const actualMinutes = data.members.size > 0 ? minutes / data.members.size : 0;
        const percentage = totalLoggedMinutes > 0 ? (minutes / totalLoggedMinutes) * 100 : 0;
        const color = taskColorsHex[task] || '#6b7280';
        
        if (percentage > 0) {
            gradientParts.push(`${color} ${cumulativePercentage}% ${cumulativePercentage + percentage}%`);
            cumulativePercentage += percentage;
        }
        
        legendHTML += `
            <div class="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600">
                <div class="flex items-center">
                    <span class="w-3 h-3 rounded-full mr-2 shadow-sm" style="background-color: ${color};"></span>
                    <span class="font-bold text-gray-700 dark:text-gray-200 text-sm">${task}</span>
                </div>
                <div class="text-right flex flex-col justify-center">
                    <div class="text-sm font-extrabold text-gray-800 dark:text-white">총 ${formatDuration(minutes)}</div>
                    <div class="text-[11px] font-bold text-blue-600 dark:text-blue-400">인당 평균: ${formatDuration(Math.round(actualMinutes))}</div>
                    <div class="text-[10px] text-gray-500 dark:text-gray-400">${percentage.toFixed(1)}%</div>
                </div>
            </div>`;
    });
    legendHTML += '</div>';

    const finalGradient = gradientParts.length > 0 ? `conic-gradient(${gradientParts.join(', ')})` : 'conic-gradient(#e5e7eb 0% 100%)';
    
    const actualTotalMinutes = overallMembers.size > 0 ? totalLoggedMinutes / overallMembers.size : 0;
    const actualBreakMinutes = breakMembers.size > 0 ? totalBreakMinutes / breakMembers.size : 0;

    analysisContainer.innerHTML = `<div class="flex flex-col md:flex-row items-center gap-6 md:gap-8">
        <div class="flex-shrink-0">
            <div class="chart shadow-sm" style="background: ${finalGradient}; width: 170px; height: 170px;">
                <div class="chart-center shadow-sm dark:bg-gray-800 flex flex-col justify-center items-center">
                    <span class="text-[11px] font-bold text-gray-400 dark:text-gray-500">총 업무시간</span>
                    <span class="text-lg font-extrabold text-blue-600 dark:text-blue-400 leading-none mb-1">${formatDuration(totalLoggedMinutes)}</span>
                    <span class="text-[10px] font-bold text-indigo-500 dark:text-indigo-400">인당: ${formatDuration(Math.round(actualTotalMinutes))}</span>
                    <span class="text-[9px] text-gray-400 mt-1.5 text-center leading-tight">
                        휴식 총 ${formatDuration(Math.round(totalBreakMinutes))}<br>
                        (인당 ${formatDuration(Math.round(actualBreakMinutes))})
                    </span>
                </div>
            </div>
        </div>
        <div class="flex-grow w-full md:w-auto">
            ${legendHTML}
        </div>
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
        container.innerHTML = `<p class="text-center text-gray-400 text-sm py-4">통계를 보려면 위에서 직원을 선택하세요.</p>`;
        return;
    }

    const memberRecords = (appState.workRecords || []).filter(r => r.member === selectedMember);
    const attendance = appState.dailyAttendance?.[selectedMember];
    const now = getCurrentTime();
    const ongoingRecord = memberRecords.find(r => r.status === 'ongoing');
    const pausedRecord = memberRecords.find(r => r.status === 'paused');
    
    let currentStatusHtml = '';
    if (ongoingRecord) {
        currentStatusHtml = `<span class="text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-md">업무 중: ${ongoingRecord.task}</span>`;
    } else if (pausedRecord) {
        currentStatusHtml = `<span class="text-sm font-bold text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 px-2 py-1 rounded-md">휴식 중</span>`;
    } else {
        const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
        const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
        const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

        const leaveInfo = combinedOnLeaveMembers.find(m => m.member === selectedMember && !(m.type === '외출' && m.endTime) && m.type !== '지각');
        if (leaveInfo) {
             const label = getLeaveDisplayLabel(selectedMember, leaveInfo);
             currentStatusHtml = `<span class="text-sm font-bold text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 px-2 py-1 rounded-md">${label} 중</span>`;
        } else {
             if (attendance && attendance.status === 'active') {
                 currentStatusHtml = `<span class="text-sm font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded-md">대기 중</span>`;
             } else if (attendance && attendance.status === 'returned') {
                 currentStatusHtml = `<span class="text-sm font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-md">퇴근 완료</span>`;
             } else {
                 currentStatusHtml = `<span class="text-sm font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-md">출근 전</span>`;
             }
        }
    }

    if (memberRecords.length === 0) {
         container.innerHTML = `
            <div class="flex justify-between items-center mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
                <h4 class="text-lg font-extrabold text-gray-800 dark:text-white">${selectedMember}</h4>
                ${currentStatusHtml}
            </div>
            <p class="text-center text-gray-400 text-sm py-4">오늘 업무 기록이 없습니다.</p>`;
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
        <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
            <h4 class="text-lg font-extrabold text-gray-800 dark:text-white">${selectedMember}</h4>
            ${currentStatusHtml}
        </div>
        <div class="grid grid-cols-2 gap-3 mb-4 text-center">
            <div class="bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-center">
                <div class="text-[11px] font-bold text-gray-400 dark:text-gray-500 mb-1">본인 실제 업무시간</div>
                <div class="text-xl font-extrabold text-blue-600 dark:text-blue-400">${formatDuration(totalLiveMinutes)}</div>
            </div>
             <div class="bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-center">
                <div class="text-[11px] font-bold text-gray-400 dark:text-gray-500 mb-1">비업무/휴식 추정</div>
                <div class="text-xl font-extrabold text-gray-500 dark:text-gray-400">${formatDuration(Math.round(totalNonWorkMinutes))}</div>
            </div>
        </div>
        <div>
            <h5 class="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">오늘 수행한 업무</h5>
            <ul class="space-y-2 max-h-40 overflow-y-auto pr-1">
    `;
    if (sortedTasks.length > 0) {
        sortedTasks.forEach(([task, minutes]) => {
            if (minutes > 0) {
                html += `<li class="flex justify-between items-center p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm"><span class="font-bold text-sm text-gray-700 dark:text-gray-200">${task}</span><span class="text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">${formatDuration(minutes)}</span></li>`;
            }
        });
    } else {
        html += `<li class="text-sm text-gray-400 text-center py-2">데이터 없음</li>`;
    }
    html += `</ul></div>`;
    container.innerHTML = html;
};