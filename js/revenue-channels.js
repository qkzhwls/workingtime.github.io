// === js/revenue-channels.js ===
// 💰 판매 채널 정의 — 경영지표 '매출 현황'을 일반배송(카페24) / 직진배송 / 도착보장 / 기타 4개로 나눠 관리한다.
//    매출액과 주문 건수를 채널별로 각각 입력·집계하고, 업무 예측의 실적 예측도 이 구분을 그대로 쓴다.
//
// 저장 구조 (history/{date}.management, daily_data/{date}.management)
//   revenueCafe24  / orderCountCafe24   : 일반배송(카페24)
//   revenueDirect  / orderCountDirect   : 직진배송
//   revenueArrival / orderCountArrival  : 도착보장
//   revenueEtc     / orderCountEtc      : 기타 (네이버·스마트스토어 등 우리가 배송하지 않는 채널)
//   revenue        / orderCount         : 위 4개의 합계
//     └ 정산·리포트·대시보드 등 기존 코드가 그대로 읽을 수 있도록 총액/총건수를 계속 유지한다.
//     └ ⚠️ 외부에서 채널값을 직접 써 넣을 때도 이 총합을 반드시 같이 갱신해야 한다.
//        총액을 revenueTotalOf() 안 거치고 날것으로 읽는 화면이 있다(정산·리포트·인력운영).
//
// ⚠️ 채널 구분 이전에 입력된 과거 데이터는 revenue / orderCount 총액만 존재한다.
//    이 경우 채널별 값은 0이고 총액만 유효하므로, 총액을 쓰는 화면은 그대로 동작한다.

// taskKey = 그 채널의 배송량(물량)에 해당하는 업무.
//   실적 예측에서 채널 하나를 고르면 매출·주문건·배송량이 모두 그 채널 기준으로만
//   계산되도록 세 값을 한 묶음으로 정의해 둔다.
//   (예: 일반배송 = 국내배송 업무량 + 카페24 매출/주문건)
// fulfillment = 풀필먼트(선입고 후 판매) 채널인지.
//   직진배송·도착보장은 우리가 작업해 보낸 수량이 그 채널 창고에 들어간 뒤 거기서 판매된다.
//   즉 **당일 배송한 장수와, 같은 날 수집되는 매출·주문건수는 시점이 달라 서로 대응되지 않는다.**
//   → 주문 건수는 세 채널 모두 유효하지만(각각 수집·관리),
//     배송량(장)을 건수로 환산해 병기하는 것은 직접배송인 일반배송(카페24)에서만 의미가 있다.
// hasDelivery = 우리가 배송하는 채널인지. 생략하면 true.
//   '기타'는 우리가 배송하지 않아 대응하는 업무(taskKey)가 아예 없다.
//   fulfillment 로는 표현할 수 없다 — false 로 두면 배송량 0을 건수로 환산해 보여주고,
//   true 로 두면 풀필먼트 안내문이 잘못 뜬다. 그래서 축을 따로 둔다.
export const REVENUE_CHANNELS = [
    { id: 'cafe24',  label: '일반배송(카페24)', shortLabel: '일반배송', color: '#4f46e5',
      field: 'revenueCafe24',  orderField: 'orderCountCafe24',  taskKey: '국내배송',     fulfillment: false },
    { id: 'direct',  label: '직진배송',         shortLabel: '직진배송', color: '#a855f7',
      field: 'revenueDirect',  orderField: 'orderCountDirect',  taskKey: '직진배송',     fulfillment: true },
    { id: 'arrival', label: '도착보장',         shortLabel: '도착보장', color: '#0ea5e9',
      field: 'revenueArrival', orderField: 'orderCountArrival', taskKey: '에이블리배송', fulfillment: true },
    { id: 'etc',     label: '기타',             shortLabel: '기타',     color: '#f59e0b',
      field: 'revenueEtc',     orderField: 'orderCountEtc',     taskKey: null,           fulfillment: false, hasDelivery: false }
];

