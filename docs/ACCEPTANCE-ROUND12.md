# 第十二批：主 WebGL 丢失时冻结游戏，恢复后安全继续

日期：2026-11-11。基线：`1a7f1fb8f45dfbca4f0e0008d5e6b4e7ab90ff37`。本批只处理主游戏画布的上下文丢失/恢复，不重复辅助预览构造故障、历史几何对照、GPU 压力矩阵或旧超时调查。

## 实际浏览器复现

使用主画布真实的 `WEBGL_lose_context` 扩展调用 `loseContext()` / `restoreContext()`，浏览器生成的两个事件均为 `isTrusted=true`。没有手工派发上下文事件、改写 `isContextLost()` 或以 VM 夹具代替实际故障。

固定基线中，丢失事件先打开菜单并暂停，但点击“继续”仍可恢复。随后真实空格按住约 260 ms，`rawContextLost` 仍为 true，却生成了 `flight`，场景时钟由约 450.0 前进到 709.5 ms；旧 `hint` 没有可见区域。说明主渲染器停止绘制时，玩法仍可在不可见画面下运行。[原始对照数据](qa/round12/context-results.json) · [基线丢失后仍在游玩](qa/round12/baseline-hidden-play.png)。

## 修复

- `graphicsUnavailable` 同时检查事件状态和浏览器真实上下文状态。原生丢失已经发生、事件尚未消费的间隙也不能继续模拟。帧循环仍更新墙钟基准，恢复后不追赶丢失期间的时间。
- 开始、主页、重启、继续、蓄力开始/释放与 `resize` 在画面不可用时拒绝执行。暂停恢复也有独立守卫，避免仅依赖某个按钮或 CSS 阻挡。
- 丢失后打开安全菜单并保持当前局，取消尚在蓄力的输入，停止声音。独立等待层显示“画面暂时不可用，游戏已暂停”，使用 `role=status`、`aria-live=polite`，不依赖原本隐藏的 HUD 提示。该层拦截指针；Space、Enter、Escape 也不能激活其后不可见的控件。
- 恢复事件后等待下一动画帧，让内嵌渲染器先重建自身 GL 状态，再调整尺寸、重绘当前场景并撤下等待层。菜单继续保持暂停，用户点击继续后才恢复当前动作；不强制重开、不修改当前分数或清存档。
- 只读诊断增加 `render.contextLost`。原运动、输入时间归一化、计分、救回、成绩迁移和皮肤材质规则不变。

[实际等待状态](qa/round12/context-lost.png) · [同局恢复，实际 2 分与银色皮肤保留](qa/round12/context-restored.png) · [普通失败恢复后正常结算](qa/round12/ordinary-settlement-restored.png)。等待界面是浏览器故障状态，不冒称历史官方 UI。

## 恢复绘制的附带问题

第一版守卫已经阻止暗中游玩，但严格绘制检查读到 GL 错误 1282，保留为 [失败记录](qa/round12/initial-gl-error-results.json)。小型诊断区分了来源：第一次读像素前已有 1282，读像素本身及后两帧为 0；控制台有四次“delete: object does not belong to this context”。[原始诊断](qa/round12/gl-cleanup-diagnostic.json)。

`resize` 会替换并销毁地面平面；恢复后销毁旧平面的 GPU 记录会尝试删除上一个上下文的缓冲句柄。因此丢失事件中先对该平面调用标准 `geometry.dispose()`，在 GL 仍处于丢失状态时清掉旧缓冲记录；恢复时再按原有路径重建平面。CPU 场景、棋子、平台和分数不被清空。没有修改内嵌引擎、吞掉错误或删除 `getError()===0` 断言。最终四组恢复绘制均通过非透明像素与 GL 错误为 0 的检查。

## 最终验证

最终 `index.html` SHA-256：`5ccb13c14b6d537525bc2cb565421cb4d41a0352c189060c21ccb420ed057607`。

