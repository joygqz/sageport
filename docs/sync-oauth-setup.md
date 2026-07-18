# 同步 OAuth 应用注册指南

GitHub Gist、Google Drive 和 Microsoft OneDrive 同步服务商均通过系统浏览器完成登录，用户无需手动粘贴访问令牌。桌面应用无法安全地内置共享密钥，因此，**每个发行者都必须分别注册自己的免费 OAuth 应用**，并在编译时通过环境变量注入客户端 ID：

```bash
export SAGEPORT_GITHUB_CLIENT_ID="Iv1.xxxxxxxx"
export SAGEPORT_GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
export SAGEPORT_GOOGLE_CLIENT_SECRET="GOCSPX-xxxx"
export SAGEPORT_MS_CLIENT_ID="00000000-0000-0000-0000-000000000000"

pnpm tauri build
```

如果某个服务商缺少客户端 ID，应用仍可正常构建和运行，但该服务商的授权登录按钮会被禁用，并指向本文档。

## GitHub（设备授权流程）

1. 打开 <https://github.com/settings/developers>，点击 **New OAuth App**；使用个人账号即可。
2. 填写任意应用名称和主页地址；将 **Authorization callback URL** 设置为 `http://127.0.0.1`。设备授权流程不会使用该回调地址，但 GitHub 要求必须填写。
3. 创建应用后打开其设置，勾选 **Enable Device Flow**。
4. 复制 **Client ID**，将其配置为 `SAGEPORT_GITHUB_CLIENT_ID`。无需客户端密钥。

授权时，应用会显示一次性代码，用户需要在 <https://github.com/login/device> 输入该代码。应用只请求 `gist` 权限作用域。

## Google（桌面应用与 PKCE）

1. 打开 <https://console.cloud.google.com/>，创建项目并启用 **Google Drive API**。
2. 进入 **APIs & Services → OAuth consent screen**，选择 **External**，填写基本信息，并添加 `.../auth/drive.appdata`、`openid` 和 `email` 权限作用域。
   - 应用处于 **Testing** 状态时，必须把每位用户的 Google 账号添加到 **Test users**，最多可添加 100 个；公开发布需要通过 Google 验证审核。
3. 进入 **Credentials → Create Credentials → OAuth client ID**，选择 **Desktop app** 类型。
4. 复制客户端 ID 和客户端密钥，分别配置为 `SAGEPORT_GOOGLE_CLIENT_ID` 和 `SAGEPORT_GOOGLE_CLIENT_SECRET`。
   - Google 始终会为桌面应用类型签发客户端密钥，但[官方文档明确说明该密钥不应被视为机密](https://developers.google.com/identity/protocols/oauth2/native-app)，因此将其编译到客户端是桌面应用的标准做法。

备份存储在 Google Drive 的 `appDataFolder` 中。这是应用专属的隐藏空间，应用只能访问由自身创建的数据。

## Microsoft（公共客户端与 PKCE）

1. 打开 <https://entra.microsoft.com/>，进入 **App registrations → New registration**。
2. 在 **Supported account types** 中选择 **Accounts in any organizational directory and personal Microsoft accounts**，以同时支持个人版和企业版 OneDrive。
3. 在 **Redirect URI** 中选择 **Mobile and desktop applications** 类型，填写 `http://localhost`；Microsoft Entra 接受 localhost 上的任意端口。
4. 在 **Authentication** 页面确认 **Allow public client flows** 设置为 **Yes**。
5. 在 **API permissions** 中添加 Microsoft Graph 委托权限：`Files.ReadWrite.AppFolder`、`User.Read` 和 `offline_access`。
6. 复制 **Application (client) ID**，将其配置为 `SAGEPORT_MS_CLIENT_ID`。无需客户端密钥。

备份存储在用户 OneDrive 的 `Apps/Sageport` 目录中，对应 Microsoft Graph 的 `special/approot`。

## 安全说明

- 每份备份都会在上传前，使用用户的同步口令在本地完成端到端加密（Argon2id + AES-256-GCM）；云端只能看到密文。
- OAuth 令牌仅存储在本地数据库的 `sync.*` 设置项中，不会写入备份；相关排除规则见 `src-tauri/src/sync/mod.rs` 中的 `EXCLUDED_SETTINGS_PREFIXES`。
- Google 和 Microsoft 使用系统浏览器、环回端口及 PKCE，这符合 RFC 8252 对原生应用的建议；GitHub 使用设备授权流程。授权码交换完全在 Rust 进程中进行，令牌不会经过 WebView。
