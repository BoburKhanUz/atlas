import 'package:material_ui/material_ui.dart';

import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/coming_soon.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const AtlasPage(
      title: 'Bugun',
      body: ComingSoonView(
        icon: Icons.wb_sunny_outlined,
        title: 'Kunlik tavsiyalar',
        message: 'Ob-havo va garderobingiz asosidagi obrazlar shu yerda bo‘ladi.',
      ),
    );
  }
}
