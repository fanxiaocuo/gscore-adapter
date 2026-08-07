import { GsCoreClient } from "./GsCoreClient.js";
/** 启动单个连接（已存在同名则跳过） */
export declare function startClient(conf: any): GsCoreClient;
/** 停止并移除单个连接 */
export declare function stopClient(name: any): boolean;
/** 按当前配置重建所有连接（用于 #早柚重载） */
export declare function reloadClients(): number;
export declare function startClients(): void;
export declare function stopClients(): void;
