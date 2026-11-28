-- The stylist chat's conversations and messages
-- (apps/web/src/app/api/v1/stylist).

-- name: ConversationOfUser :one
-- A conversation, when it is the user's.
SELECT "id", "title", "createdAt", "updatedAt" FROM "AiConversation"
 WHERE "id" = sqlc.arg(id) AND "userId" = sqlc.arg(user_id);

-- name: WardrobeForStylist :many
-- The user's items as the stylist's context reads them: the oldest first.
-- The limit is above what a wardrobe may hold (wardrobe.MaxItems).
SELECT "id", "category", "subcategory", "colors", "pattern", "material", "sleeveLength", "fit", "style", "season",
       "gender", "formality", "createdAt"
  FROM "WardrobeItem" WHERE "userId" = sqlc.arg(user_id) ORDER BY "createdAt", "id" LIMIT sqlc.arg(row_limit);

-- name: RecentMessages :many
-- The newest messages of a conversation, the newest first.
SELECT "role", "content", "metadataJson" FROM "AiMessage"
 WHERE "conversationId" = sqlc.arg(conversation_id)
 ORDER BY "createdAt" DESC, "id" DESC LIMIT sqlc.arg(row_limit);

-- name: CreateConversation :exec
-- A new conversation; its last change is its first answer, a millisecond
-- after the user's message.
INSERT INTO "AiConversation" ("id", "userId", "title", "contextJson", "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(title), sqlc.arg(context_json), atlas_now(),
        atlas_now() + interval '1 millisecond');

-- name: TouchConversation :execrows
-- The conversation, when it is still the user's, changed with this answer.
UPDATE "AiConversation" SET "updatedAt" = atlas_now() + interval '1 millisecond'
 WHERE "id" = sqlc.arg(id) AND "userId" = sqlc.arg(user_id);

-- name: CreateMessage :exec
-- A message of the turn: the user's at the transaction's time, the answer
-- (later = 1) a millisecond after.
INSERT INTO "AiMessage" ("id", "conversationId", "role", "content", "metadataJson", "createdAt")
VALUES (sqlc.arg(id), sqlc.arg(conversation_id), sqlc.arg(role), sqlc.arg(content), sqlc.arg(metadata_json),
        atlas_now() + sqlc.arg(later)::int * interval '1 millisecond');

-- name: AnswerOfUser :one
-- A stored answer of one of the user's conversations (the replay of a
-- repeated request).
SELECT m."conversationId", m."content", m."metadataJson" FROM "AiMessage" m
  JOIN "AiConversation" c ON c."id" = m."conversationId" AND c."userId" = sqlc.arg(user_id)
 WHERE m."id" = sqlc.arg(id) AND m."role" = 'assistant';

-- name: ConversationsOfUser :many
-- The user's conversations, the latest changed first, each with its last
-- message.
SELECT c."id", c."title", c."updatedAt", last."content" AS last_content, last."role" AS last_role
  FROM "AiConversation" c
  LEFT JOIN "AiMessage" last ON last."id" = (
       SELECT m."id" FROM "AiMessage" m
        WHERE m."conversationId" = c."id"
        ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1)
 WHERE c."userId" = sqlc.arg(user_id)
 ORDER BY c."updatedAt" DESC, c."id" DESC LIMIT sqlc.arg(row_limit);

-- name: MessagesOfConversation :many
-- The newest messages of a conversation, the newest first (the caller
-- shows them oldest first).
SELECT "id", "role", "content", "createdAt" FROM "AiMessage"
 WHERE "conversationId" = sqlc.arg(conversation_id)
 ORDER BY "createdAt" DESC, "id" DESC LIMIT sqlc.arg(row_limit);
