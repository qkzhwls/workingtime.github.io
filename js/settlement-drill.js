// 🔍 팀 결산 보고 — 지표 파고들기
// -----------------------------------------------------------------
// 요약 숫자를 눌렀을 때, 그 숫자가 어디서 나왔는지 작은 창으로 보여준다.
//
// 원칙: **화면에 아직 없는 정보일 때만** 붙인다.
// 이 보고서는 이미 '요약 숫자 + 바로 아래 상세 표' 구조라,
// 아무 데나 붙이면 밑에 있는 표를 창으로 한 번 더 보여주는 꼴이 된다.
//
// 창은 얕게 유지한다. 창 안에 또 스크롤·필터를 넣으면
// 표 상자에 잘리던 문제가 되풀이된다.

import * as State from './state.js?v=202610021042';
import { escapeHtml as esc } from './utils.js?v=202610021042';
import { REVENUE_CHANNELS } from './revenue-channels.js?v=202610021042';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();

const minutesText = (input) => {
    const v = Math.round(Number(input) || 0);
    const h = Math.floor(v / 60), m = v % 60;
    if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
    return `${v}분`;
};

// ── 창 ───────────────────────────────────────────────────────────
let _backdrop = null;

export function closeDrill() {
    if (_backdrop) { _backdrop.remove(); _backdrop = null; }
    document.removeEventListener('keydown', onEsc);
}

function onEsc(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeDrill(); }
}

