# tiaoyitiao · 跳一跳

基于提供的单文件 HTML 整理的浏览器复刻。保留蓄力跳跃、中心连续加分、特殊平台、原有棋子和场景，修复交互、轨迹、音频及浏览器兼容问题。页面的图像、字体、音效和脚本全部内嵌，不需要 CDN 或安装依赖。

## 打开游戏

直接双击 `index.html`，使用 Chrome、Edge 或 Safari 打开即可离线游玩。鼠标或触屏长按蓄力，松开跳跃；键盘可使用空格键，Esc 打开菜单。首次播放声音需要点击或按键操作。

也可使用 Node.js 20 及以上版本启动本机预览：

```powershell
node scripts/serve.cjs
```

打开终端打印的 `http://127.0.0.1:4173/`。需要更换端口时，先设置 `PORT` 环境变量。预览服务只监听本机。

## GitHub Pages 配置

目标仓库是 `tycofficial/tiaoyitiao`。配置完成并且 Pages 构建成功后，访问地址为：

- `https://tycofficial.github.io/tiaoyitiao/`
- `https://tycofficial.github.io/tiaoyitiao/index.html`
- `https://tycofficial.github.io/tiaoyitiao/tiaoyitiao.html`（自动打开游戏）

以上是预定地址，仓库及 Pages 发布状态应以 GitHub 实际结果为准。

手动发布时，将项目推送到仓库 `main` 分支，在 **Settings → Pages → Build and deployment** 中选择 **Deploy from a branch**，分支选择 **main**、目录选择 **/(root)**，保存后等待部署完成。`.nojekyll` 让 Pages 直接发布静态文件。

已安装 Git、Node.js 和 GitHub CLI，并完成 `gh auth login` 后，也可在项目根目录运行：

```powershell
pwsh -File scripts/publish.ps1
```

脚本会检查账号、运行检查及测试、创建缺失仓库、正常提交推送并配置 Pages。它不会强制推送或覆盖已有不一致的远端历史。已有远端提交但本地未同步时，请先正常克隆或同步仓库。脚本不接收明文访问令牌。

## 验证

```powershell
node scripts/check.cjs
node --test
```

语法、内嵌资源和离线依赖检查可以在无浏览器环境中执行。音频实际听感、设备静音开关及手机浏览器表现仍应在对应设备上验证。

## 来源

这是浏览器兼容性修复版本，不是腾讯官方发行版，也不声称使用最新官方源码。参考及第三方素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
