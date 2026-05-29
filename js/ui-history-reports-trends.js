// === js/ui-history-reports-trends.js ===
import { predictFutureTrends } from './analysis-logic.js'; 

let trendChartInstance = null; 

export const renderTrendReport = (historyData) => {
    const container = document.getElementById('trend-analysis-panel');
    if (!container) return;

    const trendData = predictFutureTrends(historyData, 14);

    if (!trendData || !trendData.prediction) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">예측을 위한 과거 데이터가 부족합니다. (최소 7일 필요)</div>';
        return;
    }

    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-2">📦 내일 예상 물량 (국내배송)</h3>
                <div class="text-3xl font-extrabold text-blue-600 dark:text-blue-400 mb-2">
                    ${trendData.prediction.tomorrow.delivery.toLocaleString()}건
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-300 bg-blue-50 dark:bg-gray-700 p-2 rounded">
                    안전 범위: <span class="font-semibold text-red-500">최소 ${trendData.prediction.rangeDelivery[0].min.toLocaleString()}건</span> ~ 
                    <span class="font-semibold text-green-500">최대 ${trendData.prediction.rangeDelivery[0].max.toLocaleString()}건</span>
                </div>
            </div>

            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-2">💰 내일 예상 매출</h3>
                <div class="text-3xl font-extrabold text-green-600 dark:text-green-400 mb-2">
                    ${trendData.prediction.tomorrow.revenue.toLocaleString()}원
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-300 bg-green-50 dark:bg-gray-700 p-2 rounded">
                    안전 범위: <span class="font-semibold text-red-500">최소 ${trendData.prediction.rangeRevenue[0].min.toLocaleString()}원</span> ~ 
                    <span class="font-semibold text-green-500">최대 ${trendData.prediction.rangeRevenue[0].max.toLocaleString()}원</span>
                </div>
            </div>
        </div>

        <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4">📈 물량 추이 및 14일 예측 차트</h3>
            <div class="relative h-80 w-full">
                <canvas id="trendChart"></canvas>
            </div>
        </div>
    `;

    drawTrendChart(trendData);
};

const drawTrendChart = (trendData) => {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;

    if (trendChartInstance) {
        trendChartInstance.destroy(); 
    }

    const labels = [...trendData.historical.labels, ...trendData.prediction.labels];
    const histLen = trendData.historical.delivery.length;
    const padding = Array(histLen - 1).fill(null);
    const lastHistorical = trendData.historical.delivery[histLen - 1];

    const historicalDelivery = [...trendData.historical.delivery, ...Array(trendData.prediction.delivery.length).fill(null)];
    const predictedDelivery = [...padding, lastHistorical, ...trendData.prediction.delivery];
    
    const minDelivery = [...padding, lastHistorical, ...trendData.prediction.rangeDelivery.map(r => r.min)];
    const maxDelivery = [...padding, lastHistorical, ...trendData.prediction.rangeDelivery.map(r => r.max)];

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '과거 실제 물량',
                    data: historicalDelivery,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true
                },
                {
                    label: '예측 물량 (EMA 반영)',
                    data: predictedDelivery,
                    borderColor: '#f59e0b',
                    borderDash: [5, 5],
                    borderWidth: 2,
                    tension: 0.4,
                    fill: false
                },
                {
                    label: '최대 신뢰 구간',
                    data: maxDelivery,
                    borderColor: 'rgba(16, 185, 129, 0)',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    fill: '+1', 
                    pointRadius: 0
                },
                {
                    label: '최소 신뢰 구간',
                    data: minDelivery,
                    borderColor: 'rgba(16, 185, 129, 0)',
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { 
                    position: 'top',
                    labels: { filter: (item) => !item.text.includes('신뢰 구간') } 
                }
            },
            scales: {
                y: { beginAtZero: true, suggestedMin: 0 }
            }
        }
    });
};