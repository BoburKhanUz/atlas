import 'package:atlas_api/atlas_api.dart' show LegalConsentRequest, LegalDocumentIdEnum;
import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';

/// The two documents of `GET /api/v1/legal`.
enum LegalDocumentKind {
  privacy('Maxfiylik siyosati'),
  terms('Foydalanish shartlari');

  const LegalDocumentKind(this.label);

  /// Shown before the document has loaded (links, app bar).
  final String label;

  static LegalDocumentKind? fromWire(LegalDocumentIdEnum id) => switch (id) {
    LegalDocumentIdEnum.privacy => LegalDocumentKind.privacy,
    LegalDocumentIdEnum.terms => LegalDocumentKind.terms,
    _ => null,
  };
}

@immutable
class LegalSectionData {
  const LegalSectionData({required this.heading, required this.paragraphs});

  final String heading;

  /// A paragraph starting with [listItemPrefix] is a list item.
  final List<String> paragraphs;

  static const listItemPrefix = '• ';
}

@immutable
class LegalDocumentData {
  const LegalDocumentData({required this.title, required this.sections});

  final String title;
  final List<LegalSectionData> sections;
}

/// The current privacy policy and terms of use. Registration sends
/// [version] back as the accepted one.
@immutable
class LegalBundle {
  const LegalBundle({required this.version, required this.effectiveDate, required this.draft, required this.documents});

  final String version;

  /// `YYYY-MM-DD`.
  final String effectiveDate;

  /// Not yet reviewed by counsel (the screens say so).
  final bool draft;
  final Map<LegalDocumentKind, LegalDocumentData> documents;
}

/// GET /api/v1/legal (public, no session needed), and the signed-in user's
/// consent to the current texts. Throws `ApiFailure`.
class LegalRepository {
  LegalRepository(this._client);
  final AtlasApiClient _client;

  Future<LegalBundle> get() async {
    final r = await _client.call((api) => api.getLegalApi().getLegalDocuments());
    return LegalBundle(
      version: r.version,
      effectiveDate: r.effectiveDate,
      draft: r.draft,
      documents: {
        for (final d in r.documents)
          ?LegalDocumentKind.fromWire(d.id): LegalDocumentData(
            title: d.title,
            sections: [
              for (final s in d.sections) LegalSectionData(heading: s.heading, paragraphs: s.paragraphs.toList()),
            ],
          ),
      },
    );
  }

  /// Whether the texts changed since the user accepted them (GET /api/v1/auth/me).
  Future<bool> consentRequired() async => (await _client.call((api) => api.getAuthApi().getMe())).consentRequired;

  /// POST /api/v1/legal/consent: the user accepts [version] (the current
  /// texts) and confirms being 18 or older.
  Future<void> accept({required String version}) => _client.callVoid(
    (api) => api.getLegalApi().acceptLegalDocuments(
      legalConsentRequest: LegalConsentRequest(
        (b) => b
          ..acceptedLegalVersion = version
          ..ageConfirmed = true,
      ),
    ),
  );
}
