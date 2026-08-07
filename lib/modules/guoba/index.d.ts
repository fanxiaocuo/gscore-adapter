export declare function supportGuoba(): {
    pluginInfo: {
        name: string;
        title: string;
        author: string;
        description: string;
        iconColor: string;
        isV3: boolean;
        isV2: boolean;
        showInMenu: boolean;
    };
    configInfo: {
        schemas: ({
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
        getConfigData(): Record<string, any>;
        setConfigData(data: Record<string, any>, { Result }: {
            Result: any;
        }): any;
    };
};
export declare const guobaPluginPath: string;
