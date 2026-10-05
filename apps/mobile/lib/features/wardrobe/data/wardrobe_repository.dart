import 'package:atlas_api/atlas_api.dart' show Detection, WardrobeItem;
import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import 'upload_job.dart';

/// Wardrobe categories of the list filter (contract enum, `all` = no filter).
const wardrobeCategories = ['all', 'outerwear', 'shirt', 'pants', 'dress', 'shoes', 'bag', 'accessory'];

class WardrobePage {
  const WardrobePage(this.items, this.nextCursor);
  final List<WardrobeItem> items;
  final String? nextCursor;
}

class UploadResult {
  const UploadResult({required this.item, required this.detection, required this.replayed});
  final WardrobeItem item;
  final Detection detection;

  /// `Idempotent-Replayed: true`: the server had already processed this key.
  final bool replayed;
}

/// Wardrobe operations of docs/api/openapi.json through the generated client.
/// Every method throws `ApiFailure` on failure.
class WardrobeRepository {
  WardrobeRepository(this._client);
  final AtlasApiClient _client;

  static const pageSize = 30;

  Future<WardrobePage> list({String category = 'all', String? cursor}) async {
    final r = await _client.call(
      (api) => api.getWardrobeApi().listWardrobeItems(
        category: category == 'all' ? null : category,
        limit: pageSize,
        cursor: cursor,
      ),
    );
    return WardrobePage(r.items.toList(), r.nextCursor);
  }

  Future<WardrobeItem> get(String id) async =>
      (await _client.call((api) => api.getWardrobeApi().getWardrobeItem(id: id))).item;

  Future<void> delete(String id) => _client.call((api) => api.getWardrobeApi().deleteWardrobeItem(id: id));

  /// POST /api/v1/wardrobe/items: multipart `file` (the job's exact bytes and
  /// file name) with the job's Idempotency-Key. Never retried here on network
  /// errors (the caller retries the same job).
  Future<UploadResult> upload(UploadJob job, {ProgressCallback? onSendProgress, CancelToken? cancelToken}) async {
    final response = await _client.callResponse(
      (api) => api.getWardrobeApi().createWardrobeItem(
        file: MultipartFile.fromBytes(
          job.image.bytes,
          filename: job.image.filename,
          contentType: DioMediaType('image', 'jpeg'),
        ),
        idempotencyKey: job.idempotencyKey,
        onSendProgress: onSendProgress,
        cancelToken: cancelToken,
      ),
    );
    final body = response.data!;
    return UploadResult(
      item: body.item,
      detection: body.detection,
      replayed: response.headers.value('idempotent-replayed') == 'true',
    );
  }
}
