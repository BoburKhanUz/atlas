import 'package:material_ui/material_ui.dart';

import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/coming_soon.dart';

class StylistScreen extends StatelessWidget {
  const StylistScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const AtlasPage(
      title: 'Stilist',
      body: ComingSoonView(
        icon: Icons.auto_awesome_outlined,
        title: 'AI stilist',
        message: 'Shaxsiy stilistingiz bilan suhbat shu yerda bo‘ladi.',
      ),
    );
  }
}
