// === js/ui-history-management.js ===
// 설명: 경영 지표(재고, 매출 등)의 입력 및 기간별 분석 리포트 렌더링을 담당합니다.

import { formatDuration, getWeekOfYear, isWeekday, toDateString, buildMemberHourlyWageMap } from './utils.js?v=202610021122';
import { getDiffHtmlForMetric, analyzeUnitCost } from './ui-history-reports-logic.js?v=202610021122';
import { appConfig } from './state.js?v=202610021122';
import {
    REVENUE_CHANNELS, CHANNEL_METRICS,
    revenueTotalOf, orderCountTotalOf, isLegacyRevenue, isLegacyOrderCount
} from './revenue-channels.js?v=202610021122';
// predictFutureTrends import 제거됨

// 💰 채널별 입력 블록 (일반배송(카페24) / 직진배송 / 도착보장 / 기타)
//    매출액·주문 건수 두 지표 모두 같은 방식으로 만들어진다.
//    합계는 입력할 때마다 즉시 다시 계산해 화면에 보여준다.
// ⚠️ 아래 스크립트 문자열은 oninput="..." 속성 안에 들어가므로 큰따옴표를 쓰면 안 된다.
const recalcTotalJs = (metricKey, fieldOf) => `(function(){` +
    `var ids=[${REVENUE_CHANNELS.map(c => `'mgmt-input-${fieldOf(c)}'`).join(',')}];` +
    `var sum=ids.reduce(function(s,id){var el=document.getElementById(id);` +
    `return s+(Number(((el&&el.value)||'0').replace(/[^0-9]/g,''))||0);},0);` +
    `var out=document.getElementById('mgmt-${metricKey}-total');` +
    `if(out) out.textContent=sum.toLocaleString();})();`;

const legacyNoteHtml = (isLegacy, total, unit) => isLegacy
    ? `<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded p-2 leading-relaxed">
         ⚠️ 이 날짜는 채널 구분 이전에 입력된 데이터입니다. 총계 <b>${formatCurrency(total)}${unit}</b>만 남아 있어
         채널별 값이 비어 있습니다. 채널별로 나눠 입력한 뒤 저장하면 합계가 새로 계산됩니다.
       </p>`
    : '';

// 채널 한 줄에 [채널명 | 매출액 | 주문 건수]를 나란히 배치한다.
// (지표별로 블록을 나누면 같은 채널의 매출/건수를 눈으로 맞춰보기 어려워서 한 행으로 합침)
const channelGridHtml = (mgmt, prevMgmt, formatVal, onInputHandler) => {
    const diffKindOf = (m) => m.key === 'revenue' ? 'totalCost' : 'quantity';
    const totalOf = (m, src) => m.key === 'revenue' ? revenueTotalOf(src) : orderCountTotalOf(src);

    const header = `
        <div class="grid grid-cols-[5.5rem_1fr_1fr] gap-2 items-end px-0.5">
            <span></span>
            ${CHANNEL_METRICS.map(m => `<span class="text-[11px] font-bold text-gray-500 text-right pr-1">${m.label} (${m.unit})</span>`).join('')}
        </div>`;

    const rows = REVENUE_CHANNELS.map(c => `
        <div class="grid grid-cols-[5.5rem_1fr_1fr] gap-2 items-center">
            <span class="flex items-center gap-1.5 text-[13px] text-gray-600 min-w-0">
                <span class="inline-block w-2 h-2 rounded-full shrink-0" style="background:${c.color}"></span>
                <span class="truncate" title="${c.label}">${c.shortLabel}</span>
            </span>
            ${CHANNEL_METRICS.map(m => {
                const field = m.fieldOf(c);
                return `<div>
                    <input type="text" id="mgmt-input-${field}" data-channel="${c.id}" data-metric="${m.key}"
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-right font-bold text-gray-800"
                        placeholder="0" value="${formatVal(mgmt[field])}"
                        oninput="${onInputHandler} ${recalcTotalJs(m.key, m.fieldOf)}">
                    <div class="text-[11px] font-medium text-right mt-0.5">
                        ${getDiffHtmlForMetric(diffKindOf(m), mgmt[field], prevMgmt[field])}
                    </div>
                </div>`;
            }).join('')}
        </div>`).join('');

    const totalRow = `
        <div class="grid grid-cols-[5.5rem_1fr_1fr] gap-2 items-center pt-2 border-t border-blue-100">
            <span class="text-sm font-bold text-blue-800">합계</span>
            ${CHANNEL_METRICS.map(m => `
                <div class="text-right pr-1">
                    <span id="mgmt-${m.key}-total" class="text-base font-black text-blue-800">${formatCurrency(totalOf(m, mgmt))}</span>
                    <div class="text-[11px] font-medium mt-0.5">
                        ${getDiffHtmlForMetric(diffKindOf(m), totalOf(m, mgmt), totalOf(m, prevMgmt))}
                    </div>
                </div>`).join('')}
        </div>`;

    // 채널 구분 이전 데이터 안내는 지표별로 한 번씩만
    const notes = CHANNEL_METRICS.map(m => m.key === 'revenue'
        ? legacyNoteHtml(isLegacyRevenue(mgmt), Number(mgmt.revenue), m.unit)
        : legacyNoteHtml(isLegacyOrderCount(mgmt), Number(mgmt.orderCount), m.unit)).join('');

    // 칸을 비우고 저장하면 '변경 없음'으로 처리돼 기존 값이 그대로 남는다.
    // 자동입력이 잘못 넣은 값을 지우려는 사람이 여기서 막히므로 미리 알려 둔다.
    const clearHint = `<p class="text-[10px] text-gray-400 pt-1">값을 지우려면 칸을 비우지 말고 <b>0</b>을 입력하세요.</p>`;

    return `<div class="space-y-2">${notes}${header}${rows}${totalRow}${clearHint}</div>`;
};

