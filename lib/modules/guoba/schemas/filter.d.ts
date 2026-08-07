/**
 * 消息过滤（仅影响 client 方向的上报）
 */
export declare const filterSchemas: ({
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
    bottomHelpMessage: string;
    component: string;
    componentProps: {
        allowAdd: boolean;
        allowDel: boolean;
    };
} | {
    field: string;
    label: string;
    component: string;
    componentProps: {
        allowAdd: boolean;
        allowDel: boolean;
    };
    bottomHelpMessage?: undefined;
})[];