function openDrill(title, sub, bodyHtml) {
    closeDrill();
    const back = document.createElement('div');
    back.className = 'settle-drill-back';
    back.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(15,23,42,.45);'
        + 'display:flex;align-items:center;justify-content:center;padding:16px;';
    back.innerHTML = `
        <div class="settle-drill" style="background:#fff;border-radius:14px;max-width:560px;width:100%;
             max-height:82vh;overflow:auto;box-shadow:0 20px 50px rgba(15,23,42,.3);">
            <div style="padding:16px 18px 12px;border-bottom:1px solid #e2e8f0;position:sticky;top:0;background:#fff;">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
                    <div>
                        <div style="font-size:15px;font-weight:800;color:#0f172a;">${esc(title)}</div>
                        ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${esc(sub)}</div>` : ''}
                    </div>
                    <button data-drill-close style="border:0;background:#f1f5f9;border-radius:8px;
                            width:28px;height:28px;font-size:16px;color:#475569;cursor:pointer;flex:none;">×</button>
                </div>
            </div>
            <div style="padding:14px 18px 18px;font-size:13px;color:#334155;">${bodyHtml}</div>
        </div>`;
    back.addEventListener('click', (e) => {
        if (e.target === back || e.target.closest('[data-drill-close]')) closeDrill();
    });
    document.body.appendChild(back);
    document.addEventListener('keydown', onEsc);
    _backdrop = back;
}

// ── 공통 조각 ────────────────────────────────────────────────────
const emptyRow = (msg) => `<div style="text-align:center;color:#94a3b8;padding:18px 0;">${esc(msg)}</div>`;

const table = (heads, rows) => `
    <table style="width:100%;border-collapse:collapse;">
        <thead><tr>${heads.map((h, i) => `<th style="text-align:${i ? 'right' : 'left'};font-size:11px;color:#64748b;
            font-weight:700;padding:6px 4px;border-bottom:1px solid #e2e8f0;white-space:nowrap;">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${i ? 'right' : 'left'};
            padding:7px 4px;border-bottom:1px solid #f1f5f9;">${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;

// 계산식 한 줄: 나눗셈을 눈에 보이게 적는다
const formula = (top, bottom, result) => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin:10px 0;
         display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;">
        <div style="text-align:center;">
            <div style="padding:0 8px 4px;border-bottom:2px solid #94a3b8;font-weight:700;">${top}</div>
            <div style="padding:4px 8px 0;font-weight:700;">${bottom}</div>
        </div>
        <div style="font-size:18px;color:#94a3b8;">=</div>
        <div style="font-size:20px;font-weight:800;color:#2563eb;">${result}</div>
    </div>`;

// ── 1) 최고·최저 처리일 → 그날의 업무별 상세 ──────────────────────
function dayDetailBody(dateId) {
    const day = (State.allHistoryData || []).find(d => d.id === dateId);
    if (!day) return emptyRow('그날의 기록을 찾지 못했습니다.');

    // 업무별 처리량에, 업무기록에서 뽑은 투입인원·시간을 붙인다
    const byTask = {};
    Object.entries(day.taskQuantities || {}).forEach(([task, q]) => {
        const qty = Number(q) || 0;
        if (qty > 0) byTask[task] = { task, qty, minutes: 0, members: new Set() };
    });
    (day.workRecords || []).forEach(r => {
        if (!r || !r.task) return;
        if (!byTask[r.task]) byTask[r.task] = { task: r.task, qty: 0, minutes: 0, members: new Set() };
        byTask[r.task].minutes += Number(r.duration) || 0;
        if (r.member) byTask[r.task].members.add(r.member);
    });

    const rows = Object.values(byTask).sort((a, b) => b.qty - a.qty || b.minutes - a.minutes);
    if (rows.length === 0) return emptyRow('그날은 처리량 기록이 없습니다.');

    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const allMembers = new Set();
    (day.workRecords || []).forEach(r => { if (r && r.member) allMembers.add(r.member); });

    return `
        <div style="display:flex;gap:10px;margin-bottom:12px;">
            <div style="flex:1;background:#eff6ff;border-radius:10px;padding:10px;text-align:center;">
                <div style="font-size:11px;color:#64748b;">총 처리량</div>
                <div style="font-size:18px;font-weight:800;color:#1d4ed8;">${fmt(totalQty)}<span style="font-size:11px;color:#94a3b8;"> 개</span></div>
            </div>
            <div style="flex:1;background:#f5f3ff;border-radius:10px;padding:10px;text-align:center;">
                <div style="font-size:11px;color:#64748b;">근무 인원</div>
                <div style="font-size:18px;font-weight:800;color:#6d28d9;">${allMembers.size}<span style="font-size:11px;color:#94a3b8;"> 명</span></div>
            </div>
        </div>
        ${table(['업무', '처리량', '투입인원', '소요시간'], rows.map(r => [
            esc(r.task),
            r.qty > 0 ? `<b>${fmt(r.qty)}</b>` : '<span style="color:#cbd5e1;">-</span>',
            r.members.size > 0 ? r.members.size + '명' : '<span style="color:#cbd5e1;">-</span>',
            r.minutes > 0 ? minutesText(r.minutes) : '<span style="color:#cbd5e1;">-</span>'
        ]))}`;
}

// ── 2) 총 매출 / 발주 건수 → 채널별 분해 ─────────────────────────
function channelBody(days, mode) {
    const isRevenue = mode === 'revenue';
    const rows = REVENUE_CHANNELS.map(c => {
        let sum = 0;
        (days || []).forEach(d => { sum += Number(d.management?.[isRevenue ? c.field : c.orderField]) || 0; });
        return { label: c.label, sum, color: c.color };
    });
    const total = rows.reduce((s, r) => s + r.sum, 0);
    if (total <= 0) return emptyRow('채널별로 나눠 입력된 값이 없습니다.');

    const unit = isRevenue ? '원' : '건';
    return `
        <div style="margin-bottom:10px;font-size:12px;color:#64748b;">
            합계 <b style="color:#0f172a;font-size:14px;">${fmt(total)}</b> ${unit}
        </div>
        ${table(['채널', isRevenue ? '매출' : '건수', '비중'], rows.map(r => {
            const pct = total > 0 ? (r.sum / total * 100) : 0;
            return [
                `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${r.color};margin-right:6px;"></span>${esc(r.label)}`,
                `<b>${fmt(r.sum)}</b> <span style="color:#94a3b8;font-size:11px;">${unit}</span>`,
                `<span style="display:inline-block;width:70px;height:6px;background:#f1f5f9;border-radius:3px;vertical-align:middle;margin-right:6px;">
                    <span style="display:block;height:6px;border-radius:3px;background:${r.color};width:${pct.toFixed(0)}%;"></span>
                 </span><span style="font-size:11px;color:#64748b;">${pct.toFixed(1)}%</span>`
            ];
        }))}`;
}

// ── 3) 효율 지표 3종 → 계산식과 대입값 ───────────────────────────
const EFFICIENCY = {
    utilizationRate: {
        title: '시간 활용률',
        desc: '나와 있던 사람들이, 정해진 근무시간 중 실제로 업무에 쓴 비율입니다.',
        build: (p) => ({
            top: `실제 근무 ${minutesText(p.totalActualWorkedMinutes)}`,
            bottom: `표준 가용 ${minutesText(p.totalStandardAvailableMinutes)}`,
            result: p.utilizationRate.toFixed(0) + '%',
            note: '표준 가용 = 근무인원 × 표준 근무시간(관리자 설정: 평일/주말). 낮으면 대기·공백이 많았다는 뜻입니다.'
        })
    },
    efficiencyRatio: {
        title: '업무 효율성',
        desc: '같은 일을 표준 속도로 했다면 걸렸을 시간과, 실제 걸린 시간의 비율입니다.',
        build: (p) => ({
            top: `표준 소요 ${minutesText(p.totalStandardMinutesNeeded)}`,
            bottom: `실제 근무 ${minutesText(p.totalActualWorkedMinutes)}`,
            result: p.efficiencyRatio.toFixed(0) + '%',
            note: '표준 속도는 전체 이력에서 뽑은 업무별 평균 처리속도입니다. 100%보다 낮으면 표준보다 오래 걸렸다는 뜻입니다.'
        })
    },
    qualityRatio: {
        title: '품질 효율',
        desc: '전체 인건비 중, 품질 문제를 처리하는 데 쓰이지 않은 비율입니다.',
        build: (p) => {
            const totalCost = p.avgCostPerMinute * p.totalActualWorkedMinutes;
            const qCost = p.qualityLossCost;
            return {
                top: `총 인건비 ${fmt(totalCost)}원 − 품질비용 ${fmt(qCost)}원`,
                bottom: `총 인건비 ${fmt(totalCost)}원`,
                result: p.qualityRatio.toFixed(0) + '%',
                note: '품질비용에 해당하는 업무는 관리자 설정(오류·상품재작업·재고찾는시간 등)에서 정합니다.'
            };
        }
    }
};

function efficiencyBody(key, prod) {
    const meta = EFFICIENCY[key];
    if (!meta || !prod) return emptyRow('계산에 쓸 값이 없습니다.');
    const f = meta.build(prod);
    const loss = {
        utilizationRate: { label: '가용 손실', cost: prod.availabilityLossCost },
        efficiencyRatio: { label: '성능 손실', cost: prod.performanceLossCost },
        qualityRatio: { label: '품질 손실', cost: prod.qualityLossCost }
    }[key];

    const topTasks = key === 'efficiencyRatio' ? (prod.topPerformanceLossTasks || [])
        : key === 'qualityRatio' ? (prod.topQualityLossTasks || []) : [];

    return `
        <div style="color:#475569;">${esc(meta.desc)}</div>
        ${formula(esc(f.top), esc(f.bottom), f.result)}
        <div style="font-size:11px;color:#64748b;line-height:1.6;">${esc(f.note)}</div>
        ${loss && loss.cost > 0 ? `
            <div style="margin-top:12px;padding:10px;background:#fef2f2;border-radius:10px;
                 display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:12px;color:#991b1b;font-weight:700;">${esc(loss.label)}</span>
                <span style="font-size:15px;font-weight:800;color:#dc2626;">${fmt(loss.cost)}원</span>
            </div>` : ''}
        ${topTasks.length > 0 ? `
            <div style="margin-top:12px;font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;">
                ${key === 'efficiencyRatio' ? '표준보다 오래 걸린 업무' : '품질비용이 큰 업무'}
            </div>
            ${table(
                key === 'efficiencyRatio' ? ['업무', '실제 속도', '표준 속도', '초과 시간'] : ['업무', '비용'],
                topTasks.map(t => key === 'efficiencyRatio'
                    ? [esc(t.task), t.actualSpeed + '개/분', t.stdSpeed + '개/분',
                       `<b style="color:#dc2626;">+${minutesText(t.lossMinutes)}</b>`]
                    : [esc(t.task), `<b style="color:#dc2626;">${fmt(t.cost)}원</b>`])
            )}` : ''}`;
}

// ── 4) FTE 세 막대 → 무슨 뜻이고 어떻게 이어지는지 ────────────────
// FTE 는 세 값이 곱셈으로 이어진다. 그 연결을 보여주는 게 핵심이다.
//   가용 → (시간 활용률) → 실작업 → (업무 효율성) → 표준 필요
function fteBody(prod) {
    if (!prod) return emptyRow('계산에 쓸 값이 없습니다.');

    const a = prod.availableFTE || 0;
    const w = prod.workedFTE || 0;
    const r = prod.requiredFTE || 0;
    const n = (v) => v.toFixed(1);

    const step = (from, rate, to, rateLabel, meaning, gapLabel) => `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0;">
            <b style="color:#0f172a;">${n(from)}명</b>
            <span style="color:#94a3b8;">×</span>
            <span style="background:#ede9fe;color:#5b21b6;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:700;">
                ${esc(rateLabel)} ${rate.toFixed(0)}%</span>
            <span style="color:#94a3b8;">=</span>
            <b style="color:#6d28d9;">${n(to)}명</b>
            <span style="color:#94a3b8;font-size:11px;">(차이 ${n(Math.max(0, from - to))}명 = ${esc(gapLabel)})</span>
        </div>
        <div style="font-size:11px;color:#64748b;margin:0 0 12px;line-height:1.6;">${esc(meaning)}</div>`;

    return `
        <div style="color:#475569;line-height:1.7;">
            <b>FTE 1 = 표준 근무시간을 온전히 채운 한 사람 몫</b>입니다.
            실제 머릿수가 아니라 <b>일한 양을 사람 수로 환산한 값</b>이라, 반만 일한 두 사람은 1로 셉니다.
        </div>

        ${table(['구분', '값', '뜻'], [
            ['가용 인력', `<b>${n(a)}</b>명`, '<span style="font-size:11px;color:#64748b;">그 기간 하루 평균 나온 인원</span>'],
            ['실작업 인력', `<b>${n(w)}</b>명`, '<span style="font-size:11px;color:#64748b;">실제 업무에 쓴 시간을 사람 수로 환산</span>'],
            ['표준 필요인력', `<b>${n(r)}</b>명`, '<span style="font-size:11px;color:#64748b;">그 일을 표준 속도로 했다면 필요했을 인원</span>']
        ])}

        <div style="margin-top:14px;font-size:11px;font-weight:700;color:#64748b;margin-bottom:2px;">어떻게 줄어드나</div>
        ${step(a, prod.utilizationRate || 0, w, '시간 활용률', '나와는 있었지만 업무에 쓰이지 않은 시간만큼 줄어듭니다. 대기·공백이 여기에 잡힙니다.', '가용 손실')}
        ${step(w, prod.efficiencyRatio || 0, r, '업무 효율성', '표준 속도보다 오래 걸린 만큼 사람이 더 들어간 셈입니다. 이 차이가 작을수록 표준에 가깝게 일한 것입니다.', '속도 손실')}

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;font-size:12px;line-height:1.7;">
            <b style="color:#0f172a;">읽는 법</b><br>
            <b>가용</b>과 <b>표준 필요</b>의 차이 <b style="color:#6d28d9;">${n(Math.max(0, a - r))}명</b>이
            이 기간에 여유가 있었던 인력입니다.<br>
            <span style="color:#64748b;">다만 표준 속도 자체가 과거 실적의 평균이라, 표준 필요인력을 곧바로
            &lsquo;적정 인원&rsquo;으로 보면 안 됩니다. 추세를 보는 값으로 쓰시는 게 맞습니다.</span>
        </div>`;
}

// ── 클릭 연결 ────────────────────────────────────────────────────
// 눌리는 값에만 표시를 준다. 전부 눌러보게 만들어 놓고 대부분 반응이
// 없으면, 아무 표시도 없느니만 못하다.
export const drillWrap = (html, kind, arg = '') =>
    `<button type="button" data-drill="${esc(kind)}" data-drill-arg="${esc(arg)}"
        style="background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;
               border-bottom:1px dashed currentColor;" title="자세히 보기">${html}</button>`;