// 헬퍼: 숫자를 통화 형식(콤마)으로 변환
const formatCurrency = (num) => {
    return (Number(num) || 0).toLocaleString();
};

// 헬퍼: 요일 구하기
const getDayOfWeek = (dateStr) => {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[new Date(dateStr).getDay()];
};

// 헬퍼: 재고 순환율 계산
const calculateTurnoverRatio = (totalRevenue, avgInventoryAmt) => {
    if (!avgInventoryAmt || avgInventoryAmt <= 0) return 0;
    return totalRevenue / avgInventoryAmt;
};

// 💰 총 매출 / 총 주문건수 카드 안에 채널별 구성비를 함께 보여준다.
//    metricKey: 'revenue' | 'orderCount'
const channelBreakdownHtml = (stats, metricKey) => {
    const isRevenue = metricKey === 'revenue';
    const total = Number(isRevenue ? stats.revenue : stats.orderCount) || 0;
    if (total <= 0) return '';

    const byChannel = isRevenue ? stats.revenueByChannel : stats.orderCountByChannel;
    const unclassified = Number(isRevenue ? stats.revenueUnclassified : stats.orderCountUnclassified) || 0;
    const pct = (v) => ((v / total) * 100).toFixed(1);

    const row = (label, value, color, muted = false) => `
        <div class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-1.5 ${muted ? 'text-gray-400' : 'text-gray-600'}">
                <span class="inline-block w-2 h-2 rounded-full" style="background:${color}"></span>${label}
            </span>
            <span class="font-bold ${muted ? 'text-gray-500' : 'text-gray-700'}">${formatCurrency(value)}<span class="text-gray-400 font-normal ml-1">(${pct(value)}%)</span></span>
        </div>`;

    const rows = REVENUE_CHANNELS.map(c => row(c.label, Number(byChannel?.[c.id]) || 0, c.color)).join('');
    const legacy = unclassified > 0 ? row('채널 미구분', unclassified, '#d1d5db', true) : '';

    return `<div class="mt-3 pt-3 border-t border-gray-100 space-y-1 text-xs">${rows}${legacy}</div>`;
};

