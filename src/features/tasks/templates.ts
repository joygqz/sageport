import { DatabaseBackup, FileCog, Rocket, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { TKey } from "@/i18n";
import type { TaskStep } from "@/types/models";

export interface TaskTemplate {
  id: string;
  icon: LucideIcon;
  nameKey: TKey;
  summaryKey: TKey;
  steps: TaskStep[];
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "frontendDeploy",
    icon: Rocket,
    nameKey: "tasks.template.frontendDeploy.name",
    summaryKey: "tasks.template.frontendDeploy.summary",
    steps: [
      { type: "localCommand", cwd: "{{projectDir:~/project}}", command: "pnpm build" },
      { type: "upload", localPath: "./dist", remotePath: "/var/www/{{app}}" },
      { type: "remoteCommand", command: "sudo systemctl reload nginx" },
    ],
  },
  {
    id: "databaseBackup",
    icon: DatabaseBackup,
    nameKey: "tasks.template.databaseBackup.name",
    summaryKey: "tasks.template.databaseBackup.summary",
    steps: [
      {
        type: "remoteCommand",
        command: "pg_dump {{database}} | gzip > /tmp/{{database}}.sql.gz",
      },
      {
        type: "download",
        remotePath: "/tmp/{{database}}.sql.gz",
        localPath: "~/backups/{{database}}.sql.gz",
      },
    ],
  },
  {
    id: "configDeploy",
    icon: FileCog,
    nameKey: "tasks.template.configDeploy.name",
    summaryKey: "tasks.template.configDeploy.summary",
    steps: [
      { type: "upload", localPath: "./config", remotePath: "/etc/{{app}}" },
      { type: "remoteCommand", command: "sudo systemctl reload {{service}}" },
    ],
  },
  {
    id: "collectLogs",
    icon: ScrollText,
    nameKey: "tasks.template.collectLogs.name",
    summaryKey: "tasks.template.collectLogs.summary",
    steps: [
      {
        type: "remoteCommand",
        command: "tar -czf /tmp/logs.tar.gz -C /var/log {{service}}",
      },
      {
        type: "download",
        remotePath: "/tmp/logs.tar.gz",
        localPath: "~/logs/{{app}}-logs.tar.gz",
      },
      {
        type: "localCommand",
        command: "tar -xzf ~/logs/{{app}}-logs.tar.gz -C ~/logs",
      },
    ],
  },
];
