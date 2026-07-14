export type HostSystem =
  | "alibaba"
  | "alma"
  | "alpine"
  | "anolis"
  | "aosc"
  | "apple"
  | "arch"
  | "bclinux"
  | "centos"
  | "ctyunos"
  | "debian"
  | "deepin"
  | "euleros"
  | "fedora"
  | "freebsd"
  | "gentoo"
  | "harmonyos"
  | "kali"
  | "kylin"
  | "kylinsec"
  | "linux"
  | "lingmo"
  | "loongnix"
  | "mint"
  | "manjaro"
  | "nixos"
  | "opencloudos"
  | "openeuler"
  | "openkylin"
  | "opensuse"
  | "redhat"
  | "redflag"
  | "rocky"
  | "suse"
  | "tencentos"
  | "ubuntu"
  | "uos"
  | "windows"
  | "unknown";

export function detectHostSystem(value: string | null | undefined): HostSystem {
  const os = value?.trim().toLowerCase() ?? "";

  if (os.includes("openeuler") || os.includes("open euler")) {
    return "openeuler";
  }
  if (os.includes("euleros") || os.includes("euler os")) return "euleros";
  if (os.includes("openkylin") || os.includes("open kylin")) {
    return "openkylin";
  }
  if (
    os.includes("kylinsec") ||
    os.includes("kylin sec") ||
    os.includes("麒麟信安")
  ) {
    return "kylinsec";
  }
  if (
    os.includes("neokylin") ||
    os.includes("ubuntu kylin") ||
    os.includes("kylin linux") ||
    os.includes("银河麒麟") ||
    os.includes("中标麒麟")
  ) {
    return "kylin";
  }
  if (os.includes("uniontech") || /\buos\b/.test(os) || os.includes("统信")) {
    return "uos";
  }
  if (os.includes("deepin") || os.includes("深度操作系统")) return "deepin";
  if (os.includes("opencloudos")) return "opencloudos";
  if (os.includes("tencentos") || os.includes("tencent os")) {
    return "tencentos";
  }
  if (os.includes("anolis os") || os.includes("openanolis")) return "anolis";
  if (os.includes("alibaba cloud linux") || /\balinux\b/.test(os)) {
    return "alibaba";
  }
  if (os.includes("loongnix")) return "loongnix";
  if (os.includes("bigcloud") || /\bbclinux\b/.test(os)) return "bclinux";
  if (os.includes("ctyunos") || os.includes("ctyun os")) return "ctyunos";
  if (os.includes("aosc os") || /\baosc\b/.test(os)) return "aosc";
  if (os.includes("lingmo os") || os.includes("lingmoos")) return "lingmo";
  if (os.includes("red flag linux") || os.includes("红旗 linux")) {
    return "redflag";
  }
  if (os.includes("openharmony") || os.includes("harmonyos")) {
    return "harmonyos";
  }
  if (os.includes("ubuntu")) return "ubuntu";
  if (os.includes("debian")) return "debian";
  if (os.includes("alma")) return "alma";
  if (os.includes("rocky")) return "rocky";
  if (os.includes("centos")) return "centos";
  if (os.includes("fedora")) return "fedora";
  if (os.includes("red hat") || /\brhel\b/.test(os)) return "redhat";
  if (os.includes("alpine")) return "alpine";
  if (os.includes("arch")) return "arch";
  if (os.includes("linux mint")) return "mint";
  if (os.includes("manjaro")) return "manjaro";
  if (os.includes("kali")) return "kali";
  if (os.includes("nixos") || os.includes("nix os")) return "nixos";
  if (os.includes("gentoo")) return "gentoo";
  if (os.includes("opensuse")) return "opensuse";
  if (/\bsuse\b/.test(os)) return "suse";
  if (os.includes("freebsd")) return "freebsd";
  if (
    os.includes("macos") ||
    os.includes("mac os") ||
    os.includes("darwin") ||
    os === "osx"
  ) {
    return "apple";
  }
  if (os.includes("windows") || os === "win") return "windows";
  if (os.includes("linux") || os.includes("unix")) return "linux";
  return "unknown";
}
