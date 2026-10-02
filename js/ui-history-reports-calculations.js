// === js/ui-history-reports-calculations.js ===
import { isWeekday, getTodayDateString, getRegularMembersForCount } from './utils.js?v=202610021042';
import { taskSpeedPerMinute } from './task-throughput.js?v=202610021042';
import { getAsArray } from './ui-history-reports-utils.js?v=202610021042';

export const calculateReportKPIs = (data, appConfig, wageMap) => {
    if (!data) {
        return {
            totalDuration: 0, totalCost: 0, totalQuantity: 0,
            overallAvgThroughput: 0, overallAvgCostPerItem: 0,
            activeMembersCount: 0, nonWorkMinutes: 0, totalQualityCost: 0,
            coqPercentage: 0
        };
    }

    const records = getAsArray(data.workRecords);
    const quantities = data.taskQuantities || {};
    const onLeaveMemberEntries = getAsArray(data.onLeaveMembers);
    const partTimersFromHistory = getAsArray(data.partTimers);
    const qualityCostTasks = new Set(appConfig.qualityCostTasks || []);

    let totalDuration = 0;
    let totalCost = 0;
    let totalQualityCost = 0;

    records.forEach(r => {
        const duration = Number(r.duration) || 0;
        const cost = (duration / 60) * (wageMap[r.member] || 0);

        totalDuration += duration;
        totalCost += cost;

        if (qualityCostTasks.has(r.task)) {
            totalQualityCost += cost;
        }
    });

    const totalQuantity = Object.values(quantities).reduce((s, q) => s + (Number(q) || 0), 0);
    const overallAvgThroughput = totalDuration > 0 ? (totalQuantity / totalDuration) : 0;
    const overallAvgCostPerItem = totalQuantity > 0 ? (totalCost / totalQuantity) : 0;
    const coqPercentage = (totalCost > 0) ? (totalQualityCost / totalCost) * 100 : 0;

    const allRegularMembers = getRegularMembersForCount(appConfig, data.id); // 해당 날짜 재직 인원(퇴사자 과거 보존)
    const systemAccounts = new Set(appConfig.systemAccounts || []);
    
    const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);

    const activeRegularMembers = [...allRegularMembers].filter(name => !onLeaveMemberNames.includes(name) && !systemAccounts.has(name)).length;
    const activePartTimers = partTimersFromHistory.filter(pt => !onLeaveMemberNames.includes(pt.name)).length;

    const activeMembersCount = activeRegularMembers + activePartTimers;

    let nonWorkMinutes = 0;
    if (data.id && data.id.length === 10 && isWeekday(data.id)) {
        const standardHours = (appConfig.standardDailyWorkHours?.weekday || 8);
        const totalPotentialMinutes = activeMembersCount * standardHours * 60;
        nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalDuration);
    }

    return {
        totalDuration, totalCost, totalQuantity,
        overallAvgThroughput, overallAvgCostPerItem,
        activeMembersCount, nonWorkMinutes, totalQualityCost,
        coqPercentage
    };
};

export const calculateReportAggregations = (data, appConfig, wageMap, memberToPartMap) => {
    const records = getAsArray(data?.workRecords);
    const quantities = data?.taskQuantities || {};

    const partSummary = {};
    const memberSummary = {};
    const taskSummary = {};

    records.forEach(r => {
        if (!r || !r.task) return;
        const duration = Number(r.duration) || 0;
        const wage = wageMap[r.member] || 0;
        const cost = (duration / 60) * wage;
        const part = memberToPartMap.get(r.member) || '알바';

        if (!partSummary[part]) partSummary[part] = { duration: 0, cost: 0, members: new Set() };
        partSummary[part].duration += duration;
        partSummary[part].cost += cost;
        partSummary[part].members.add(r.member);

        if (!memberSummary[r.member]) memberSummary[r.member] = { duration: 0, cost: 0, tasks: new Set(), part: part };
        memberSummary[r.member].duration += duration;
        memberSummary[r.member].cost += cost;
        memberSummary[r.member].tasks.add(r.task);

        if (!taskSummary[r.task]) {
            taskSummary[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0, uniqueDays: new Set() };
        }
        taskSummary[r.task].duration += duration;
        taskSummary[r.task].cost += cost;
        taskSummary[r.task].members.add(r.member);
        taskSummary[r.task].recordCount += 1;
        
        const recordDate = r.date || data.id;
        if (recordDate) {
            taskSummary[r.task].uniqueDays.add(recordDate);
        }
    });

    const allTaskKeys = new Set([...Object.keys(taskSummary), ...Object.keys(quantities)]);
    allTaskKeys.forEach(task => {
        if (!taskSummary[task]) {
            taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0, uniqueDays: new Set() };
        }
        const summary = taskSummary[task];
        const qty = Number(quantities[task]) || 0;

        summary.quantity = qty;
        summary.avgThroughput = summary.duration > 0 ? (qty / summary.duration) : 0;
        summary.avgCostPerItem = qty > 0 ? (summary.cost / qty) : 0;
        summary.avgStaff = summary.members.size;
        summary.avgTime = (summary.recordCount > 0) ? (summary.duration / summary.recordCount) : 0;
        summary.efficiency = summary.avgStaff > 0 ? (summary.avgThroughput / summary.avgStaff) : 0;
        
        summary.workDays = summary.uniqueDays.size;
    });

    return { partSummary, memberSummary, taskSummary };
};

