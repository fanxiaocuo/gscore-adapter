/**
 * 服务端方向（早柚核心 -> 云崽）
 */
export declare const serverSchemas: ({
    component: string;
    label: string;
    field?: undefined;
    bottomHelpMessage?: undefined;
    componentProps?: undefined;
} | {
    field: string;
    label: string;
    bottomHelpMessage: string;
    component: string;
    componentProps?: undefined;
} | {
    field: string;
    label: string;
    component: string;
    bottomHelpMessage?: undefined;
    componentProps?: undefined;
} | {
    field: string;
    label: string;
    bottomHelpMessage: string;
    component: string;
    componentProps: {
        options: {
            label: string;
            value: string;
        }[];
    };
})[];
