# 第二批验收：中断、模式切换和皮肤资源异常

日期：2026-11-10。检查起点：`948494be4d64b77ae51a8f7b84432d6e73c70f71`，继续使用同一功能分支和草稿 PR #1。

## 先复现再修复

| 问题 | 复现步骤与修改前实测 | 本批行为与源码位置 |
| --- | --- | --- |
| 失败期间开启无敌仍结束游戏 | 关闭无敌；长按约 1.35 秒落空；失败动画开始后开菜单并开启无敌；继续后等 2.6 秒。`invincible=true` 但 `mode=over`。 | 保留该次起跳点，取消这一失败及其子回调、动画和结束计时器，返回起跳点继续。`index.html` 的 `fail`、`runFailureWork`、`recoverMiss`、`setInvincible`。其他场景动画不统一清空。 |
| 皮肤中心与菜单叠加后暂停失效 | 首页开皮肤中心；点右上菜单；按 Esc。旧菜单仍可见但 `paused=false`，场景时间从 533.3 ms 继续到 1011.8 ms。 | 菜单接管时关闭原弹窗，保持暂停；Esc 仅退出当前菜单并恢复首页。`openMenu`。 |
| 皮肤预览解码失败导致整款游戏卡加载 | 临时测试浏览器把生成预览的 PNG 替换成不可解码数据，不修改 HTML 或真实资源。4 秒后仍显示“准备开始”，`jumpDiagnostics` 未建立；4 张预览均失败。 | 预览编码、解码和显示失败均可降级，皮肤卡片显示“预览暂不可用”，游戏仍能启动；不展示错误颜色的替代皮肤。`buildSkinArt`、`updateSkins`，只读诊断增加 `skin.previewIssues`。必需场景资源失败仍显示启动错误。 |
| 切换无敌时已有普通局成绩未及时保存 | Node 复现已有 17 分的普通局转为无敌；切换后 `best` 仍为 0。 | 切换时保存真实已有最高分，不额外加分；浏览器也验证成功跳跃后的成绩在失败救回时保留并写入存档。`setInvincible`。 |

修改前原始记录：[中断](qa/round2/interruptions-before.json)、[皮肤](qa/round2/skins-before.json)。其中后台标签测试的失败是无头浏览器未产生真实 blur，不能作为产品缺陷；见下方验证限制。

## 最终验证

- **通过**：`node scripts/check.cjs`，3 段脚本和 158 个内嵌资源；ASSETS 表与第一批逐字相同。
- **通过**：`node --test`，31/31，0 fail，0 skipped。新增用例覆盖五种失败类型、多个救回时间、后代回调取消、无关动画保留、快速模式切换、普通失败、特殊平台计分、旧音频回调及弹窗接管。
- **通过**：原有浏览器脚本的 14 项检查，继续覆盖正常跳跃、连跳、无敌重试、普通失败、皮肤、尺寸及触屏。
- **通过**：新增 15 项浏览器生命周期检查。飞行和 220 ms 回位期间暂停/继续、主页/新局、重启；途中切换模式；失败动画期间救回；已有成绩保存；迟到的 pointer-up；连续 15 轮主页/开始/菜单/继续；blur **事件注入**后的暂停和恢复。
- **通过**：5 项皮肤与资源异常浏览器检查。覆盖菜单与 Esc、预览编码失败、解码失败、展示失败，以及必需内嵌图片失败。前三种预览异常后均可真正开始游戏。
- **通过**：真实手动跳到 31 号特殊平台，暂停时分数/场景时间不变；恢复后只加一次 20 分（20 → 40），再等不重复加分；重启后 0 分、0 个计时器。Node 另验证奖金待触发时重启及旧音频完成回调不会影响新局。

可重复运行（先启动 `node scripts/serve.cjs`）：

```sh
node scripts/check.cjs
node --test
QA_SKIP_FILE=1 node scripts/browser-qa.cjs
node scripts/lifecycle-qa.cjs
node scripts/skin-error-qa.cjs
node scripts/special-platform-qa.cjs
```

浏览器脚本需开发环境已有 Playwright、Chromium；主脚本录屏还需 Playwright 可找到的 FFmpeg。`QA_OUTPUT` 指定证据目录。游戏本身仍无运行依赖。错误注入只作用于隔离的测试浏览器，未损坏生产资源和用户存档。

原始结果：[主路径](qa/round2/core-results.json) · [生命周期](qa/round2/lifecycle-results.json) · [皮肤错误](qa/round2/skin-error-results.json) · [特殊平台](qa/round2/special-results.json)。新增结果记录 `index.html` 的 SHA-256，以核对被测产品内容。

本批产品文件 SHA-256：`44deba7fcda21e8d24625a1c3c59f7a3e6af90fcfb2142f9949b298cd4597cd2`。

[失败救回后](qa/round2/falling-mode-enabled.png) · [预览异常降级](qa/round2/fallback-decode.png) · [菜单退出后](qa/round2/skins-menu-escape.png)

## 明确未完成和跳过项

- 未重试 `file://`。上一批托管浏览器策略返回 `ERR_BLOCKED_BY_ADMINISTRATOR`，本批显式跳过；HTTP 本地服务通过不等同于该入口通过。
- 无头 Chromium 的新标签切前台没有产生真实后台 blur，不能声称已实测系统切后台。已验证事件处理路径；实体设备、真实标签隐藏、休眠恢复仍需后续设备测试。
- 尚无当前官方同版本录像或实测；本批没有新增官方 1:1、像素或听感结论。不是为凑进度调整物理参数。
- 没有代替用户选择批准或绕过限制；最初只读检查后，在收到新的明确推进授权后才修复。仅更新功能分支与同一草稿 PR，不推 main、不合并、不部署。推送后的确切 SHA 和 CI 记录在 PR 中。
