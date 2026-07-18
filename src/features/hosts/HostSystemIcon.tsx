import { lazy, Suspense, type SVGProps } from "react";
import { Server } from "lucide-react";

import { cn } from "@/lib/utils";
import { PANEL_LIST_ICON_CLASS } from "@/workbench/PanelHeader";
import { detectHostSystem, type HostSystem } from "./hostSystem";

const HostBrandIcon = lazy(() =>
  import("./HostBrandIcon").then((module) => ({
    default: module.HostBrandIcon,
  })),
);

const BRAND_SYSTEMS = new Set<HostSystem>([
  "alibaba",
  "alma",
  "alpine",
  "apple",
  "arch",
  "centos",
  "debian",
  "deepin",
  "euleros",
  "fedora",
  "freebsd",
  "gentoo",
  "harmonyos",
  "kali",
  "linux",
  "mint",
  "manjaro",
  "nixos",
  "openeuler",
  "opensuse",
  "redhat",
  "rocky",
  "suse",
  "ubuntu",
]);

const CUSTOM_MARKS: Partial<
  Record<HostSystem, { label: string; color: string; title: string }>
> = {
  anolis: { label: "AO", color: "#ff6a00", title: "Anolis OS" },
  aosc: { label: "A", color: "#3b6ea8", title: "AOSC OS" },
  bclinux: { label: "BC", color: "#2e8b57", title: "BCLinux" },
  ctyunos: { label: "CT", color: "#1677ff", title: "CTyunOS" },
  kylin: { label: "KY", color: "#c9152d", title: "Kylin OS" },
  kylinsec: { label: "KS", color: "#9f1425", title: "KylinSec OS" },
  lingmo: { label: "LM", color: "#5b5fe8", title: "Lingmo OS" },
  loongnix: { label: "LN", color: "#b51f2e", title: "Loongnix" },
  opencloudos: { label: "OC", color: "#0052d9", title: "OpenCloudOS" },
  openkylin: { label: "oK", color: "#5d3fd3", title: "openKylin" },
  redflag: { label: "RF", color: "#d71920", title: "Red Flag Linux" },
  tencentos: { label: "TS", color: "#006eff", title: "TencentOS Server" },
  uos: { label: "UOS", color: "#245bdb", title: "UnionTech OS" },
};

function SystemLettermark({
  label,
  color,
  title,
}: {
  label: string;
  color: string;
  title: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" role="img">
      <title>{title}</title>
      <rect width="24" height="24" rx="6" fill={color} />
      <text
        x="12"
        y="12.4"
        fill="white"
        fontFamily="Inter, sans-serif"
        fontSize={label.length > 2 ? 7 : 9}
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {label}
      </text>
    </svg>
  );
}

function WindowsLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M2 4.1 10.2 3v8.1H2V4.1Zm9.2-1.25L22 1.4v9.7H11.2V2.85ZM2 12.1h8.2v8.1L2 19.1v-7Zm9.2 0H22v9.7l-10.8-1.45V12.1Z" />
    </svg>
  );
}

export function HostSystemIcon({ os }: { os: string | null | undefined }) {
  const system = detectHostSystem(os);
  const branded = BRAND_SYSTEMS.has(system);
  const customMark = CUSTOM_MARKS[system];

  return (
    <div
      className={cn(
        PANEL_LIST_ICON_CLASS,
        "relative",
        (branded || customMark) && "bg-card",
        system === "apple" && "text-foreground/80",
        system === "windows" && "bg-sky-500/10 text-[#00A4EF]",
      )}
    >
      {branded ? (
        <Suspense
          fallback={<Server className="size-4 text-muted-foreground" />}
        >
          <HostBrandIcon system={system} title={os?.trim() || system} />
        </Suspense>
      ) : customMark ? (
        <SystemLettermark {...customMark} />
      ) : system === "windows" ? (
        <WindowsLogo className="size-[18px]" aria-label={os ?? "Windows"} />
      ) : (
        <Server className="size-4" strokeWidth={1.7} />
      )}
    </div>
  );
}
