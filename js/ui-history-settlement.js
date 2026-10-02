// === js/ui-history-settlement.js ===
// 🧾 팀 결산 보고: 월/분기/년 단위로 종합 인사이트·생산성·인력운영·업무리포트·근태이력·경영지표·검수이력을
// 한 화면에 상세하게 요약해서 보여주는 보고서 탭. 각 섹션의 실제 계산은 기존 모듈의 재사용 함수를 그대로 사용하고,
// 이 파일은 "기간 해석 + 심층 집계 + 보고서 렌더링"을 담당한다.

import * as State from './state.js?v=202610021122';
import { LEAVE_TYPES } from './state.js?v=202610021122';
import { getRegularMembersForCount, formatDuration, buildMemberHourlyWageMap, getTodayDateString, escapeHtml as esc } from './utils.js?v=202610021122';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { matchesFilter, hasFilter, filterCount, openFloatingFilter, closeFloatingFilter } from './table-filter.js?v=202610021122';
import { bindDrillListeners, drillWrap } from './settlement-drill.js?v=202610021122';

import {
    calculateReportKPIs,
    calculateReportAggregations,
    aggregateDaysToSingleData,
    calculatePeriodThroughputs,
    calculateAdvancedProductivity,
    calculateBenchmarkOEE,
    generateProductivityDiagnosis,
    analyzeUnitCost
} from './ui-history-reports-logic.js?v=202610021122';

import { aggregateManagementData } from './ui-history-management.js?v=202610021122';
import { ensureMilestonesLoaded, getMilestoneSummariesForPeriod } from './ui-history-milestones.js?v=202610021122';

// ============================================================
// 모듈 상태
// ============================================================
let _productHistoryCache = null; // product_history 컬렉션 캐시 (검수이력용)
let _currentPeriod = { granularity: 'month', year: new Date().getFullYear(), sub: new Date().getMonth() + 1 };
let _chartInstances = [];

function destroyCharts() {
    _chartInstances.forEach(c => { try { c.destroy(); } catch (e) { /* noop */ } });
    _chartInstances = [];
}

// ============================================================
// 1. 기간 해석 유틸
// ============================================================
const pad2 = (n) => String(n).padStart(2, '0');

function getQuarterMonthKeys(year, quarter) {
    const startMonth = (quarter - 1) * 3 + 1;
    return [0, 1, 2].map(i => `${year}-${pad2(startMonth + i)}`);
}

function getFilteredDaysForPeriod(granularity, year, sub) {
    const all = State.allHistoryData || [];
    if (granularity === 'month') {
        const key = `${year}-${pad2(sub)}`;
        return all.filter(d => typeof d.id === 'string' && d.id.substring(0, 7) === key);
    }
    if (granularity === 'quarter') {
        const keys = new Set(getQuarterMonthKeys(year, sub));
        return all.filter(d => typeof d.id === 'string' && keys.has(d.id.substring(0, 7)));
    }
    const key = String(year);
    return all.filter(d => typeof d.id === 'string' && d.id.substring(0, 4) === key);
}

function getPreviousPeriod(granularity, year, sub) {
    if (granularity === 'month') {
        let m = sub - 1, y = year;
        if (m < 1) { m = 12; y -= 1; }
        return { year: y, sub: m };
    }
    if (granularity === 'quarter') {
        let q = sub - 1, y = year;
        if (q < 1) { q = 4; y -= 1; }
        return { year: y, sub: q };
    }
    return { year: year - 1, sub: null };
}

function getPeriodLabel(granularity, year, sub) {
    if (granularity === 'month') return `${year}년 ${sub}월`;
    if (granularity === 'quarter') return `${year}년 ${sub}분기`;
    return `${year}년`;
}

// 검수이력(product_history)은 history 문서가 없는 날짜도 포함해야 하므로 실제 달력 범위를 계산
function getPeriodDateRange(granularity, year, sub) {
    if (granularity === 'month') {
        const last = new Date(year, sub, 0);
        return { from: `${year}-${pad2(sub)}-01`, to: `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}` };
    }
    if (granularity === 'quarter') {
        const startMonth = (sub - 1) * 3 + 1;
        const last = new Date(year, startMonth + 3 - 1, 0);
        return { from: `${year}-${pad2(startMonth)}-01`, to: `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}` };
    }
    return { from: `${year}-01-01`, to: `${year}-12-31` };
}

// ============================================================
// 2. 공용 빌더 헬퍼
// ============================================================
function buildWageMap(dayArrays, appConfig) {
    const wageMap = buildMemberHourlyWageMap(appConfig.memberWages); // 월기본급 → 시급(÷209)
    dayArrays.flat().forEach(day => {
        (day.partTimers || []).forEach(pt => {
            if (pt && pt.name && !wageMap[pt.name]) wageMap[pt.name] = pt.wage || 0;
        });
    });
    return wageMap;
}

function buildMemberToPartMap(appConfig) {
    const map = new Map();
    (appConfig.teamGroups || []).forEach(group => {
        (group.members || []).forEach(member => map.set(member, group.name));
    });
    return map;
}

// 연차/반차 항목의 실제 사용일수 (반차=0.5, 다일 연차는 평일만 카운트) — ui-history-leave.js의 계산 방식과 동일한 패턴
function countLeaveDays(entry) {
    if (entry.type && entry.type.includes('반차')) return 0.5;
    const start = entry.startDate || entry.date || '';
    const end = entry.endDate || start;
    if (!start) return 1;
    if (!end || end === start) return 1;
    let count = 0;
    const s = new Date(start), e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1;
    for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) {
        const dow = dt.getDay();
        if (dow !== 0 && dow !== 6) count++;
    }
    return count > 0 ? count : 1;
}

// 일자 정렬된 날짜별 총 처리량/매출 시계열 (차트용)
function buildDailySeries(days, valueFn) {
    const sorted = [...days].sort((a, b) => a.id.localeCompare(b.id));
    return {
        labels: sorted.map(d => d.id.slice(5)),
        values: sorted.map(d => valueFn(d)),
        ids: sorted.map(d => d.id)          // 파고들기에서 그날 상세를 찾을 때 쓴다
    };
}

// ============================================================
// 3. 섹션별 계산 함수
// ============================================================

// 공용 핵심 지표 번들 (여러 섹션이 공유)
function computeCoreMetrics(currentDays, previousDays, appConfig) {
    const wageMap = buildWageMap([currentDays, previousDays], appConfig);
    const memberToPartMap = buildMemberToPartMap(appConfig);

    const curAgg = aggregateDaysToSingleData(currentDays, 'settlement-current');
    const prevAgg = aggregateDaysToSingleData(previousDays, 'settlement-previous');

    const curKPIs = calculateReportKPIs(curAgg, appConfig, wageMap);
    const prevKPIs = calculateReportKPIs(prevAgg, appConfig, wageMap);

    const curAggr = calculateReportAggregations(curAgg, appConfig, wageMap, memberToPartMap);
    const prevAggr = calculateReportAggregations(prevAgg, appConfig, wageMap, memberToPartMap);

    const curThroughputs = calculatePeriodThroughputs(currentDays);
    const prevThroughputs = calculatePeriodThroughputs(previousDays);

    const curProd = calculateAdvancedProductivity(currentDays, curAggr, curThroughputs, appConfig, wageMap);
    const prevProd = calculateAdvancedProductivity(previousDays, prevAggr, prevThroughputs, appConfig, wageMap);

    const benchmarkOEE = calculateBenchmarkOEE(State.allHistoryData, appConfig);
    const diagnosis = generateProductivityDiagnosis(curProd, prevProd, benchmarkOEE);

    return { wageMap, memberToPartMap, curKPIs, prevKPIs, curAggr, prevAggr, curProd, prevProd, benchmarkOEE, diagnosis };
}

// 생산성·효율성: 처리량(수량) 중심 — 시간/금액은 부가 지표로만 사용
function computeThroughputSummary(currentDays, core) {
    const workingDays = currentDays.filter(d => (d.workRecords || []).length > 0);
    const daily = buildDailySeries(currentDays, d => Object.values(d.taskQuantities || {}).reduce((s, q) => s + (Number(q) || 0), 0));

    const totalQuantity = core.curKPIs.totalQuantity;
    const prevTotalQuantity = core.prevKPIs.totalQuantity;
    const avgDailyQuantity = workingDays.length > 0 ? totalQuantity / workingDays.length : 0;
    const prevWorkingDaysCount = core.prevAggr ? Object.keys(core.prevAggr.taskSummary).length : 0;

    // 최고/최저 처리량일
    let peakDay = null, lowDay = null;
    daily.labels.forEach((label, i) => {
        const v = daily.values[i];
        if (v <= 0) return;
        const id = daily.ids ? daily.ids[i] : null;
        if (!peakDay || v > peakDay.value) peakDay = { label, value: v, id };
        if (!lowDay || v < lowDay.value) lowDay = { label, value: v, id };
    });

    // 업무별 처리량 전체 분해 (share %, 전기간 대비, UPH는 참고용)
    const prevTaskQty = {};
    Object.entries(core.prevAggr.taskSummary).forEach(([task, s]) => { prevTaskQty[task] = s.quantity || 0; });

    const taskEntries = Object.entries(core.curAggr.taskSummary)
        .map(([task, s]) => ({
            task,
            quantity: s.quantity || 0,
            avgThroughput: s.avgThroughput || 0,
            avgStaff: s.avgStaff || 0,
            duration: s.duration || 0,
            prevQuantity: prevTaskQty[task] || 0
        }))
        .filter(t => t.quantity > 0 || t.duration > 0)
        .sort((a, b) => b.quantity - a.quantity);

    const taskTotalQty = taskEntries.reduce((sum, t) => sum + t.quantity, 0);
    taskEntries.forEach(t => {
        t.share = taskTotalQty > 0 ? (t.quantity / taskTotalQty * 100) : 0;
        t.changePct = t.prevQuantity > 0 ? ((t.quantity - t.prevQuantity) / t.prevQuantity * 100) : null;
    });

    return {
        daily, totalQuantity, prevTotalQuantity, avgDailyQuantity,
        workingDaysCount: workingDays.length, peakDay, lowDay, taskEntries
    };
}

function computeWorkforceSummary(currentDays, appConfig, core) {
    const workingDays = currentDays.filter(d => (d.workRecords || []).length > 0);
    const avgActiveMembers = workingDays.length > 0
        ? workingDays.reduce((s, d) => s + calculateReportKPIs(d, appConfig, core.wageMap).activeMembersCount, 0) / workingDays.length
        : 0;

    const partTimerNames = new Set();
    currentDays.forEach(d => (d.partTimers || []).forEach(p => { if (p && p.name) partTimerNames.add(p.name); }));

    const leaveSeen = new Set();
    let leaveDaysUsed = 0;
    const memberLeaveDays = {};
    currentDays.forEach(d => (d.onLeaveMembers || []).forEach(l => {
        if (!l || !l.type || !(l.type.includes('연차') || l.type.includes('반차'))) return;
        const key = `${l.member}|${l.type}|${l.startDate || l.date || ''}|${l.endDate || ''}`;
        if (leaveSeen.has(key)) return;
        leaveSeen.add(key);
        const days = countLeaveDays(l);
        leaveDaysUsed += days;
        memberLeaveDays[l.member] = (memberLeaveDays[l.member] || 0) + days;
    }));

    const topLeaveUsers = Object.entries(memberLeaveDays)
        .map(([member, days]) => ({ member, days }))
        .sort((a, b) => b.days - a.days)
        .slice(0, 8);

    // 파트별 인력 분포 (calculateReportAggregations의 partSummary 재사용)
    const partDistribution = Object.entries(core.curAggr.partSummary)
        .map(([part, s]) => ({ part, memberCount: s.members.size, duration: s.duration }))
        .sort((a, b) => b.memberCount - a.memberCount);

    return {
        avgActiveMembers,
        regularMemberCount: getRegularMembersForCount(appConfig).size,
        partTimerCount: partTimerNames.size,
        partTimerNames: [...partTimerNames],
        leaveDaysUsed,
        topLeaveUsers,
        partDistribution,
        workingDaysCount: workingDays.length
    };
}