// 헬퍼: 데이터 집계 함수
export const aggregateManagementData = (dataList) => {
    const result = {
        revenue: 0,
        orderCount: 0,
        inventoryQtySum: 0,
        inventoryAmtSum: 0,
        daysWithInventory: 0,
        avgInventoryQty: 0,
        avgInventoryAmt: 0,
        usdRateSum: 0, cnyRateSum: 0, daysWithFx: 0,
        avgUsdRate: 0, avgCnyRate: 0,
        // 💰 채널별 매출·주문건수 합계 (일반배송(카페24) / 직진배송 / 도착보장 / 기타)
        revenueByChannel: REVENUE_CHANNELS.reduce((a, c) => ({ ...a, [c.id]: 0 }), {}),
        orderCountByChannel: REVENUE_CHANNELS.reduce((a, c) => ({ ...a, [c.id]: 0 }), {}),
        revenueUnclassified: 0,   // 채널 구분 이전에 입력된 총액
        orderCountUnclassified: 0 // 채널 구분 이전에 입력된 총 건수
    };

    dataList.forEach(day => {
        const mgmt = day.management || {};
        result.revenue += revenueTotalOf(mgmt);
        result.orderCount += orderCountTotalOf(mgmt);

        REVENUE_CHANNELS.forEach(c => {
            result.revenueByChannel[c.id] += (Number(mgmt[c.field]) || 0);
            result.orderCountByChannel[c.id] += (Number(mgmt[c.orderField]) || 0);
        });
        if (isLegacyRevenue(mgmt)) result.revenueUnclassified += (Number(mgmt.revenue) || 0);
        if (isLegacyOrderCount(mgmt)) result.orderCountUnclassified += (Number(mgmt.orderCount) || 0);

        const invQty = Number(mgmt.inventoryQty) || 0;
        const invAmt = Number(mgmt.inventoryAmt) || 0;

        if (invQty > 0 || invAmt > 0) {
            result.inventoryQtySum += invQty;
            result.inventoryAmtSum += invAmt;
            result.daysWithInventory++;
        }

        const usd = Number(mgmt.usdRate) || 0;
        const cny = Number(mgmt.cnyRate) || 0;
        if (usd > 0 || cny > 0) {
            result.usdRateSum += usd;
            result.cnyRateSum += cny;
            result.daysWithFx++;
        }
    });

    if (result.daysWithInventory > 0) {
        result.avgInventoryQty = result.inventoryQtySum / result.daysWithInventory;
        result.avgInventoryAmt = result.inventoryAmtSum / result.daysWithInventory;
    }
    if (result.daysWithFx > 0) {
        result.avgUsdRate = result.usdRateSum / result.daysWithFx;
        result.avgCnyRate = result.cnyRateSum / result.daysWithFx;
    }

    return result;
};

/**
 * 원가 분석 HTML 생성 헬퍼
 */
const generateCostAnalysisHTML = (analysis) => {
    if (!analysis.isValid) {
        return `
            <div class="mt-8 p-6 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-center text-gray-500">
                <p class="mb-2">📉 <strong>원가 분석 데이터를 표시할 수 없습니다.</strong></p>
                <p class="text-xs">관리자 페이지에서 '원가 계산 업무' 및 '고정 비용'을 설정하고,<br>해당 기간의 업무 기록(처리량)이 있어야 분석이 가능합니다.</p>
            </div>
        `;
    }

    const { costs, profit, targetTasks } = analysis;
    
    let profitHtml = '';
    if (profit.revenuePerItem > 0) {
        const marginColor = profit.margin > 0 ? 'text-blue-600' : 'text-red-600';
        profitHtml = `
            <div class="flex-1 bg-green-50 p-4 rounded-lg border border-green-100">
                <h5 class="text-sm font-bold text-green-800 mb-2">💰 예상 손익 (1개당)</h5>
                <div class="flex justify-between items-center text-sm mb-1">
                    <span class="text-gray-600">객단가 (매출/수량)</span>
                    <span class="font-semibold">${Math.round(profit.revenuePerItem).toLocaleString()}원</span>
                </div>
                <div class="flex justify-between items-center text-sm border-t border-green-200 pt-2 mt-1">
                    <span class="text-gray-800 font-bold">공헌이익 (마진)</span>
                    <span class="text-xl font-extrabold ${marginColor}">${Math.round(profit.margin).toLocaleString()}원 <span class="text-xs font-normal">(${profit.marginRate.toFixed(1)}%)</span></span>
                </div>
            </div>
        `;
    } else {
        profitHtml = `
            <div class="flex-1 bg-gray-50 p-4 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 text-sm">
                매출액과 주문건수가 입력되어야<br>예상 마진이 계산됩니다.
            </div>
        `;
    }

    return `
        <div class="mt-8">
            <h4 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                💸 상품 1개당 원가 및 손익 분석 (기간 평균)
            </h4>
            <div class="flex flex-col md:flex-row gap-6">
                <div class="flex-1 bg-orange-50 p-4 rounded-lg border border-orange-100">
                    <h5 class="text-sm font-bold text-orange-800 mb-2">📦 출고 원가 구성 (1개당)</h5>
                    <div class="space-y-2">
                        <div class="flex justify-between items-center text-sm">
                            <span class="text-gray-600">인건비 <span class="text-xs text-gray-400">(${targetTasks.length}개 업무)</span></span>
                            <span class="font-semibold">${Math.round(costs.labor).toLocaleString()}원</span>
                        </div>
                        <div class="flex justify-between items-center text-sm">
                            <span class="text-gray-600">고정 부자재비</span>
                            <span class="font-semibold">${costs.material.toLocaleString()}원</span>
                        </div>
                        <div class="flex justify-between items-center text-sm">
                            <span class="text-gray-600">고정 택배비</span>
                            <span class="font-semibold">${costs.shipping.toLocaleString()}원</span>
                        </div>
                        
                        <div class="flex justify-between items-center text-purple-700">
                            <span>ZG&AB배송 화물비 <span class="text-xs">(${costs.directDeliveryCount}회)</span></span>
                            <span class="font-semibold">+ ${Math.round(costs.directDelivery).toLocaleString()}원</span>
                        </div>

                        <div class="flex justify-between items-center pt-2 border-t border-orange-200 mt-1">
                            <span class="font-bold text-orange-900">총 출고 원가</span>
                            <span class="text-xl font-extrabold text-orange-600">${Math.round(costs.total).toLocaleString()}원</span>
                        </div>
                    </div>
                </div>
                ${profitHtml}
            </div>
            <p class="text-xs text-gray-500 mt-2 text-right">
                * 인건비 계산 포함 업무: ${targetTasks.join(', ')}<br>
                * 기준 수량: ${analysis.baseQuantity.toLocaleString()}개 (기간 내 총 주문건수 또는 총 작업량)
            </p>
        </div>
    `;
};

