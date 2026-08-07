/**
 * 基础配置项：运行模式与其它杂项
 */
export declare const baseSchemas: ({
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
    componentProps: {
        options: {
            label: string;
            value: string;
        }[];
        min?: undefined;
        step?: undefined;
    };
} | {
    field: string;
    label: string;
    bottomHelpMessage: string;
    component: string;
    componentProps: {
        min: number;
        step: number;
        options?: undefined;
    };
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
    componentProps?: undefined;
})[];
