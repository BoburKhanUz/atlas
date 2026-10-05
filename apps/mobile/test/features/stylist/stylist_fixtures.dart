Map<String, Object?> chatJson(
  String conversationId, {
  String answer = 'Ko‘k shim va oq ko‘ylak mos keladi.',
  int items = 6,
  bool weather = false,
  bool event = false,
}) => {
  'conversationId': conversationId,
  'assistantMessage': answer,
  'contextSummary': {'wardrobeItemCount': items, 'weatherProvided': weather, 'eventProvided': event},
};

Map<String, Object?> conversationJson(String id, List<(String, String)> messages, {String? title = 'Bugun ishga'}) => {
  'conversation': {
    'id': id,
    'title': title,
    'createdAt': '2026-10-05T10:00:00.000Z',
    'updatedAt': '2026-10-05T10:05:00.000Z',
    'messages': [
      for (final (i, (role, content)) in messages.indexed)
        {'id': 'm$i', 'role': role, 'content': content, 'createdAt': '2026-10-05T10:0$i:00.000Z'},
    ],
  },
};

Map<String, Object?> conversationsJson(List<String> ids) => {
  'conversations': [
    for (final id in ids)
      {
        'id': id,
        'title': 'Suhbat $id',
        'lastMessage': 'Oxirgi xabar $id',
        'lastRole': 'assistant',
        'updatedAt': '2026-10-05T10:00:00.000Z',
      },
  ],
};
