// === js/analysis-logic.js ===
// 설명: 순수 계산 및 분석 함수 모음입니다. (시뮬레이션, 병목 분석, 예측 등)

import * as State from './state.js?v=202610021228';
import { formatDuration, getTodayDateString } from './utils.js?v=202610021228';
import { channelScope } from './revenue-channels.js?v=202610021228';

/**
 * 누락된 처리량이 있는지 확인하는 함수
 */
export const checkMissingQuantities = (dayData) => {
    if (!dayData || !dayData.workRecords) return [];

    const records = dayData.workRecords;
    const quantities = dayData.taskQuantities || {};
    const confirmedZeroTasks = dayData.confirmedZeroTasks || [];

    const durationByTask = records.reduce((acc, r) => {
        if (r.task && r.duration > 0) {
            acc[r.task] = (acc[r.task] || 0) + r.duration;
        }
        return acc;
    }, {});

    const tasksWithDuration = Object.keys(durationByTask);
    if (tasksWithDuration.length === 0) return [];
    
    const quantityTaskTypes = (State.appConfig && State.appConfig.quantityTaskTypes) ? State.appConfig.quantityTaskTypes : [];
    const missingTasks = [];

    for (const task of tasksWithDuration) {
        if (quantityTaskTypes.includes(task)) {
            const quantity = Number(quantities[task]) || 0;
            if (quantity <= 0 && !confirmedZeroTasks.includes(task)) {
                missingTasks.push(task);
            }
        }
    }

    return missingTasks;
};

const calculateLinkedTaskAverageDuration = (allHistoryData, appConfig) => {
    const links = (appConfig && appConfig.simulationTaskLinks) ? appConfig.simulationTaskLinks : {};
    const mainTasks = Object.keys(links);
    if (mainTasks.length === 0 || !allHistoryData) return {};

    const linkedTasks = new Set(Object.values(links));
    const taskStats = {}; 

    allHistoryData.forEach(day => {
        (day.workRecords || []).forEach(r => {
            if (linkedTasks.has(r.task)) {
                if (!taskStats[r.task]) {
                    taskStats[r.task] = { duration: 0, count: 0 };
                }
                taskStats[r.task].duration += (r.duration || 0);
                taskStats[r.task].count += 1;
            }
        });
    });

    const avgDurations = {}; 
    Object.entries(taskStats).forEach(([taskName, stats]) => {
        if (stats.count > 0) {
            avgDurations[taskName] = stats.duration / stats.count; 
        }
    });

    const mainTaskAvgDurations = {};
    for (const mainTask of mainTasks) {
        const linkedTaskName = links[mainTask];
        if (avgDurations[linkedTaskName]) {
            mainTaskAvgDurations[mainTask] = avgDurations[linkedTaskName];
        }
    }
    return mainTaskAvgDurations;
};

// ───────────────────────────────────────────────────────────
// 📊 예측 엔진 공통 부품
//   요일별 평균(이상치 제거) × 백테스트 보정계수 × EMA 추세 계수
//   매출·배송량뿐 아니라 채널별/업무별 어떤 지표에도 같은 방식으로 쓸 수 있도록 분리했다.
// ───────────────────────────────────────────────────────────
const filterOutliers = (arr) => {
    if (arr.length < 4) return arr;
    const sorted = [...arr].sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length / 4))];
    const q3 = sorted[Math.floor((sorted.length * (3 / 4)))];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    return arr.filter(x => x >= Math.max(0, lowerBound) && x <= upperBound);
};

