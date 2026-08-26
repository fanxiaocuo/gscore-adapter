/**
 * @description 面板按 MB / 秒 显示、配置文件仍存字节 / 毫秒的那几栏，换算与边界只有这一份
 *
 * 三个写入口（锅巴、web 面板、#早柚设置）以前各写一遍这组数字，新增字段就要重复第四遍。
 * 注意：单位不能真的改进配置 —— 下游（utils/media.ts、fileServer 的 ttl）都按原单位读。
 * 注意：apps/admin.ts 那份刻意不并进来，它的措辞是给出图那张结果图写的（CN_LABEL + 单条话术），形状不一样
 */
import { MEDIA_SIZE_MAX } from "../constants/index.js";
/**
 * @description 写「MB」而除数仍是 1048576：口语一致（用户说的就是 mb），术语上不严格
 * 注意：换成 1000 会与 #早柚设置（utils/settings.ts 乘 1024*1024）算出不同的字节数，那是真的错
 */
const MB = 1024 * 1024;
/**
 * @description 换算字段表
 * 注意：下限不能是 0 —— utils/media.ts 把 0 当「没配」并悄悄换成默认值，之后三个面板与实际生效值会一致地对不上
 */
export const UNIT_FIELDS = {
    media_max_size: {
        divisor: MB,
        unit: "MB",
        label: "媒体内联上限",
        min: 1024,
        minText: "1 KB",
        max: MEDIA_SIZE_MAX,
        maxText: `${MEDIA_SIZE_MAX / MB} MB`,
    },
    file_max_size: {
        divisor: MB,
        unit: "MB",
        label: "文件大小上限",
        min: 1024,
        minText: "1 KB",
        max: MEDIA_SIZE_MAX,
        maxText: `${MEDIA_SIZE_MAX / MB} MB`,
    },
    // 不设上限：有效期长只是外链多占一会儿内存，是合理选择
    link_expire: {
        divisor: 1000,
        unit: "秒",
        label: "外链有效期",
        min: 1000,
        minText: "1 秒",
    },
};
/** @description 面板控件的取值区间，单位是面板单位（落盘仍是字节 / 毫秒） */
export function displayRange(field) {
    const f = UNIT_FIELDS[field];
    if (!f)
        return { min: 0 };
    return {
        // precision 是 2，所以 0.01 MB（约 10 KB）是能填出来的最小值
        min: Math.max(round2(f.min / f.divisor), 0.01),
        ...(f.max === undefined ? {} : { max: round2(f.max / f.divisor) }),
    };
}
/** 除不尽时留两位，避免 10485761 字节显示成一长串小数 */
function round2(n) {
    return Math.round(n * 100) / 100;
}
/**
 * @description 落盘值 → 面板显示值
 * 注意：只认有限数字，缺省/字符串/null 原样返回，别在这里补默认值 —— 那等于把「用户没配过」悄悄写成一个具体数
 */
export function toDisplay(field, value) {
    const f = UNIT_FIELDS[field];
    if (!f || typeof value !== "number" || !Number.isFinite(value))
        return value;
    return round2(value / f.divisor);
}
/**
 * @description 面板显示值 → 落盘值；非换算字段原样返回
 * 注意：不能用 Number() 兜 —— 清空输入框时控件发 null，Number(null) 是 0，而下游把 0 当「没配」换成默认值
 * （utils/media.ts 的 `|| 默认`），于是面板显示 0、实际跑 10 MB。返回 undefined 表示「这栏不写」，
 * 写盘循环跳过它、原值保住
 * @param current 当前落盘值。面板没动过这一栏就原样留着 —— toDisplay 收两位小数，乘回去是另一个数
 *                （5000000 显示成 4.77 MB，存回来变 5001708），否则保存别的项会顺手改了它
 */
export function toStored(field, value, current) {
    const f = UNIT_FIELDS[field];
    if (!f)
        return value;
    if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
    if (typeof current === "number" &&
        Number.isFinite(current) &&
        toDisplay(field, current) === value)
        return current;
    // 字节数必须是整数：0.33 MB 乘出来是 346030.08，写进 yaml 会带小数
    return Math.round(value * f.divisor);
}
/**
 * @description 校验落盘值，越界时给出用户看的那句话，没问题返回 null
 * 注意：报的数字要换回面板单位 —— 面板按 MB / 秒 收，报字节数用户看不出自己填的是 256 GB；
 * 非有限数字一律放过，那是 {@link toStored} 的「这栏不写」而不是错误
 */
export function boundsError(field, stored) {
    const f = UNIT_FIELDS[field];
    if (!f || typeof stored !== "number" || !Number.isFinite(stored))
        return null;
    const got = round2(stored / f.divisor);
    if (stored < f.min)
        return `${f.label}至少 ${f.minText}，收到 ${got} ${f.unit}`;
    if (f.max !== undefined && stored > f.max)
        return `${f.label}最多 ${f.maxText}，收到 ${got} ${f.unit}`;
    return null;
}
