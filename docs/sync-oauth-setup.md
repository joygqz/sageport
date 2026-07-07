# Sync OAuth app registration guide

The GitHub Gist, Google Drive, and Microsoft OneDrive sync providers sign in through the browser, so users never paste tokens by hand. A desktop app cannot ship a shared secret, which means **every distributor must register their own (free) OAuth apps** and inject the client IDs at compile time through environment variables:

```bash
export SAGEPORT_GITHUB_CLIENT_ID="Iv1.xxxxxxxx"
export SAGEPORT_GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
export SAGEPORT_GOOGLE_CLIENT_SECRET="GOCSPX-xxxx"
export SAGEPORT_MS_CLIENT_ID="00000000-0000-0000-0000-000000000000"

pnpm tauri build
```

If a provider's client ID is missing, the app still builds and runs normally; that provider's sign-in button is simply disabled with a pointer to this document.

## GitHub (device flow)

1. Open <https://github.com/settings/developers> → **New OAuth App** (a personal account is fine).
2. Fill in any name and homepage; set **Authorization callback URL** to `http://127.0.0.1` (device flow never uses the callback, but the field is required).
3. After creating the app, open its settings and check **Enable Device Flow**.
4. Copy the **Client ID** into `SAGEPORT_GITHUB_CLIENT_ID`. No client secret is needed.

During authorization the app shows a one-time code that the user enters at <https://github.com/login/device>. The only requested scope is `gist`.

## Google (desktop app + PKCE)

1. Open <https://console.cloud.google.com/>, create a project, and enable the **Google Drive API**.
2. Under **APIs & Services → OAuth consent screen**, choose External, fill in the basics, and add the scopes `.../auth/drive.appdata`, `openid`, and `email`.
   - While the app is in Testing status, each user's Google account must be added under **Test users** (limit 100); public release requires Google's verification review.
3. Under **Credentials → Create Credentials → OAuth client ID**, choose the **Desktop app** type.
4. Copy the client ID and client secret into `SAGEPORT_GOOGLE_CLIENT_ID` / `SAGEPORT_GOOGLE_CLIENT_SECRET`.
   - Google always issues a client secret for the Desktop type, but the [official docs state it is not treated as confidential](https://developers.google.com/identity/protocols/oauth2/native-app); compiling it into the client is standard practice.

Backups are stored in Drive's `appDataFolder`, a hidden app-scoped space where the app can only access data it created itself.

## Microsoft (public client + PKCE)

1. Open <https://entra.microsoft.com/> → **App registrations → New registration**.
2. For **Supported account types**, choose *Accounts in any organizational directory and personal Microsoft accounts* (covers both personal and business OneDrive).
3. For **Redirect URI**, choose the **Mobile and desktop applications** type and enter `http://localhost` (Entra accepts any port on localhost).
4. On the **Authentication** page, confirm *Allow public client flows* is **Yes**.
5. Under **API permissions**, add the Microsoft Graph delegated permissions `Files.ReadWrite.AppFolder`, `User.Read`, and `offline_access`.
6. Copy the **Application (client) ID** into `SAGEPORT_MS_CLIENT_ID`. No client secret is needed.

Backups are stored in the user's OneDrive under `Apps/Sageport` (Graph `special/approot`).

## Security notes

- Every backup is end-to-end encrypted locally with the user's passphrase (Argon2id + AES-256-GCM) before upload; the cloud only ever sees ciphertext.
- OAuth tokens live only in the local database under the `sync.*` settings prefix and are never included in backups (see `EXCLUDED_SETTINGS_PREFIXES` in `src-tauri/src/sync/mod.rs`).
- Google and Microsoft use the system browser with a loopback port and PKCE (the RFC 8252 recommendation for native apps); GitHub uses the device flow. Authorization-code exchanges happen entirely in the Rust process, so tokens never pass through the WebView.