function computeAttendanceSummary(currentDays) {
    const seen = new Set();
    const typeCounts = {};
    LEAVE_TYPES.forEach(t => { typeCounts[t] = 0; });
    const memberCounts = {};

    currentDays.forEach(day => {
        (day.onLeaveMembers || []).forEach(entry => {
            if (!entry || !entry.type || !entry.member) return;
            const start = entry.startDate || entry.date || '';
            const end = entry.endDate || start;
            const key = `${entry.member}|${entry.type}|${start}|${end}`;
            if (seen.has(key)) return;
            seen.add(key);

            typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
            if (!memberCounts[entry.member]) memberCounts[entry.member] = {};
            memberCounts[entry.member][entry.type] = (memberCounts[entry.member][entry.type] || 0) + 1;
        });
    });

    const memberRows = Object.entries(memberCounts)
        .map(([member, counts]) => ({
            member, counts,
            total: Object.values(counts).reduce((a, b) => a + b, 0),
            absence: counts['결근'] || 0,
            late: counts['지각'] || 0,
            outing: counts['외출'] || 0,
            earlyLeave: counts['조퇴'] || 0
        }))
        .sort((a, b) => (b.absence - a.absence) || (b.late - a.late) || (b.outing - a.outing) || (b.earlyLeave - a.earlyLeave) || (b.total - a.total))
        .slice(0, 10);

    const totalEvents = Object.values(typeCounts).reduce((a, b) => a + b, 0);

    return { typeCounts, memberRows, totalEvents };
}

function computeWorkReportSummary(core) {
    const taskEntries = Object.entries(core.curAggr.taskSummary)
        .map(([task, s]) => ({ task, quantity: s.quantity || 0, cost: s.cost || 0, duration: s.duration || 0, avgStaff: s.avgStaff || 0, workDays: s.workDays || 0 }))
        .filter(t => t.quantity > 0 || t.duration > 0)
        .sort((a, b) => b.duration - a.duration);

    const totalDuration = taskEntries.reduce((s, t) => s + t.duration, 0);
    taskEntries.forEach(t => { t.timeShare = totalDuration > 0 ? (t.duration / totalDuration * 100) : 0; });

    const memberEntries = Object.entries(core.curAggr.memberSummary || {})
        .map(([member, s]) => ({ member, duration: s.duration || 0, cost: s.cost || 0, taskCount: s.tasks ? s.tasks.size : 0, part: s.part || '' }))
        .sort((a, b) => b.duration - a.duration);

    const partRows = Object.entries(core.curAggr.partSummary)
        .map(([part, s]) => ({ part, duration: s.duration, cost: s.cost, memberCount: s.members.size }))
        .sort((a, b) => b.duration - a.duration);

    return {
        taskEntries, memberEntries, partRows,
        taskCount: taskEntries.length,
        memberCount: memberEntries.length
    };
}

function computeManagementSummary(currentDays, previousDays, appConfig, core) {
    const curMgmt = aggregateManagementData(currentDays);
    const prevMgmt = aggregateManagementData(previousDays);
    const revenueDaily = buildDailySeries(currentDays, d => Number(d.management?.revenue) || 0);

    let unitCost = null;
    if ((appConfig.costCalcTasks || []).length > 0) {
        const curSingle = aggregateDaysToSingleData(currentDays, 'settlement-mgmt-current');
        unitCost = analyzeUnitCost(curSingle, appConfig, core.wageMap, curMgmt.revenue);
    }

    return { curMgmt, prevMgmt, unitCost, revenueDaily };
}

function computeInspectionSummary(productHistoryCache, from, to) {
    let totalInspectedQty = 0, totalDefectQty = 0, totalInspectionCount = 0, totalDefectCount = 0;
    const productStats = {};
    const defectReasonCounts = {};
    const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];
    const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염' };

    (productHistoryCache || []).forEach(product => {
        const pName = product.id;
        (product.logs || []).forEach(log => {
            if (!log.date || log.date < from || log.date > to) return;

            const qty = Number(log.inboundQty) || Number(log.qty) || 0;
            totalInspectionCount += 1;
            totalInspectedQty += qty;

            if (!productStats[pName]) productStats[pName] = { totalQty: 0, defectQty: 0, inspCount: 0, defectCount: 0, reasons: [] };
            productStats[pName].totalQty += qty;
            productStats[pName].inspCount += 1;

            let isDefect = log.status === '불량';
            const reasons = [];
            if (log.defects && Array.isArray(log.defects) && log.defects.length > 0) { isDefect = true; reasons.push(...log.defects); }
            if (log.checklist) {
                Object.entries(log.checklist).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const cleanVal = String(val).trim();
                        if (cleanVal && !normalValues.includes(cleanVal)) {
                            isDefect = true;
                            reasons.push(`${labelMap[key] || key}: ${cleanVal}`);
                        }
                    }
                });
            }

            if (isDefect) {
                totalDefectCount += 1;
                totalDefectQty += qty;
                productStats[pName].defectCount += 1;
                productStats[pName].defectQty += qty;
                const reasonList = reasons.length > 0 ? reasons : ['상태 불량/기타'];
                reasonList.forEach(r => { defectReasonCounts[r] = (defectReasonCounts[r] || 0) + 1; });
                productStats[pName].reasons.push(...reasonList);
            }
        });
    });

    const qtyDefectRate = totalInspectedQty > 0 ? (totalDefectQty / totalInspectedQty * 100) : 0;
    const countDefectRate = totalInspectionCount > 0 ? (totalDefectCount / totalInspectionCount * 100) : 0;

    const topDefective = Object.entries(productStats)
        .map(([name, s]) => ({
            name, defectCount: s.defectCount, defectQty: s.defectQty, totalQty: s.totalQty,
            commonReason: Object.entries(s.reasons.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
        }))
        .filter(p => p.defectCount > 0)
        .sort((a, b) => b.defectCount - a.defectCount)
        .slice(0, 10);

    const topReasons = Object.entries(defectReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
        totalInspectedQty, totalDefectQty, totalInspectionCount, totalDefectCount,
        qtyDefectRate, countDefectRate, topDefective, topReasons,
        productTypeCount: Object.keys(productStats).length
    };
}

// 마일스톤 유형별 운영방안 문구 (효과 방향에 따라)
const MILESTONE_TYPE_ACTIONS = {
    location_change: { good: '로케이션·동선 최적화 효과가 확인됐습니다. 동일한 배치 원칙을 유사 구역·품목으로 확대 적용하세요.', bad: '변경 후 처리 효율이 떨어졌습니다. 이전 로케이션으로의 부분 원복 또는 동선 재설계를 검토하세요.' },
    staffing:        { good: '인력 구성 변경이 생산성에 긍정적으로 작용했습니다. 현재 인원 구성을 유지하고 피크 시간대 배치를 표준화하세요.', bad: '인력 변경 후 효율이 저하됐습니다. 교차 훈련으로 숙련도를 보강하거나 배치를 재조정하세요.' },
    process:         { good: '프로세스 개선 효과가 확인됐습니다. 표준작업(SOP)으로 문서화해 전 인원에게 정착시키세요.', bad: '프로세스 변경이 오히려 효율을 떨어뜨렸습니다. 원복 후 병목 구간을 다시 분석하세요.' },
    inflow:          { good: '입출고 패턴 변화가 처리에 유리하게 작용했습니다. 현재 입고 스케줄·물량 분산 방식을 유지하세요.', bad: '입출고 패턴 변화로 부하가 커졌습니다. 입고 평준화나 인력 사전 배치로 대응하세요.' },
    policy:          { good: '정책 변경이 긍정적 효과를 냈습니다. 정책을 공식화하고 지속 모니터링하세요.', bad: '정책 변경 후 지표가 악화됐습니다. 정책 완화 또는 예외 기준 보완을 검토하세요.' },
    system:          { good: '시스템·장비 변경 효과가 확인됐습니다. 안정화 후 유사 공정으로 확대 도입을 검토하세요.', bad: '시스템·장비 변경 후 효율이 낮아졌습니다. 설정 점검·교육 보강 또는 원복이 필요합니다.' },
    memo:            { good: '변경 이후 지표가 개선됐습니다. 개선 요인을 구체적으로 파악해 재현 가능하도록 만드세요.', bad: '변경 이후 지표가 악화됐습니다. 원인을 파악해 조치하세요.' }
};

// 마일스톤 1건의 결과 해석 + 운영방안 생성
function buildMilestoneInsight(it) {
    const m = it.milestone;
    const s = it.summary;
    if (!s.hasEnoughData) {
        return {
            cls: 'insufficient',
            interp: `전·후 관측 일수가 부족해(Before ${s.before.dayCount}일 / After ${s.after.dayCount}일) 아직 효과를 판정할 수 없습니다.`,
            action: `기준일(${m.date}) 이후 데이터가 충분히 쌓이면 자동으로 재평가됩니다. 그때까지 기록을 계속 유지하세요.`
        };
    }
    const uph = it.uphPct, qty = it.qtyPct;
    const up = (uph !== null && uph > 0.5) || (qty !== null && qty > 0.5);
    const down = (uph !== null && uph < -0.5) || (qty !== null && qty < -0.5);
    let cls = 'flat';
    if (up && !down) cls = 'good';
    else if (down && !up) cls = 'bad';
    else if (up && down) cls = 'mixed';

    const parts = [];
    if (uph !== null) parts.push(`시간당 처리(UPH) ${uph >= 0 ? '+' : ''}${uph.toFixed(1)}%`);
    if (qty !== null) parts.push(`일평균 처리량 ${qty >= 0 ? '+' : ''}${qty.toFixed(1)}%`);
    if (it.durPct !== null) parts.push(`작업시간 ${it.durPct >= 0 ? '+' : ''}${it.durPct.toFixed(1)}%`);
    const metricTxt = parts.join(' · ');

    const typeActions = MILESTONE_TYPE_ACTIONS[m.type] || MILESTONE_TYPE_ACTIONS.memo;
    let interp, action;
    if (cls === 'good') {
        interp = `변경 후 ${metricTxt}로 개선됐습니다. 이 변경은 효과가 검증된 것으로 볼 수 있습니다.`;
        action = typeActions.good;
    } else if (cls === 'bad') {
        interp = `변경 후 ${metricTxt}로 지표가 악화됐습니다. 변경이 부정적으로 작용했을 가능성이 높습니다.`;
        action = typeActions.bad;
    } else if (cls === 'mixed') {
        interp = `변경 후 지표가 엇갈립니다(${metricTxt}). 인력·물량 등 외부 요인이 섞였을 수 있습니다.`;
        action = '처리량과 UPH가 다른 방향인지, 물량·인력 변동 때문인지 요인을 분리해 재확인한 뒤 확대 여부를 결정하세요.';
    } else {
        interp = `변경 전후로 유의미한 지표 변화가 없습니다(${metricTxt}).`;
        action = '효과가 제한적입니다. 이 변경만으로는 성과 개선이 어려우므로 다른 개선 레버를 함께 검토하세요.';
    }
    return { cls, interp, action };
}

// 기간 내 발생한 마일스톤 + before/after 효과 요약 (ui-history-milestones.js 재사용)
function computeMilestoneSummaryForPeriod(from, to) {
    const items = getMilestoneSummariesForPeriod(from, to, 14);
    // 효과가 명확한(충분한 데이터) 항목을 우선 정렬 — UPH 개선 큰 순
    const withStats = items.map(it => {
        const s = it.summary;
        const uphPct = s.before.uph > 0 ? ((s.after.uph - s.before.uph) / s.before.uph * 100) : null;
        const qtyPct = s.before.avgQtyPerDay > 0 ? ((s.after.avgQtyPerDay - s.before.avgQtyPerDay) / s.before.avgQtyPerDay * 100) : null;
        const durPct = s.before.avgDurationPerDay > 0 ? ((s.after.avgDurationPerDay - s.before.avgDurationPerDay) / s.before.avgDurationPerDay * 100) : null;
        const enriched = { ...it, uphPct, qtyPct, durPct };
        enriched.insight = buildMilestoneInsight(enriched);
        return enriched;
    }).sort((a, b) => {
        // 데이터 충분한 것 우선, 그다음 최신순
        if (a.summary.hasEnoughData !== b.summary.hasEnoughData) return a.summary.hasEnoughData ? -1 : 1;
        return (b.milestone.date || '').localeCompare(a.milestone.date || '');
    });

    const measured = withStats.filter(it => it.summary.hasEnoughData);
    const positive = measured.filter(it => it.insight.cls === 'good');
    const negative = measured.filter(it => it.insight.cls === 'bad');

    return { items: withStats, total: withStats.length, measuredCount: measured.length, positiveCount: positive.length, negativeCount: negative.length };
}

