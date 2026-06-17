# Live Share 项目上下文整理

日期：2026-06-09

## 1. 项目目标

这个项目的目标是：

- 添加本地 React + Vite 项目
- 一键启动项目
- 自动生成本地预览地址
- 自动生成可给他人访问的公网地址
- 在控制台页面里统一展示状态、进度、错误和链接

项目目录：

- 控制台项目：`C:\Users\ZhuanZ（无密码）\Desktop\codex项目\前端展示`
- 当前被分享的业务项目：`C:\Users\ZhuanZ（无密码）\Desktop\make文件\PC端代码`

## 2. 这次问题的完整脉络

最开始希望走 `cloudflared Quick Tunnel`。

但在当前机器和网络环境下，Quick Tunnel 长时间不稳定，主要遇到过这些问题：

- `429 Too Many Requests`
- `api.trycloudflare.com` 无法连通
- 某些网络环境里会被解析到保留地址
- 生成的公网地址在本机和其他机器都可能打不开

基于这几轮排查，最终决定：

- 放弃 `cloudflared` 作为默认公网方案
- 恢复为 `localtunnel`

## 3. 切回 localtunnel 后遇到的新问题

切回 `localtunnel` 后，公网地址可以生成，但又遇到了两个典型问题：

### 问题 A：公网能打开标题，但页面内容白屏

这个问题的根因不是 `localtunnel` 自身失效，而是：

- 被分享项目是 Vite 项目
- 最开始的分享方式实际上还在走开发态页面
- 开发态页面包含 `@vite/client` 和 HMR
- 经隧道访问时，HMR 会误连访问者本机 `localhost`
- 结果就是浏览器标题能出来，但 React 页面主体白屏

这个结论后来被业务项目自己的 `vite.config.ts` 进一步佐证：

- 文件中已经有明确注释，说明经隧道访问时 HMR 可能导致白屏

### 问题 B：切到 build + preview 后，第 4 步超时

后来我们把分享链路改成：

1. `npm run build`
2. `npm run preview`
3. `localtunnel`

这一步的目标是绕过 HMR 白屏。

但又出现了第 4 步失败，报错：

- `share preview server did not become reachable in time`

根因后来被确认是：

- `vite preview` 想占用 `5173`
- 旧的本地服务或旧会话残留仍然占着 `5173`
- 预览服务没有真正起来
- 控制台误以为它还在等待中，最后超时

## 4. 当前已经确认有效的稳定方案

### 当前默认公网方案

默认公网分享方案已经固定为：

- `localtunnel`

### 当前分享模式

分享不再走开发态 `vite dev`，而是：

1. `npm run build`
2. `npm run preview -- --host 0.0.0.0`
3. `localtunnel` 建立公网地址

### 端口策略

分享预览服务不再默认从 `5173` 起步，而是：

- 从 `4173` 开始分配

这样做的原因是：

- 避开常见的 Vite 开发端口冲突
- 避免旧服务残留导致 `preview` 启动失败

### 分享服务就绪判定

现在只有当首页真正返回“构建产物页面”时，才算启动成功。

也就是说：

- 如果页面里还是 `@vite/client` 和 `/main.tsx`
- 就说明它还是开发态，不算成功

只有出现 `dist` 风格的 `/assets/*.js` 等构建资源时，才算预览服务真的起来了。

## 5. 目前已经做过的关键代码修改

### 控制台项目中的关键文件

- `src/server/liveShareSupervisor.ts`
  - 主流程从“开发态分享”切到“构建后预览分享”
  - 分享预览默认端口从 `5173` 调整为 `4173`
  - 状态流改为更贴近真实过程

- `src/server/shareServerManager.ts`
  - 新增
  - 专门负责：
    - `npm run build`
    - `npm run preview`
    - 检查构建页是否真正可达

- `src/server/tunnelManager.ts`
  - 现在默认使用 `localtunnel`
  - 错误提示改成中文
  - 保留了 `cloudflared` 相关代码，但不再作为默认主链路

- `src/server/systemChecks.ts`
  - 顶部状态提示改为围绕 `localtunnel`

- `src/client/App.tsx`
  - 页面中文文案已重写
  - 修复了大量乱码
  - 状态展示和步骤展示已与后端当前语义对齐

- `README.md`
  - 已按当前真实方案重写

### 已补的测试

- `tests/server/shareServerManager.test.ts`
  - 验证只接受构建产物页
  - 拒绝 Vite 开发态页面

- `tests/server/liveShareSupervisor.test.ts`
  - 已跟当前 supervisor 逻辑同步

- `tests/server/tunnelManager.test.ts`
  - 已跟当前 `localtunnel` 错误提示同步

## 6. 已确认的验证结果

### 已成功验证

- 控制台项目 `typecheck` 通过
- `localtunnel` 可以生成公网地址
- 经过上述修复后，用户已明确反馈“终于成功了”

### 曾经确认过的根因结论

- `cloudflared Quick Tunnel` 在当前环境不稳定，不适合作为当前默认方案
- `localtunnel` 本身可以工作
- 白屏的核心问题不是隧道创建，而是开发态页面经隧道访问的 HMR 问题
- `build + preview` 才是更适合分享的方式

## 7. 当前用户偏好和约束

用户明确偏好如下：

- 尽量中文说明
- 更重视可交付、可稳定使用，而不是复杂理论
- 不希望依赖普通用户去装一堆额外工具
- 不希望再回到 Cloudflare 这条不稳定路径上
- 当前阶段优先保证“能稳定分享”，而不是做架构性扩展

## 8. 后续如果继续开发，建议优先顺序

### 优先级高

1. 再补一轮“分享成功后本地地址端口确实来自 `4173+`”的测试
2. 将所有用户可见的英文内部报错进一步统一成中文
3. 给“启动分享”增加更明确的失败原因提示，例如：
   - 构建失败
   - 预览服务端口被占用
   - 公网隧道建立失败

### 优先级中

4. 把老的 `devServerManager.ts` 标记为“非公网分享链路使用”，避免以后误接回主流程
5. 补充一份“分享模式工作原理”文档，方便以后续接

### 优先级低

6. 如以后确实需要，再重新评估：
   - 自建 relay
   - 内置 sidecar
   - 更稳定的付费隧道方案

但这不属于当前阶段重点。

## 9. 当前结论

截至 2026-06-09，这个项目的可用主路径已经明确：

- 控制台管理本地项目
- 分享模式走 `build + preview`
- 公网隧道走 `localtunnel`
- 预览端口从 `4173` 起步

这个结论是基于多轮失败后的收敛结果，不建议轻易再改回：

- 开发态 `vite dev + tunnel`
- 默认 `cloudflared Quick Tunnel`

除非后续有新的明确需求和新的可验证网络条件。
