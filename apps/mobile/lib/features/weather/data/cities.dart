import 'location.dart';

/// A city the user can choose instead of device location. Coordinates are
/// public city centres (already rounded), never the user's position.
class City {
  const City(this.id, this.name, this._lat, this._lon);
  final String id;
  final String name;
  final double _lat;
  final double _lon;

  RoundedLocation get location => RoundedLocation.round(_lat, _lon)!;

  @override
  String toString() => 'City($id)';
}

/// Regional centres of Uzbekistan (no geocoding service is used).
abstract final class Cities {
  static const all = [
    City('tashkent', 'Toshkent', 41.31, 69.28),
    City('samarkand', 'Samarqand', 39.65, 66.96),
    City('bukhara', 'Buxoro', 39.77, 64.42),
    City('andijan', 'Andijon', 40.78, 72.34),
    City('namangan', 'Namangan', 41.00, 71.67),
    City('fergana', 'Farg‘ona', 40.39, 71.78),
    City('nukus', 'Nukus', 42.46, 59.60),
    City('karshi', 'Qarshi', 38.86, 65.79),
    City('termez', 'Termiz', 37.22, 67.28),
    City('jizzakh', 'Jizzax', 40.12, 67.84),
    City('gulistan', 'Guliston', 40.49, 68.78),
    City('navoi', 'Navoiy', 40.10, 65.38),
    City('urgench', 'Urganch', 41.55, 60.63),
  ];

  static City? byId(String? id) => all.where((c) => c.id == id).firstOrNull;
}