/**
 * 1. 일별 입력 및 조회 화면 렌더링
 */
export const renderManagementDaily = (dateKey, allHistoryData) => {
    const container = document.getElementById('management-view-container');
    const saveBtn = document.getElementById('management-save-btn');
    if (!container) return;

    if (saveBtn) {
        saveBtn.classList.remove('hidden');
        saveBtn.dataset.dateKey = dateKey;
    }

    const dayData = allHistoryData.find(d => d.id === dateKey);
    const mgmt = (dayData && dayData.management) ? dayData.management : {};

    const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
    const prevDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                        ? allHistoryData[currentIndex + 1] : null;
    const prevMgmt = (prevDayData && prevDayData.management) ? prevDayData.management : {};

    const getValue = (val) => (val !== undefined && val !== null) ? val : '';
    const formatVal = (val) => {
        const v = getValue(val);
        return v === '' ? '' : Number(v).toLocaleString();
    };
    const onInputHandler = "this.value = this.value.replace(/[^0-9]/g, '').replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');";

    const wageMap = buildMemberHourlyWageMap(appConfig.memberWages); // 월기본급 → 시급(÷209)
    (dayData?.partTimers || []).forEach(pt => {
        if (pt.name) wageMap[pt.name] = pt.wage || 0;
    });

    const analysis = analyzeUnitCost(
        dayData || { workRecords: [], taskQuantities: {} }, 
        appConfig, 
        wageMap, 
        revenueTotalOf(mgmt)
    );

    const analysisHtml = generateCostAnalysisHTML(analysis);

    container.innerHTML = `
        <div class="max-w-4xl mx-auto">
            <div class="mb-6 flex items-center justify-between">
                <h3 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                    📅 ${dateKey} 경영 지표 입력
                </h3>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded mr-2">
                        * 숫자를 입력하면 전일 대비 증감이 자동 계산됩니다.
                    </span>
                    <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm"
                            data-action="request-history-deletion" data-date-key="${dateKey}">
                        삭제
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-6 rounded-xl border border-blue-100 shadow-sm">
                    <h4 class="font-bold text-blue-800 mb-4 flex items-center">
                        💰 매출 현황
                    </h4>
                    <div class="space-y-5">
                        ${channelGridHtml(mgmt, prevMgmt, formatVal, onInputHandler)}
                        <div class="pt-3 border-t">
                            <div class="text-sm font-bold text-gray-700 mb-2">건당 평균 매출 (객단가)</div>
                            <div class="space-y-1 text-sm">
                                ${REVENUE_CHANNELS.map(c => {
                                    const rev = Number(mgmt[c.field]) || 0;
                                    const ord = Number(mgmt[c.orderField]) || 0;
                                    return `<div class="flex justify-between">
                                        <span class="flex items-center gap-1.5 text-gray-600 text-[13px]">
                                            <span class="inline-block w-2 h-2 rounded-full" style="background:${c.color}"></span>${c.label}
                                        </span>
                                        <span class="font-bold text-gray-700">${ord > 0 ? formatCurrency(Math.round(rev / ord)) : '0'} 원</span>
                                    </div>`;
                                }).join('')}
                                <div class="flex justify-between pt-1.5 border-t border-gray-100">
                                    <span class="text-gray-800 font-bold">전체</span>
                                    <span class="font-bold text-gray-800">
                                        ${orderCountTotalOf(mgmt) > 0 ? formatCurrency(Math.round(revenueTotalOf(mgmt) / orderCountTotalOf(mgmt))) : '0'} 원
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="bg-white p-6 rounded-xl border border-indigo-100 shadow-sm">
                    <h4 class="font-bold text-indigo-800 mb-4 flex items-center">
                        📦 재고 현황
                    </h4>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">총 재고량 (개)</label>
                            <div class="flex items-center gap-2">
                                <input type="text" id="mgmt-input-inventoryQty" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-right font-bold text-gray-800" 
                                    placeholder="0" value="${formatVal(mgmt.inventoryQty)}" oninput="${onInputHandler}">
                                <span class="text-sm font-medium w-20 text-right">
                                    ${getDiffHtmlForMetric('quantity', mgmt.inventoryQty, prevMgmt.inventoryQty)}
                                </span>
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">재고 금액 (원)</label>
                            <div class="flex items-center gap-2">
                                <input type="text" id="mgmt-input-inventoryAmt" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-right font-bold text-gray-800" 
                                    placeholder="0" value="${formatVal(mgmt.inventoryAmt)}" oninput="${onInputHandler}">
                                <span class="text-sm font-medium w-20 text-right">
                                    ${getDiffHtmlForMetric('totalCost', mgmt.inventoryAmt, prevMgmt.inventoryAmt)}
                                </span>
                            </div>
                        </div>
                        <div class="pt-3 border-t mt-2">
                            <div class="flex justify-between text-sm">
                                <span class="text-gray-600">재고 순환율 (매출/재고)</span>
                                <span class="font-bold text-indigo-600">
                                    ${(Number(mgmt.inventoryAmt) > 0) ? (revenueTotalOf(mgmt) / Number(mgmt.inventoryAmt) * 100).toFixed(1) : "0.0"} %
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="mt-6 bg-white p-6 rounded-xl border border-emerald-100 shadow-sm">
                    <h4 class="font-bold text-emerald-800 mb-4 flex items-center justify-between">
                        <span>💱 환율 (원)</span>
                        <span class="text-[11px] font-medium text-gray-400">${mgmt.fxAt ? '자동입력 ' + new Date(mgmt.fxAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '매일 오전 9시 자동입력'}</span>
                    </h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">달러 (1 USD = 원)</label>
                            <input type="text" id="mgmt-input-usdRate" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 text-right font-bold text-gray-800"
                                placeholder="0" value="${formatVal(mgmt.usdRate)}" oninput="${onInputHandler}">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">위안화 (1 CNY = 원)</label>
                            <input type="text" id="mgmt-input-cnyRate" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 text-right font-bold text-gray-800"
                                placeholder="0" value="${formatVal(mgmt.cnyRate)}" oninput="${onInputHandler}">
                        </div>
                    </div>
                    <div class="text-[11px] text-gray-400 mt-2">매일 오전 9시 그날의 환율이 자동 입력됩니다. 필요 시 직접 수정 후 [저장]하세요.</div>
                </div>

                <div class="mt-6 p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-yellow-800">
                    💡 <strong>Tip:</strong> 입력한 데이터는 우측 상단 <strong>[저장]</strong> 버튼을 눌러야 반영됩니다. 저장된 데이터는 주간/월간 리포트에서 합산되어 분석됩니다.
                </div>
            </div>

            ${analysisHtml}
        </div>
    `;
};

