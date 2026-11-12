import {
  DatabaseBackup,
  FileCog,
  Rocket,
  ScrollText,
  Server,
} from "lucide-react";
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
      {
        type: "localCommand",
        cwd: "~/project",
        command: "pnpm build",
      },
      {
        type: "upload",
        localPath: "~/project/dist",
        remotePath: "/var/www/myapp",
      },
      { type: "remoteCommand", command: "sudo systemctl reload nginx" },
    ],
  },
  {
    id: "backendDeploy",
    icon: Server,
    nameKey: "tasks.template.backendDeploy.name",
    summaryKey: "tasks.template.backendDeploy.summary",
    steps: [
      {
        type: "localCommand",
        cwd: "~/project",
        command: "mvn clean package -DskipTests",
      },
      {
        type: "upload",
        localPath: "~/project/target/myapp.jar",
        remotePath: "/opt/myapp/myapp.jar",
      },
      { type: "remoteCommand", command: "sudo systemctl restart myapp" },
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
        command:
          'backup=$(mktemp /tmp/mydb.XXXXXX.dump) && if pg_dump -Fc -f "$backup" mydb; then mv -f -- "$backup" /tmp/mydb.dump; else rm -f -- "$backup"; exit 1; fi',
      },
      {
        type: "localCommand",
        command:
          'mkdir -p ~/backups && if [ -f ~/backups/mydb.dump ]; then mv -- ~/backups/mydb.dump ~/backups/"mydb.$(date -u +%Y%m%dT%H%M%SZ).$$.dump"; fi',
      },
      {
        type: "download",
        remotePath: "/tmp/mydb.dump",
        localPath: "~/backups/mydb.dump",
      },
    ],
  },
  {
    id: "configDeploy",
    icon: FileCog,
    nameKey: "tasks.template.configDeploy.name",
    summaryKey: "tasks.template.configDeploy.summary",
    steps: [
      {
        type: "upload",
        localPath: "~/config",
        remotePath: "/etc/myapp",
      },
      { type: "remoteCommand", command: "sudo systemctl reload myapp" },
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
        command: "tar -czf /tmp/logs.tar.gz -C /var/log myapp",
      },
      { type: "localCommand", command: "mkdir -p ~/logs" },
      {
        type: "download",
        remotePath: "/tmp/logs.tar.gz",
        localPath: "~/logs/myapp-logs.tar.gz",
      },
      {
        type: "localCommand",
        command: "tar -xzf ~/logs/myapp-logs.tar.gz -C ~/logs",
      },
    ],
  },
];
