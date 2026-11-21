import { serve } from "@hono/node-server";
import { createLifebookApp } from "./app.js";
import { runHotBackup } from "./services/import-export.js";
import { cleanupExpiredSnapshots, purgeExpiredTrash } from "./services/entries.js";

const port = Number(process.env.PORT || "3220");
const instance = createLifebookApp();

// 启动时执行一次跨日过期快照清理与 30 天回收站清理
cleanupExpiredSnapshots(instance.db);
purgeExpiredTrash(instance.db);

// 每 24 小时自动执行在线热备与过期快照清扫
const backupTimer = setInterval(() => {
  void runHotBackup(instance.db, instance.dataDir).catch((err) => {
    console.error("[lifebook] 每日热备任务异常:", err);
  });
}, 24 * 60 * 60 * 1000);
backupTimer.unref();

const server = serve(
  {
    fetch: instance.app.fetch,
    port,
    hostname: "0.0.0.0"
  },
  (info) => {
    console.log(`[lifebook] 服务端已启动：http://0.0.0.0:${info.port} (DATA_DIR=${instance.dataDir})`);
  }
);

function shutdown() {
  clearInterval(backupTimer);
  server.close(() => {
    instance.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
