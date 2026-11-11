# 第三批验收：历史参考核对与落地形变衔接

日期：2026-11-10。基线：`f70e0181a5645bdf95aab660673ae9408ba9366f`。本批产品改动集中在 `squeezeAt` 和成功落地调用，共 4 行调整。

## 可复核差异列表

参考为项目已声明的 Men-HuLu/wechat-code 提交 `4ef17b5fabec6a33e38501df4c75bae80950dccc`，路径 `跳一跳/_1079392110_64/js/`。这是历史 4.0.6 快照，不是当前官方版本或 1:1 验收依据。

| 项目 | 核对依据和结果 | 本批处理 |
| --- | --- | --- |
| 蓄力压缩 | `bottle._prepare`、`block._shrink`。在 60 Hz 的 0、30、60、99 步，适配器身体、头部、棋子与平台压缩位置的最大差异约 2.05e-14，仅浮点误差。适配器按墙钟连续插值，历史实现按帧减量，非逐设备逐帧等同。 | 保留现有参数。 |
| 转体与落地动画原方法 | 内嵌 `Bottle.jump`、`Bottle.squeeze` 和历史源码方法去除空白后 SHA-256 相同。源码声明转体 140+180 ms、默认 Linear；历史动画库另有 17 ms 离散步进，浏览器适配器按时间连续计算。 | 保留声明时长和原方法。 |
| 平台回弹 | `block.rebound` 方法与参考相同，500 ms、Elastic.easeOut。 | 保留。 |
| 镜头跟随 | 参考 `index.moveGradually` 使用 `500 * (move.length()/10)` ms 和 Quad.easeOut；适配器的 `move.length()/20` 秒等价。未中断时终点关系一致；适配器已有平台中点锚定以避免中断后的偏移积累。 | 保留既有时长、缓动和锚定。 |
| 成功落地的身体比例 | 参考 `index.succeed` 直接调用 `bottle.squeeze()`，从当时身体比例接着动画。适配器 `squeezeAt` 先强制标准比例，再调用同一动画，形成触地瞬间突变。 | **修复此差异**：成功落到下一平台时保留身体比例，再进入原有落地动画。落回当前平台及安全回位继续使用原有完整姿态重置。 |

原始方法摘要与压缩测量：[reference-audit.json](qa/round3/reference-audit.json)。方法摘要只比对去空白的源码文本，不代表整款游戏的一致性。

参考链接：[bottle.js](https://github.com/Men-HuLu/wechat-code/blob/4ef17b5fabec6a33e38501df4c75bae80950dccc/%E8%B7%B3%E4%B8%80%E8%B7%B3/_1079392110_64/js/bottle.js)、[block.js](https://github.com/Men-HuLu/wechat-code/blob/4ef17b5fabec6a33e38501df4c75bae80950dccc/%E8%B7%B3%E4%B8%80%E8%B7%B3/_1079392110_64/js/block.js)、[index.js](https://github.com/Men-HuLu/wechat-code/blob/4ef17b5fabec6a33e38501df4c75bae80950dccc/%E8%B7%B3%E4%B8%80%E8%B7%B3/_1079392110_64/js/index.js)、[lib/animation.js](https://github.com/Men-HuLu/wechat-code/blob/4ef17b5fabec6a33e38501df4c75bae80950dccc/%E8%B7%B3%E4%B8%80%E8%B7%B3/_1079392110_64/js/lib/animation.js)。

## 复现与测量

固定蓄力 0.719 秒，运行真实内嵌 `jump`、`squeeze` 及适配器时钟，在计算出的触地时间采样身体 XYZ 比例：

| 时点 | 修复前 | 修复后／参考直接衔接 |
| --- | --- | --- |
| 触地调用前 | 1.140455 / 0.874594 / 1.140455 | 相同 |
| 触地调用后 | 1 / 1 / 1 | 1.140455 / 0.874594 / 1.140455 |
| 300 ms 恢复后 | 1 / 1 / 1 | 1 / 1 / 1 |

隔离方法测量原始值：[修改前](qa/round3/landing-before.json)、[修改后](qa/round3/landing-after.json)。飞行时间、射程、蓄力映射和计分公式均未改动。

浏览器另在基线与新版的隔离本地副本中，给真实成功落地调用加只读观察器，各执行四次连续手动成功跳跃，包含 straight 和 left：基线首次触地最大比例跳变 0.133289；新版四次均为 0，随后均恢复标准比例，无页面异常。观察器不修改动作、计时或得分，不写入产品文件。真实输入的实际蓄力时长存在调度差异，因此不比较两次运行的分数，只比较每一次触地前后的比例。[原始浏览器结果](qa/round3/landing-browser-results.json)。

## 验证

- **通过**：静态脚本、158 项内嵌资源和离线依赖检查；ASSETS 表保留。
- **通过**：33/33 Node 回归测试，0 fail、0 skipped。新增测试直接调用真实 `land` 路径，覆盖两种方向、五个蓄力时长、30/60/120 Hz；验证触地连续、150 ms 目标姿态、300 ms 恢复，以及后续无旧动画覆盖。原有 31 项测试的期待值未降低。
- **通过**：`scripts/landing-qa.cjs` 的八次成功触地观察及恢复检查，基线缺陷复现成功。
- **通过**：原有 `scripts/browser-qa.cjs` 的 14 项主路径，包括短/长蓄力、连续手动成功、无敌重试、普通失败、重启、菜单、皮肤、多个尺寸和触屏模拟。[原始结果](qa/round3/core-browser-results.json)。
- 本批被测 `index.html` SHA-256：`785dfa320bfbe1a8089dde51e155ca2ae6820848f3c3fe0f42e1c0c82e4c77bf`。浏览器对照结果记录了相应产品摘要。

本地复现：先运行 `node scripts/serve.cjs`，再运行 `node --test`、`node scripts/landing-qa.cjs` 及 `QA_SKIP_FILE=1 node scripts/browser-qa.cjs`。浏览器开发依赖和录屏条件同前两批。

[基线接触画面](qa/round3/baseline-contact.png) · [新版接触画面](qa/round3/current-contact.png)。截图用于展示场景，数值结论来自真实调用边界的采样。

## 剩余项与跳过项

当前官方版本的录屏、实体设备手感及 Safari 仍未验收；真实页面隐藏/系统前后台没有新增验证结论，不把此前 blur 注入当成真实后台。`file://` 继续显式跳过，未重试或绕过限制。

没有新增无关功能或猜测视觉、物理参数。本批仍为同一功能分支和草稿 PR，不推 main、不合并、不部署。确切提交及远端 CI 原始结果见 PR。