// 종합의견 — 각 섹션의 핵심 지표를 종합해 자동 서술
function computeOverallOpinion(core, tp, wf, att, mg, insp, ms, workingDaysCount) {
    const points = []; // { tone, icon, text }
    if (workingDaysCount === 0) return { verdict: null, points, summaryText: '해당 기간에 업무 기록이 없어 종합의견을 생성할 수 없습니다.' };

    const oee = core.curProd.oee;
    const prevOee = core.prevProd.oee;
    const qtyPct = tp.prevTotalQuantity > 0 ? ((tp.totalQuantity - tp.prevTotalQuantity) / tp.prevTotalQuantity * 100) : null;

    // 1) 생산성 총평
    if (qtyPct !== null) {
        if (qtyPct >= 5) points.push({ tone: 'blue', icon: '📈', text: `총 처리량이 전기간 대비 <b>${qtyPct.toFixed(1)}% 증가</b>했습니다(${fmt(tp.prevTotalQuantity)}→${fmt(tp.totalQuantity)}개). 생산 물량이 확대되는 흐름입니다.` });
        else if (qtyPct <= -5) points.push({ tone: 'red', icon: '📉', text: `총 처리량이 전기간 대비 <b>${Math.abs(qtyPct).toFixed(1)}% 감소</b>했습니다(${fmt(tp.prevTotalQuantity)}→${fmt(tp.totalQuantity)}개). 물량 감소 원인 점검이 필요합니다.` });
        else points.push({ tone: 'gray', icon: '➖', text: `총 처리량은 전기간과 유사한 수준입니다(${fmt(tp.totalQuantity)}개, ${qtyPct >= 0 ? '+' : ''}${qtyPct.toFixed(1)}%).` });
    } else {
        points.push({ tone: 'gray', icon: '📊', text: `이 기간 총 처리량은 <b>${fmt(tp.totalQuantity)}개</b>이며, 비교할 전기간 데이터가 없습니다.` });
    }

    // 2) OEE 총평
    if (oee < 60) points.push({ tone: 'red', icon: '🔴', text: `종합 생산효율(OEE)이 <b>${oee.toFixed(0)}%</b>로 낮은 편입니다. 가용·성능·품질 손실 요인 중 가장 큰 항목부터 개선이 필요합니다.` });
    else if (oee < 80) points.push({ tone: 'amber', icon: '🟡', text: `종합 생산효율(OEE)은 <b>${oee.toFixed(0)}%</b>로 보통 수준입니다${prevOee > 0 ? ` (전기간 ${prevOee.toFixed(0)}%)` : ''}.` });
    else points.push({ tone: 'emerald', icon: '🟢', text: `종합 생산효율(OEE)이 <b>${oee.toFixed(0)}%</b>로 우수합니다${prevOee > 0 ? ` (전기간 ${prevOee.toFixed(0)}%)` : ''}. 현재 운영 수준을 유지하는 것이 관건입니다.` });

    // 3) 인력 운영
    if (core.curProd.requiredFTE > 0) {
        const gap = core.curProd.workedFTE - core.curProd.requiredFTE;
        const gapPct = core.curProd.requiredFTE > 0 ? (gap / core.curProd.requiredFTE * 100) : 0;
        if (gapPct > 15) points.push({ tone: 'amber', icon: '👥', text: `실투입 인력(${core.curProd.workedFTE.toFixed(1)} FTE)이 표준 필요인력(${core.curProd.requiredFTE.toFixed(1)} FTE) 대비 <b>${gapPct.toFixed(0)}% 많습니다</b>. 인력 대비 산출이 낮을 수 있어 배치 효율 점검을 권장합니다.` });
        else if (gapPct < -15) points.push({ tone: 'blue', icon: '👥', text: `실투입 인력(${core.curProd.workedFTE.toFixed(1)} FTE)이 표준 필요인력(${core.curProd.requiredFTE.toFixed(1)} FTE)보다 적은데도 물량을 소화했습니다. 밀도 높은 운영이나 과부하 여부 확인이 필요합니다.` });
        else points.push({ tone: 'gray', icon: '👥', text: `실투입 인력과 표준 필요인력이 균형(${core.curProd.workedFTE.toFixed(1)} vs ${core.curProd.requiredFTE.toFixed(1)} FTE)을 이루고 있습니다.` });
    }

    // 4) 근태
    const absence = att.typeCounts['결근'] || 0;
    const late = att.typeCounts['지각'] || 0;
    if (absence + late >= 5) points.push({ tone: 'amber', icon: '🕒', text: `결근 ${absence}건·지각 ${late}건이 발생했습니다. 특정 인원 집중 여부와 원인 관리가 필요합니다.` });
    else if (att.totalEvents > 0) points.push({ tone: 'gray', icon: '🕒', text: `근태는 대체로 안정적입니다(결근 ${absence}·지각 ${late}건).` });

    // 5) 검수 품질
    if (insp.totalInspectionCount > 0) {
        if (insp.qtyDefectRate >= 5) points.push({ tone: 'red', icon: '🔍', text: `입고 검수 불량률이 <b>${insp.qtyDefectRate.toFixed(1)}%</b>(수량 기준)로 높습니다. 상위 불량사유(${insp.topReasons.slice(0, 2).map(r => r[0]).join(', ') || '기타'}) 중심의 공급처 개선이 필요합니다.` });
        else points.push({ tone: 'emerald', icon: '🔍', text: `입고 검수 불량률은 <b>${insp.qtyDefectRate.toFixed(1)}%</b>로 양호한 수준입니다.` });
    }

    // 6) 매출/경영
    if (mg.curMgmt.revenue > 0) {
        const revPct = mg.prevMgmt.revenue > 0 ? ((mg.curMgmt.revenue - mg.prevMgmt.revenue) / mg.prevMgmt.revenue * 100) : null;
        if (revPct !== null) points.push({ tone: revPct >= 0 ? 'blue' : 'red', icon: '💹', text: `총 매출은 <b>${fmt(mg.curMgmt.revenue)}원</b>으로 전기간 대비 ${revPct >= 0 ? '+' : ''}${revPct.toFixed(1)}%입니다.` });
        else points.push({ tone: 'gray', icon: '💹', text: `총 매출은 <b>${fmt(mg.curMgmt.revenue)}원</b>입니다.` });
    }

    // 7) 마일스톤 효과
    if (ms.total > 0) {
        if (ms.measuredCount === 0) points.push({ tone: 'gray', icon: '📍', text: `이 기간에 마일스톤 ${ms.total}건이 등록됐으나 아직 전/후 데이터가 충분치 않아 효과 판정은 보류 상태입니다.` });
        else if (ms.positiveCount > ms.negativeCount) points.push({ tone: 'emerald', icon: '📍', text: `운영 마일스톤 ${ms.measuredCount}건 중 <b>${ms.positiveCount}건에서 긍정적 효과</b>가 확인됐습니다. 효과가 좋은 변경은 표준화·확대 적용을 검토하세요.` });
        else if (ms.negativeCount > ms.positiveCount) points.push({ tone: 'amber', icon: '📍', text: `운영 마일스톤 ${ms.measuredCount}건 중 ${ms.negativeCount}건에서 부정적 변화가 관찰됐습니다. 해당 변경의 원복 또는 보완이 필요합니다.` });
        else points.push({ tone: 'gray', icon: '📍', text: `운영 마일스톤 ${ms.measuredCount}건의 효과는 뚜렷한 방향성 없이 혼재되어 있습니다.` });
    }

    // ============================================================
    // 이후 운영 계획 / 방향 (진단값 기반 실행 과제)
    // ============================================================
    const plans = []; // { icon, title, text }

    // A) 생산성·OEE 개선 — 가장 큰 손실 항목을 지목해 우선 과제화
    const losses = [
        { key: '가용 손실', cost: core.curProd.availabilityLossCost || 0, tip: '근무 시작 지연·대기·비가동 시간을 줄이도록 작업 준비·전환 시간을 단축하고 시작 시간을 앞당기세요.' },
        { key: '성능 손실', cost: core.curProd.performanceLossCost || 0, tip: '표준 속도 대비 느린 상위 업무의 병목을 개선하고 속도 저하 원인(동선·장비·숙련도)을 제거하세요.' },
        { key: '품질 손실', cost: core.curProd.qualityLossCost || 0, tip: '재작업·불량을 줄이도록 작업 표준과 자체 검수 기준을 강화하세요.' }
    ].sort((a, b) => b.cost - a.cost);
    const topLoss = losses[0];
    let oeeTarget;
    if (oee < 60) oeeTarget = '60% 이상';
    else if (oee < 80) oeeTarget = `${Math.min(85, Math.ceil((oee + 5) / 5) * 5)}%`;
    else oeeTarget = '현 수준(80%+) 유지';
    let planText = `다음 기간 OEE 목표를 <b>${oeeTarget}</b>로 설정하세요.`;
    if (topLoss && topLoss.cost > 0) planText += ` 현재 손실 비중이 가장 큰 <b>${topLoss.key}(${fmt(topLoss.cost)}원)</b>부터 집중 개선합니다 — ${topLoss.tip}`;
    plans.push({ icon: '🎯', title: '생산 효율(OEE) 개선', text: planText });

    // B) 물량 대응
    if (qtyPct !== null && qtyPct <= -5) plans.push({ icon: '📦', title: '물량 회복', text: `처리량 감소가 발주·입고 물량 자체의 감소인지, 처리 지연인지 구분해 원인을 규명하세요. 물량 요인이면 영업·발주와 협의하고, 처리 요인이면 병목 업무에 인력을 우선 배치하세요.` });
    else if (qtyPct !== null && qtyPct >= 10) plans.push({ icon: '📦', title: '증가 물량 대응', text: `물량이 뚜렷이 늘고 있습니다. 피크일 기준으로 인력·작업 공간·검수 캐파를 사전 확보해 처리 지연과 품질 저하를 예방하세요.` });

    // C) 인력 운영 방향
    if (core.curProd.requiredFTE > 0) {
        const gapPct = (core.curProd.workedFTE - core.curProd.requiredFTE) / core.curProd.requiredFTE * 100;
        if (gapPct > 15) plans.push({ icon: '👥', title: '인력 배치 효율화', text: `표준 대비 인력이 ${gapPct.toFixed(0)}% 초과 투입됐습니다. 저부하 시간대 인원을 축소하거나 고부하 업무로 재배치하고, 파트타이머 투입을 물량에 연동해 조정하세요.` });
        else if (gapPct < -15) plans.push({ icon: '👥', title: '과부하 예방', text: `표준보다 적은 인력으로 운영되고 있어 특정 인원 과부하·번아웃 위험이 있습니다. 교차 훈련으로 대체 가능 인력을 늘리고 핵심 업무의 백업 인원을 확보하세요.` });
    }

    // D) 근태 관리
    if (absence + late >= 5) plans.push({ icon: '🕒', title: '근태 관리', text: `결근·지각이 집중된 인원을 식별해 1:1 면담과 원인 파악을 진행하고, 반복 시 근태 기준·교대 방식을 재점검하세요.` });

    // E) 품질/공급처
    if (insp.totalInspectionCount > 0 && insp.qtyDefectRate >= 5) plans.push({ icon: '🔍', title: '입고 품질 개선', text: `불량률이 높습니다. 상위 불량사유(${insp.topReasons.slice(0, 2).map(r => r[0]).join(', ') || '기타'})와 불량 상위 제품을 공급처에 피드백하고, 재발 시 발주 조건·검수 강화 등 조치 기준을 마련하세요.` });

    // F) 마일스톤 운영 방향
    if (ms.total === 0) {
        plans.push({ icon: '📍', title: '변경 이력 관리', text: `이 기간 등록된 운영 마일스톤이 없습니다. 로케이션·인력·프로세스 변경 시 마일스톤을 등록하면 다음 결산에서 효과를 정량적으로 검증할 수 있습니다.` });
    } else {
        if (ms.positiveCount > 0) plans.push({ icon: '📍', title: '검증된 개선 확산', text: `효과가 확인된 마일스톤 ${ms.positiveCount}건은 표준작업으로 문서화해 유사 공정·구역으로 확대 적용하세요.` });
        if (ms.negativeCount > 0) plans.push({ icon: '📍', title: '부정 변경 보완', text: `부정적 변화가 나타난 ${ms.negativeCount}건은 원복 또는 보완안을 마련하고, 조치 후 효과를 다시 추적하세요.` });
        if (ms.measuredCount < ms.total) plans.push({ icon: '📍', title: '효과 관측 지속', text: `아직 판정되지 않은 마일스톤은 데이터가 쌓이는 대로 재평가하고, 최소 2~4주간 지표 변화를 지켜본 뒤 존치 여부를 결정하세요.` });
    }

    // 최종 판정
    let verdict = { icon: '🟢', text: '양호', bg: 'bg-emerald-500' };
    if (oee < 60 || (qtyPct !== null && qtyPct <= -10) || insp.qtyDefectRate >= 8) verdict = { icon: '🔴', text: '주의 필요', bg: 'bg-red-500' };
    else if (oee < 80 || (qtyPct !== null && qtyPct < 0) || insp.qtyDefectRate >= 5) verdict = { icon: '🟡', text: '보통', bg: 'bg-amber-500' };

    // 판정 요약 한 줄
    const verdictSummary = verdict.text === '주의 필요'
        ? '핵심 지표에 하락·위험 신호가 있어 즉각적인 개선 조치가 필요한 기간입니다.'
        : (verdict.text === '보통'
            ? '전반적으로 안정적이나 일부 지표에 개선 여지가 있어 관리가 필요한 기간입니다.'
            : '주요 지표가 양호하게 유지된 기간으로, 현재 운영 수준을 지키며 점진적 개선을 이어갈 시점입니다.');

    return { verdict, verdictSummary, points, plans };
}

