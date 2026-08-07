/**
 * 客户端方向（云崽 -> 早柚核心）
 *
 * connections 是数组，锅巴用 GSubForm 渲染可增删的子表单。
 */
export declare const clientSchemas: ({
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
        min: number;
        multiple?: undefined;
        schemas?: undefined;
    };
} | {
    field: string;
    label: string;
    bottomHelpMessage: string;
    component: string;
    componentProps: {
        multiple: boolean;
        schemas: ({
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
                placeholder: string;
                min?: undefined;
                allowAdd?: undefined;
                allowDel?: undefined;
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
            componentProps: {
                min: number;
                placeholder?: undefined;
                allowAdd?: undefined;
                allowDel?: undefined;
            };
        } | {
            field: string;
            label: string;
            bottomHelpMessage: string;
            component: string;
            componentProps: {
                allowAdd: boolean;
                allowDel: boolean;
                placeholder?: undefined;
                min?: undefined;
            };
        })[];
        min?: undefined;
    };
})[];
