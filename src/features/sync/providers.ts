import type { ComponentType, SVGProps } from "react";
import { Database, Globe } from "lucide-react";

import type { TKey } from "@/i18n";
import type { SyncProviderKind } from "@/types/models";
import { GdriveIcon, GithubIcon, OnedriveIcon } from "./icons";

export interface SyncProviderMeta {
  kind: SyncProviderKind;

  name: string;
  taglineKey: TKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;

  oauth: boolean;
}

export const SYNC_PROVIDERS: SyncProviderMeta[] = [
  {
    kind: "gist",
    name: "GitHub Gist",
    taglineKey: "settings.sync.provider.gistTagline",
    icon: GithubIcon,
    oauth: true,
  },
  {
    kind: "gdrive",
    name: "Google Drive",
    taglineKey: "settings.sync.provider.gdriveTagline",
    icon: GdriveIcon,
    oauth: true,
  },
  {
    kind: "onedrive",
    name: "Microsoft OneDrive",
    taglineKey: "settings.sync.provider.onedriveTagline",
    icon: OnedriveIcon,
    oauth: true,
  },
  {
    kind: "webdav",
    name: "WebDAV",
    taglineKey: "settings.sync.provider.webdavTagline",
    icon: Globe,
    oauth: false,
  },
  {
    kind: "s3",
    name: "S3",
    taglineKey: "settings.sync.provider.s3Tagline",
    icon: Database,
    oauth: false,
  },
];

export function providerMeta(kind: SyncProviderKind): SyncProviderMeta {
  const meta = SYNC_PROVIDERS.find((p) => p.kind === kind);
  if (!meta) throw new Error(`unknown sync provider: ${kind}`);
  return meta;
}