// ============================================================
// 4. 렌더 헬퍼
// ============================================================
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();

// 섹션 컨테이너 (전체 폭 패널 — 카드 나열이 아니라 보고서 챕터처럼 구성)
const sectionPanel = (icon, title, subtitle, bodyHtml, accentClass = 'border-l-blue-500') => `
    <section class="bg-white border border-gray-200 ${accentClass} border-l-4 rounded-xl shadow-sm p-5 md:p-6 print:break-inside-avoid">
        <div class="flex items-baseline justify-between flex-wrap gap-1 mb-4 pb-3 border-b border-gray-100">
            <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">${icon} ${title}</h3>
            <p class="text-xs text-gray-400">${subtitle}</p>
        </div>
        ${bodyHtml}
    </section>`;

const heroStat = (label, value, unit, diffHtml, colorClass = 'text-gray-800') => `
    <div class="flex-1 min-w-[120px]">
        <div class="text-[11px] text-gray-500 mb-1">${label}</div>
        <div class="text-2xl md:text-3xl font-extrabold ${colorClass}">${value}<span class="text-xs font-semibold text-gray-400 ml-0.5">${unit}</span></div>
        ${diffHtml ? `<div class="mt-1">${diffHtml}</div>` : ''}
    </div>`;

const miniStat = (label, value, sub = '') => `
    <div class="bg-gray-50 rounded-lg p-3 text-center">
        <div class="text-[11px] text-gray-500 mb-0.5">${label}</div>
        <div class="text-base font-extrabold text-gray-800">${value}</div>
        ${sub ? `<div class="text-[10px] text-gray-400 mt-0.5">${sub}</div>` : ''}
    </div>`;

const progressBar = (pct, colorClass = 'bg-blue-500') => `
    <div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div class="h-1.5 rounded-full ${colorClass}" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div>
    </div>`;

