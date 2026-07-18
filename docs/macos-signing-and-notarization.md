# macOS 发布签名与公证

本文面向 Sageport 维护者，说明如何让 GitHub Releases 中的 macOS `.dmg` 通过 Gatekeeper 检查，避免用户首次打开时看到“Apple 无法验证 Sageport 是否包含可能危害 Mac 安全或泄漏隐私的恶意软件”。

> 结论：必须使用 **Developer ID Application** 证书签名，并把签名后的软件提交给 Apple **公证（notarization）**。仅让用户右键打开、执行 `xattr`、选择“仍要打开”或使用 ad-hoc 签名，都不是正式发布方案。

## 当前项目情况

Sageport 通过 [`.github/workflows/release.yml`](../.github/workflows/release.yml) 和 `tauri-apps/tauri-action` 构建通用架构 macOS `.dmg`。工作流中已有：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

这两个值只用于 **Tauri 自动更新产物签名**，不能作为 Apple 代码签名或公证凭据。macOS 正式发布还需要下面单独列出的 Apple 凭据。

已经发布的未签名构建不会因修改仓库配置而自动变得可信。配置完成后必须重新构建并发布新的 `.dmg`。

## 前置条件

1. 加入付费的 [Apple Developer Program](https://developer.apple.com/programs/)。免费开发者账号只能用于开发测试，不能完成面向用户的 Developer ID 公证。
2. 确认 Account Holder 可以登录 [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)。Apple 只允许 Account Holder 创建 Developer ID 证书。
3. Mac 上已安装当前版 Xcode Command Line Tools。
4. Apple ID 已启用双重认证，以便创建 app 专用密码。

本项目通过 GitHub Releases 在 Mac App Store 之外分发，因此需要的是 `Developer ID Application`，不是 `Apple Distribution`，也不是 `Developer ID Installer`。

## 一、创建 Developer ID Application 证书

### 1. 创建 CSR

在 Mac 上打开“钥匙串访问”，依次选择：

`钥匙串访问 → 证书助理 → 从证书颁发机构请求证书`

填写 Apple Developer 账号邮箱和名称，选择“存储到磁盘”，生成 `.certSigningRequest` 文件。

### 2. 创建并安装证书

1. 打开 Apple Developer 的 [Certificates 页面](https://developer.apple.com/account/resources/certificates/list)。
2. 点击 `+`，选择 `Developer ID Application`。
3. 上传刚生成的 CSR，下载 `.cer` 文件。
4. 双击 `.cer`，安装到登录钥匙串。
5. 在“钥匙串访问 → 登录 → 我的证书”中展开证书，确认其下方有私钥。

用下面的命令确认签名身份存在：

```bash
security find-identity -v -p codesigning
```

应看到类似下面的结果：

```text
Developer ID Application: Quincy Zhang (TEAMID1234)
```

如果“我的证书”中没有关联私钥，说明证书和生成 CSR 的私钥不匹配，不能用于 CI 签名；需要在原来生成 CSR 的 Mac 上导出，或重新创建证书。

## 二、为 GitHub Actions 导出证书

1. 在“钥匙串访问 → 登录 → 我的证书”中找到 `Developer ID Application`。
2. 右键证书条目，选择“导出”。必须导出证书及其私钥，格式选择 `.p12`。
3. 为 `.p12` 设置一个强密码。
4. 转成不换行的 Base64 文本：

```bash
openssl base64 -A -in /绝对路径/DeveloperIDApplication.p12 \
  -out /绝对路径/apple-certificate-base64.txt
```

`.p12`、Base64 文件和密码都属于敏感凭据。不要把它们提交到 Git、放进 Release、粘贴到 Issue 或输出到 Actions 日志。录入 GitHub 后，删除不再需要的明文临时副本，并把需要长期保留的备份放进受控的密码保险库。

## 三、创建公证凭据

本流程采用配置最简单的 **Apple ID + app 专用密码**：

1. 登录 [Apple Account](https://account.apple.com/)，在“登录与安全 → App 专用密码”中创建一个新密码，例如命名为 `Sageport GitHub Actions`。
2. 在 [Apple Developer Membership](https://developer.apple.com/account/#/membership/) 页面找到 Team ID。
3. 保存 Apple ID 邮箱、app 专用密码和 Team ID。`APPLE_PASSWORD` 必须是刚生成的 app 专用密码，不能填写 Apple ID 的网页登录密码。

Tauri 也支持 App Store Connect API Key。若改用该方案，应按照 [Tauri macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/#notarization) 配置 `APPLE_API_ISSUER`、`APPLE_API_KEY` 和指向 `.p8` 私钥的 `APPLE_API_KEY_PATH`；不要同时混用两套公证身份。

## 四、配置 GitHub Actions Secrets

打开仓库：

`Settings → Secrets and variables → Actions → New repository secret`

添加以下 5 个 repository secrets：

| Secret                       | 内容                                          |
| ---------------------------- | --------------------------------------------- |
| `APPLE_CERTIFICATE`          | `apple-certificate-base64.txt` 的完整单行内容 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码                      |
| `APPLE_ID`                   | Apple Developer 账号邮箱                      |
| `APPLE_PASSWORD`             | Apple ID 的 app 专用密码                      |
| `APPLE_TEAM_ID`              | Apple Developer Team ID                       |

可以用 GitHub CLI 检查名称是否已经创建；GitHub 不会回显 secret 内容：

```bash
gh secret list
```

不要把这些值写进 `tauri.conf.json`、`.env`、工作流 YAML 或本文档。GitHub 官方的 secret 配置与安全说明见 [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

## 五、发布脚本已接入

[`.github/workflows/release.yml`](../.github/workflows/release.yml) 已完成 Apple 签名与公证接入，不需要再复制或修改构建脚本。macOS build 会自动：

1. 检查上面的 5 个 Actions secrets 是否齐全；
2. 创建临时钥匙串并导入 `.p12` 证书；
3. 自动找到 `Developer ID Application` 签名身份；
4. 将 Apple ID 公证凭据提供给 Tauri；
5. 构建、签名、提交 Apple 公证并装订公证票据；
6. 保留现有的 Tauri 自动更新产物签名。

如果任一 Apple secret 缺失，或者 `.p12` 中没有 `Developer ID Application` 证书，macOS build 会明确报错并停止，避免发布未签名产物。

配置完 secrets 后只需按现有方式推送新版本 tag。不要给正式发布加入 `--skip-stapling`；它只适合诊断初次公证问题。

## 六、发布并检查结果

推送一个新的语义化版本 tag，等待 Release workflow 完成。不要复用旧的未签名 `.dmg`。

下载 GitHub Release 中的新 `.dmg`，在 Mac 上执行：

```bash
xcrun stapler validate /绝对路径/Sageport.dmg
spctl --assess --type open --context context:primary-signature \
  --verbose=4 /绝对路径/Sageport.dmg
```

再挂载 `.dmg`，将 Sageport 拖入 `/Applications`，检查应用本体：

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Sageport.app
spctl --assess --type execute --verbose=4 /Applications/Sageport.app
```

通过时应满足：

- `stapler validate` 报告验证成功；
- `codesign --verify` 没有错误；
- `spctl` 显示 `accepted`，来源为 `Notarized Developer ID`；
- 从浏览器重新下载并首次启动时，不再出现截图中的“Apple 无法验证”提示；
- 系统显示的开发者名称与 Developer ID 证书主体一致。

只在构建目录内运行成功不算完整验收。Gatekeeper 主要检查带下载隔离属性的文件，因此必须至少测试一次从 GitHub Release 实际下载的产物，最好再使用一台未安装过 Sageport 的 Mac 验证。

## 常见问题

### 仍显示“Apple 无法验证”

通常说明下载的仍是旧包、公证未完成、票据没有装订，或发布后又修改了 `.app`/`.dmg`。确认 Release 资产的生成时间和版本，重新运行上面的四个验证命令。签名后不能再修改应用包内容，否则签名会失效。

### Actions 找不到 Developer ID identity

确认导出的 `.p12` 同时包含证书和私钥，并且证书类型确实是 `Developer ID Application`。在本机“钥匙串访问 → 我的证书”中，证书必须能展开看到私钥。

### 公证提交被拒绝

先查看失败的 Actions 日志。若能获得 submission ID，可在 Mac 上查询 Apple 公证日志：

```bash
xcrun notarytool log SUBMISSION_ID \
  --apple-id "你的 Apple ID" \
  --team-id "你的 Team ID" \
  --password "你的 app 专用密码"
```

不要把真实密码直接写进 shell 历史；本地排错时优先使用 `notarytool store-credentials` 保存到钥匙串。常见原因包括证书类型错误、嵌套二进制未签名、签名后文件被修改或 hardened runtime/entitlements 不符合要求。Apple 的排错清单见 [Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)。

### 能否不购买 Apple Developer Program

可以做 ad-hoc 签名或让每位用户手动放行，但 Gatekeeper 仍会提示未验证，因此不满足本文的正式发布目标。要让从网站或 GitHub 下载的应用正常通过 Gatekeeper，需要 Apple Developer Program、Developer ID 签名和公证。

## 完成标准

- [ ] 使用有效的 `Developer ID Application` 证书；
- [ ] 5 个 Apple secrets 已配置且未进入仓库；
- [ ] macOS CI 构建完成代码签名、公证和票据装订；
- [ ] `.dmg` 和 `.app` 均通过 `codesign`、`stapler`、`spctl` 检查；
- [ ] 从 GitHub Release 全新下载后的首次启动不再出现 Gatekeeper 未验证弹窗；
- [ ] 自动更新 `.sig` 仍正常生成，`latest.json` 仍指向对应版本。

## 官方资料

- [Apple：Signing your apps for Gatekeeper](https://developer.apple.com/developer-id/)
- [Apple：Developer ID 支持说明](https://developer.apple.com/support/developer-id/)
- [Tauri 2：macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [GitHub：Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