const calcEMA = (dataArray, period) => {
    if (dataArray.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = dataArray[0];
    for (let i = 1; i < dataArray.length; i++) {
        ema = (dataArray[i] * k) + (ema * (1 - k));
    }
    return ema;
};

/**
 * 하나의 지표(valueOf로 뽑아낸 값)에 대한 예측 시리즈를 만든다.
 * @param {Array}    pastData      오늘 이전의 일자 데이터(오래된 순)
 * @param {Object}   todayData     오늘 데이터
 * @param {number}   daysToPredict 예측할 일수
 * @param {Function} valueOf       (dayData) => number
 * @param {number}   margin        예측 구간 폭 (0.10 = ±10%)
 */
const buildMetricPrediction = (pastData, todayData, todayStr, daysToPredict, valueOf, margin = 0.10) => {
    const dowAvg = {};
    for (let dow = 0; dow < 7; dow++) {
        const sameDow = pastData.filter(r => new Date(r.id).getDay() === dow);
        const valid = filterOutliers(sameDow.map(valueOf).filter(v => v > 0));
        dowAvg[dow] = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    }

    const series = pastData.map(valueOf).filter(v => v > 0);
    const ema7 = calcEMA(series.slice(-7), 7);
    const ema30 = calcEMA(series.slice(-30), 30);
    const trend = ema30 > 0 ? Math.max(0.7, Math.min(1.3, ema7 / ema30)) : 1;

    // 최근 14일 백테스트로 편향 보정
    let sumActual = 0, sumPred = 0;
    pastData.slice(-14).forEach(day => {
        const actual = valueOf(day);
        if (actual > 0) { sumActual += actual; sumPred += dowAvg[new Date(day.id).getDay()]; }
    });
    const errorFactor = sumPred > 0 ? Math.max(0.85, Math.min(1.15, sumActual / sumPred)) : 1;

    const todayDow = new Date(todayStr).getDay();
    const todayPredicted = Math.round(Math.max(0, dowAvg[todayDow] * errorFactor * trend));
    const todayActual = valueOf(todayData);

    const labels = [], predicted = [], range = [];
    const todayDateObj = new Date(todayStr);
    let tomorrow = 0;

    for (let i = 1; i <= daysToPredict; i++) {
        const targetDate = new Date(todayDateObj.getTime() + (i * 86400000));
        const decayTrend = 1 + (trend - 1) * Math.max(0.5, (1 - i * 0.05));
        const p = Math.round(Math.max(0, dowAvg[targetDate.getDay()] * errorFactor * decayTrend));

        labels.push(targetDate.toISOString().slice(5, 10));
        predicted.push(p);
        range.push({ min: Math.round(p * (1 - margin)), max: Math.round(p * (1 + margin)) });
        if (i === 1) tomorrow = p;
    }

    return { labels, predicted, range, trend, errorFactor, todayPredicted, todayActual, tomorrow };
};

/** 예측에 쓸 과거/오늘 데이터 분리 (최근 90일). 데이터가 7일 미만이면 null. */
const splitHistoryForPrediction = (historyData) => {
    const todayStr = getTodayDateString();
    const sortedData = [...(historyData || [])].sort((a, b) => a.id.localeCompare(b.id));
    const pastData = sortedData.filter(d => d.id < todayStr).slice(-90);
    if (pastData.length < 7) return null;
    const todayData = sortedData.find(d => d.id === todayStr) || { id: todayStr, management: {}, taskQuantities: {} };
    return { todayStr, sortedData, pastData, todayData };
};

/**
 * 🚀 [개선된 엔진] 고도화된 실적 및 트렌드 예측 (이상치 제거, EMA 적용)
 *
 * @param {Array}  historyData
 * @param {number} daysToPredict
 * @param {Object} scope  채널 스코프(revenue-channels.js의 channelScope). 생략하면 전체(총계) 기준.
 *   - revenueOf(day)     : 그 날의 매출
 *   - orderCountOf(day)  : 그 날의 주문 건수
 *   - deliveryOf(day)    : 그 날의 배송 물량
 *   채널을 지정하면 매출·주문건수·배송량이 모두 그 채널 데이터만으로 계산된다.
 */
export const predictFutureTrends = (historyData, daysToPredict = 14, scope = null) => {
    const ctx = splitHistoryForPrediction(historyData);
    if (!ctx) return null;
    const { todayStr, sortedData, pastData, todayData } = ctx;

    const sc = scope || channelScope(null);
    const revenueOf = sc.revenueOf;
    const orderCountOf = sc.orderCountOf;
    const deliveryOf = sc.deliveryOf;

    const rev = buildMetricPrediction(pastData, todayData, todayStr, daysToPredict, revenueOf);
    const del = buildMetricPrediction(pastData, todayData, todayStr, daysToPredict, deliveryOf);
    const ord = buildMetricPrediction(pastData, todayData, todayStr, daysToPredict, orderCountOf);

    const displayHist = sortedData.slice(-30);

    return {
        scope: { id: sc.id, label: sc.label, color: sc.color, deliveryLabel: sc.deliveryLabel, deliverySource: sc.deliverySource },
        historical: {
            labels: displayHist.map(d => d.id.substring(5)),
            revenue: displayHist.map(revenueOf),
            delivery: displayHist.map(deliveryOf),
            orderCount: displayHist.map(orderCountOf)
        },
        prediction: {
            labels: rev.labels,
            revenue: rev.predicted,
            delivery: del.predicted,
            orderCount: ord.predicted,
            rangeRevenue: rev.range,
            rangeDelivery: del.range,
            rangeOrderCount: ord.range,
            today: {
                predictedRev: rev.todayPredicted,
                predictedDel: del.todayPredicted,
                predictedOrd: ord.todayPredicted,
                actualRev: rev.todayActual,
                actualDel: del.todayActual,
                actualOrd: ord.todayActual,
                errorFactorRev: rev.errorFactor,
                errorFactorDel: del.errorFactor
            },
            tomorrow: {
                revenue: rev.tomorrow,
                delivery: del.tomorrow,
                orderCount: ord.tomorrow
            }
        },
        trend: {
            revenueFactor: rev.trend,
            deliveryFactor: del.trend,
            orderCountFactor: ord.trend
        }
    };
};

