// === js/ui-history-reports-calculations.js ===
import { isWeekday, getTodayDateString } from './utils.js';
import { getAsArray } from './ui-history-reports-utils.js';

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

    const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
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

export const calculateStandardThroughputs = (allHistoryData) => {
    const todayKey = getTodayDateString();
    
    const sortedHistory = [...allHistoryData].sort((a, b) => a.id.localeCompare(b.id));
    const taskDailySpeeds = {};

    sortedHistory.forEach(day => {
        if (day.id === todayKey) return;

        const records = getAsArray(day.workRecords);
        const quantities = day.taskQuantities || {};
        const dailyTaskStats = {};

        records.forEach(r => {
            const duration = Number(r.duration) || 0;
            if (r.task && duration > 0) {
                if (!dailyTaskStats[r.task]) dailyTaskStats[r.task] = { duration: 0, quantity: 0 };
                dailyTaskStats[r.task].duration += duration;
            }
        });

        Object.entries(quantities).forEach(([task, qty]) => {
            const q = Number(qty) || 0;
            if (q > 0) {
                if (!dailyTaskStats[task]) dailyTaskStats[task] = { duration: 0, quantity: 0 };
                dailyTaskStats[task].quantity += q;
            }
        });

        Object.entries(dailyTaskStats).forEach(([task, stats]) => {
            if (stats.duration >= 10 && stats.quantity > 0) {
                const speed = stats.quantity / stats.duration;
                if (!taskDailySpeeds[task]) taskDailySpeeds[task] = [];
                taskDailySpeeds[task].push(speed);
            }
        });
    });

    const standards = {};
    Object.keys(taskDailySpeeds).forEach(task => {
        const speeds = taskDailySpeeds[task];
        
        speeds.sort((a, b) => b - a);
        const top20 = speeds.slice(0, 20);
        
        if (top20.length > 0) {
            const avgTop = top20.reduce((a, b) => a + b, 0) / top20.length;
            standards[task] = avgTop;
        } else {
            standards[task] = 0;
        }
    });
    return standards;
};

export const calculatePeriodThroughputs = (daysData) => {
    const taskDailySpeeds = {};

    daysData.forEach(day => {
        const records = getAsArray(day.workRecords);
        const quantities = day.taskQuantities || {};
        const dailyTaskStats = {};

        records.forEach(r => {
            const duration = Number(r.duration) || 0;
            if (r.task && duration > 0) {
                if (!dailyTaskStats[r.task]) dailyTaskStats[r.task] = { duration: 0, quantity: 0 };
                dailyTaskStats[r.task].duration += duration;
            }
        });

        Object.entries(quantities).forEach(([task, qty]) => {
            const q = Number(qty) || 0;
            if (q > 0) {
                if (!dailyTaskStats[task]) dailyTaskStats[task] = { duration: 0, quantity: 0 };
                dailyTaskStats[task].quantity += q;
            }
        });

        Object.entries(dailyTaskStats).forEach(([task, stats]) => {
            if (stats.duration > 0 && stats.quantity > 0) {
                const speed = stats.quantity / stats.duration;
                if (!taskDailySpeeds[task]) taskDailySpeeds[task] = [];
                taskDailySpeeds[task].push(speed);
            }
        });
    });

    const periodStandards = {};
    Object.keys(taskDailySpeeds).forEach(task => {
        const speeds = taskDailySpeeds[task];
        if (speeds.length > 0) {
            const avgPeriod = speeds.reduce((a, b) => a + b, 0) / speeds.length;
            periodStandards[task] = avgPeriod;
        } else {
            periodStandards[task] = 0;
        }
    });
    return periodStandards;
};

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