const changeBadge = (pct) => {
    if (pct === null || pct === undefined || !isFinite(pct)) return '<span class="text-[10px] text-gray-400">(신규)</span>';
    if (Math.abs(pct) < 0.5) return '<span class="text-[10px] text-gray-400">(-)</span>';
    const up = pct > 0;
    return `<span class="text-[10px] font-bold ${up ? 'text-blue-600' : 'text-red-500'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
};

const tableShell = (theadHtml, tbodyHtml, maxH = 'max-h-[420px]') => `
    <div class="overflow-x-auto overflow-y-auto ${maxH} border border-gray-100 rounded-lg">
        <table class="w-full text-sm text-left text-gray-600">
            <thead class="text-[11px] text-gray-700 uppercase bg-gray-100 sticky top-0"><tr>${theadHtml}</tr></thead>
            <tbody class="divide-y divide-gray-100">${tbodyHtml}</tbody>
        </table>
    </div>`;

const th = (label, align = 'left') => `<th class="px-3 py-2 text-${align} font-bold whitespace-nowrap">${label}</th>`;

// ────────────────────────────────────────────────────────────
// 표 정렬 · 다중선택 필터
//  각 표는 컬럼 정의(cols)와 행 배열만 넘기면 된다.
//   cols: { key, label, align, type:'text'|'num', get(row), cell(row), filterable }
//  상태는 표별로 모듈에 남고, 보고서를 다시 그려도 유지된다.
// ────────────────────────────────────────────────────────────
const _sf = {};   // tableId -> { sort:{key,dir}, filters:{key: value} }
const sfState = (id) => (_sf[id] = _sf[id] || { sort: { key: '', dir: 'asc' }, filters: {} });

/** 필터를 통과하고 정렬까지 마친 행 */
const sfApply = (id, rows, cols) => {
    const st = sfState(id);
    let out = (rows || []).filter(r => cols.every(c => !c.filterable || matchesFilter(c.get(r), st.filters[c.key])));
    if (st.sort.key) {
        const c = cols.find(x => x.key === st.sort.key);
        if (c) {
            const sign = st.sort.dir === 'desc' ? -1 : 1;
            out = out.slice().sort((a, b) => {
                const va = c.get(a), vb = c.get(b);
                const r = (c.type === 'num') ? (Number(va) || 0) - (Number(vb) || 0)
                                             : String(va ?? '').localeCompare(String(vb ?? ''), 'ko');
                return r * sign;
            });
        }
    }
    return out;
};

/** 정렬 버튼 + 필터 버튼이 붙은 머리글. allRows 는 필터 후보값을 뽑는 데 쓴다. */
const sfHead = (id, cols, allRows) => {
    const st = sfState(id);
    return cols.map(c => {
        const on = st.sort.key === c.key;
        const ic = on ? (st.sort.dir === 'asc' ? '▲' : '▼') : '↕';
        const f = st.filters[c.key];
        const n = filterCount(f);
        const active = hasFilter(f);
        const opts = c.filterable
            ? [...new Set((allRows || []).map(r => String(c.get(r) ?? '')))].sort((x, y) => x.localeCompare(y, 'ko'))
            : [];
        return `<th class="px-3 py-2 text-${c.align || 'left'} font-bold whitespace-nowrap">
            <span class="inline-flex items-center gap-0.5 ${c.align === 'right' ? 'flex-row-reverse' : ''}">
                <button type="button" data-tf-sort="${c.key}" data-tf-table="${id}"
                        class="inline-flex items-center gap-1 hover:text-blue-600 ${on ? 'text-blue-600' : ''}"
                        title="클릭해서 정렬 (오름차순 → 내림차순 → 해제)">${label(c)} <span class="text-[9px] ${on ? '' : 'text-gray-300'}">${ic}</span></button>
                ${c.filterable ? `<button type="button" data-tf-filter="${c.key}" data-tf-table="${id}"
                        class="px-1 rounded text-[9px] ${active ? 'text-blue-600 bg-blue-50' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-200'}"
                        title="${c.label} 필터">▼${n > 0 ? `<span class="ml-0.5 font-bold">${n}</span>` : ''}</button>` : ''}
            </span>
        </th>`;
    }).join('');
};
const label = (c) => esc(c.label);

/** 행 HTML */
const sfBody = (rows, cols, emptyMsg = '데이터 없음') => rows.length
    ? rows.map(r => `<tr>${cols.map(c => td(c.cell(r), c.align || 'left')).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="text-center text-gray-400 py-6">${emptyMsg}</td></tr>`;

/** 표 하나를 통째로 (머리글 + 본문) */
const sfTable = (id, cols, rows, maxH, emptyMsg) => {
    _sfCols[id] = cols;
    _sfRows[id] = rows;
    return tableShell(sfHead(id, cols, rows), sfBody(sfApply(id, rows, cols), cols, emptyMsg), maxH || 'max-h-[420px]');
};
const _sfCols = {};   // 필터 팝업이 후보값을 뽑을 때 쓴다
const _sfRows = {};
const td = (content, align = 'left', extra = '') => `<td class="px-3 py-2 text-${align} ${extra}">${content}</td>`;

const emptyNote = (msg) => `<div class="text-xs text-gray-400 text-center py-6">${msg}</div>`;

const narrative = (text, tone = 'gray') => {
    const toneMap = {
        gray: 'bg-gray-50 border-gray-200 text-gray-700',
        blue: 'bg-blue-50 border-blue-200 text-blue-800',
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        red: 'bg-red-50 border-red-200 text-red-800',
        amber: 'bg-amber-50 border-amber-200 text-amber-800'
    };
    return `<div class="rounded-lg border p-3 text-xs leading-relaxed ${toneMap[tone] || toneMap.gray}">${text}</div>`;
};

// ============================================================
// 5. 차트 생성 (Chart.js)
// ============================================================
function createBarChart(canvasId, labels, values, label, colorHex) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return null;
    const chart = new Chart(el, {
        type: 'bar',
        data: { labels, datasets: [{ label, data: values, backgroundColor: colorHex, borderRadius: 4, maxBarThickness: 28 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                y: { beginAtZero: true, grid: { borderDash: [4, 4] }, ticks: { font: { size: 10 } } }
            }
        }
    });
    _chartInstances.push(chart);
    return chart;
}

function createHorizontalBarChart(canvasId, labels, values, colorHex) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return null;
    const chart = new Chart(el, {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: colorHex, borderRadius: 4, maxBarThickness: 18 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { borderDash: [4, 4] }, ticks: { font: { size: 10 } } },
                y: { grid: { display: false }, ticks: { font: { size: 10 } } }
            }
        }
    });
    _chartInstances.push(chart);
    return chart;
}

// ============================================================
// 6. 섹션 렌더 함수
// ============================================================

function renderExecutiveSummary(core, tp, wf, att, mg, insp, periodLabel, workingDaysCount) {
    if (workingDaysCount === 0) {
        return `
        <div class="settle-exec bg-gradient-to-br from-gray-700 to-gray-900 rounded-2xl shadow-md p-6 text-white">
            <h2 class="text-xl font-bold mb-1">🧾 ${periodLabel} 팀 결산 보고</h2>
            <p class="text-sm text-gray-300">해당 기간에 업무 기록이 없어 요약할 내용이 없습니다.</p>
        </div>`;
    }

    const d = core.diagnosis?.diagnosis;
    let verdictIcon = '🟢', verdictText = '양호', verdictBg = 'bg-emerald-500';
    if (core.curProd.oee < 60) { verdictIcon = '🔴'; verdictText = '주의 필요'; verdictBg = 'bg-red-500'; }
    else if (core.curProd.oee < 80) { verdictIcon = '🟡'; verdictText = '보통'; verdictBg = 'bg-amber-500'; }

    const qtyChangeTxt = tp.prevTotalQuantity > 0
        ? `전기간(${fmt(tp.prevTotalQuantity)}개) 대비 ${tp.totalQuantity >= tp.prevTotalQuantity ? '+' : ''}${(((tp.totalQuantity - tp.prevTotalQuantity) / tp.prevTotalQuantity) * 100).toFixed(1)}%`
        : '전기간 데이터 없음';

    return `
    <div class="bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 rounded-2xl shadow-md p-6 md:p-8 text-white">
        <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
            <div>
                <div class="text-xs text-slate-300 tracking-wide uppercase mb-1">Executive Summary</div>
                <h2 class="text-2xl font-extrabold">${periodLabel} 팀 결산 보고</h2>
            </div>
            <span class="inline-flex items-center gap-1.5 ${verdictBg} text-white text-sm font-bold px-3 py-1.5 rounded-full shadow">${verdictIcon} ${verdictText}</span>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
                <div class="text-[11px] text-slate-300 mb-1">총 처리량</div>
                <div class="text-3xl font-extrabold">${fmt(tp.totalQuantity)}<span class="text-sm font-medium text-slate-300 ml-1">개</span></div>
                <div class="text-[11px] text-slate-300 mt-1">${qtyChangeTxt}</div>
            </div>
            <div>
                <div class="text-[11px] text-slate-300 mb-1">종합 생산 효율 (OEE)</div>
                <div class="text-3xl font-extrabold">${core.curProd.oee.toFixed(0)}<span class="text-sm font-medium text-slate-300 ml-1">%</span></div>
                <div class="text-[11px] text-slate-300 mt-1">${core.prevProd.oee > 0 ? `전기간 ${core.prevProd.oee.toFixed(0)}%` : '전기간 데이터 없음'}</div>
            </div>
            <div>
                <div class="text-[11px] text-slate-300 mb-1">일평균 근무인원</div>
                <div class="text-3xl font-extrabold">${wf.avgActiveMembers.toFixed(1)}<span class="text-sm font-medium text-slate-300 ml-1">명</span></div>
                <div class="text-[11px] text-slate-300 mt-1">파트타이머 ${wf.partTimerCount}명 포함</div>
            </div>
            <div>
                <div class="text-[11px] text-slate-300 mb-1">${mg.curMgmt.revenue > 0 ? '총 매출' : '검수 불량률'}</div>
                <div class="text-3xl font-extrabold">${mg.curMgmt.revenue > 0 ? fmt(mg.curMgmt.revenue) : insp.qtyDefectRate.toFixed(1)}<span class="text-sm font-medium text-slate-300 ml-1">${mg.curMgmt.revenue > 0 ? '원' : '%'}</span></div>
                <div class="text-[11px] text-slate-300 mt-1">${mg.curMgmt.revenue > 0 ? `발주 ${fmt(mg.curMgmt.orderCount)}건` : `검수 ${fmt(insp.totalInspectionCount)}건`}</div>
            </div>
        </div>

        ${d ? `<div class="bg-white/10 backdrop-blur rounded-lg p-4 text-sm leading-relaxed">
            <span class="font-bold">${d.icon} ${d.title}.</span> ${d.desc}
            ${core.diagnosis?.commentHtml ? `<div class="mt-2 text-slate-200 text-xs">${core.diagnosis.commentHtml}</div>` : ''}
        </div>` : ''}
    </div>`;
}

function renderProductivitySection(tp, core, workingDaysCount) {
    if (workingDaysCount === 0) return sectionPanel('🚀', '생산성 및 효율성', '처리량 중심 분석', emptyNote('해당 기간에 업무 기록이 없습니다.'), 'border-l-blue-500');

    const qtyChangePct = tp.prevTotalQuantity > 0 ? ((tp.totalQuantity - tp.prevTotalQuantity) / tp.prevTotalQuantity * 100) : null;
    const chartId = 'settle-chart-throughput';
    const maxQty = Math.max(1, ...tp.taskEntries.map(t => t.quantity));

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            ${heroStat('총 처리량', fmt(tp.totalQuantity), '개', changeBadge(qtyChangePct), 'text-blue-700')}
            ${heroStat('일평균 처리량', fmt(tp.avgDailyQuantity), '개/일', '', 'text-gray-800')}
            ${heroStat('최고 처리일',
                tp.peakDay ? (tp.peakDay.id ? drillWrap(fmt(tp.peakDay.value), 'day', tp.peakDay.id) : fmt(tp.peakDay.value)) : '-',
                tp.peakDay ? `개 (${tp.peakDay.label})` : '', '', 'text-emerald-600')}
            ${heroStat('최저 처리일',
                tp.lowDay ? (tp.lowDay.id ? drillWrap(fmt(tp.lowDay.value), 'day', tp.lowDay.id) : fmt(tp.lowDay.value)) : '-',
                tp.lowDay ? `개 (${tp.lowDay.label})` : '', '', 'text-gray-500')}
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">📈 일별 처리량 추이</div>
            <div style="height:220px;"><canvas id="${chartId}"></canvas></div>
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">🧩 업무별 처리량 분해 (점유율 · 전기간 대비)</div>
            ${sfTable('tpTask', [
                { key: 'task', label: '업무', filterable: true, get: t => t.task, cell: t => esc(t.task) },
                { key: 'quantity', label: '처리량', align: 'right', type: 'num', get: t => t.quantity,
                  cell: t => `<span class="font-bold text-gray-800">${fmt(t.quantity)}</span>` },
                { key: 'share', label: '점유율', align: 'right', type: 'num', get: t => t.share,
                  cell: t => `<div class="w-24 inline-block align-middle mr-2">${progressBar(t.share, 'bg-blue-500')}</div><span class="text-xs text-gray-500">${t.share.toFixed(1)}%</span>` },
                { key: 'changePct', label: '전기간 대비', align: 'right', type: 'num', get: t => t.changePct ?? 0, cell: t => changeBadge(t.changePct) },
                { key: 'avgStaff', label: '평균 투입인원', align: 'right', type: 'num', get: t => t.avgStaff, cell: t => t.avgStaff.toFixed(1) + '명' },
                { key: 'avgThroughput', label: '처리속도(개/분)', align: 'right', type: 'num', get: t => t.avgThroughput, cell: t => t.avgThroughput.toFixed(2) }
            ], tp.taskEntries)}
        </div>

        <div class="text-xs font-bold text-gray-600 mb-2">⚙️ 효율성 부가 지표 (참고용)</div>
        <div class="grid grid-cols-3 gap-2 mb-3">
            ${miniStat('시간 활용률', drillWrap(core.curProd.utilizationRate.toFixed(0) + '%', 'utilizationRate'))}
            ${miniStat('업무 효율성', drillWrap(core.curProd.efficiencyRatio.toFixed(0) + '%', 'efficiencyRatio'))}
            ${miniStat('품질 효율', drillWrap(core.curProd.qualityRatio.toFixed(0) + '%', 'qualityRatio'))}
        </div>
        <div class="grid grid-cols-3 gap-2 text-center mb-3">
            <div class="text-[11px] text-gray-500">가용 손실 <b class="text-gray-700 block text-sm">${fmt(core.curProd.availabilityLossCost)}원</b></div>
            <div class="text-[11px] text-gray-500">성능 손실 <b class="text-gray-700 block text-sm">${fmt(core.curProd.performanceLossCost)}원</b></div>
            <div class="text-[11px] text-gray-500">품질 손실 <b class="text-gray-700 block text-sm">${fmt(core.curProd.qualityLossCost)}원</b></div>
        </div>
        ${core.curProd.topPerformanceLossTasks && core.curProd.topPerformanceLossTasks.length > 0 ? `
        <div class="text-[11px] text-gray-500 mb-1">⏱️ 속도 손실 상위 업무</div>
        <div class="space-y-1">
            ${core.curProd.topPerformanceLossTasks.map(t => `<div class="flex justify-between text-xs"><span>${esc(t.task)}</span><span class="text-red-500 font-bold">-${fmt(t.lossMinutes)}분</span></div>`).join('')}
        </div>` : ''}
    `;
    return { html: sectionPanel('🚀', '생산성 및 효율성', '처리량 중심 분석', body, 'border-l-blue-500'), chartId, chartData: tp.daily };
}

function renderWorkforceSection(wf, core, workingDaysCount) {
    if (workingDaysCount === 0) return sectionPanel('👥', '인력 운영', '인력 배치와 가동 현황', emptyNote('해당 기간에 업무 기록이 없습니다.'), 'border-l-violet-500');

    const fteMax = Math.max(core.curProd.availableFTE, core.curProd.workedFTE, core.curProd.requiredFTE, 1);

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            ${heroStat('일평균 근무인원', wf.avgActiveMembers.toFixed(1), '명', '', 'text-violet-700')}
            ${heroStat('정규 인원', wf.regularMemberCount, '명')}
            ${heroStat('파트타이머', wf.partTimerCount, '명')}
            ${heroStat('연차·반차 사용', wf.leaveDaysUsed.toFixed(1), '일')}
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">⚖️ 투입 인력 비교 (${drillWrap('FTE란?', 'fte')})</div>
            <div class="space-y-2">
                <div class="flex items-center gap-3 text-xs">
                    <span class="w-24 text-gray-500">가용 인력</span>
                    <div class="flex-1">${progressBar(core.curProd.availableFTE / fteMax * 100, 'bg-violet-400')}</div>
                    <span class="w-16 text-right font-bold text-gray-700">${core.curProd.availableFTE.toFixed(1)}</span>
                </div>
                <div class="flex items-center gap-3 text-xs">
                    <span class="w-24 text-gray-500">실작업 인력</span>
                    <div class="flex-1">${progressBar(core.curProd.workedFTE / fteMax * 100, 'bg-violet-500')}</div>
                    <span class="w-16 text-right font-bold text-gray-700">${core.curProd.workedFTE.toFixed(1)}</span>
                </div>
                <div class="flex items-center gap-3 text-xs">
                    <span class="w-24 text-gray-500">표준 필요인력</span>
                    <div class="flex-1">${progressBar(core.curProd.requiredFTE / fteMax * 100, 'bg-violet-600')}</div>
                    <span class="w-16 text-right font-bold text-gray-700">${core.curProd.requiredFTE.toFixed(1)}</span>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">🧑‍🤝‍🧑 파트별 인력 분포</div>
                ${sfTable('wfPart', [
                    { key: 'part', label: '파트', filterable: true, get: p => p.part, cell: p => esc(p.part) },
                    { key: 'memberCount', label: '인원', align: 'right', type: 'num', get: p => p.memberCount, cell: p => p.memberCount + '명' },
                    { key: 'duration', label: '투입시간', align: 'right', type: 'num', get: p => p.duration, cell: p => formatDuration(p.duration) }
                ], wf.partDistribution, 'max-h-[220px]')}
            </div>
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">🏖️ 연차·반차 사용 상위 인원</div>
                ${sfTable('wfLeave', [
                    { key: 'member', label: '이름', filterable: true, get: m => m.member, cell: m => esc(m.member) },
                    { key: 'days', label: '사용일수', align: 'right', type: 'num', get: m => m.days, cell: m => m.days.toFixed(1) + '일' }
                ], wf.topLeaveUsers, 'max-h-[220px]', '사용 내역 없음')}
            </div>
        </div>
    `;
    return sectionPanel('👥', '인력 운영', '인력 배치와 가동 현황', body, 'border-l-violet-500');
}

function renderWorkReportSection(wr, workingDaysCount, totalDaysCount) {
    if (workingDaysCount === 0) return sectionPanel('📁', '업무 리포트', '업무별·인원별 상세', emptyNote('해당 기간에 업무 기록이 없습니다.'), 'border-l-indigo-500');

    // 업무별 '가동일수'를 전체 가동일수와 견줘 볼 수 있도록 기준값을 만들어 둔다.
    const totalDays = Number(totalDaysCount) || 0;
    const opRate = (n) => workingDaysCount > 0 ? Math.round(n / workingDaysCount * 100) : 0;

    const body = `
        <div class="grid grid-cols-3 gap-3 mb-5">
            ${heroStat('활동 인원', wr.memberCount, '명', '', 'text-indigo-700')}
            ${heroStat('수행 업무 종류', wr.taskCount, '종')}
            ${heroStat('총 가동일수', workingDaysCount, '일',
                `<span class="text-[10px] text-gray-400">기간 ${totalDays}일 중 업무 기록이 있는 날</span>`)}
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">📋 업무별 상세 (투입시간 순)</div>
            ${sfTable('wrTask', [
                { key: 'task', label: '업무', filterable: true, get: t => t.task, cell: t => esc(t.task) },
                { key: 'duration', label: '투입시간', align: 'right', type: 'num', get: t => t.duration, cell: t => formatDuration(t.duration) },
                { key: 'timeShare', label: '시간 점유율', align: 'right', type: 'num', get: t => t.timeShare,
                  cell: t => `<div class="w-20 inline-block align-middle mr-2">${progressBar(t.timeShare, 'bg-indigo-500')}</div><span class="text-xs text-gray-500">${t.timeShare.toFixed(1)}%</span>` },
                { key: 'quantity', label: '생산량', align: 'right', type: 'num', get: t => t.quantity, cell: t => fmt(t.quantity) + '개' },
                { key: 'cost', label: '인건비', align: 'right', type: 'num', get: t => t.cost, cell: t => fmt(t.cost) + '원' },
                { key: 'workDays', label: '가동일수', align: 'right', type: 'num', get: t => t.workDays,
                  cell: t => `<span class="font-bold text-gray-800">${t.workDays}</span>`
                           + `<span class="text-gray-400"> / ${workingDaysCount}일</span>`
                           + `<div class="text-[10px] text-gray-400">${opRate(t.workDays)}%</div>` }
            ], wr.taskEntries)}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">🧑‍🤝‍🧑 파트별 요약</div>
                ${sfTable('wrPart', [
                    { key: 'part', label: '파트', filterable: true, get: p => p.part, cell: p => esc(p.part) },
                    { key: 'memberCount', label: '인원', align: 'right', type: 'num', get: p => p.memberCount, cell: p => p.memberCount + '명' },
                    { key: 'duration', label: '투입시간', align: 'right', type: 'num', get: p => p.duration, cell: p => formatDuration(p.duration) }
                ], wr.partRows, 'max-h-[260px]')}
            </div>
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">🙋 인원별 상세 (투입시간 순)</div>
                ${sfTable('wrMember', [
                    { key: 'member', label: '이름', filterable: true, get: m => m.member, cell: m => esc(m.member) },
                    { key: 'part', label: '파트', filterable: true, get: m => m.part, cell: m => esc(m.part) },
                    { key: 'duration', label: '투입시간', align: 'right', type: 'num', get: m => m.duration, cell: m => formatDuration(m.duration) },
                    { key: 'taskCount', label: '업무 수', align: 'right', type: 'num', get: m => m.taskCount, cell: m => m.taskCount + '종' }
                ], wr.memberEntries, 'max-h-[260px]')}
            </div>
        </div>
    `;
    return sectionPanel('📁', '업무 리포트', `업무별·인원별 상세 · 총 가동일수 ${workingDaysCount}일 / 기간 ${totalDays}일`, body, 'border-l-indigo-500');
}

function renderAttendanceSection(att) {
    if (att.totalEvents === 0) return sectionPanel('🕒', '근태 이력', '근태 유형별 분포', emptyNote('해당 기간에 근태 기록이 없습니다.'), 'border-l-amber-500');

    const chartId = 'settle-chart-attendance';
    const activeTypes = LEAVE_TYPES.filter(t => att.typeCounts[t] > 0);

    const body = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
            <div class="md:col-span-1">
                <div class="text-xs font-bold text-gray-600 mb-2">📊 근태 유형별 건수</div>
                <div style="height:${Math.max(140, activeTypes.length * 32)}px;"><canvas id="${chartId}"></canvas></div>
            </div>
            <div class="md:col-span-2">
                <div class="text-xs font-bold text-gray-600 mb-2">⚠️ 결근·지각·외출·조퇴 상위 인원</div>
                ${sfTable('attMember', [
                    { key: 'member', label: '이름', filterable: true, get: m => m.member, cell: m => esc(m.member) },
                    { key: 'absence', label: '결근', align: 'right', type: 'num', get: m => m.absence,
                      cell: m => m.absence > 0 ? `<span class="text-red-600 font-bold">${m.absence}</span>` : '0' },
                    { key: 'late', label: '지각', align: 'right', type: 'num', get: m => m.late,
                      cell: m => m.late > 0 ? `<span class="text-orange-500 font-bold">${m.late}</span>` : '0' },
                    { key: 'outing', label: '외출', align: 'right', type: 'num', get: m => m.outing,
                      cell: m => m.outing > 0 ? `<span class="text-amber-600 font-bold">${m.outing}</span>` : '0' },
                    { key: 'earlyLeave', label: '조퇴', align: 'right', type: 'num', get: m => m.earlyLeave,
                      cell: m => m.earlyLeave > 0 ? `<span class="text-yellow-600 font-bold">${m.earlyLeave}</span>` : '0' },
                    { key: 'total', label: '총 건수', align: 'right', type: 'num', get: m => m.total, cell: m => m.total }
                ], att.memberRows, 'max-h-[260px]', '결근·지각·외출·조퇴 없음')}
            </div>
        </div>
    `;
    return { html: sectionPanel('🕒', '근태 이력', '근태 유형별 분포', body, 'border-l-amber-500'), chartId, labels: activeTypes, values: activeTypes.map(t => att.typeCounts[t]) };
}

function renderManagementSection(mg) {
    if (mg.curMgmt.revenue === 0 && mg.curMgmt.orderCount === 0) return sectionPanel('💹', '경영 지표', '매출·재고·환율', emptyNote('해당 기간에 입력된 경영 지표가 없습니다.'), 'border-l-emerald-500');

    const chartId = 'settle-chart-revenue';
    const revenueChangePct = mg.prevMgmt.revenue > 0 ? ((mg.curMgmt.revenue - mg.prevMgmt.revenue) / mg.prevMgmt.revenue * 100) : null;

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            ${heroStat('총 매출', drillWrap(fmt(mg.curMgmt.revenue), 'revenue'), '원', changeBadge(revenueChangePct), 'text-emerald-700')}
            ${heroStat('총 발주 건수', drillWrap(fmt(mg.curMgmt.orderCount), 'orderCount'), '건')}
            ${heroStat('평균 재고금액', fmt(mg.curMgmt.avgInventoryAmt), '원')}
            ${heroStat('평균 환율(USD)', mg.curMgmt.avgUsdRate > 0 ? mg.curMgmt.avgUsdRate.toFixed(1) : '-', '')}
            ${heroStat('평균 환율(CNY)', mg.curMgmt.avgCnyRate > 0 ? mg.curMgmt.avgCnyRate.toFixed(1) : '-', '')}
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">📈 일별 매출 추이</div>
            <div style="height:200px;"><canvas id="${chartId}"></canvas></div>
        </div>

        ${mg.unitCost && mg.unitCost.isValid ? `
        <div class="text-xs font-bold text-gray-600 mb-2">💰 개당 원가 구조</div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
            ${miniStat('인건비', fmt(mg.unitCost.costs.labor) + '원')}
            ${miniStat('자재비', fmt(mg.unitCost.costs.material) + '원')}
            ${miniStat('배송비', fmt(mg.unitCost.costs.shipping) + '원')}
            ${miniStat('ZG&AB배송', fmt(mg.unitCost.costs.directDelivery) + '원')}
            ${miniStat('개당 원가 합계', fmt(mg.unitCost.costs.total) + '원')}
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
            <div class="text-[11px] text-gray-500">개당 매출 <b class="text-gray-700 block text-sm">${fmt(mg.unitCost.profit.revenuePerItem)}원</b></div>
            <div class="text-[11px] text-gray-500">개당 마진 <b class="text-gray-700 block text-sm">${fmt(mg.unitCost.profit.margin)}원</b></div>
            <div class="text-[11px] text-gray-500">마진율 <b class="text-gray-700 block text-sm">${mg.unitCost.profit.marginRate.toFixed(1)}%</b></div>
        </div>` : ''}
    `;
    return { html: sectionPanel('💹', '경영 지표', '매출·재고·환율', body, 'border-l-emerald-500'), chartId, chartData: mg.revenueDaily };
}

function renderInspectionSection(insp) {
    if (insp.totalInspectionCount === 0) return sectionPanel('🔍', '검수 이력', '입고 검수 품질 현황', emptyNote('해당 기간에 검수 기록이 없습니다.'), 'border-l-rose-500');

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            ${heroStat('총 검수 수량', fmt(insp.productTypeCount), 'SKU', `<span class="text-[10px] text-gray-400">총 수량 ${fmt(insp.totalInspectedQty)}개</span>`, 'text-rose-700')}
            ${heroStat('불량 수량', fmt(insp.totalDefectQty), '개')}
            ${heroStat('수량 기준 불량률', insp.qtyDefectRate.toFixed(1), '%', '', insp.qtyDefectRate >= 5 ? 'text-red-600' : 'text-gray-800')}
            ${heroStat('건수 기준 불량률', insp.countDefectRate.toFixed(1), '%', '', insp.countDefectRate >= 5 ? 'text-red-600' : 'text-gray-800')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">⚠️ 불량 상위 제품</div>
                ${sfTable('inspDefect', [
                    { key: 'name', label: '제품', filterable: true, get: r => r.name, cell: r => esc(r.name) },
                    { key: 'defectCount', label: '불량건수', align: 'right', type: 'num', get: r => r.defectCount,
                      cell: r => `<span class="text-red-600 font-bold">${r.defectCount}</span>` },
                    { key: 'defectQty', label: '불량수량', align: 'right', type: 'num', get: r => r.defectQty, cell: r => fmt(r.defectQty) + '개' },
                    { key: 'commonReason', label: '주요 불량사유', filterable: true, get: r => r.commonReason, cell: r => esc(r.commonReason) }
                ], insp.topDefective, 'max-h-[300px]', '불량 없음')}
            </div>
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">📋 불량 사유 상위 항목</div>
                <div class="space-y-2">
                    ${insp.topReasons.map(([reason, count]) => {
                        const max = insp.topReasons[0][1] || 1;
                        return `<div>
                            <div class="flex justify-between text-xs mb-1"><span>${esc(reason)}</span><span class="font-bold text-gray-700">${count}건</span></div>
                            ${progressBar(count / max * 100, 'bg-rose-500')}
                        </div>`;
                    }).join('') || '<div class="text-xs text-gray-400 text-center py-6">불량 사유 없음</div>'}
                </div>
            </div>
        </div>
    `;
    return sectionPanel('🔍', '검수 이력', '입고 검수 품질 현황', body, 'border-l-rose-500');
}

function renderMilestoneSection(ms) {
    if (ms.total === 0) return sectionPanel('📍', '운영 마일스톤 결과', '기간 내 변경사항의 전·후 효과', emptyNote('해당 기간에 등록된 운영 마일스톤이 없습니다.'), 'border-l-teal-500');

    const changeCell = (pct, betterIfHigh = true, suffix = '%') => {
        if (pct === null || pct === undefined || !isFinite(pct)) return '<span class="text-[11px] text-gray-400">-</span>';
        const flat = Math.abs(pct) < 0.5;
        const good = (betterIfHigh && pct > 0) || (!betterIfHigh && pct < 0);
        const cls = flat ? 'text-gray-400' : (good ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold');
        const icon = flat ? '—' : (good ? '✅' : '⚠️');
        return `<span class="${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}${suffix} ${icon}</span>`;
    };

    const rows = ms.items.map(it => {
        const m = it.milestone;
        const s = it.summary;
        const affected = (m.affectedTasks || []).length > 0 ? esc(m.affectedTasks.join(', ')) : '전체';
        if (!s.hasEnoughData) {
            return `<tr>
                ${td(`<div class="text-[11px] text-gray-400 font-mono">${esc(m.date)}</div>`)}
                ${td(`<div class="font-bold text-gray-800">${esc(m.title || '-')}</div><div class="text-[10px] text-gray-400">${esc(it.typeInfo.label)}</div>`)}
                ${td(`<span class="text-[10px] text-gray-400">${esc(affected)}</span>`)}
                <td class="px-3 py-2 text-center" colspan="4"><span class="text-[11px] text-gray-400">⏳ ${esc(s.statusLabel)}</span></td>
            </tr>`;
        }
        return `<tr>
            ${td(`<div class="text-[11px] text-gray-500 font-mono">${esc(m.date)}</div>`)}
            ${td(`<div class="font-bold text-gray-800">${esc(m.title || '-')}</div><div class="text-[10px] text-gray-400">${esc(it.typeInfo.label)}</div>`)}
            ${td(`<span class="text-[10px] text-gray-500">${esc(affected)}</span>`)}
            ${td(`<span class="text-xs text-gray-600">${s.before.uph.toFixed(1)}→${s.after.uph.toFixed(1)}</span>`, 'right')}
            ${td(changeCell(it.uphPct, true), 'right')}
            ${td(`<span class="text-xs text-gray-600">${fmt(s.before.avgQtyPerDay)}→${fmt(s.after.avgQtyPerDay)}</span>`, 'right')}
            ${td(changeCell(it.qtyPct, true), 'right')}
        </tr>`;
    }).join('');

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            ${heroStat('등록 마일스톤', ms.total, '건', '', 'text-teal-700')}
            ${heroStat('효과 측정 가능', ms.measuredCount, '건')}
            ${heroStat('긍정 효과', ms.positiveCount, '건', '', 'text-emerald-600')}
            ${heroStat('부정 변화', ms.negativeCount, '건', '', ms.negativeCount > 0 ? 'text-red-500' : 'text-gray-500')}
        </div>
        <div class="text-xs font-bold text-gray-600 mb-2">📊 마일스톤별 전·후 효과 (기준일 전후 14일 비교)</div>
        ${tableShell(
            th('기준일') + th('변경 내용') + th('영향 업무') + th('UPH(전→후)', 'right') + th('UPH 변화', 'right') + th('일평균처리량(전→후)', 'right') + th('처리량 변화', 'right'),
            rows,
            'max-h-[360px]'
        )}
        <div class="mt-3 mb-5 text-[11px] text-gray-400 leading-relaxed">
            ℹ️ 각 마일스톤 기준일의 전 14일 ↔ 후 14일 평균을 비교합니다. 관측 일수가 적은 항목은 "데이터 누적 중"으로 표시됩니다.<br>
            ℹ️ UPH·처리량 "✅"는 개선(증가), "⚠️"는 악화(감소)를 의미합니다.
        </div>

        <div class="text-xs font-bold text-gray-600 mb-2">🧩 결과 해석 및 운영방안</div>
        <div class="space-y-2.5">
            ${ms.items.map(it => {
                const clsTone = {
                    good: 'bg-emerald-50 border-emerald-200',
                    bad: 'bg-red-50 border-red-200',
                    mixed: 'bg-amber-50 border-amber-200',
                    flat: 'bg-gray-50 border-gray-200',
                    insufficient: 'bg-gray-50 border-dashed border-gray-300'
                }[it.insight.cls] || 'bg-gray-50 border-gray-200';
                const badge = {
                    good: '<span class="text-emerald-700 font-bold">✅ 효과 확인</span>',
                    bad: '<span class="text-red-600 font-bold">⚠️ 부정적</span>',
                    mixed: '<span class="text-amber-700 font-bold">↔️ 혼재</span>',
                    flat: '<span class="text-gray-500 font-bold">— 변화 미미</span>',
                    insufficient: '<span class="text-gray-400 font-bold">⏳ 관측 중</span>'
                }[it.insight.cls] || '';
                return `
                <div class="rounded-lg border ${clsTone} p-3">
                    <div class="flex items-center justify-between flex-wrap gap-1 mb-1">
                        <div class="text-xs font-bold text-gray-800">${esc(it.typeInfo.label)} · ${esc(it.milestone.title || '-')} <span class="text-[10px] text-gray-400 font-mono ml-1">${esc(it.milestone.date)}</span></div>
                        <div class="text-[11px]">${badge}</div>
                    </div>
                    <div class="text-[12px] text-gray-700 leading-relaxed"><b class="text-gray-500">해석:</b> ${it.insight.interp}</div>
                    <div class="text-[12px] text-gray-700 leading-relaxed mt-0.5"><b class="text-gray-500">운영방안:</b> ${it.insight.action}</div>
                </div>`;
            }).join('')}
        </div>
    `;
    return sectionPanel('📍', '운영 마일스톤 결과', '기간 내 변경사항의 전·후 효과', body, 'border-l-teal-500');
}

function renderOverallOpinionSection(op, periodLabel, workingDaysCount) {
    if (workingDaysCount === 0 || !op.verdict) {
        return sectionPanel('🧭', '종합 의견', '기간 전체 진단', emptyNote(op.summaryText || '해당 기간에 업무 기록이 없습니다.'), 'border-l-slate-500');
    }

    const toneColor = {
        blue: 'text-blue-600', emerald: 'text-emerald-600', red: 'text-red-500',
        amber: 'text-amber-600', gray: 'text-gray-500'
    };
    const pointsHtml = op.points.map(p => `
        <li class="flex items-start gap-2.5">
            <span class="text-base leading-tight ${toneColor[p.tone] || 'text-gray-500'} shrink-0">${p.icon}</span>
            <span class="text-sm text-gray-700 leading-relaxed">${p.text}</span>
        </li>`).join('');

    const plansHtml = (op.plans || []).map((pl, i) => `
        <li class="flex items-start gap-3 bg-slate-50 rounded-lg border border-slate-200 p-3">
            <span class="shrink-0 w-6 h-6 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center">${i + 1}</span>
            <div>
                <div class="text-sm font-bold text-gray-800 mb-0.5">${pl.icon} ${esc(pl.title)}</div>
                <div class="text-[13px] text-gray-700 leading-relaxed">${pl.text}</div>
            </div>
        </li>`).join('');

    const body = `
        <div class="flex items-center gap-3 mb-3 flex-wrap">
            <span class="inline-flex items-center gap-1.5 ${op.verdict.bg} text-white text-sm font-bold px-3 py-1.5 rounded-full shadow">${op.verdict.icon} 종합 판정: ${op.verdict.text}</span>
            <span class="text-xs text-gray-400">${esc(periodLabel)} 운영 전반에 대한 자동 진단</span>
        </div>
        ${op.verdictSummary ? narrative(`<b>총평.</b> ${esc(op.verdictSummary)}`, op.verdict.text === '주의 필요' ? 'red' : (op.verdict.text === '보통' ? 'amber' : 'emerald')) : ''}

        <div class="text-xs font-bold text-gray-600 mt-5 mb-2">🔎 진단값 해석</div>
        <ul class="space-y-3">${pointsHtml}</ul>

        ${plansHtml ? `
        <div class="text-xs font-bold text-gray-600 mt-6 mb-2">📋 이후 운영 계획 / 방향</div>
        <ol class="space-y-2.5">${plansHtml}</ol>` : ''}

        <div class="mt-4 text-[11px] text-gray-400">※ 본 종합의견·운영계획은 각 섹션 지표를 규칙 기반으로 자동 요약·제안한 것으로, 실제 현장 상황과 함께 판단하시기 바랍니다.</div>
    `;
    return sectionPanel('🧭', '종합 의견', '진단 · 해석 · 운영계획', body, 'border-l-slate-500');
}

// ============================================================
// 7-1. 화면 그대로 PDF 저장
// ------------------------------------------------------------------
// 엑셀은 숫자만 남고 색·그래프·구성이 사라진다. 보고용으로 그대로 넘기려면
// 화면 모습 그대로가 필요해서 따로 만든다.
//
// ⚠️ 버튼을 전부 지우면 안 된다.
//    이 화면은 표의 열 제목이 정렬 버튼 안에 들어 있고(sfHead),
//    파고들기 숫자도 버튼 안에 있다(drillWrap). 통째로 지우면 제목과
//    숫자가 사라진 종이가 나온다. 조작용만 지우고 나머지는 껍데기만 벗긴다.
async function downloadSettlementPdf(periodLabel) {
    if (typeof html2pdf === 'undefined') {
        alert('PDF 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        return;
    }
    const panel = document.getElementById('settlement-panel');
    if (!panel) return;

    const btn = document.getElementById('settle-pdf-btn');
    const btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }

    // ⚠️ 임시 상자는 반드시 '문서 흐름 안'에 있어야 한다.
    //    position 을 fixed/absolute 로 두면 html2pdf 가 높이를 0 으로 재고
    //    빈 종이가 나온다(실측: 캔버스 794x0). 흐름에 둔 채로 감추려고
    //    높이 0 · overflow hidden 인 껍데기에 넣는다. 화면에는 보이지 않는다.
    const wrap = document.createElement('div');
    wrap.style.cssText = 'height:0;overflow:hidden;';

    const holder = document.createElement('div');
    holder.id = 'settle-pdf-holder';
    // 폭은 화면에 보이는 그 폭으로 맞춘다. 임의의 넓은 폭을 쓰면 레이아웃이
    // 다시 잡히면서 캡처 영역이 어긋나 좌우에 빈 띠가 생긴다.
    const capW0 = Math.max(900, Math.round(panel.clientWidth));
    holder.style.cssText = `width:${capW0}px;height:auto;background:#fff;padding:16px;overflow:visible;`;
    holder.innerHTML = `<style>
        #settle-pdf-holder * { overflow: visible !important; max-height: none !important;
                               scrollbar-width: none !important; }
        #settle-pdf-holder .depth-panel, #settle-pdf-holder table { page-break-inside: avoid; }
        #settle-pdf-holder tr { page-break-inside: avoid; }
    </style>`;
    const clone = panel.cloneNode(true);

    // ⚠️ 원본 패널은 'flex-1 h-full' 로 부모 높이를 따라간다.
    //    높이 기준이 없는 임시 상자에 그대로 넣으면 높이가 0 이 되어 빈 종이가 나온다.
    //    복제본은 흐름대로 쌓이도록 되돌린다.
    clone.classList.remove('hidden', 'flex-1', 'h-full', 'overflow-y-auto', 'overflow-hidden', 'absolute', 'inset-0');
    clone.style.cssText = 'display:block;position:static;width:100%;height:auto;max-height:none;overflow:visible;';

    // 조작용 요소만 걷어낸다
    clone.querySelectorAll(
        '[data-html2canvas-ignore], [data-tf-filter], .settle-gran-btn, ' +
        '#settle-year-select, #settle-sub-select, #settle-generate-btn, ' +
        '#settle-download-btn, #settle-pdf-btn, input, select'
    ).forEach(el => el.remove());
    // 기간 선택 줄 통째로
    // 'print:hidden' 은 콜론이 들어간 클래스라 CSS 선택자에서 이스케이프가 필요하다.
    // 헷갈리기 쉬우니 속성 선택자로 찾는다.
    clone.querySelectorAll('[class*="print:hidden"]').forEach(el => el.remove());

    // 내용이 든 버튼은 지우지 말고 껍데기만 벗긴다
    clone.querySelectorAll('button').forEach(b => {
        const span = document.createElement('span');
        span.innerHTML = b.innerHTML;
        span.className = (b.className || '').replace(/hover:[^\s]+/g, '');
        b.replaceWith(span);
    });

    // 그래프는 캔버스라 복제만으론 빈 사각형이 된다. 픽셀을 옮겨 담는다.
    const src = panel.querySelectorAll('canvas');
    const dst = clone.querySelectorAll('canvas');
    src.forEach((c, i) => {
        if (!dst[i]) return;
        const img = document.createElement('img');
        try { img.src = c.toDataURL('image/png'); } catch (e) { return; }
        img.style.cssText = `width:${c.clientWidth}px;height:${c.clientHeight}px;`;
        dst[i].replaceWith(img);
    });

    // 스크롤 상자를 펼치고, 화면에 겹쳐 놓기 위한 배치를 흐름 배치로 되돌린다.
    // (남겨 두면 서로 겹쳐 그려지거나 높이가 0 이 된다)
    clone.querySelectorAll('*').forEach(el => {
        el.classList.remove('h-full', 'h-screen', 'overflow-y-auto', 'overflow-x-auto', 'overflow-auto', 'sticky');
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') el.style.position = 'static';
    });

    holder.appendChild(clone);
    wrap.appendChild(holder);
    document.body.insertBefore(wrap, document.body.firstChild);

    // 이 화면(history.html)의 body 는 flex + overflow:hidden + 높이 고정이라
    // 임시 상자가 화면 밖으로 밀리고, 그러면 캡처 영역이 어긋나 내용이 잘린다.
    // 캡처하는 동안만 그 제약을 풀고, 끝나면 되돌린다.
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'visible';
    document.documentElement.style.overflow = 'visible';

    // 캡처할 영역을 픽셀로 못 박는다. 요소 위치로 알아서 잡게 두면
    // 창 크기·스크롤에 따라 좌우가 잘린다.
    const capW = Math.ceil(holder.scrollWidth);

    // 한 섹션이 두 쪽으로 갈리지 않게 한다.
    //
    // html2pdf 의 pagebreak.avoid 는 이 방식(화면을 통째로 그림으로 떠서 일정 높이로
    // 자르는 방식)에서는 듣지 않는다. 실제로 걸어 봤지만 섹션이 그대로 갈렸다.
    // 그래서 자를 자리를 직접 계산해, 걸치는 섹션 앞에 빈 칸을 넣어 다음 장으로 민다.
    //
    //   A4 가로 297x210mm, 위아래 여백 8mm → 한 쪽에 쓸 수 있는 높이 194mm
    //   가로 297-16=281mm 가 capW 픽셀에 대응하므로 1px = 281/capW mm
    const pageH = Math.floor(194 / (281 / capW));
    const holderTop = holder.getBoundingClientRect().top;
    let pushed = 0, tooTall = 0;

    holder.querySelectorAll('section, .settle-exec').forEach(el => {
        const r = el.getBoundingClientRect();
        const top = r.top - holderTop;
        const h = r.height;
        if (h > pageH) { tooTall++; return; }        // 한 쪽보다 큰 섹션은 어쩔 수 없다
        const startPage = Math.floor(top / pageH);
        const endPage = Math.floor((top + h - 1) / pageH);
        if (startPage === endPage) return;           // 이미 한 쪽에 들어간다

        const gap = (startPage + 1) * pageH - top;   // 다음 장 머리까지 밀어낸다
        const spacer = document.createElement('div');
        spacer.style.cssText = `height:${gap}px;`;
        el.parentNode.insertBefore(spacer, el);
        pushed++;
    });
    if (pushed || tooTall) {
        console.info(`결산 PDF: ${pushed}개 섹션을 다음 장으로 밀었습니다.`
            + (tooTall ? ` (${tooTall}개는 한 쪽 ${pageH}px 보다 커서 나뉩니다)` : ''));
    }

    const capH = Math.ceil(holder.scrollHeight);   // 빈 칸을 넣은 뒤의 최종 높이

    const opt = {
        margin: [8, 8, 8, 8],
        filename: `팀결산보고_${periodLabel.replace(/[\/:*?"<>|]/g, '')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2, useCORS: true, backgroundColor: '#ffffff',
            scrollX: 0, scrollY: 0,
            width: capW, height: capH, windowWidth: capW, windowHeight: capH
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: [] }   // 자를 자리는 위에서 직접 맞췄다
    };

    try {
        // 여기서 높이가 0 이면 빈 종이가 나온다. 저장하기 전에 잡아낸다.
        if (holder.scrollHeight < 50) {
            throw new Error('내용 높이를 계산하지 못했습니다 (' + holder.scrollHeight + 'px)');
        }
        await html2pdf().from(holder).set(opt).save();
    } catch (e) {
        console.error('결산 PDF 저장 실패:', e);
        alert('PDF 저장 중 오류가 발생했습니다.');
    } finally {
        document.body.style.overflow = prevBody;
        document.documentElement.style.overflow = prevHtml;
        wrap.remove();
        if (btn) { btn.disabled = false; btn.textContent = btnText; }
    }
}

// 7. 엑셀 다운로드
// ============================================================
function downloadSettlementExcel(periodLabel, core, tp, wf, wr, att, mg, insp, ms, opinion) {
    try {
        const rows = [
            ['구분', '항목', '값'],
            ['종합', '총 처리량(개)', Math.round(tp.totalQuantity)],
            ['종합', 'OEE(%)', core.curProd.oee.toFixed(1)],
            ['생산성·효율성', '일평균 처리량(개)', Math.round(tp.avgDailyQuantity)],
            ['생산성·효율성', '시간 활용률(%)', core.curProd.utilizationRate.toFixed(1)],
            ['생산성·효율성', '업무 효율성(%)', core.curProd.efficiencyRatio.toFixed(1)],
            ['생산성·효율성', '품질 효율(%)', core.curProd.qualityRatio.toFixed(1)],
            ...tp.taskEntries.map(t => ['업무별 처리량', t.task, Math.round(t.quantity)]),
            ['인력운영', '일평균 근무인원(명)', wf.avgActiveMembers.toFixed(1)],
            ['인력운영', '정규 인원(명)', wf.regularMemberCount],
            ['인력운영', '파트타이머(명)', wf.partTimerCount],
            ['인력운영', '연차·반차 사용(일)', wf.leaveDaysUsed.toFixed(1)],
            ['업무리포트', '활동 인원(명)', wr.memberCount],
            ['업무리포트', '수행 업무 종류(종)', wr.taskCount],
            ...LEAVE_TYPES.filter(t => att.typeCounts[t] > 0).map(t => ['근태이력', t + '(건)', att.typeCounts[t]]),
            ['경영지표', '총 매출(원)', Math.round(mg.curMgmt.revenue)],
            ['경영지표', '총 발주 건수', Math.round(mg.curMgmt.orderCount)],
            ['경영지표', '평균 재고금액(원)', Math.round(mg.curMgmt.avgInventoryAmt)],
            ['경영지표', '평균 환율(USD)', mg.curMgmt.avgUsdRate > 0 ? mg.curMgmt.avgUsdRate.toFixed(1) : ''],
            ['경영지표', '평균 환율(CNY)', mg.curMgmt.avgCnyRate > 0 ? mg.curMgmt.avgCnyRate.toFixed(1) : ''],
            ['검수이력', '총 검수 SKU(종)', insp.productTypeCount],
            ['검수이력', '총 검수 수량(개)', Math.round(insp.totalInspectedQty)],
            ['검수이력', '불량 수량(개)', Math.round(insp.totalDefectQty)],
            ['검수이력', '수량기준 불량률(%)', insp.qtyDefectRate.toFixed(1)],
            ['검수이력', '건수기준 불량률(%)', insp.countDefectRate.toFixed(1)],
            ['마일스톤', '등록 건수', ms.total],
            ['마일스톤', '효과 측정 가능 건수', ms.measuredCount],
            ['마일스톤', '긍정 효과 건수', ms.positiveCount],
            ['마일스톤', '부정 변화 건수', ms.negativeCount],
            ...ms.items.map(it => ['마일스톤 상세',
                `${it.milestone.date} ${it.milestone.title || ''}`.trim(),
                it.summary.hasEnoughData
                    ? `UPH ${it.uphPct !== null ? (it.uphPct >= 0 ? '+' : '') + it.uphPct.toFixed(1) + '%' : '-'} / 처리량 ${it.qtyPct !== null ? (it.qtyPct >= 0 ? '+' : '') + it.qtyPct.toFixed(1) + '%' : '-'}`
                    : `데이터 부족(${it.summary.statusLabel})`
            ]),
            ...ms.items.map(it => ['마일스톤 운영방안',
                `${it.milestone.date} ${it.milestone.title || ''}`.trim(),
                `[해석] ${it.insight.interp} [운영방안] ${it.insight.action}`
            ]),
            ...(opinion.verdict ? [['종합의견', '종합 판정', opinion.verdict.text]] : []),
            ...(opinion.verdictSummary ? [['종합의견', '총평', opinion.verdictSummary]] : []),
            ...(opinion.points || []).map((p, i) => ['종합의견', `진단 해석 ${i + 1}`, String(p.text).replace(/<[^>]+>/g, '')]),
            ...(opinion.plans || []).map((pl, i) => ['운영계획', `${i + 1}. ${pl.title}`, String(pl.text).replace(/<[^>]+>/g, '')])
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        worksheet['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 16 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '팀 결산 보고');
        XLSX.writeFile(workbook, `팀결산보고_${periodLabel.replace(/\s/g, '')}_${getTodayDateString()}.xlsx`);
    } catch (e) {
        console.error('결산 보고서 엑셀 다운로드 실패:', e);
        alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
}

// ============================================================
// 8. 메인 렌더 함수
// ============================================================
function buildPeriodControlsHtml() {
    const { granularity, year, sub } = _currentPeriod;
    const allYears = new Set((State.allHistoryData || []).map(d => (d.id || '').substring(0, 4)).filter(Boolean));
    allYears.add(String(year));
    const yearOptions = [...allYears].sort().reverse();

    const granBtn = (g, label) => `<button data-settle-gran="${g}" class="settle-gran-btn px-3 py-1.5 text-sm font-bold transition ${granularity === g ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}">${label}</button>`;

    let subOptions = '';
    if (granularity === 'month') {
        subOptions = Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}" ${sub === m ? 'selected' : ''}>${m}월</option>`).join('');
    } else if (granularity === 'quarter') {
        subOptions = [1, 2, 3, 4].map(q => `<option value="${q}" ${sub === q ? 'selected' : ''}>${q}분기</option>`).join('');
    }

    return `
        <div class="flex flex-wrap items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm print:hidden">
            <div class="flex items-center gap-2 flex-wrap">
                <div class="flex rounded-lg overflow-hidden border border-gray-300">
                    ${granBtn('month', '월')}${granBtn('quarter', '분기')}${granBtn('year', '년')}
                </div>
                <select id="settle-year-select" class="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                    ${yearOptions.map(y => `<option value="${y}" ${String(year) === y ? 'selected' : ''}>${y}년</option>`).join('')}
                </select>
                ${granularity !== 'year' ? `<select id="settle-sub-select" class="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">${subOptions}</select>` : ''}
                <button id="settle-generate-btn" class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-1.5 rounded-lg transition">📊 보고서 생성</button>
            </div>
            <div class="flex items-center gap-2">
                <span id="settle-generated-at" class="text-xs text-gray-400"></span>
                <button id="settle-download-btn" class="bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-3 py-1.5 rounded-lg transition">⬇️ 엑셀</button>
                <button id="settle-pdf-btn" class="bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-3 py-1.5 rounded-lg transition" title="화면 모습 그대로 저장합니다">🖼️ PDF</button>
            </div>
        </div>`;
}

function attachPeriodControlListeners(container, appConfig) {
    container.querySelectorAll('.settle-gran-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const gran = btn.dataset.settleGran;
            if (gran === _currentPeriod.granularity) return;
            if (gran === 'month') _currentPeriod = { granularity: 'month', year: _currentPeriod.year, sub: new Date().getMonth() + 1 };
            else if (gran === 'quarter') _currentPeriod = { granularity: 'quarter', year: _currentPeriod.year, sub: Math.floor(new Date().getMonth() / 3) + 1 };
            else _currentPeriod = { granularity: 'year', year: _currentPeriod.year, sub: null };
            renderSettlementReport(container, appConfig);
        });
    });

    const generateBtn = container.querySelector('#settle-generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', () => {
            const yearSel = container.querySelector('#settle-year-select');
            const subSel = container.querySelector('#settle-sub-select');
            _currentPeriod.year = Number(yearSel.value) || _currentPeriod.year;
            if (subSel) _currentPeriod.sub = Number(subSel.value) || _currentPeriod.sub;
            renderSettlementReport(container, appConfig);
        });
    }
}

