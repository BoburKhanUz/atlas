// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'profile_row.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ProfileRow extends ProfileRow {
  @override
  final String id;
  @override
  final String userId;

  factory _$ProfileRow([void Function(ProfileRowBuilder)? updates]) => (ProfileRowBuilder()..update(updates))._build();

  _$ProfileRow._({required this.id, required this.userId}) : super._();
  @override
  ProfileRow rebuild(void Function(ProfileRowBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  ProfileRowBuilder toBuilder() => ProfileRowBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ProfileRow && id == other.id && userId == other.userId;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, userId.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ProfileRow')
          ..add('id', id)
          ..add('userId', userId))
        .toString();
  }
}

class ProfileRowBuilder implements Builder<ProfileRow, ProfileRowBuilder> {
  _$ProfileRow? _$v;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  String? _userId;
  String? get userId => _$this._userId;
  set userId(String? userId) => _$this._userId = userId;

  ProfileRowBuilder() {
    ProfileRow._defaults(this);
  }

  ProfileRowBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _id = $v.id;
      _userId = $v.userId;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ProfileRow other) {
    _$v = other as _$ProfileRow;
  }

  @override
  void update(void Function(ProfileRowBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ProfileRow build() => _build();

  _$ProfileRow _build() {
    final _$result =
        _$v ??
        _$ProfileRow._(
          id: BuiltValueNullFieldError.checkNotNull(id, r'ProfileRow', 'id'),
          userId: BuiltValueNullFieldError.checkNotNull(userId, r'ProfileRow', 'userId'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
