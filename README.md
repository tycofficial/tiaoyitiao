# tiaoyitiao · 跳一跳

基于提供的单文件 HTML 整理的浏览器复刻。保留蓄力跳跃、中心连续加分、特殊平台、原有棋子和场景，修复交互、轨迹、音频及浏览器兼容问题。页面的图像、字体、音效和脚本全部内嵌，不需要 CDN 或安装依赖。

默认开启无敌模式：失误后返回本次起跳点，分数不变，继续手动蓄力。菜单可关闭以恢复普通玩法；设置会保存。历史成绩保留，已解锁皮肤可继续使用。

## 打开游戏

直接双击 `index.html`，使用 Chrome、Edge 或 Safari 打开即可离线游玩。鼠标或触屏长按蓄力，松开跳跃；键盘可使用空格键，Esc 打开菜单。首次播放声音需要点击或按键操作。

也可使用 Node.js 20 及以上版本启动本机预览：

```powershell
node scripts/serve.cjs
```

打开终端打印的 `http://127.0.0.1:4173/`。需要更换端口时，先设置 `PORT` 环境变量。预览服务只监听本机。

## GitHub Pages 配置

项目仓库：[tycofficial/tiaoyitiao](https://github.com/tycofficial/tiaoyitiao)。配置完成并且 Pages 工作流部署成功后，访问地址为：

- `https://tycofficial.github.io/tiaoyitiao/`
- `https://tycofficial.github.io/tiaoyitiao/index.html`
- `https://tycofficial.github.io/tiaoyitiao/tiaoyitiao.html`（自动打开游戏）

以上是预定访问地址，是否已上线以 GitHub Actions 中的实际部署结果为准。

在 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。然后推送到 `main`，或在 **Actions → Check and deploy game → Run workflow** 中选择 `main` 并运行。

工作流先检查脚本、内嵌资源并运行回归测试，全部通过后再发布。Pull request 只运行检查。部署包仅包含 `index.html`、`tiaoyitiao.html` 和 `.nojekyll`；测试、开发脚本及来源说明不会进入网站部署包。

已安装 Git、Node.js 和 GitHub CLI，并完成 `gh auth login` 后，也可在项目根目录运行：

```powershell
pwsh -File scripts/publish.ps1
```

脚本会检查账号、运行检查及测试、创建缺失仓库、正常提交推送，并将 Pages 配置为 **GitHub Actions**；已有的分支发布配置也会切换到该工作流。它不会强制推送或覆盖已有不一致的远端历史。已有远端提交但本地未同步时，请先正常克隆或同步仓库。脚本不接收明文访问令牌。

## 验证

```powershell
node scripts/check.cjs
node --test
```

当前分支包含 **38 项回归测试**，覆盖跳跃射程、运动中间位置、动画衔接、无敌重试、普通失败、存档及音频生命周期。中断、模式切换与皮肤资源异常的复现和结果见 [第二批验收](docs/ACCEPTANCE-ROUND2.md)。落地形变与历史运动参数的核对见 [第三批验收](docs/ACCEPTANCE-ROUND3.md)。皮肤中心的小窗口布局与选择状态见 [第四批验收](docs/ACCEPTANCE-ROUND4.md)。两列皮肤页、历史可执行源码对照、原始海报与键盘/触控验证见 [第五批验收](docs/ACCEPTANCE-ROUND5.md)。普通模式结算得分区与导航对照见 [第六批验收](docs/ACCEPTANCE-ROUND6.md)。HUD 历史核对与窄容器模式提示遮挡修复见 [第七批验收](docs/ACCEPTANCE-ROUND7.md)。加载/输入时序诊断、录屏与上下文对照及短按验收修正见 [第八批记录](docs/ACCEPTANCE-ROUND8.md)。原生事件时间计时及排队输入修复见 [第九批验收](docs/ACCEPTANCE-ROUND9.md)。另有可选真实浏览器脚本 `node scripts/browser-qa.cjs`；复现条件、画面和未完成对照项见 [本批验收记录](docs/ACCEPTANCE.md)。测试通过不代表 Pages 已完成部署，应查看工作流的 `deploy` 结果。

主页历史绘制/出现时序核对、小高度窗口标题遮挡与过小控件的修复，以及触控、入口返回、开始/重启验证见 [第十批验收](docs/ACCEPTANCE-ROUND10.md)。

这些检查可以在无浏览器环境中执行。音频实际听感、设备静音开关及手机浏览器表现仍应在对应设备上验证。

## 来源

这是浏览器兼容性修复版本，不是腾讯官方发行版，也不声称使用最新官方源码。参考及第三方素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