/** 머리글의 정렬·필터 버튼 처리. 컨테이너를 다시 그려도 한 번만 붙는다. */
function bindSortFilterListeners(container, appConfig) {
    if (!container || container.dataset.sfBound === 'true') return;
    container.dataset.sfBound = 'true';

    container.addEventListener('click', (e) => {
        const sortBtn = e.target.closest('[data-tf-sort]');
        if (sortBtn) {
            const st = sfState(sortBtn.dataset.tfTable);
            const key = sortBtn.dataset.tfSort;
            // 오름차순 → 내림차순 → 해제
            if (st.sort.key !== key) st.sort = { key, dir: 'asc' };
            else if (st.sort.dir === 'asc') st.sort.dir = 'desc';
            else st.sort = { key: '', dir: 'asc' };
            closeFloatingFilter();
            renderSettlementReport(container, appConfig);
            return;
        }
        const fBtn = e.target.closest('[data-tf-filter]');
        if (fBtn) {
            const id = fBtn.dataset.tfTable, key = fBtn.dataset.tfFilter;
            const cols = _sfCols[id] || [];
            const col = cols.find(c => c.key === key);
            const st = sfState(id);
            if (!col) return;
            // 다른 칸에 걸린 필터를 통과한 행에서만 후보값을 뽑는다(엑셀과 같은 방식)
            const others = (_sfRows[id] || []).filter(r =>
                cols.every(c => c.key === key || !c.filterable || matchesFilter(c.get(r), st.filters[c.key])));
            const options = [...new Set(others.map(r => String(col.get(r) ?? '')))].sort((x, y) => x.localeCompare(y, 'ko'));
            openFloatingFilter(fBtn, {
                key: id + '|' + key,
                label: col.label,
                options,
                current: st.filters[key],
                onChange: (v) => {
                    if (v == null) delete st.filters[key]; else st.filters[key] = v;
                    renderSettlementReport(container, appConfig);
                }
            });
        }
    });
}

