/**
 * 按钮双向转换
 *
 * 云崽用 permission（两个 i）+ link/callback/input 三键，
 * 早柚核心用 permisson（协议原文错拼）+ action/data 两键，两套字段需逐一映射。
 */
import type { YunzaiButton } from "../../types/index.js";
/**
 * 云崽按钮 -> 早柚核心 Button
 * 字段拼写 permisson 为协议原文（非标准拼法），勿改
 */
export declare function buttonToGscore(b: any): any;
/** segment.button(...rows).data -> Button[][] */
export declare function buttonsToGscore(square: any): any[];
/** 早柚核心 buttons -> segment.button(...rows)；扁平列表按每行 2 个切分 */
export declare function buttonsFromGscore(raw: any): {
    type: "button";
    data: YunzaiButton[];
};