/**
 * 결산 화면에 파고들기 클릭을 연결한다. 화면을 다시 그릴 때마다 부른다.
 * @param {HTMLElement} container  settlement-panel
 * @param {object} ctx  { days, prod }  현재 기간의 일자료와 생산성 계산 결과
 */
export function bindDrillListeners(container, ctx) {
    if (!container || container._drillBound) {
        if (container) container._drillCtx = ctx;
        return;
    }
    container._drillBound = true;
    container._drillCtx = ctx;

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-drill]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();

        const kind = btn.dataset.drill;
        const arg = btn.dataset.drillArg || '';
        const c = container._drillCtx || {};

        if (kind === 'day') {
            openDrill(`${arg} 처리량 상세`, '그날 입력된 업무별 처리량과 투입 현황', dayDetailBody(arg));
        } else if (kind === 'revenue' || kind === 'orderCount') {
            openDrill(kind === 'revenue' ? '채널별 매출' : '채널별 발주 건수',
                '일반배송(카페24) · 직진배송 · 도착보장', channelBody(c.days, kind));
        } else if (kind === 'fte') {
            openDrill('투입 인력 비교 (FTE)', '세 값이 어떻게 이어지는지', fteBody(c.prod));
        } else if (EFFICIENCY[kind]) {
            openDrill(EFFICIENCY[kind].title, '계산식과 실제 대입값', efficiencyBody(kind, c.prod));
        }
    });
}
