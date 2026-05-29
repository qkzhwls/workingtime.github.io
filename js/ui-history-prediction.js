// === js/ui-history-prediction.js ===
// 설명: '실적 예측' 탭의 UI 렌더링 및 차트 제어를 담당합니다.

import { predictFutureTrends } from './analysis-logic.js';

// 차트 인스턴스를 저장하여 중복 생성을 방지합니다.
const predictionCharts = {
    revenue: null,
    delivery: null
};

/**
 * 실적 예측 탭 렌더링 메인 함수
 * @param {Array} historyData - 전체 이력 데이터
 * @param {number} daysToPredict - 예측할 미래 일수 (기본 14일)
 */
export const renderPredictionTab = (historyData, daysToPredict = 14) => {
    const revenueCtx = document.getElementById('chart-prediction-revenue');
    const deliveryCtx = document.getElementById('chart-prediction-delivery');

    if (!revenueCtx || !deliveryCtx) return;

    // 1. 데이터 분석 및 예측 실행
    const result = predictFutureTrends(historyData, daysToPredict);

    if (!result) {
        renderNoData(revenueCtx, "데이터가 부족하여 예측할 수 없습니다.");
        renderNoData(deliveryCtx, "데이터가 부족하여 예측할 수 없습니다.");
        updateKPICards(null);
        return;
    }

    const { historical, prediction, trend } = result;

    // 2. 차트 데이터 구성 (과거 데이터 + 예측 데이터 연결)
    // 과거 데이터의 마지막 부분과 예측 데이터의 시작 부분이 자연스럽게 이어지도록 처리
    // (예측 로직이 오늘부터 시작하므로 그대로 연결 가능)
    const splitIndex = historical.labels.length;
    
    // 전체 라벨: 과거 라벨 + 예측 라벨
    const allLabels = [...historical.labels, ...prediction.labels];

    // 3. 차트 렌더링
    // 과거(Historical) 데이터와 예측(Prediction) 데이터 분리하여 전달
    renderChart('revenue', revenueCtx, allLabels, historical.revenue, prediction.revenue, splitIndex, '매출 (원)', 'rgb(79, 70, 229)'); // Indigo
    renderChart('delivery', deliveryCtx, allLabels, historical.delivery, prediction.delivery, splitIndex, '배송량 (건)', 'rgb(16, 185, 129)'); // Emerald

    // 4. KPI 카드 업데이트
    updateKPICards(prediction, trend);
};

/**
 * KPI 카드 수치 업데이트 함수
 */
const updateKPICards = (prediction, trend) => {
    const elAvgRev = document.getElementById('pred-avg-revenue');
    const elAvgDel = document.getElementById('pred-avg-delivery');
    const elNextMonth = document.getElementById('pred-next-month-revenue');
    const elRevTrend = document.getElementById('pred-revenue-trend');
    const elDelTrend = document.getElementById('pred-delivery-trend');

    if (!prediction) {
        if (elAvgRev) elAvgRev.textContent = '-';
        if (elAvgDel) elAvgDel.textContent = '-';
        if (elNextMonth) elNextMonth.textContent = '-';
        if (elRevTrend) elRevTrend.textContent = '데이터 부족';
        if (elDelTrend) elDelTrend.textContent = '데이터 부족';
        return;
    }

    // 예측 기간 내 평균 계산 (0이 아닌 값만 고려 권장하나, 여기서는 전체 평균)
    // 매출/배송량이 없는 날(0)도 평균에 포함할지 여부는 비즈니스 로직에 따름. 여기서는 단순 평균.
    const activeRevenues = prediction.revenue; 
    const avgRev = activeRevenues.length ? (activeRevenues.reduce((a,b)=>a+b,0) / activeRevenues.length) : 0;
    
    const activeDeliveries = prediction.delivery;
    const avgDel = activeDeliveries.length ? (activeDeliveries.reduce((a,b)=>a+b,0) / activeDeliveries.length) : 0;

    // 다음 달(30일) 예상 총 매출 (현재 추세 기준)
    // 단순 평균 * 30일 (또는 근무일 기준 보정)
    // 여기서는 주말 제외 약 22일 근무 가정으로 계산
    const nextMonthTotal = Math.round(avgRev * 22); 

    // 화면 표시
    if (elAvgRev) elAvgRev.textContent = Math.round(avgRev).toLocaleString();
    if (elAvgDel) elAvgDel.textContent = Math.round(avgDel).toLocaleString();
    if (elNextMonth) elNextMonth.textContent = nextMonthTotal.toLocaleString();

    // 추세 텍스트
    if (elRevTrend && trend) {
        const slope = trend.revenueSlope;
        const trendIcon = slope > 0 ? '📈' : (slope < 0 ? '📉' : '➡️');
        const trendText = slope > 1000 ? '상승세' : (slope < -1000 ? '하락세' : '보합세');
        elRevTrend.innerHTML = `${trendIcon} <span class="${slope > 0 ? 'text-red-500' : 'text-blue-500'} font-bold">${trendText}</span> (기울기: ${Math.round(slope)})`;
    }
    
    if (elDelTrend && trend) {
        const slope = trend.deliverySlope;
        const trendIcon = slope > 0 ? '📈' : (slope < 0 ? '📉' : '➡️');
        const trendText = slope > 0.5 ? '상승세' : (slope < -0.5 ? '하락세' : '보합세');
        elDelTrend.innerHTML = `${trendIcon} <span class="${slope > 0 ? 'text-red-500' : 'text-blue-500'} font-bold">${trendText}</span>`;
    }
};

/**
 * Chart.js 차트 생성 헬퍼
 */
const renderChart = (key, ctx, labels, histData, predData, splitIndex, label, color) => {
    if (predictionCharts[key]) {
        predictionCharts[key].destroy();
    }

    // 데이터셋 구성: 
    // 1. 과거 데이터: 처음부터 splitIndex까지 (나머지 null)
    // 2. 예측 데이터: splitIndex-1(연결점)부터 끝까지 (앞부분 null)
    
    // 과거 데이터셋
    const historicalDataset = histData.map((v, i) => i < splitIndex ? v : null);
    
    // 예측 데이터셋 (연결점 포함)
    // splitIndex-1은 과거 데이터의 마지막 점. 이 점을 예측 데이터의 시작점으로 삼아야 선이 끊기지 않음.
    const predictionDataset = labels.map((_, i) => {
        if (i === splitIndex - 1) return histData[splitIndex - 1]; // 연결점
        if (i >= splitIndex) return predData[i - splitIndex];
        return null;
    });

    predictionCharts[key] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '실적 (과거)',
                    data: historicalDataset,
                    borderColor: color,
                    backgroundColor: color.replace(')', ', 0.1)').replace('rgb', 'rgba'),
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: '예측 (AI)',
                    data: predictionDataset,
                    borderColor: '#f59e0b', // Amber-500
                    borderWidth: 2,
                    borderDash: [5, 5], // 점선
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.3,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: { boxWidth: 12, usePointStyle: true }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += Math.round(context.parsed.y).toLocaleString();
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 10, font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [2, 2] },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
};

const renderNoData = (ctx, msg) => {
    const context = ctx.getContext('2d');
    context.clearRect(0, 0, ctx.width, ctx.height);
    context.font = "14px 'Noto Sans KR'";
    context.fillStyle = "#9ca3af";
    context.textAlign = "center";
    context.fillText(msg, ctx.width / 2, ctx.height / 2);
};