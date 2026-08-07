/**
 * 载入 lib/apps/ 下所有应用
 * @returns { apps } 默认导出 class 按文件名收集
 */
export declare function loadApps(): Promise<{
    apps: Record<string, any>;
}>;
