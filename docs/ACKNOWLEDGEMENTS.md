# 开源来源与致谢

NUT Studio 的 NUT65 CU 适配使用并参考了 **打包还是带走（packOrTake）** 的开源项目 **weika-nut65-firmware**。感谢原作者公开配置定义和功能说明，使本工具能够适配其 CU 固件功能。相应版权与许可属于原作者；NUT Studio 不代表原作者或上游项目。

- 原作者：**打包还是带走 / packOrTake**。
- 上游项目：[weika-nut65-firmware](https://gitee.com/packOrTake/weika-nut65-firmware)。
- 参考版本：**CU V37**，`master` 提交 **`8427691`**；参考资料取得日期为 2026-10-22。
- 上游配置文件：`cu/NUT65 CU.json`。
- 本仓库定义快照：[docs/reference/nut65-cu-v37.json](https://github.com/Qenior/nut-studio/blob/v1.1.5/docs/reference/nut65-cu-v37.json)。

## 实际使用范围

本工具采用并适配上游的 CU 灯效名称与编号、自定义配置菜单及参数编号和值域，以及专用键码对应的功能语义。仓库保留上述配置定义快照，适配代码据此向键盘发送 VIA 配置指令。键盘中的音乐律动、打字速度、番茄钟及灯带实际渲染由相应固件执行；软件中的灯光预览为示意。

NUT Studio 发布包不包含该项目的固件二进制、SignalRGB 插件或 AI Agent 可执行程序，也不提供固件刷写。有关上游固件和插件的安装、功能及限制，请查阅原作者项目说明。

## v1.1.5 署名补充

本次补充使中文署名在仓库首页、使用说明及 Release 附件中更容易找到。已经公开的 v1.1.5 tag、EXE、ZIP 和原 `SHA256SUMS.txt` 保留。原 v1.1.5 便携包、源码包及 EXE 内嵌的 `THIRD-PARTY-NOTICES.md` 已包含原作者署名、上游来源和 MIT 许可全文；中文声明作为补充附件提供。

## 上游 MIT 许可

以下原文与本仓库 [THIRD-PARTY-NOTICES.md](https://github.com/Qenior/nut-studio/blob/v1.1.5/docs/THIRD-PARTY-NOTICES.md) 保留的原作者 MIT 许可一致：

MIT License

Copyright (c) 2026 打包还是带走

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
