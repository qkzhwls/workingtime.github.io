// === js/ui-history-reports-utils.js ===
import { formatDuration } from './utils.js';

export const getAsArray = (data) => {
    if (!data) return []; 
    if (Array.isArray(data)) return data; 
    if (typeof data === 'object') return Object.values(data); 
    return [data]; 
};

export const getDiffHtmlForMetric = (metric, current, previous) => {
    const currValue = Number(current) || 0;

    if (previous === null || typeof previous === 'undefined') {
        if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
        return '';
    }
    
    const prevValue = Number(previous) || 0;

    if (prevValue === 0) {
        if (currValue === 0) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;
        
        const sign = '↑';
        let colorClass = 'text-green-600';
        if (['avgCostPerItem', 'duration', 'totalDuration', 'totalCost', 'nonWorkTime', 'coqPercentage', 'totalLossCost', 'availabilityLossCost', 'performanceLossCost', 'qualityLossCost', 'unitTotalCost'].includes(metric)) {
             colorClass = 'text-red-600';
        }
        
        let diffStr = '';
        if (metric === 'avgTime' || metric === 'duration' || metric === 'totalDuration' || metric === 'nonWorkTime') {
            diffStr = formatDuration(Math.abs(currValue));
        } else if (['workDays', 'directDeliveryCount', 'avgStaff', 'avgCostPerItem', 'quantity', 'totalQuantity', 'totalCost', 'totalLossCost', 'availabilityLossCost', 'performanceLossCost', 'qualityLossCost', 'unitTotalCost', 'unitMargin'].includes(metric)) {
            diffStr = Math.round(Math.abs(currValue)).toLocaleString();
        } else if (['availableFTE', 'workedFTE', 'requiredFTE', 'qualityFTE'].includes(metric)) {
            diffStr = Math.abs(currValue).toFixed(1) + ' FTE';
        } else if (metric === 'avgDailyStaff') {
            diffStr = Math.abs(currValue).toFixed(1) + ' 명';
        } else {
            diffStr = Math.abs(currValue).toFixed(1);
        }
        return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: 0">
                    ${sign} ${diffStr}
                </span>`;
    }

    const diff = currValue - prevValue;
    if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;

    const percent = (diff / prevValue) * 100;
    const sign = diff > 0 ? '↑' : '↓';

    let colorClass = 'text-gray-500';
    if (['workDays', 'directDeliveryCount', 'avgThroughput', 'quantity', 'avgStaff', 'avgDailyStaff', 'totalQuantity', 'efficiencyRatio', 'utilizationRate', 'qualityRatio', 'oee', 'qualityFTE', 'unitMargin'].includes(metric)) {
        colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
    }
    else if (['avgCostPerItem', 'duration', 'totalDuration', 'totalCost', 'nonWorkTime', 'coqPercentage', 'totalLossCost', 'availabilityLossCost', 'performanceLossCost', 'qualityLossCost', 'unitTotalCost'].includes(metric)) {
        colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
    }

    let diffStr = '';
    let prevStr = '';

    if (metric === 'avgTime' || metric === 'duration' || metric === 'totalDuration' || metric === 'nonWorkTime') {
        diffStr = formatDuration(Math.abs(diff));
        prevStr = formatDuration(prevValue);
    } else if (['workDays', 'directDeliveryCount', 'avgStaff', 'avgCostPerItem', 'quantity', 'totalQuantity', 'totalCost', 'totalLossCost', 'availabilityLossCost', 'performanceLossCost', 'qualityLossCost', 'unitTotalCost', 'unitMargin'].includes(metric)) {
        diffStr = Math.round(Math.abs(diff)).toLocaleString();
        prevStr = Math.round(prevValue).toLocaleString();
    } else if (['availableFTE', 'workedFTE', 'requiredFTE', 'qualityFTE'].includes(metric)) {
        diffStr = Math.abs(diff).toFixed(1) + ' FTE';
        prevStr = prevValue.toFixed(1) + ' FTE';
    } else if (metric === 'avgDailyStaff') {
        diffStr = Math.abs(diff).toFixed(1);
        prevStr = prevValue.toFixed(1);
    } else {
        diffStr = Math.abs(diff).toFixed(1);
        prevStr = prevValue.toFixed(1);
    }

    return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: ${prevStr}">
                ${sign} ${diffStr} (${percent.toFixed(0)}%)
            </span>`;
};

export const createTableRow = (columns, isHeader = false, sortState = null) => {
    const cellTag = isHeader ? 'th' : 'td';
    const rowClass = isHeader ? 'text-xs text-gray-700 uppercase bg-gray-100 sticky top-0' : 'bg-white border-b hover:bg-gray-50';

    let cellsHtml = columns.map((col, index) => {
        if (!isHeader) {
            const alignClass = (index > 0) ? 'text-right' : 'text-left';
            if (typeof col === 'object' && col !== null) {
                return `<${cellTag} class="px-4 py-2 ${alignClass} ${col.class || ''}">
                            <div>${col.content}</div>
                            ${col.diff || ''}
                        </${cellTag}>`;
            }
            return `<${cellTag} class="px-4 py-2 ${alignClass}">${col}</${cellTag}>`;
        }

        const alignClass = (index > 0) ? 'text-right' : 'text-left';
        const sortable = col.sortKey ? 'sortable-header' : '';
        const dataSortKey = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';
        const title = col.title ? `title="${col.title}"` : '';

        let sortIcon = '';
        if (col.sortKey) {
            let iconChar = '↕';
            let iconClass = 'sort-icon';
            if (sortState && col.sortKey === sortState.key) {
                if (sortState.dir === 'asc') {
                    iconChar = '▲';
                    iconClass += ' sorted-asc';
                } else if (sortState.dir === 'desc') {
                    iconChar = '▼';
                    iconClass += ' sorted-desc';
                }
            }
            sortIcon = `<span class="${iconClass}">${iconChar}</span>`;
        }

        return `<${cellTag} scope="col" class="px-4 py-2 ${alignClass} ${sortable}" ${dataSortKey} ${title}>
                    ${col.content}
                    ${sortIcon}
                </${cellTag}>`;

    }).join('');

    return `<tr class="${rowClass}">${cellsHtml}</tr>`;
};