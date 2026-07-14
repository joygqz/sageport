# Terms of Service

Effective date: 2026-07-04

Please read these terms carefully before using Sageport. By installing, running, or otherwise using Sageport (the "Application"), you agree to be bound by them.

## 1. About the Application

Sageport is an open-source desktop SSH workbench that integrates a terminal, SFTP file transfer, host and credential management, command snippets, port forwarding, and an optional AI assistant. The Application is open source under [GPL-3.0-only](https://github.com/joygqz/sageport/blob/main/LICENSE); its source code is available for inspection and modification in the [GitHub repository](https://github.com/joygqz/sageport).

## 2. License to use

Subject to the terms of the GPL-3.0-only license, you may freely download, install, use, copy, modify, and distribute the Application. The specific terms of GPL-3.0-only govern, as set out in the [LICENSE](https://github.com/joygqz/sageport/blob/main/LICENSE) file; in the event of any conflict between this document and the LICENSE file, the LICENSE file controls.

## 3. Your responsibilities

By using the Application, you agree to:

- Connect only to servers and systems you are authorized to access, and comply with the policies of those systems' owners and all applicable laws.
- Safeguard the passwords, private keys, passphrases, and third-party credentials (API keys, sync provider authorizations, etc.) you store in the Application; you are responsible for any loss resulting from their compromise.
- Review AI-proposed operations before approving them in the default supervised mode. If you enable Autonomous mode, AI-generated operations may execute without individual prompts; AI output can contain errors or inappropriate actions, and you remain solely responsible for its consequences.
- Remember the passphrase you set when enabling Sync — losing it makes previously synced data permanently unrecoverable, and neither the Application nor the developer can recover it for you.
- Comply with the terms of service of any third-party service you connect to or authorize through the Application (GitHub, Google Drive, Microsoft OneDrive, WebDAV/S3 providers, AI providers, etc.).

## 4. Third-party services

Some features of the Application rely on third-party services that you choose, configure, or authorize yourself, including but not limited to:

- GitHub Gist, Google Drive, Microsoft OneDrive, WebDAV, and S3-compatible storage used for Sync & backup;
- Anthropic or any OpenAI-compatible endpoint used by the AI assistant;
- GitHub Releases, used to check for updates.

These third-party services are operated independently by their respective providers, and their availability, behavior, and data handling are governed entirely by that provider's own terms and policies. The developer has no involvement in and bears no responsibility for the availability, accuracy, or consequences of any third-party service.

## 5. Disclaimer of warranties

The Application is provided "AS IS," without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement. The developer does not warrant that the Application will be error-free, uninterrupted, or fault-free in any environment.

To the maximum extent permitted by applicable law, the developer shall not be liable for any direct, indirect, incidental, special, or consequential damages arising from the use of, or inability to use, the Application, including but not limited to data loss, server misconfiguration, credential compromise, or data rendered unrecoverable due to a lost sync passphrase.

## 6. Free and open source

The Application is provided free of charge, with no advertising, in-app purchases, or sale of user data. You are free to review the source code to independently verify the privacy and security commitments described above.

## 7. Changes to these terms

The developer may update these terms from time to time. Updates will appear as changes to this file in the source repository, and the full history of changes is visible through Git commit history. Continued use of the Application after a change constitutes acceptance of the revised terms.

## 8. Contact

If you have questions about these terms, reach the developer via [GitHub Issues](https://github.com/joygqz/sageport/issues).
