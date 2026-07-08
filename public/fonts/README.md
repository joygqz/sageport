# Nerd Font 字体文件

将下载的 Nerd Font `.woff2` 文件放入对应的子目录中，然后在 `src/styles/globals.css` 中取消注释对应的 `@font-face` 规则。

## 下载地址

- **JetBrainsMono Nerd Font**: <https://github.com/ryanoasis/nerd-fonts/releases/latest>
- **CascadiaCode Nerd Font**: <https://github.com/ryanoasis/nerd-fonts/releases/latest>
- **FiraCode Nerd Font**: <https://github.com/ryanoasis/nerd-fonts/releases/latest>

## 安装方法

1. 从上面的链接下载所需字体的 `.zip` 包
2. 解压后找到 `.woff2` 文件（或 `.ttf`/`.otf` 文件）
3. 在 `public/fonts/` 下创建对应字体的子目录
4. 将字体文件放入
5. 在 `src/styles/globals.css` 中取消注释对应的 `@font-face` 规则
6. 在应用的"设置 → 外观 → 终端字体"中选择对应字体

> **提示**：也可以直接在系统上安装 Nerd Font，然后在应用中选择字体名称即可，无需捆绑字体文件。
