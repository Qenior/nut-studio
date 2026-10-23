# NUT Studio v1.1.5

Windows 11 x64 / WEIKAV 维咖 NUT65 CU 配置工具。

1. 将压缩包解压到可写文件夹，双击 NUT-Studio.exe。
2. 使用可传输数据的 USB 线连接键盘，选择有线模式。
3. 关闭同时占用设备的 VIA / OpenRGB / SignalRGB。
4. packOrTake CU V37 固件默认通过 Fn + Y 切换 RGB 协议，选择红色反馈的 VIA。
5. 选择“连接键盘 → Windows 直接连接”。
6. 灯光和设备功能实时生效，停止调整约 1 秒后保存；改键请点击“应用键位 → 应用并保存”。

使用系统自带的 .NET Framework 4.8 和 Microsoft Edge，无需管理员权限或另装 USB 驱动。当前 EXE 未进行代码签名，下载校验值见 Release 的 SHA256SUMS.txt。

“前灯带开 / 关（软件联动）”需要在改键中分配并应用，且保持 Windows 直接连接和软件窗口运行，可以最小化；此功能使用专用 F24 系统热键。软件退出或连接断开后联动停止。

运行时 data/ 自动生成，包含方案、联动偏好、诊断和修改前备份。更新前在“使用帮助 → 退出软件”结束旧程序，再把 data/ 复制到新版旁。

主要适配：packOrTake / weika-nut65-firmware CU V37，参考提交 8427691。
https://gitee.com/packOrTake/weika-nut65-firmware

本软件不提供固件刷写。其他硬件批次和固件版本可能有差异。详细说明、源码和问题反馈请查看下载本版本的 GitHub 仓库。

MIT 许可证见 LICENSE；第三方来源和许可见 THIRD-PARTY-NOTICES.md。

