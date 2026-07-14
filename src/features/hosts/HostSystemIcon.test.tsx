import { describe, expect, it } from "vitest";

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
