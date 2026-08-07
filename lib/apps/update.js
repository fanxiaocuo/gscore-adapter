/**
 * 插件更新
 *
 * 参照 df-plugin（src/apps/update.ts）的做法：**不自己实现 git 更新**，
 * 而是改写 e.msg 后转调云崽本体的 plugins/other/update.js。
 *
 * 本体那套已经处理了自己写一遍很难覆盖全的部分：
 *   - 强制更新前用 getRemoteBranch() 解析真实远端分支，而不是假定 origin/<当前分支>
 *   - package.json 有变动时自动重装依赖（updatePackage）
 *   - 更新成功后自动重启（Restart），并有 uping 全局锁
 *   - gitErr 对超时/连接失败/冲突分别给出可照做的提示
 * 自己维护一份只会与本体的行为逐渐分叉。
 *
 * 契约（plugins/other/update.js）：
 *   - getPlugin() 把 "#(安静)?(强制)?更新(日志)?" 前缀剥掉，余下部分当插件目录名，
 *     并要求 plugins/<name>/.git 存在（第 92 行），所以要拼成 "#更新gscore-adapter"
 *   - update() 首行判 this.e.isMaster，故 e 必须是原事件（带 isMaster），不能自造
 *
 * 与 df-plugin 的差异：它用相对路径 import 本体插件，本插件改用 YunzaiPath
 * 拼绝对路径（理由见 run() 内注释）。
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PluginName, PluginPath, YunzaiPath } from "../dir.js";
export default class GsCoreUpdate extends plugin {
    constructor() {
        super({
            name: "早柚核心适配器更新",
            dsc: "更新 gscore-adapter",
            event: "message",
            priority: 500,
            rule: [
                { reg: "^#?早柚(核心)?(适配器)?(强制)?更新$", fnc: "update", permission: "master" },
                { reg: "^#?早柚(核心)?(适配器)?更新日志$", fnc: "updateLog", permission: "master" },
            ],
        });
    }
    async update(e) {
        return this.run(e, e.msg.includes("强制") ? "#强制更新" : "#更新");
    }
    async updateLog(e) {
        return this.run(e, "#更新日志");
    }
    /**
     * 转调本体的更新插件
     *
     * 改的是 e.msg 而不是 this.e.msg —— 本体读的是它自己实例上的 e。
     * 用完恢复原值：同一个事件对象后面还会流经其他插件，改坏了会影响它们的匹配。
     */
    async run(e, type) {
        let Update;
        try {
            // 与 modules/client/framework.ts 同一套做法：由 YunzaiPath 拼绝对路径后
            // 动态 import，不写 ../../../other/update.js。
            //
            // 相对写法有两个问题：
            //   1. 依赖编译产物的目录深度，改 outDir 或挪 apps/ 就断
            //   2. tsc 会静态解析这个字面量。本体的 plugins/other/ 不在本仓库里，
            //      CI 单独 checkout 时必然 TS2307 —— 运行时有 try/catch 兜底，
            //      但类型检查阶段就已经失败了，产物分支根本构建不出来
            const url = pathToFileURL(join(YunzaiPath, "plugins/other/update.js")).href;
            ({ update: Update } = await import(url));
        }
        catch (err) {
            Bot.makeLog("error", ["加载本体更新插件失败", err], "GsCore");
            return e.reply(`无法调用本体更新功能，请手动在插件目录执行 git pull：\n${PluginPath}`);
        }
        const raw = e.msg;
        e.msg = type + PluginName;
        try {
            const up = new Update();
            up.e = e;
            return type === "#更新日志" ? await up.updateLog() : await up.update();
        }
        finally {
            e.msg = raw;
        }
    }
}
