import 'dart:io' show InternetAddress, InternetAddressType;

/// Hosts a release / production build must never talk to: loopback,
/// private, link-local, unspecified and local-only names. Public hosts —
/// names and public IP literals — are allowed.
abstract final class HostPolicy {
  static bool isLocalOrPrivate(String host) {
    var h = host.toLowerCase().trim();
    // `localhost.` and `127.0.0.1.` resolve like their dotless forms.
    while (h.endsWith('.')) {
      h = h.substring(0, h.length - 1);
    }
    if (h.isEmpty) return true;
    final address = InternetAddress.tryParse(h.startsWith('[') && h.endsWith(']') ? h.substring(1, h.length - 1) : h);
    if (address != null) {
      return address.type == InternetAddressType.IPv4 ? _privateV4(address.rawAddress) : _privateV6(address.rawAddress);
    }
    // Non-canonical IPv4 literals (`127.1`, `0x7f.0.0.1`, `2130706433`) are
    // accepted by resolvers but not by the parser above: refuse them. Real
    // DNS names end in an alphabetic top-level label.
    if (RegExp(r'^(0x[0-9a-f]*|[0-9]+)$').hasMatch(h.split('.').last)) return true;
    // Names that only resolve locally.
    return h == 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || !h.contains('.');
  }

  static bool _privateV4(List<int> b) =>
      b[0] == 0 || // 0.0.0.0/8 (unspecified, "this network")
      b[0] == 10 || // 10.0.0.0/8
      b[0] == 127 || // 127.0.0.0/8 loopback
      (b[0] == 100 && b[1] >= 64 && b[1] <= 127) || // 100.64.0.0/10 carrier-grade NAT
      (b[0] == 169 && b[1] == 254) || // 169.254.0.0/16 link-local
      (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || // 172.16.0.0/12
      (b[0] == 192 && b[1] == 168); // 192.168.0.0/16

  static bool _privateV6(List<int> b) {
    final allZeroExceptLast = b.sublist(0, 15).every((x) => x == 0);
    if (allZeroExceptLast && (b[15] == 0 || b[15] == 1)) return true; // :: and ::1
    if ((b[0] & 0xfe) == 0xfc) return true; // fc00::/7 unique local
    if (b[0] == 0xfe && (b[1] & 0xc0) == 0x80) return true; // fe80::/10 link-local
    if (b[0] == 0xfe && (b[1] & 0xc0) == 0xc0) return true; // fec0::/10 site-local (deprecated)
    // ::ffff:a.b.c.d (IPv4-mapped): judge the IPv4 address.
    final mapped = b.sublist(0, 10).every((x) => x == 0) && b[10] == 0xff && b[11] == 0xff;
    return mapped && _privateV4(b.sublist(12));
  }
}