export const aggregateDaysToSingleData = (daysData, id) => {
    const aggregated = {
        id: id,
        workRecords: [],
        taskQuantities: {},
        onLeaveMembers: [],
        partTimers: [],
        management: { revenue: 0, orderCount: 0, inventoryQty: 0, inventoryAmt: 0 }
    };

    const partTimerNames = new Set();

    daysData.forEach(day => {
        getAsArray(day.workRecords).forEach(r => {
            aggregated.workRecords.push({ ...r, date: day.id });
        });
        
        getAsArray(day.onLeaveMembers).forEach(o => aggregated.onLeaveMembers.push(o));

        getAsArray(day.partTimers).forEach(p => {
            if (p && p.name && !partTimerNames.has(p.name)) {
                aggregated.partTimers.push(p);
                partTimerNames.add(p.name);
            }
        });

        Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
            aggregated.taskQuantities[task] = (aggregated.taskQuantities[task] || 0) + (Number(qty) || 0);
        });

        const m = day.management || {};
        aggregated.management.revenue += (Number(m.revenue) || 0);
        aggregated.management.orderCount += (Number(m.orderCount) || 0);
        aggregated.management.inventoryQty += (Number(m.inventoryQty) || 0);
        aggregated.management.inventoryAmt += (Number(m.inventoryAmt) || 0);
    });

    return aggregated;
};

/** 🎯 기준(목표) 속도 — 단위 **개/분**.
 *  전 기간의 일별 속도 중 빠른 순 20일 평균이라 '잘 돌아갔을 때의 속도'다.
 *  평상시 실적보다 높게 나오는 것이 정상이며, 이 값과 비교하면 대체로 '저하'로 보인다.
 *  실적 평균이 필요하면 calculatePeriodThroughputs(개/분) 나
 *  task-throughput.taskUph(개/시) 를 쓸 것. */
export const calculateStandardThroughputs = (allHistoryData) =>
    taskSpeedPerMinute(allHistoryData, {
        mode: 'bestDays', topN: 20, minMinutes: 10, skipDate: getTodayDateString()
    });

/** 📊 그 기간의 실적 평균 속도 — 단위 **개/분**.
 *  일별 속도를 낸 뒤 단순 평균(모든 날을 같은 무게로 본다). */
export const calculatePeriodThroughputs = (daysData) =>
    taskSpeedPerMinute(daysData, { mode: 'dailyAvg', minMinutes: 0 });

export const calculateAverageStaffing = (allHistoryData) => {
    if (!allHistoryData) return {};
    const taskDailyStaff = {};

    allHistoryData.forEach(day => {
        getAsArray(day.workRecords).forEach(r => {
            if (r.task && r.member) {
                if (!taskDailyStaff[r.task]) taskDailyStaff[r.task] = {};
                if (!taskDailyStaff[r.task][day.id]) {
                    taskDailyStaff[r.task][day.id] = new Set();
                }
                taskDailyStaff[r.task][day.id].add(r.member);
            }
        });
    });

    const avgStaffMap = {};
    Object.keys(taskDailyStaff).forEach(task => {
        const dayEntries = Object.values(taskDailyStaff[task]);
        const totalDays = dayEntries.length;
        if (totalDays > 0) {
            const totalStaffSum = dayEntries.reduce((sum, daySet) => sum + daySet.size, 0);
            avgStaffMap[task] = totalStaffSum / totalDays;
        }
    });
    return avgStaffMap;
};