/** 우리가 배송하는 채널만. 배송량 합계·출처 표기는 반드시 이 목록을 쓴다.
 *  (전체를 쓰면 taskKey 가 null 인 '기타'가 섞여 화면에 'null' 이 찍힌다) */
export const DELIVERY_CHANNELS = REVENUE_CHANNELS.filter(c => c.hasDelivery !== false);

export const channelById = (id) => REVENUE_CHANNELS.find(c => c.id === id) || null;

// 채널별로 나눠 입력하는 지표들. (총합 필드 = 채널 합계)
export const CHANNEL_METRICS = [
    { key: 'revenue',    fieldOf: (c) => c.field,      totalField: 'revenue',    label: '매출액',   unit: '원' },
    { key: 'orderCount', fieldOf: (c) => c.orderField, totalField: 'orderCount', label: '주문 건수', unit: '건' }
];

const sumOf = (mgmt, pick) => REVENUE_CHANNELS.reduce((s, c) => s + (Number(mgmt[pick(c)]) || 0), 0);

/** 채널 매출 합계 */
export const revenueChannelSum = (mgmt = {}) => sumOf(mgmt, c => c.field);
/** 채널 주문건수 합계 */
export const orderCountChannelSum = (mgmt = {}) => sumOf(mgmt, c => c.orderField);

// 총액 산출의 안전망.
// 원래는 '채널 합계가 0보다 크면 무조건 채널 합계'였다. 채널 입력 화면이 네 칸을 한꺼번에
// 저장하는 유일한 쓰기 경로였을 땐 맞았지만, 외부(Slack 자동입력)가 한 채널만 써 넣기
// 시작하면 얘기가 다르다 — 채널 구분 이전 날짜에 기타 30만원만 얹으면 그날 총매출
// 1,200만원이 30만원으로 둔갑하고, 객단가·재고회전율이 통째로 틀어진다.
// 그래서 저장된 총액이 더 크면 그쪽을 믿는다. 앱 내 저장 경로는 총액도 함께 갱신하므로
// 정상 흐름에서는 두 값이 같아 영향이 없다.
const totalWithFloor = (sum, legacy) => (sum > 0 ? Math.max(sum, legacy) : legacy);

/** 그 날의 총 매출액 — 채널 합계와 저장된 총액 중 큰 쪽(구 데이터 보호) */
export const revenueTotalOf = (mgmt = {}) =>
    totalWithFloor(revenueChannelSum(mgmt), Number(mgmt.revenue) || 0);

/** 그 날의 총 주문 건수 — 채널 합계와 저장된 총건수 중 큰 쪽(구 데이터 보호) */
export const orderCountTotalOf = (mgmt = {}) =>
    totalWithFloor(orderCountChannelSum(mgmt), Number(mgmt.orderCount) || 0);

/** 채널 구분 없이 총액만 있는 과거 데이터인지 */
export const isLegacyRevenue = (mgmt = {}) =>
    revenueChannelSum(mgmt) === 0 && (Number(mgmt.revenue) || 0) > 0;

/** 채널 구분 없이 총 건수만 있는 과거 데이터인지 */
export const isLegacyOrderCount = (mgmt = {}) =>
    orderCountChannelSum(mgmt) === 0 && (Number(mgmt.orderCount) || 0) > 0;

