import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';

/// A required checkbox of a consent form (registration, changed legal texts):
/// validation fails until it is ticked.
class ConsentCheckboxField extends FormField<bool> {
  ConsentCheckboxField({
    super.key,
    required String label,
    required String requiredMessage,
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
           title: Text(label),
           subtitle: field.errorText == null
               ? null
               : Text(field.errorText!, style: const TextStyle(color: AtlasColors.error)),
           controlAffinity: ListTileControlAffinity.leading,
           contentPadding: EdgeInsets.zero,
         ),
       );
}
