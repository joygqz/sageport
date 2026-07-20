<div align="center">

<img src="public/app-icon.png" alt="Sageport" width="96" height="96" />

# Sageport

**连接、传输、监控、运维，一个桌面应用搞定所有服务器。**

免费开源的 SSH 工作台，支持 macOS、Windows 和 Linux。

[![Latest release](https://img.shields.io/github/v/release/joygqz/sageport)](https://github.com/joygqz/sageport/releases/latest)
[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

[English](README.md) · 简体中文

[下载](https://github.com/joygqz/sageport/releases/latest) · [三分钟上手](#三分钟上手) · [核心亮点](#核心亮点)

</div>

![Sageport 工作台](docs/screenshot.png)

Sageport 取代了你桌面上散落的终端窗口、传输工具、密钥管理器和命令备忘录。它基于标准 SSH —— **服务器上无需安装任何东西，也不用注册账号**，所有数据都留在你自己的设备上。

## 核心亮点

- **跟得上手速的终端。** 多标签、分屏、一键重连、回滚搜索、命令自动补全，还能同时向多台服务器广播输入。
- **传文件毫不费力。** 在双栏文件浏览器里拖拽即传，远程文件可直接编辑，保存即回写服务器。
- **服务器状态一目了然。** CPU、内存、磁盘、网络实时可见，无需部署任何探针。
- **主机井井有条。** 分组管理、凭据复用、经跳板机直达内网服务器，还能一键导入现有 SSH 主机。
- **重复操作不再重敲。** 把命令存成片段，支持变量填空，可批量运行在多台服务器上并分别查看结果。
- **内网服务一键触达。** 端口转发随开随关、可自动启动，跳板机之后的服务也不在话下。
- **先问再做的 AI 助手。** 接入你自己的 AI 服务，助手能查看工作台、建议或执行命令，但每一步操作都默认等你确认。
- **随身带走。** 可选的加密同步（GitHub、Google Drive、OneDrive、WebDAV 或 S3），也可以导出一份加密备份文件。

这一切都装在你熟悉的 VS Code 风格工作区里：命令面板、快捷键、明暗主题，界面支持简体中文和英文。

## 下载

从[最新版本](https://github.com/joygqz/sageport/releases/latest)选择适合你电脑的安装包：

| 系统                            | 安装包                         |
| ------------------------------- | ------------------------------ |
| macOS（Apple Silicon 与 Intel） | 通用 `.dmg`                    |
| Windows（64 位）                | `.exe` 安装程序或便携版 `.zip` |
| Linux（64 位）                  | `.AppImage` 或 `.deb`          |

Sageport 会自动检查更新，新版本可直接在应用内安装。

Windows 便携版无需安装。解压到任意位置（包括 U 盘）即可运行，所有设置、主机、密钥与会话记录都保存在 `Sageport.exe` 同级的 `data` 目录里，整个目录搬到哪儿，配置就跟到哪儿。便携版不会自动更新，也不会在宿主机注册开机自启。拿到该目录的人即可读取其中的凭据，请自行保管好磁盘。

## 三分钟上手

准备好服务器地址、用户名，以及密码或私钥。

1. **添加服务器** —— 按 <kbd>⌘</kbd> <kbd>N</kbd> 填写连接信息，或直接导入现有 SSH 主机。
2. **连接** —— 在侧边栏点击主机，或按 <kbd>⌘</kbd> <kbd>P</kbd> 搜索名称。赶时间？输入 `user@host` 即连，无需保存。
3. **传文件** —— 按 <kbd>⌘</kbd> <kbd>J</kbd>，在电脑与服务器之间拖拽文件。

Windows 和 Linux 上，把本页的 <kbd>⌘</kbd> 换成 <kbd>Ctrl</kbd> 即可。

## 数据只属于你

- 所有数据都存在你自己的设备上，没有 Sageport 云服务，也不需要账号。
- 密码与密钥以明文保存在本机数据库中。任何能读取你用户账户文件的程序都能读到它们，请自行保护好设备。
- 备份与同步在离开设备前会用密码短语加密。
- 同步密码短语只有你知道，Sageport 无法读取你的备份，也无法找回丢失的密码短语，请妥善保管。
- 首次连接陌生服务器需要你确认；AI 的每个操作都需你放行，除非你主动开启自主模式。

## 许可证

[GPL-3.0-only](LICENSE)
