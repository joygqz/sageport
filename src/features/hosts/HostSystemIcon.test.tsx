import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HostBrandIcon } from "./HostBrandIcon";
import { HostSystemIcon } from "./HostSystemIcon";
import { detectHostSystem } from "./hostSystem";

describe("detectHostSystem", () => {
  it.each([
    ["Ubuntu 24.04.2 LTS", "ubuntu"],
    ["Debian GNU/Linux 12 (bookworm)", "debian"],
    ["CentOS Stream 9", "centos"],
    ["Red Hat Enterprise Linux 9.5", "redhat"],
    ["Rocky Linux 9.5", "rocky"],
    ["AlmaLinux 9.5", "alma"],
    ["Fedora Linux 41", "fedora"],
    ["Alpine Linux v3.21", "alpine"],
    ["Arch Linux", "arch"],
    ["openSUSE Tumbleweed", "opensuse"],
    ["openEuler 24.03 (LTS-SP1)", "openeuler"],
    ["openEuler 22.03 LTS", "openeuler"],
    ["EulerOS 2.0 (SP10)", "euleros"],
    ["deepin 23", "deepin"],
    ["UnionTech OS Server 20 Enterprise", "uos"],
    ["openKylin 2.0", "openkylin"],
    ["Kylin Linux Advanced Server V10", "kylin"],
    ["NeoKylin Linux Advanced Server V7", "kylin"],
    ["Ubuntu Kylin 24.04", "kylin"],
    ["Anolis OS 8.9", "anolis"],
    ["Alibaba Cloud Linux 3.2104", "alibaba"],
    ["OpenCloudOS 9.4", "opencloudos"],
    ["TencentOS Server 3.2", "tencentos"],
    ["Loongnix Server 8.4", "loongnix"],
    ["BigCloud Enterprise Linux 8.2", "bclinux"],
    ["CTyunOS 3", "ctyunos"],
    ["AOSC OS", "aosc"],
    ["Lingmo OS 2.0", "lingmo"],
    ["OpenHarmony 5.0", "harmonyos"],
    ["FreeBSD 14.2", "freebsd"],
    ["macOS 15.3", "apple"],
    ["Windows Server 2025", "windows"],
    ["Linux", "linux"],
    [null, "unknown"],
  ] as const)("maps %s to %s", (value, expected) => {
    expect(detectHostSystem(value)).toBe(expected);
  });
});

describe("HostSystemIcon", () => {
  it("keeps brand icons on the theme card background", () => {
    const html = renderToStaticMarkup(<HostSystemIcon os="NixOS 25.05" />);

    expect(html).toContain("bg-card");
    expect(html).not.toContain("bg-white");
  });

  it.each([
    ["alma", "AlmaLinux 9.6"],
    ["alpine", "Alpine Linux 3.22"],
    ["arch", "Arch Linux"],
    ["centos", "CentOS Stream 10"],
    ["debian", "Debian 13"],
    ["deepin", "deepin 25"],
    ["euleros", "EulerOS 2.0"],
    ["freebsd", "FreeBSD 14.3"],
    ["gentoo", "Gentoo Linux"],
    ["harmonyos", "OpenHarmony 5"],
    ["kali", "Kali Linux"],
    ["nixos", "NixOS 25.05"],
    ["openeuler", "openEuler 24.03"],
    ["redhat", "Red Hat Enterprise Linux 10"],
    ["suse", "SUSE Linux Enterprise Server 15"],
    ["ubuntu", "Ubuntu 25.04"],
  ] as const)("uses the theme link color for the %s icon", (system, title) => {
    const html = renderToStaticMarkup(
      <HostBrandIcon system={system} title={title} />,
    );

    expect(html).toContain('fill="currentColor"');
    expect(html).toContain("dark:text-link");
  });

  it("keeps high-contrast brand colors in dark themes", () => {
    const html = renderToStaticMarkup(
      <HostBrandIcon system="fedora" title="Fedora Linux 42" />,
    );

    expect(html).toContain('fill="#51A2DA"');
    expect(html).not.toContain("dark:text-link");
  });
});
