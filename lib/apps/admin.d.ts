export default class GsCoreAdmin extends plugin {
    constructor();
    help(e: any): Promise<any>;
    /** 按名字或 1 起的序号定位连接 */
    find(key: any): {
        index: number;
        conf: import("../types/index.js").ClientConnection;
    };
    add(e: any): Promise<any>;
    del(e: any): Promise<any>;
    list(e: any): Promise<any>;
    enable(e: any): Promise<any>;
    disable(e: any): Promise<any>;
    toggle(e: any, on: any): Promise<any>;
    set(e: any): Promise<any>;
}