/**
 * 외부에서 채널값을 써 넣을 때 쓰는 유일한 창구. (Slack 자동입력 등)
 *
 * 총합(revenue / orderCount)을 반드시 같이 갱신한다 — 정산·리포트·인력운영·생산성은
 * revenueTotalOf() 를 안 거치고 총액을 날것으로 읽기 때문에, 채널만 써 넣으면
 * 그 화면들에서 값이 통째로 빠지고 같은 화면 안에서 총액과 채널합이 어긋나 보인다.
 *
 * @param {object} mgmt  그 날의 기존 management 맵 (서버에서 방금 읽은 값)
 * @param {object} patch 바꿀 채널 필드들 (예: { revenueEtc: 300000, orderCountEtc: 12 })
 * @returns {object} 총합까지 맞춰진 새 management 맵. 그대로 저장하면 된다.
 * @throws 채널 구분 이전(총액만 있는) 날짜에 쓰려고 하면 거부한다.
 *         그 경우 채널값만 얹으면 총액이 그 값으로 줄어들어 과거 매출이 사라진다.
 */
export const applyChannelPatch = (mgmt = {}, patch = {}) => {
    if (isLegacyRevenue(mgmt) || isLegacyOrderCount(mgmt)) {
        throw new Error('채널 구분 이전 데이터(총액만 있는 날짜)에는 채널값을 직접 넣을 수 없습니다. 경영지표 화면에서 채널별로 나눠 입력하세요.');
    }
    const next = { ...mgmt, ...patch };
    CHANNEL_METRICS.forEach(m => {
        next[m.totalField] = REVENUE_CHANNELS.reduce(
            (s, c) => s + (Number(next[m.fieldOf(c)]) || 0), 0
        );
    });
    return next;
};

/** 실적 예측 스코프 — id가 없으면(=전체) 총계/전 채널 물량 합으로 계산한다.
 *  하루치 데이터(day)를 받아 매출·주문건수·배송량을 같은 채널 기준으로 뽑아준다. */
export const channelScope = (id) => {
    const c = channelById(id);
    if (!c) {
        return {
            id: 'all', label: '전체', color: '#2563eb',
            revenueOf: (d) => revenueTotalOf(d?.management),
            orderCountOf: (d) => orderCountTotalOf(d?.management),
            deliveryOf: (d) => DELIVERY_CHANNELS.reduce((s, ch) => s + (Number(d?.taskQuantities?.[ch.taskKey]) || 0), 0),
            deliveryLabel: '전체 배송량',
            deliverySource: DELIVERY_CHANNELS.map(ch => ch.taskKey).join(' + '),
            // 전체는 직접배송(카페24)과 풀필먼트 채널이 섞여 있어 배송량↔주문건수 대응이 성립하지 않는다.
            // → 주문건수는 합계로 보여주되, 배송량은 장수로만 표기한다.
            fulfillment: true,
            showDeliveryCases: false
        };
    }
    // 배송이 없는 채널('기타')은 배송량 라벨·출처를 그대로 쓰면 화면에 'null' 이 찍힌다.
    // 지금은 예측 탭이 DELIVERY_CHANNELS 로만 탭을 만들어 여기 도달하지 않지만,
    // 필터 하나가 유일한 방벽인 상태로 두지 않는다.
    const hasDelivery = c.hasDelivery !== false;
    return {
        id: c.id, label: c.label, color: c.color,
        revenueOf: (d) => Number(d?.management?.[c.field]) || 0,
        orderCountOf: (d) => Number(d?.management?.[c.orderField]) || 0,
        deliveryOf: (d) => (hasDelivery ? (Number(d?.taskQuantities?.[c.taskKey]) || 0) : 0),
        deliveryLabel: hasDelivery ? `${c.shortLabel} 배송량` : '배송량 없음',
        deliverySource: hasDelivery ? c.taskKey : '해당 없음',
        fulfillment: !!c.fulfillment,
        // 풀필먼트 채널은 그날 보낸 장수와 그날 잡히는 주문건수가 서로 다른 시점의 값이라
        // 배송량을 건수로 환산해 병기하면 안 된다. 주문건수는 별도 지표로 그대로 보여준다.
        // 배송 자체가 없는 채널('기타')도 마찬가지 — 0을 건수로 환산해 봐야 의미가 없다.
        showDeliveryCases: !c.fulfillment && hasDelivery
    };
};
