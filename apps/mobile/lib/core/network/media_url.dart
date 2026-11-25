/// Signed media URLs (`/api/v1/media/…?exp=…&sig=…`) come with
/// `urlExpiresAt`. They are public until they expire and must never be
/// persisted or logged; when one is (nearly) expired, reload the item to get
/// a fresh URL instead of reusing it.
abstract final class SignedMediaUrl {
  /// URLs closer than this to expiry are treated as expired (time to load
  /// the image).
  static const safetyMargin = Duration(seconds: 60);

  /// [urlExpiresAt] is the server's time, so it is compared with the
  /// server's clock: the device clock plus [serverClockOffset] (server time −
  /// device time, measured on authentication answers). A wrong device clock
  /// would otherwise make every fresh URL look expired.
  static bool isUsable(DateTime urlExpiresAt, {DateTime? now, Duration serverClockOffset = Duration.zero}) =>
      (now ?? DateTime.now()).toUtc().add(serverClockOffset).add(safetyMargin).isBefore(urlExpiresAt.toUtc());
}
