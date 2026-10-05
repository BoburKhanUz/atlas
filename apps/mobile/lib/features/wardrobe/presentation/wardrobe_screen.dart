import 'package:material_ui/material_ui.dart';

import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/coming_soon.dart';

class WardrobeScreen extends StatelessWidget {
  const WardrobeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const AtlasPage(
      title: 'Garderob',
      body: ComingSoonView(
        icon: Icons.checkroom_outlined,
        title: 'Kiyimlaringiz',
        message: 'Kiyim qo‘shish, AI tahlili va kiyimlar ro‘yxati shu yerda bo‘ladi.',
      ),
    );
  }
}
