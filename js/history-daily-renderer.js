// === js/history-daily-renderer.js ===
// 설명: 이력 보기의 '일별 상세' 탭 화면을 렌더링하는 모듈입니다.
// (수정됨: 현황판과 동일한 기준으로 유효 멤버 필터링 강화, 시스템 계정 제외)

import * as State from './state.js';
import { 
    formatDuration, isWeekday, calcTotalPauseMinutes, formatTimeTo24H, getTodayDateString
} from './utils.js';
import { getDiffHtmlForMetric } from './ui-history-reports-logic.js';

/**
 * 일별 상세 화면 렌더링 (KPI 카드 및 업무별 진행바 등)
 */
export const renderHistoryDetail = (dateKey, previousDayData = null) => {
    const view = document.getElementById('history-daily-view');
    if (!view) return;
    
    view.innerHTML = '<div class="text-center text-gray-500">데이터 로딩 중...</div>';

    const data = State.allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        view.innerHTML = '<div class="text-center text-red-500">해당 날짜의 데이터를 찾을 수 없습니다.</div>';
        return;
    }

    const records = data.workRecords || [];
    const quantities = data.taskQuantities || {};
    const partTimersFromHistory = data.partTimers || [];

    // 1. 시급 정보 매핑
    const wageMap = { ...State.appConfig.memberWages };
    partTimersFromHistory.forEach(pt => {
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });
    
    // ✅ [수정] 2. 근무 인원 계산 (엄격한 필터링 적용)
    const attendanceMap = data.dailyAttendance || {};
    const isToday = (dateKey === getTodayDateString());
    
    // 시스템 계정 (관리자 등) 목록 가져오기
    const systemAccounts = new Set((State.appConfig.systemAccounts || []).map(s => s.trim()));

    // 유효한 멤버 목록 생성 (현황판과 동일한 기준)
    // - 오늘: 현재 앱 상태(State.appConfig)의 실시간 목록 사용
    // - 과거: 당시 저장된 이력 데이터(data) 사용
    let validMemberNames = new Set();

    if (isToday) {
        // 오늘: 설정에 있는 정직원 + 현재 등록된 알바
        (State.appConfig.teamGroups || []).forEach(g => {
            g.members.forEach(m => validMemberNames.add(m.trim()));
        });
        (State.appState.partTimers || []).forEach(p => {
            if (p.name) validMemberNames.add(p.name.trim());
        });
    } else {
        // 과거: 설정에 있는 정직원(과거라 변경됐을 수 있으니 이력 우선이 맞으나 팀원은 보통 설정 기준) + 이력에 저장된 알바
        // (과거 이력의 경우, 퇴사자도 기록엔 남아있어야 하므로 이력 데이터의 partTimers를 신뢰)
        (State.appConfig.teamGroups || []).forEach(g => {
            g.members.forEach(m => validMemberNames.add(m.trim()));
        });
        partTimersFromHistory.forEach(p => {
            if (p.name) validMemberNames.add(p.name.trim());
        });
    }

    const clockedInMembers = new Set(
        Object.keys(attendanceMap).filter(rawName => {
            const member = rawName.trim();
            if (!member) return false;

            // 1) 시스템 계정 제외
            if (systemAccounts.has(member)) return false;

            // 2) 유효한 멤버 목록(팀원/알바)에 있는지 확인
            if (!validMemberNames.has(member)) return false;

            // 3) 출근(active) 또는 퇴근(returned) 상태인지 확인
            // (주의: 현황판은 active만 세지만, 이력은 '다녀간 사람'을 세야 하므로 returned도 포함)
            const status = attendanceMap[rawName].status;
            return status === 'active' || status === 'returned';
        })
    );
    
    // 출퇴근 기록이 없는 과거 데이터 호환성 (유효 멤버만 카운트)
    if (Object.keys(attendanceMap).length === 0 && records.length > 0) {
         records.forEach(r => {
             const mName = r.member ? r.member.trim() : '';
             if (mName && validMemberNames.has(mName) && !systemAccounts.has(mName)) {
                 clockedInMembers.add(mName);
             }
         });
    }

    const activeMembersCount = clockedInMembers.size;

    // 3. 데이터 집계 (총 시간, 비용, 수량)
    const totalSumDuration = records.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
    const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

    const taskDurations = records.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (Number(rec.duration) || 0); return acc; }, {});

    // 각 업무별 총 휴식 시간 집계
    const taskPauses = records.reduce((acc, rec) => {
        acc[rec.task] = (acc[rec.task] || 0) + calcTotalPauseMinutes(rec.pauses);
        return acc;
    }, {});

    const taskCosts = records.reduce((acc, rec) => {
        const wage = wageMap[rec.member] || 0;
        const cost = ((Number(rec.duration) || 0) / 60) * wage;
        acc[rec.task] = (acc[rec.task] || 0) + cost;
        return acc;
    }, {});

    // 4. 업무별 메트릭 생성
    const taskMetrics = {};
    const allTaskKeys = new Set([...Object.keys(taskDurations), ...Object.keys(quantities)]);
    
    allTaskKeys.forEach(task => {
        const duration = taskDurations[task] || 0;
        const cost = taskCosts[task] || 0;
        const qty = Number(quantities[task]) || 0;
        const pauseDuration = taskPauses[task] || 0;

        taskMetrics[task] = {
            duration: duration,
            pauseDuration: pauseDuration,
            cost: cost,
            quantity: qty,
            avgThroughput: duration > 0 ? (qty / duration) : 0,
            avgCostPerItem: qty > 0 ? (cost / qty) : 0
        };
    });

    // 5. 이전 데이터와 비교를 위한 메트릭 준비
    let prevTaskMetrics = {};
    const currentIndex = State.allHistoryData.findIndex(d => d.id === dateKey);

    allTaskKeys.forEach(task => {
        for (let i = currentIndex + 1; i < State.allHistoryData.length; i++) {
            const recentDay = State.allHistoryData[i];
            if (!recentDay) continue;

            const recentRecords = recentDay.workRecords || [];
            const recentQuantities = recentDay.taskQuantities || {};

            const taskRecords = recentRecords.filter(r => r.task === task);
            const duration = taskRecords.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
            const qty = Number(recentQuantities[task]) || 0;

            if (duration > 0 || qty > 0) {
                const cost = taskRecords.reduce((sum, r) => {
                    const wage = wageMap[r.member] || 0;
                    return sum + ((Number(r.duration) || 0) / 60) * wage;
                }, 0);
                
                prevTaskMetrics[task] = {
                    date: recentDay.id, 
                    duration: duration,
                    cost: cost,
                    quantity: qty,
                    avgThroughput: duration > 0 ? (qty / duration) : 0,
                    avgCostPerItem: qty > 0 ? (cost / qty) : 0
                };
                break; 
            }
        }
    });

    const avgThroughput = totalSumDuration > 0 ? (totalQuantity / totalSumDuration).toFixed(2) : '0.00';

    // 6. 비업무 시간(Non-Work Time) 계산
    let nonWorkHtml = '';
    const standardHoursSettings = State.appConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 };
    const standardHours = isWeekday(dateKey) ? (standardHoursSettings.weekday || 8) : (standardHoursSettings.weekend || 4);

    if (activeMembersCount > 0 || totalSumDuration > 0) {
        const totalPotentialMinutes = activeMembersCount * standardHours * 60;
        const nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalSumDuration);
        const percentage = totalPotentialMinutes > 0 ? (nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
        
        const titleText = isWeekday(dateKey) ? `총 비업무시간` : `총 비업무시간 (주말)`;
        const subText = isWeekday(dateKey) ? `(추정치, ${percentage}%)` : `(주말 ${standardHours}H 기준, ${percentage}%)`;

        nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]">
                        <h4 class="text-sm font-semibold text-gray-500">${titleText}</h4>
                        <p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes)}</p>
                        <p class="text-xs text-gray-500 mt-1">${subText}</p>
                       </div>`;
    } else {
         const titleText = isWeekday(dateKey) ? '총 비업무시간' : '총 비업무시간 (주말)';
         nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px] flex flex-col justify-center items-center">
                         <h4 class="text-sm font-semibold text-gray-500">${titleText}</h4>
                         <p class="text-lg font-bold text-gray-400">${isWeekday(dateKey) ? '데이터 없음' : '주말 근무 없음'}</p>
                        </div>`;
    }

    // 7. HTML 조립
    let html = `
    <div class="mb-6 pb-4 border-b flex justify-between items-center">
      <h3 class="text-2xl font-bold text-gray-800">${dateKey}</h3>
      <div>
        <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm"
                data-action="open-history-quantity-modal" data-date-key="${dateKey}">처리량 수정</button>
        <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2"
                data-action="request-history-deletion" data-date-key="${dateKey}">삭제</button>
      </div>
    </div>
    <div class="flex flex-wrap gap-4 mb-6">
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]">
        <h4 class="text-sm font-semibold text-gray-500">근무 인원 (출근 기준)</h4> 
        <p class="text-2xl font-bold text-gray-800">${activeMembersCount} 명</p>
      </div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총합 시간</h4><p class="text-2xl font-bold text-gray-800">${formatDuration(totalSumDuration)}</p></div>
      ${nonWorkHtml}
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold text-gray-800">${totalQuantity} 개</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">분당 평균 처리량</h4><p class="text-2xl font-bold text-gray-800">${avgThroughput} 개/분</p></div>
    </div>
  `;

    html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">`;

    // 업무별 처리량 카드
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
    let hasQuantities = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasQuantities = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('quantity', metrics.quantity, prevMetric?.quantity);
            const dateSpan = prevMetric ? `<span class="text-xs text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';

            html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.quantity} 개 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasQuantities) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
    html += `</div></div>`;

    // 업무별 분당 처리량 카드
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 분당 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
    let hasThroughput = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasThroughput = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevMetric?.avgThroughput);
            const dateSpan = prevMetric ? `<span class="text-xs text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';
            
            html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgThroughput.toFixed(2)} 개/분 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasThroughput) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
    html += `</div></div>`;

    // 업무별 개당 처리비용 카드
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 개당 처리비용</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
    let hasCostPerItem = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasCostPerItem = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevMetric?.avgCostPerItem);
            const dateSpan = prevMetric ? `<span class="text-xs text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';

            html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgCostPerItem.toFixed(0)} 원/개 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasCostPerItem) html += `<p class="text-gray-500 text-sm">처리량이 없어 계산 불가.</p>`;
    html += `</div></div>`;
    html += `</div>`;

    // 하단 업무별 시간 비중 (프로그레스 바)
    html += `<div class="bg-white p-4 rounded-lg shadow-sm">
                <div class="flex justify-between items-center mb-3">
                    <h4 class="text-lg font-bold text-gray-700">업무별 시간 비중</h4>
                    <button class="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-semibold py-1 px-2 rounded transition"
                            data-action="open-record-manager" data-date-key="${dateKey}">
                        기록 관리
                    </button>
                </div>
                <div class="space-y-3">`;
    
    const tasksWithTime = Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.duration > 0)
        .sort(([, a], [, b]) => b.duration - a.duration);

    if (tasksWithTime.length > 0) {
        tasksWithTime.forEach(([task, metrics]) => {
            const percentage = totalSumDuration > 0 ? (metrics.duration / totalSumDuration * 100).toFixed(1) : 0;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('duration', metrics.duration, prevMetric?.duration);
            const dateSpan = prevMetric ? `<span class="text-xs text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';
            const pauseText = metrics.pauseDuration > 0 ? ` <span class="text-xs text-gray-400 ml-2">(휴: ${formatDuration(metrics.pauseDuration)})</span>` : '';

            html += `
            <div>
              <div class="flex justify-between items-center mb-1 text-sm">
                <span class="font-semibold text-gray-600">${task}</span>
                <div>
                    <span>${formatDuration(metrics.duration)} (${percentage}%) ${diffHtml} ${dateSpan}</span>
                    ${pauseText}
                </div>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${percentage}%"></div></div>
            </div>`;
        });
    } else {
        html += `<p class="text-gray-500 text-sm">기록된 업무 시간이 없습니다.</p>`;
    }
    html += `</div></div>`;

    view.innerHTML = html;
};