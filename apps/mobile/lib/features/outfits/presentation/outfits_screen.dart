import 'package:material_ui/material_ui.dart';

import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/coming_soon.dart';

class OutfitsScreen extends StatelessWidget {
  const OutfitsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const AtlasPage(
      title: 'Obrazlar',
      body: ComingSoonView(
        icon: Icons.style_outlined,
        title: 'Obrazlar',
        message: 'Tavsiya etilgan va saqlangan obrazlaringiz shu yerda bo‘ladi.',
      ),
    );
  }
}
