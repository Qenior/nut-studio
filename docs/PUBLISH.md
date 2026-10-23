# 发布流程

仓库名建议为 nut-studio，公开可见。普通用户从 Releases 下载便携版；源码存放在 main 分支。

下面是后续版本发布时的操作说明。发布前先完成验证和打包，再按已授权的发布范围执行对应网络操作。

## 发布前

1. 检查 VERSION、src/AssemblyInfo.cs 和发布说明的版本一致。
2. 运行 test.ps1、build.ps1 和 python scripts/package.py。
3. 检查 dist/ 中的便携 ZIP、独立 EXE、源码 ZIP 与 SHA256SUMS.txt；源码由 scripts/source-files.txt 逐文件允许列表生成，不从 git 暂存区隐式收集。
4. git status 中不应出现 data/、日志、备份、.publish-tools/ 或本机凭据。
5. 初次公开发布前确认 LICENSE 与第三方声明符合计划的授权方式。

## GitHub CLI

以下命令在仓库根目录执行。首次操作需要 GitHub CLI 已安装并完成 gh auth login；也可以使用 GitHub 网页创建仓库和上传 Release 资产。

```powershell
$publishAccount = gh api user | ConvertFrom-Json
$publishOwner = $publishAccount.login
$publishRepo = "$publishOwner/nut-studio"
git init -b main
git config user.name $publishOwner
git config user.email "$($publishAccount.id)+$publishOwner@users.noreply.github.com"
git add .
git commit -m "Release NUT Studio v1.1.5"
gh repo create $publishRepo --public --source . --remote origin --description "Windows 11 configuration tool for WEIKAV NUT65 CU"
git push -u origin main
git tag -a v1.1.5 -m "NUT Studio v1.1.5"
git push origin v1.1.5
gh release create v1.1.5 --repo $publishRepo --verify-tag --draft --title "NUT Studio v1.1.5" --notes-file docs/releases/v1.1.5.md
gh release upload v1.1.5 dist/NUT-Studio-Win11-v1.1.5.zip dist/NUT-Studio-v1.1.5.exe dist/NUT-Studio-Source-v1.1.5.zip dist/SHA256SUMS.txt --repo $publishRepo
gh release edit v1.1.5 --repo $publishRepo --draft=false --latest
```

创建仓库命令用于首次发布；仓库已存在时使用现有 origin，不要重复创建或覆盖。提交源码后再建立标签。先上传完整资产，再将草稿发布。

v1.1.5 使用修复后重新编译的二进制。v1.1.4 获得的正常使用反馈不能作为新版真机验收证据；发布前应检查版本、嵌入资源、测试结果和真机回归记录。PE 时间戳可能随重新编译变化。

## 发布后

在未登录状态确认仓库公开可见，Release 不是草稿，四份资产均可下载且下载校验值与 SHA256SUMS.txt 一致。确认 Actions 结果，并将 Releases 链接提供给用户。

