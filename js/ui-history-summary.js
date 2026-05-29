// === ui-history-summary.js (업무 이력 주/월별 요약 담당) ===

import { formatDuration, getWeekOfYear } from './utils.js';
// 헬퍼 함수를 reports 파일에서 가져옴 (순환 참조 해결)
import { getDiffHtmlForMetric } from './ui-history-reports-logic.js';

/**
 * 주/월별 요약 뷰 렌더링 (내부 헬퍼)
 * (ui-history.js -> ui-history-summary.js)
 */
const renderSummaryView = (mode, dataset, periodKey, wageMap = {}, previousPeriodDataset = null) => {
    const records = dataset.workRecords || [];
    const quantities = dataset.taskQuantities || {};

    // --- 1. 이전 기간(Previous) 데이터 계산 ---
    let prevTaskSummary = {};
    let prevTotalDuration = 0;
    let prevTotalQuantity = 0;
    let prevTotalCost = 0;
    let prevOverallAvgThroughput = 0;
    let prevOverallAvgCostPerItem = 0;

    if (previousPeriodDataset) {
        const prevRecords = previousPeriodDataset.workRecords || [];
        const prevQuantities = previousPeriodDataset.taskQuantities || {};

        prevTotalDuration = prevRecords.reduce((s, r) => s + (r.duration || 0), 0);
        prevTotalQuantity = Object.values(prevQuantities).reduce((s, q) => s + (Number(q) || 0), 0);
        prevTotalCost = prevRecords.reduce((s, r) => {
            const wage = wageMap[r.member] || 0;
            return s + ((r.duration || 0) / 60) * wage;
        }, 0);
        prevOverallAvgThroughput = prevTotalDuration > 0 ? (prevTotalQuantity / prevTotalDuration) : 0;
        prevOverallAvgCostPerItem = prevTotalQuantity > 0 ? (prevTotalCost / prevTotalQuantity) : 0;

        prevTaskSummary = prevRecords.reduce((acc, r) => {
            if (!r || !r.task) return acc;
            if (!acc[r.task]) {
                acc[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; 
            }
            acc[r.task].duration += (r.duration || 0);
            const wage = wageMap[r.member] || 0;
            acc[r.task].cost += ((r.duration || 0) / 60) * wage;
            acc[r.task].members.add(r.member);
            acc[r.task].recordCount += 1;
            return acc;
        }, {});

        // 1b. 이전 기간 Post-process (업무별)
        Object.keys(prevTaskSummary).forEach(task => {
            const summary = prevTaskSummary[task];
            const qty = Number(prevQuantities[task]) || 0;
            
            summary.quantity = qty;
            summary.avgThroughput = summary.duration > 0 ? (qty / summary.duration) : 0;
            summary.avgCostPerItem = qty > 0 ? (summary.cost / qty) : 0;
            summary.avgStaff = summary.members.size;
            summary.avgTime = (summary.recordCount > 0) ? (summary.duration / summary.recordCount) : 0;
        });
        Object.entries(prevQuantities || {}).forEach(([task, qtyValue]) => {
            if (!prevTaskSummary[task] && Number(qtyValue) > 0) {
                 prevTaskSummary[task] = { 
                     duration: 0, cost: 0, quantity: Number(qtyValue), 
                     avgThroughput: 0, avgCostPerItem: 0, 
                     members: new Set(), recordCount: 0,
                     avgStaff: 0, avgTime: 0
                 };
            }
        });
    }

    // --- 2. 현재 기간(Current) 데이터 계산 ---
    const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
    const totalQuantity = Object.values(quantities || {}).reduce((s, q) => s + (Number(q) || 0), 0);
    const totalCost = records.reduce((s, r) => {
        const wage = wageMap[r.member] || 0;
        return s + ((r.duration || 0) / 60) * wage;
    }, 0);

    const overallAvgThroughputNum = totalDuration > 0 ? (totalQuantity / totalDuration) : 0;
    const overallAvgCostPerItemNum = totalQuantity > 0 ? (totalCost / totalQuantity) : 0;

    const overallAvgThroughputStr = overallAvgThroughputNum.toFixed(2);
    const overallAvgCostPerItemStr = overallAvgCostPerItemNum.toFixed(0);

    const taskSummary = records.reduce((acc, r) => {
        if (!r || !r.task) return acc;
        if (!acc[r.task]) {
            acc[r.task] = { 
                duration: 0, 
                cost: 0, 
                members: new Set(),
                recordCount: 0
            };
        }
        acc[r.task].duration += (r.duration || 0);
        const wage = wageMap[r.member] || 0;
        acc[r.task].cost += ((r.duration || 0) / 60) * wage;
        acc[r.task].members.add(r.member);
        acc[r.task].recordCount += 1;
        return acc;
    }, {});

    Object.keys(taskSummary).forEach(task => {
        const summary = taskSummary[task];
        const qty = Number(quantities[task]) || 0;
        
        summary.quantity = qty;
        summary.avgThroughput = summary.duration > 0 ? (qty / summary.duration) : 0;
        summary.avgCostPerItem = qty > 0 ? (summary.cost / qty) : 0;
        summary.avgStaff = summary.members.size;
        summary.avgTime = (summary.recordCount > 0) ? (summary.duration / summary.recordCount) : 0;
    });
    Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
        if (!taskSummary[task] && Number(qtyValue) > 0) {
             taskSummary[task] = { 
                 duration: 0, cost: 0, quantity: Number(qtyValue), 
                 avgThroughput: 0, avgCostPerItem: 0, 
                 members: new Set(), recordCount: 0,
                 avgStaff: 0, avgTime: 0
             };
        }
    });

    // --- 3. HTML 렌더링 ---
    const durationDiff = previousPeriodDataset ? getDiffHtmlForMetric('totalDuration', totalDuration, prevTotalDuration) : '';
    const quantityDiff = previousPeriodDataset ? getDiffHtmlForMetric('totalQuantity', totalQuantity, prevTotalQuantity) : '';
    const costDiff = previousPeriodDataset ? getDiffHtmlForMetric('totalCost', totalCost, prevTotalCost) : '';
    const throughputDiff = previousPeriodDataset ? getDiffHtmlForMetric('overallAvgThroughput', overallAvgThroughputNum, prevOverallAvgThroughput) : '';
    const costPerItemDiff = previousPeriodDataset ? getDiffHtmlForMetric('overallAvgCostPerItem', overallAvgCostPerItemNum, prevOverallAvgCostPerItem) : '';

    let html = `<div id="summary-card-${periodKey}" class="bg-white p-4 rounded-lg shadow-sm mb-6 scroll-mt-4">`;
    html += `<h3 class="text-xl font-bold mb-4">${periodKey} 요약</h3>`;

    html += `<div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6 text-center">
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">총 시간</div>
            <div class="text-lg font-bold">${formatDuration(totalDuration)}</div>
            ${durationDiff}
        </div>
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">총 처리량</div>
            <div class="text-lg font-bold">${totalQuantity.toLocaleString()} 개</div>
            ${quantityDiff}
        </div>
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">총 인건비</div>
            <div class="text-lg font-bold">${Math.round(totalCost).toLocaleString()} 원</div>
            ${costDiff}
        </div>
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">평균 처리량</div>
            <div class="text-lg font-bold">${overallAvgThroughputStr} 개/분</div>
            ${throughputDiff}
        </div>
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">평균 처리비용</div>
            <div class="text-lg font-bold">${overallAvgCostPerItemStr} 원/개</div>
            ${costPerItemDiff}
        </div>
    </div>`;

    html += `<h4 class="text-lg font-semibold mb-3 text-gray-700">업무별 평균 (
                ${previousPeriodDataset ? (mode === 'weekly' ? '전주' : '전월') + ' 대비' : '이전 데이터 없음'}
            )</h4>`;
    
    html += `<div class="overflow-x-auto max-h-[60vh]">
               <table class="w-full text-sm text-left text-gray-600">
                 <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0">
                   <tr>
                     <th scope="col" class="px-4 py-2">업무</th>
                     <th scope="col" class="px-4 py-2 text-right">평균 처리량 (개/분)</th>
                     <th scope="col" class="px-4 py-2 text-right">평균 처리비용 (원/개)</th>
                     <th scope="col" class="px-4 py-2 text-right">총 참여인원 (명)</th>
                     <th scope="col" class="px-4 py-2 text-right">평균 처리시간 (건)</th>
                   </tr>
                 </thead>
                 <tbody>`;

    const sortedTasks = Object.keys(taskSummary).sort();
    let hasTaskData = false;
    if (sortedTasks.length > 0) {
        sortedTasks.forEach(task => {
            const summary = taskSummary[task];
            const prevSummary = prevTaskSummary[task] || null; 

            if (summary && (summary.duration > 0 || summary.quantity > 0)) {
                hasTaskData = true;

                const tableThroughputDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgThroughput', summary.avgThroughput, prevSummary?.avgThroughput) : '';
                const tableCostDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgCostPerItem', summary.avgCostPerItem, prevSummary?.avgCostPerItem) : '';
                const tableStaffDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgStaff', summary.avgStaff, prevSummary?.avgStaff) : '';
                const tableTimeDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgTime', summary.avgTime, prevSummary?.avgTime) : '';

                html += `<tr class="bg-white border-b hover:bg-gray-50">
                           <td class="px-4 py-2 font-medium text-gray-900">${task}</td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgThroughput.toFixed(2)}</div>
                                ${tableThroughputDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgCostPerItem.toFixed(0)}</div>
                                ${tableCostDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgStaff}</div>
                                ${tableStaffDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${formatDuration(summary.avgTime)}</div>
                                ${tableTimeDiff}
                           </td>
                         </tr>`;
            }
        });
    }

    if (!hasTaskData) {
        html += `<tr><td colspan="5" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }

    html += `    </tbody>
               </table>
             </div>`;

    html += `</div>`;
    return html;
};

/**
 * 업무 이력 - 주별 요약 렌더링
 * (ui-history.js -> ui-history-summary.js)
 */
export const renderWeeklyHistory = (selectedWeekKey, allHistoryData, appConfig) => {
    const view = document.getElementById('history-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 데이터 집계 중...</div>';

    try {
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        const weeklyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string') return acc;
            try {
                const dateObj = new Date(day.id);
                if (isNaN(dateObj.getTime())) return acc;

                const weekKey = getWeekOfYear(dateObj);
                if (!weekKey) return acc;

                if (!acc[weekKey]) acc[weekKey] = { workRecords: [], taskQuantities: {} };

                acc[weekKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[weekKey].taskQuantities[task] = (acc[weekKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) {
                console.error("Error processing day in weekly aggregation:", day.id, e);
            }
            return acc;
        }, {});

        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
        
        const currentData = weeklyData[selectedWeekKey];
        if (!currentData) {
            view.innerHTML = `<div class="text-center text-gray-500">${selectedWeekKey} 주에 해당하는 데이터가 없습니다.</div>`;
            return;
        }
        
        const currentIndex = sortedWeeks.indexOf(selectedWeekKey);
        const prevWeekKey = (currentIndex > -1 && currentIndex + 1 < sortedWeeks.length) 
                            ? sortedWeeks[currentIndex + 1] 
                            : null;
        const prevData = prevWeekKey ? weeklyData[prevWeekKey] : null;
        
        view.innerHTML = renderSummaryView('weekly', currentData, selectedWeekKey, combinedWageMap, prevData);

    } catch (error) {
        console.error("Error in renderWeeklyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">주별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>';
    }
};

/**
 * 업무 이력 - 월별 요약 렌더링
 * (ui-history.js -> ui-history-summary.js)
 */
export const renderMonthlyHistory = (selectedMonthKey, allHistoryData, appConfig) => {
    const view = document.getElementById('history-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 데이터 집계 중...</div>';

    try {
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                 if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        const monthlyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string' || day.id.length < 7) return acc;
            try {
                const monthKey = day.id.substring(0, 7);
                 if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;

                if (!acc[monthKey]) acc[monthKey] = { workRecords: [], taskQuantities: {} };
                acc[monthKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[monthKey].taskQuantities[task] = (acc[monthKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) {
                 console.error("Error processing day in monthly aggregation:", day.id, e);
            }
            return acc;
        }, {});

        const sortedMonths = Object.keys(monthlyData).sort((a,b) => b.localeCompare(a));

        const currentData = monthlyData[selectedMonthKey];
        if (!currentData) {
            view.innerHTML = `<div class="text-center text-gray-500">${selectedMonthKey} 월에 해당하는 데이터가 없습니다.</div>`;
            return;
        }

        const currentIndex = sortedMonths.indexOf(selectedMonthKey);
        const prevMonthKey = (currentIndex > -1 && currentIndex + 1 < sortedMonths.length)
                             ? sortedMonths[currentIndex + 1]
                             : null;
        const prevData = prevMonthKey ? monthlyData[prevMonthKey] : null;
            
        view.innerHTML = renderSummaryView('monthly', currentData, selectedMonthKey, combinedWageMap, prevData);
        
    } catch (error) {
        console.error("Error in renderMonthlyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">월별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>';
    }
};