export function renderSettlementReport(container, appConfig) {
    if (!container) return;
    appConfig = appConfig || State.appConfig || {};
    destroyCharts();

    const { granularity, year, sub } = _currentPeriod;
    const periodLabel = getPeriodLabel(granularity, year, sub);
    const currentDays = getFilteredDaysForPeriod(granularity, year, sub);
    const prevPeriod = getPreviousPeriod(granularity, year, sub);
    const previousDays = getFilteredDaysForPeriod(granularity, prevPeriod.year, prevPeriod.sub);
    const workingDaysCount = currentDays.filter(d => (d.workRecords || []).length > 0).length;

    const core = computeCoreMetrics(currentDays, previousDays, appConfig);
    const tp = computeThroughputSummary(currentDays, core);
    const wf = computeWorkforceSummary(currentDays, appConfig, core);
    const att = computeAttendanceSummary(currentDays);
    const wr = computeWorkReportSummary(core);
    const mg = computeManagementSummary(currentDays, previousDays, appConfig, core);
    const { from, to } = getPeriodDateRange(granularity, year, sub);
    const insp = computeInspectionSummary(_productHistoryCache, from, to);
    const ms = computeMilestoneSummaryForPeriod(from, to);
    const opinion = computeOverallOpinion(core, tp, wf, att, mg, insp, ms, workingDaysCount);

    const prodResult = renderProductivitySection(tp, core, workingDaysCount);
    const attResult = renderAttendanceSection(att);
    const mgResult = renderManagementSection(mg);

    container.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
                <h2 class="text-xl font-bold text-gray-800 dark:text-gray-100">🧾 팀 결산 보고 <span class="text-blue-600">· ${periodLabel}</span></h2>
                <p class="text-xs text-gray-500 mt-1">근무 기록 ${currentDays.length}일 중 실근무 ${workingDaysCount}일 기준</p>
            </div>
        </div>
        ${buildPeriodControlsHtml()}
        ${renderExecutiveSummary(core, tp, wf, att, mg, insp, periodLabel, workingDaysCount)}
        <div class="space-y-5">
            ${prodResult.html || prodResult}
            ${renderWorkforceSection(wf, core, workingDaysCount)}
            ${renderWorkReportSection(wr, workingDaysCount, currentDays.length)}
            ${attResult.html || attResult}
            ${mgResult.html || mgResult}
            ${renderInspectionSection(insp)}
            ${renderMilestoneSection(ms)}
            ${renderOverallOpinionSection(opinion, periodLabel, workingDaysCount)}
        </div>
    `;

    bindSortFilterListeners(container, appConfig);
    bindDrillListeners(container, { days: currentDays, prod: core.curProd });

    // 차트 인스턴스 생성 (DOM 마운트 이후)
    if (prodResult.chartId && prodResult.chartData) {
        createBarChart(prodResult.chartId, prodResult.chartData.labels, prodResult.chartData.values, '일별 처리량', '#2563eb');
    }
    if (attResult.chartId && attResult.labels && attResult.labels.length > 0) {
        createHorizontalBarChart(attResult.chartId, attResult.labels, attResult.values, '#f59e0b');
    }
    if (mgResult.chartId && mgResult.chartData) {
        createBarChart(mgResult.chartId, mgResult.chartData.labels, mgResult.chartData.values, '일별 매출', '#10b981');
    }

    const generatedAtEl = container.querySelector('#settle-generated-at');
    if (generatedAtEl) generatedAtEl.textContent = `생성: ${new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`;

    const downloadBtn = container.querySelector('#settle-download-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => downloadSettlementExcel(periodLabel, core, tp, wf, wr, att, mg, insp, ms, opinion));

    const pdfBtn = container.querySelector('#settle-pdf-btn');
    if (pdfBtn) pdfBtn.addEventListener('click', () => downloadSettlementPdf(periodLabel));

    attachPeriodControlListeners(container, appConfig);
}

// ============================================================
// 9. 초기화 (탭 진입 시 1회 호출)
// ============================================================
export async function initSettlementReport() {
    const container = document.getElementById('settlement-panel');
    if (!container) return;

    if (!_productHistoryCache) {
        try {
            const snapshot = await getDocs(collection(State.db, 'product_history'));
            _productHistoryCache = [];
            snapshot.forEach(d => _productHistoryCache.push({ id: d.id, ...d.data() }));
        } catch (e) {
            console.error('검수 이력(product_history) 로드 실패:', e);
            _productHistoryCache = [];
        }
    }

    // 마일스톤 결과 데이터(운영 마일스톤 전/후 효과)를 캐시에 로드
    await ensureMilestonesLoaded();

    renderSettlementReport(container, State.appConfig);
}