/**
 * 2. 기간별(주/월/년) 요약 및 분석 화면 렌더링
 */
export const renderManagementSummary = (viewMode, key, allHistoryData) => {
    const container = document.getElementById('management-view-container');
    const saveBtn = document.getElementById('management-save-btn');
    if (!container) return;
    if (saveBtn) saveBtn.classList.add('hidden');

    const filteredData = allHistoryData.filter(d => {
        if (viewMode === 'management-weekly') return getWeekOfYear(new Date(d.id)) === key;
        if (viewMode === 'management-monthly') return d.id.startsWith(key);
        if (viewMode === 'management-yearly') return d.id.startsWith(key);
        return false;
    });
    filteredData.sort((a, b) => a.id.localeCompare(b.id));

    if (filteredData.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10">해당 기간(${key})에 입력된 경영 지표 데이터가 없습니다.</div>`;
        return;
    }

    const currentStats = aggregateManagementData(filteredData);

    let prevKey = null;
    if (viewMode === 'management-monthly') {
        const [y, m] = key.split('-').map(Number);
        const prevDate = new Date(y, m - 2, 1);
        prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    } else if (viewMode === 'management-yearly') {
        prevKey = String(Number(key) - 1);
    }

    let prevStats = null;
    if (prevKey) {
        const prevData = allHistoryData.filter(d => {
            if (viewMode === 'management-monthly') return d.id.startsWith(prevKey);
            if (viewMode === 'management-yearly') return d.id.startsWith(prevKey);
            return false;
        });
        if (prevData.length > 0) {
            prevStats = aggregateManagementData(prevData);
        }
    }

    // 💱 환율 전기간 비교 (주: 직전 7일, 월/년: 기존 prevStats 재사용)
    let prevFxStats = prevStats;
    let fxCompareLabel = prevKey ? `vs ${prevKey}` : '';
    if (viewMode === 'management-weekly' && filteredData.length > 0) {
        const earliest = filteredData[0].id;
        const s = new Date(earliest + 'T00:00:00'); s.setDate(s.getDate() - 7);
        const e = new Date(earliest + 'T00:00:00'); e.setDate(e.getDate() - 1);
        const lo = toDateString(s), hi = toDateString(e);
        const pd = allHistoryData.filter(d => d.id >= lo && d.id <= hi);
        if (pd.length > 0) { prevFxStats = aggregateManagementData(pd); fxCompareLabel = 'vs 직전주'; }
    }

    const turnoverRatio = calculateTurnoverRatio(currentStats.revenue, currentStats.avgInventoryAmt);
    const prevTurnoverRatio = prevStats ? calculateTurnoverRatio(prevStats.revenue, prevStats.avgInventoryAmt) : 0;
    
    // 일자별 테이블 생성
    let dailyTableHtml = '';
    if (viewMode === 'management-monthly' || viewMode === 'management-weekly') {
        const tableRows = filteredData.map(day => {
            const m = day.management || {};
            const rev = Number(m.revenue) || 0;
            const orders = Number(m.orderCount) || 0;
            const invAmt = Number(m.inventoryAmt) || 0;
            const invQty = Number(m.inventoryQty) || 0;
            const avgOrderPrice = orders > 0 ? rev / orders : 0;
            const dailyTurnover = invAmt > 0 ? (rev / invAmt) * 100 : 0;
            const dateColor = isWeekday(day.id) ? 'text-gray-900' : 'text-red-500 font-medium';

            return `
                <tr class="hover:bg-gray-50 transition">
                    <td class="px-4 py-3 ${dateColor}">${day.id} <span class="text-xs text-gray-400 ml-1">(${getDayOfWeek(day.id)})</span></td>
                    <td class="px-4 py-3 text-right font-bold text-blue-600">${rev > 0 ? formatCurrency(rev) : '-'}</td>
                    <td class="px-4 py-3 text-right">${orders > 0 ? formatCurrency(orders) : '-'}</td>
                    <td class="px-4 py-3 text-right text-gray-600">${avgOrderPrice > 0 ? formatCurrency(Math.round(avgOrderPrice)) : '-'}</td>
                    <td class="px-4 py-3 text-right">${invAmt > 0 ? formatCurrency(invAmt) : '-'}</td>
                    <td class="px-4 py-3 text-right">${invQty > 0 ? formatCurrency(invQty) : '-'}</td>
                    <td class="px-4 py-3 text-right font-mono text-purple-600">${dailyTurnover > 0 ? dailyTurnover.toFixed(1) + '%' : '-'}</td>
                    <td class="px-4 py-3 text-right text-emerald-700">${(Number(m.usdRate) || 0) > 0 ? formatCurrency(Number(m.usdRate)) : '-'}</td>
                    <td class="px-4 py-3 text-right text-emerald-700">${(Number(m.cnyRate) || 0) > 0 ? formatCurrency(Number(m.cnyRate)) : '-'}</td>
                </tr>
            `;
        }).join('');

        dailyTableHtml = `
            <div class="bg-white rounded-xl border border-gray-200 overflow-hidden mt-8 shadow-sm">
                <div class="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center gap-2 flex-wrap">
                    <h4 class="font-bold text-gray-800">📅 일자별 상세 내역</h4>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="window.__runFxBackfill && window.__runFxBackfill('2026-06-01')"
                                class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 px-3 rounded-md shadow-sm"
                                title="환율이 비어있는 과거 날짜를 과거 시세로 일괄 채웁니다 (2026-06-01부터)">💱 과거 환율 채우기</button>
                        <span class="text-xs text-gray-500">일별 회전율은 (매출/재고금액)% 로 계산됩니다.</span>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="bg-gray-50 text-gray-500 font-medium border-b border-gray-200">
                            <tr>
                                <th class="px-4 py-3">날짜</th>
                                <th class="px-4 py-3 text-right">매출액</th>
                                <th class="px-4 py-3 text-right">주문수</th>
                                <th class="px-4 py-3 text-right">객단가</th>
                                <th class="px-4 py-3 text-right">재고금액</th>
                                <th class="px-4 py-3 text-right">재고량</th>
                                <th class="px-4 py-3 text-right">회전율(%)</th>
                                <th class="px-4 py-3 text-right">달러(원)</th>
                                <th class="px-4 py-3 text-right">위안(원)</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${tableRows}
                        </tbody>
                        <tfoot class="bg-gray-50 font-bold text-gray-700">
                            <tr>
                                <td class="px-4 py-3">합계 / 평균</td>
                                <td class="px-4 py-3 text-right text-blue-700">${formatCurrency(currentStats.revenue)}</td>
                                <td class="px-4 py-3 text-right">${formatCurrency(currentStats.orderCount)}</td>
                                <td class="px-4 py-3 text-right">-</td>
                                <td class="px-4 py-3 text-right">${formatCurrency(Math.round(currentStats.avgInventoryAmt))} (평균)</td>
                                <td class="px-4 py-3 text-right">${formatCurrency(Math.round(currentStats.avgInventoryQty))} (평균)</td>
                                <td class="px-4 py-3 text-right">-</td>
                                <td class="px-4 py-3 text-right text-emerald-700">${currentStats.avgUsdRate > 0 ? formatCurrency(Math.round(currentStats.avgUsdRate)) + ' (평균)' : '-'}</td>
                                <td class="px-4 py-3 text-right text-emerald-700">${currentStats.avgCnyRate > 0 ? formatCurrency(Math.round(currentStats.avgCnyRate)) + ' (평균)' : '-'}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    }

    // 기간별 원가 분석
    const aggregatedWorkRecords = [];
    const aggregatedQuantities = {};
    const aggregatedWageMap = buildMemberHourlyWageMap(appConfig.memberWages); // 월기본급 → 시급(÷209)

    filteredData.forEach(day => {
        (day.workRecords || []).forEach(r => {
            aggregatedWorkRecords.push({ ...r, date: day.id });
        });
        if(day.taskQuantities) {
            Object.entries(day.taskQuantities).forEach(([k, v]) => {
                aggregatedQuantities[k] = (aggregatedQuantities[k] || 0) + (Number(v) || 0);
            });
        }
        (day.partTimers || []).forEach(pt => {
            if(pt.name) aggregatedWageMap[pt.name] = pt.wage || 0;
        });
    });

    const analysis = analyzeUnitCost(
        { 
            id: key, 
            workRecords: aggregatedWorkRecords, 
            taskQuantities: aggregatedQuantities, 
            management: { orderCount: currentStats.orderCount } 
        },
        appConfig,
        aggregatedWageMap,
        currentStats.revenue
    );

    let comparisonTitle = prevKey ? `(vs ${prevKey})` : '(이전 데이터 없음)';

    // 환율 증감액 표시 (상승=빨강▲, 하락=파랑▼)
    const fxDiff = (cur, prev) => {
        if (!cur || cur <= 0) return '';
        if (!prev || prev <= 0) return '<span class="text-xs text-gray-400">이전 데이터 없음</span>';
        const d = Math.round(cur - prev);
        if (d === 0) return '<span class="text-xs text-gray-500">변동 없음</span>';
        const up = d > 0;
        return `<span class="text-xs font-bold ${up ? 'text-red-500' : 'text-blue-500'}">${up ? '▲' : '▼'} ${Math.abs(d).toLocaleString()}원</span>`;
    };

    container.innerHTML = `
        <div class="max-w-6xl mx-auto pb-10">
            <h3 class="text-xl font-bold text-gray-800 mb-6 text-center">
                📊 ${key} 경영 성과 요약 <span class="text-sm font-normal text-gray-500 ml-2">${comparisonTitle}</span>
            </h3>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden group hover:border-blue-400 transition">
                    <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition">
                        <svg class="w-16 h-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <h4 class="text-sm font-semibold text-gray-500 mb-1">총 매출액</h4>
                    <div class="text-2xl font-extrabold text-gray-800 mb-2">
                        ${formatCurrency(currentStats.revenue)} <span class="text-sm font-medium text-gray-600">원</span>
                    </div>
                    <div class="text-sm">
                        ${getDiffHtmlForMetric('totalCost', currentStats.revenue, prevStats?.revenue)}
                    </div>
                    ${channelBreakdownHtml(currentStats, 'revenue')}
                </div>

                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden group hover:border-green-400 transition">
                    <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition">
                        <svg class="w-16 h-16 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                    </div>
                    <h4 class="text-sm font-semibold text-gray-500 mb-1">총 주문 건수</h4>
                    <div class="text-2xl font-extrabold text-gray-800 mb-2">
                        ${formatCurrency(currentStats.orderCount)} <span class="text-sm font-medium text-gray-600">건</span>
                    </div>
                    <div class="text-sm">
                        ${getDiffHtmlForMetric('quantity', currentStats.orderCount, prevStats?.orderCount)}
                    </div>
                    ${channelBreakdownHtml(currentStats, 'orderCount')}
                </div>

                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden group hover:border-purple-400 transition">
                    <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition">
                        <svg class="w-16 h-16 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    </div>
                    <h4 class="text-sm font-semibold text-gray-500 mb-1">재고 순환율 (회전율)</h4>
                    <div class="text-2xl font-extrabold text-purple-600 mb-2">
                        ${turnoverRatio.toFixed(2)} <span class="text-sm font-medium text-gray-500">회</span>
                    </div>
                    <div class="text-sm">
                        ${getDiffHtmlForMetric('efficiencyRatio', turnoverRatio, prevTurnoverRatio)}
                    </div>
                    <p class="text-[10px] text-gray-400 mt-1">* 매출액 ÷ 평균 재고금액</p>
                </div>
            </div>

            <div class="bg-white rounded-xl border border-emerald-100 shadow-sm mb-8 overflow-hidden">
                <div class="px-6 py-4 border-b border-emerald-50 bg-emerald-50/50 flex justify-between items-center">
                    <h4 class="font-bold text-emerald-800 flex items-center gap-2">💱 환율 (기간 평균)</h4>
                    <span class="text-xs text-gray-500">${currentStats.daysWithFx}일 기록${fxCompareLabel ? ' · ' + fxCompareLabel : ''}</span>
                </div>
                <div class="grid grid-cols-2 divide-x divide-gray-100">
                    <div class="p-5 text-center">
                        <div class="text-sm text-gray-500 mb-1">달러 (1 USD = 원)</div>
                        <div class="text-2xl font-extrabold text-gray-800">${currentStats.avgUsdRate > 0 ? Math.round(currentStats.avgUsdRate).toLocaleString() : '-'}<span class="text-sm font-medium text-gray-500 ml-1">원</span></div>
                        <div class="mt-1">${fxDiff(currentStats.avgUsdRate, prevFxStats?.avgUsdRate)}</div>
                    </div>
                    <div class="p-5 text-center">
                        <div class="text-sm text-gray-500 mb-1">위안화 (1 CNY = 원)</div>
                        <div class="text-2xl font-extrabold text-gray-800">${currentStats.avgCnyRate > 0 ? Math.round(currentStats.avgCnyRate).toLocaleString() : '-'}<span class="text-sm font-medium text-gray-500 ml-1">원</span></div>
                        <div class="mt-1">${fxDiff(currentStats.avgCnyRate, prevFxStats?.avgCnyRate)}</div>
                    </div>
                </div>
            </div>

            ${generateCostAnalysisHTML(analysis)}

            ${dailyTableHtml}
        </div>
    `;
};