| 真实扩展场景 | 丢失期间与恢复后的结果 |
| --- | --- |
| 带真实成绩的飞行 | 已手动获得 2 分、处于一次短跳飞行中。指针尝试继续/重启/主页、实际 Space/Enter/Escape 和游戏输入均未推进时钟、飞行、棋子、平台或分数。恢复后仍暂停，手动继续后仍为 2 分。 |
| 已暂停的主页 | 保留场景时刻与状态；恢复不自动开始演示，点击返回后才继续原主页时钟。 |
| 无敌回位 | 220 ms 回位动作在丢失处冻结；恢复后仍暂停，点击继续才完成同一起跳点的回位，分数不变。 |
| 普通失败 | 失败与结束计时器冻结；恢复后继续原失败流程，正常结算已有 2 分并记录该真实成绩，没有转成无敌或重开。 |

以上四组中，恢复时的场景时刻与丢失后完全相同；均保留银色选择、旧最高分/纪录 3200，恢复绘制有实际 GL 像素且错误为 0，无页面异常。实际指针的命中测试确认等待层接收点击，辅助状态的可访问快照也已记录。额外的基线用例用于重复确认旧问题，故共 **5 组**。这不是多设备 GPU 压力测试。

- **通过**：[静态检查](qa/round12/static.txt)，3 段脚本、158 项内嵌资源。
- **通过**：[Node 41/41](qa/round12/node.txt)，0 fail、0 skipped。原 38 项保留原断言；新增 3 项检查原生丢失/事件状态、当前局/输入/尺寸守卫，以及帧循环不推进且不积累恢复时间。既有输入 VM 夹具显式提供健康画面依赖，不以此证明真实 GPU 行为。
- **通过**：[针对性真实扩展 5 组](qa/round12/context-results.json)，包含固定基线和上述四组修复场景，丢失/恢复事件均为浏览器原生可信事件。
- **通过**：[录屏开启的既有主流程 14 项](qa/round12/core-results.json)、[生命周期 15 项](qa/round12/lifecycle-results.json)、[皮肤键盘/触控 6 项](qa/round12/skin-input-results.json)。覆盖无敌/普通、真实计分、菜单/重启/主页、迟到输入、模式和成绩/皮肤保存；没有为守卫降低落点或生命周期断言。
- **通过**：[逐字节保留检查](qa/round12/preservation.json)：素材和内嵌引擎完全不变，21 个相关运动/计分/存档/救回/皮肤函数不变；6 个函数仅增加画面可用性守卫。原生事件时间计算保留，监听器只增加不可用期间的交互阻挡。

[执行环境](qa/round12/environment.json) · [测试摘要](qa/round12/test-hashes.json) · [四段针对性录屏](qa/round12/videos)。针对性脚本 SHA-256：`ab485a98a38b8add34ded949c962498d25cfe2a87d59963e0150620c22fb6796`。主流程录屏保留在执行环境 `/tmp/tiaoyitiao-round12/core-final`；针对性录像、截图和原始数据随仓库提交。

复现先启动 `node scripts/serve.cjs`，准备基线提交，再运行：

```sh
node scripts/graphics-context-qa.cjs
node scripts/check.cjs
node --test
QA_SKIP_FILE=1 node scripts/browser-qa.cjs
node scripts/lifecycle-qa.cjs
node scripts/skin-input-qa.cjs
```

开发依赖为 Playwright、Chromium 及录屏所需 ffmpeg。`QA_OUTPUT` 可指定输出目录，`QA_SKIP_VIDEO=1` 可用于不需要录像的运行；本次最终针对性与主流程均未关闭录像。

## 限制与跳过

扩展产生的是实际浏览器上下文丢失/恢复，但不能冒称实体设备自然 GPU 故障、驱动崩溃或 Safari 已验收；也不保证浏览器一定会恢复 GPU。本批验证丢失后仍可留在安全等待状态，没有强制刷新或清数据。官方同版本对照、原始金银素材、真实前后台/休眠、实体设备和听感等既有缺项不因本批而完成；旧 30 秒加载与 510 ms 样本归因仍未确认。

`file://` 继续按既有 `ERR_BLOCKED_BY_ADMINISTRATOR` 限制显式跳过，没有重试或绕过。本批没有新增审批拒绝或待批准动作；只更新原功能分支和草稿 PR，不推 main、不合并、不部署、不强推。
