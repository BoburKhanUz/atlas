import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../data/legal_repository.dart' show LegalDocumentKind;

/// A required checkbox of a consent form (registration, changed legal texts):
/// validation fails until it is ticked. [title] replaces the plain [label]
/// (which stays the accessible name), e.g. with [LegalConsentLabel].
class ConsentCheckboxField extends FormField<bool> {
  ConsentCheckboxField({
    super.key,
    required String label,
    required String requiredMessage,
    Widget? title,
    ValueChanged<bool>? onChanged,
    super.enabled,
  }) : super(
         initialValue: false,
         validator: (v) => v == true ? null : requiredMessage,
         builder: (field) => CheckboxListTile(
           value: field.value ?? false,
           onChanged: field.widget.enabled
               ? (v) {
                   field.didChange(v ?? false);
                   onChanged?.call(v ?? false);
                 }
               : null,
           title: title ?? Text(label),
           subtitle: field.errorText == null
               ? null
               : Text(field.errorText!, style: const TextStyle(color: AtlasColors.error)),
           controlAffinity: ListTileControlAffinity.leading,
           contentPadding: EdgeInsets.zero,
           visualDensity: VisualDensity.compact,
         ),
       );
}

/// "Foydalanish shartlari va Maxfiylik siyosatiga roziman" with both
/// documents as links (keys `<keyPrefix>.terms`, `<keyPrefix>.privacy`).
class LegalConsentLabel extends StatelessWidget {
  const LegalConsentLabel({super.key, required this.keyPrefix, required this.onOpen});

  final String keyPrefix;
  final ValueChanged<LegalDocumentKind> onOpen;

  @override
  Widget build(BuildContext context) {
    final style = DefaultTextStyle.of(context).style;
    InlineSpan link(LegalDocumentKind kind) => WidgetSpan(
      alignment: PlaceholderAlignment.baseline,
      baseline: TextBaseline.alphabetic,
      child: Semantics(
        link: true,
        child: GestureDetector(
          key: Key('$keyPrefix.${kind.name}'),
          behavior: HitTestBehavior.opaque,
          onTap: () => onOpen(kind),
          child: Text(
            kind.label,
            style: style.copyWith(
              color: AtlasColors.accent,
              fontWeight: FontWeight.w700,
              decoration: TextDecoration.underline,
              decorationColor: AtlasColors.accent.withValues(alpha: 0.4),
            ),
          ),
        ),
      ),
    );
    return Text.rich(
      TextSpan(
        children: [
          link(LegalDocumentKind.terms),
          const TextSpan(text: ' va '),
          link(LegalDocumentKind.privacy),
          const TextSpan(text: 'ga roziman'),
        ],
      ),
    );
  }
}
