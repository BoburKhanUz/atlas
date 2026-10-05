import 'package:material_ui/material_ui.dart';

import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/coming_soon.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const AtlasPage(
      title: 'Profil',
      body: ComingSoonView(
        icon: Icons.person_outline_rounded,
        title: 'Profilingiz',
        message: 'Uslub afzalliklari, rang profili va hisob sozlamalari shu yerda bo‘ladi.',
      ),
    );
  }
}
