# 同步 OAuth 应用注册指南

同步功能里 GitHub Gist、Google Drive、Microsoft OneDrive 三个提供方使用浏览器授权登录，不需要用户手动粘贴令牌。桌面应用无法内置共享密钥，因此**每个分发者需要自行注册（免费的）OAuth 应用**，并在编译时通过环境变量注入 Client ID：

```bash
export SAGEPORT_GITHUB_CLIENT_ID="Iv1.xxxxxxxx"
export SAGEPORT_GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
export SAGEPORT_GOOGLE_CLIENT_SECRET="GOCSPX-xxxx"
export SAGEPORT_MS_CLIENT_ID="00000000-0000-0000-0000-000000000000"

pnpm tauri build
```

未注入某个提供方的 Client ID 时，应用会正常构建运行，只是该提供方的登录按钮显示为不可用，并提示查看本文档。

## GitHub（Device Flow）

1. 打开 <https://github.com/settings/developers> → **New OAuth App**（个人账户即可）。
2. 任意填写名称/主页；**Authorization callback URL** 填 `http://127.0.0.1`（Device Flow 不使用回调，但该字段必填）。
3. 创建后进入应用设置，勾选 **Enable Device Flow**。
4. 复制 **Client ID** 到 `SAGEPORT_GITHUB_CLIENT_ID`。**不需要** Client Secret。

授权时应用向用户展示一次性代码，用户在 <https://github.com/login/device> 输入即可。授权范围仅 `gist`。

## Google（Desktop App + PKCE）

1. 打开 <https://console.cloud.google.com/> 创建项目，启用 **Google Drive API**。
2. **APIs & Services → OAuth consent screen**：选择 External，填写基本信息，添加授权范围 `.../auth/drive.appdata` 与 `openid`、`email`。
   - 应用处于 Testing 状态时，需把使用者的 Google 账号加入 **Test users**（上限 100 人）；对外发布需要通过 Google 审核。
3. **Credentials → Create Credentials → OAuth client ID**，类型选择 **Desktop app**。
4. 复制 Client ID / Client Secret 到 `SAGEPORT_GOOGLE_CLIENT_ID` / `SAGEPORT_GOOGLE_CLIENT_SECRET`。
   - Google 对 Desktop 类型强制发放 Client Secret，但[官方文档明确其不作为机密对待](https://developers.google.com/identity/protocols/oauth2/native-app)，编译进客户端是标准做法。

备份存放在 Drive 的 `appDataFolder`（应用专属隐藏空间），应用只能访问自己创建的数据。

## Microsoft（公共客户端 + PKCE）

1. 打开 <https://entra.microsoft.com/> → **App registrations → New registration**。
2. **Supported account types** 选择 *Accounts in any organizational directory and personal Microsoft accounts*（覆盖个人版与商业版 OneDrive）。
3. **Redirect URI** 类型选 **Mobile and desktop applications**，填 `http://localhost`（Entra 对 localhost 允许任意端口）。
4. **Authentication** 页确认 *Allow public client flows* 为 **Yes**。
5. **API permissions** 添加 Microsoft Graph 委托权限：`Files.ReadWrite.AppFolder`、`User.Read`、`offline_access`。
6. 复制 **Application (client) ID** 到 `SAGEPORT_MS_CLIENT_ID`。**不需要** Client Secret。

备份存放在用户 OneDrive 的 `应用/Sageport` 文件夹（Graph `special/approot`）。

## 安全说明

- 所有备份先在本地用用户口令做 Argon2id + AES-256-GCM 端到端加密，云端只见密文。
- OAuth 令牌只保存在本机数据库，且属于 `sync.*` 设置前缀，永远不会随备份上传（见 `src-tauri/src/sync/mod.rs` 的 `EXCLUDED_SETTINGS_PREFIXES`）。
- Google/Microsoft 使用系统浏览器 + 回环端口 + PKCE（RFC 8252 推荐的原生应用授权方式）；GitHub 使用 Device Flow。授权码交换均在 Rust 进程内完成，令牌不经过 WebView。
