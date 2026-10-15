-- Store content only in message_json; retain a virtual projection for SQL triggers.
DROP TRIGGER chat_session_search_after_message_insert;
DROP TRIGGER chat_session_search_after_message_update;
DROP TRIGGER asset_references_after_message_insert;
DROP TRIGGER asset_references_after_message_update;
-- Repair legacy metadata-only rows before dropping the redundant stored content.
UPDATE chat_messages SET message_json=json_set(message_json,'$.content',json(content_json))
WHERE json_type(message_json,'$.content') IS NULL;
ALTER TABLE chat_messages DROP COLUMN content_json;
ALTER TABLE chat_messages ADD COLUMN content_json TEXT
 GENERATED ALWAYS AS (coalesce(json_extract(message_json,'$.content'),'[]')) VIRTUAL;
UPDATE chat_sessions SET last_message_json=json_remove(last_message_json,'$.content','$.steps','$.details')
WHERE last_message_json IS NOT NULL AND json_valid(last_message_json);

CREATE TRIGGER chat_session_search_after_message_insert
AFTER INSERT ON chat_messages
WHEN NEW.role IN ('user', 'assistant')
BEGIN
	INSERT INTO chat_session_search(session_id, user_id, message_id, document_kind, title, content)
	SELECT
		session.id,
		session.user_id,
		NEW.id,
		'message',
		'',
		trim(group_concat(trim(coalesce(json_extract(part.value, '$.text'), '')), ' '))
	FROM chat_sessions AS session
	JOIN json_each(CASE WHEN json_valid(NEW.content_json) THEN NEW.content_json ELSE '[]' END) AS part
	WHERE
		session.id = NEW.session_id AND
		(
			NEW.role <> 'assistant' OR
			NOT EXISTS (
				SELECT 1
				FROM json_each(CASE WHEN json_valid(NEW.content_json) THEN NEW.content_json ELSE '[]' END) AS tool_part
				WHERE json_extract(tool_part.value, '$.type') = 'toolCall'
			)
		) AND
		json_extract(part.value, '$.type') = 'text' AND
		trim(coalesce(json_extract(part.value, '$.text'), '')) <> ''
	GROUP BY session.id, session.user_id;
 INSERT INTO chat_search_documents(fts_rowid,session_id,message_id)
 SELECT last_insert_rowid(),NEW.session_id,NEW.id WHERE changes()>0;
END;

CREATE TRIGGER chat_session_search_after_message_update
AFTER UPDATE OF id, session_id, role, message_json ON chat_messages
BEGIN
	DELETE FROM chat_session_search WHERE rowid=(SELECT fts_rowid FROM chat_search_documents WHERE message_id=OLD.id);
 DELETE FROM chat_search_documents WHERE message_id=OLD.id;

	INSERT INTO chat_session_search(session_id, user_id, message_id, document_kind, title, content)
	SELECT
		session.id,
		session.user_id,
		NEW.id,
		'message',
		'',
		trim(group_concat(trim(coalesce(json_extract(part.value, '$.text'), '')), ' '))
	FROM chat_sessions AS session
	JOIN json_each(CASE WHEN json_valid(NEW.content_json) THEN NEW.content_json ELSE '[]' END) AS part
	WHERE
		session.id = NEW.session_id AND
		NEW.role IN ('user', 'assistant') AND
		(
			NEW.role <> 'assistant' OR
			NOT EXISTS (
				SELECT 1
				FROM json_each(CASE WHEN json_valid(NEW.content_json) THEN NEW.content_json ELSE '[]' END) AS tool_part
				WHERE json_extract(tool_part.value, '$.type') = 'toolCall'
			)
		) AND
		json_extract(part.value, '$.type') = 'text' AND
		trim(coalesce(json_extract(part.value, '$.text'), '')) <> ''
	GROUP BY session.id, session.user_id;
 INSERT INTO chat_search_documents(fts_rowid,session_id,message_id)
 SELECT last_insert_rowid(),NEW.session_id,NEW.id WHERE changes()>0;
END;

CREATE TRIGGER asset_references_after_message_insert AFTER INSERT ON chat_messages
BEGIN
 INSERT OR IGNORE INTO chat_asset_references(message_id,asset_id)
 SELECT NEW.id,a.id FROM json_each(NEW.content_json) p
 JOIN chat_assets a ON a.id=json_extract(p.value,'$.source.assetId')
 WHERE json_extract(p.value,'$.source.type')='asset';
END;

CREATE TRIGGER asset_references_after_message_update AFTER UPDATE OF message_json ON chat_messages
WHEN OLD.content_json IS NOT NEW.content_json
BEGIN
 DELETE FROM chat_asset_references WHERE message_id=OLD.id;
 INSERT OR IGNORE INTO chat_asset_references(message_id,asset_id)
 SELECT NEW.id,a.id FROM json_each(NEW.content_json) p
 JOIN chat_assets a ON a.id=json_extract(p.value,'$.source.assetId')
 WHERE json_extract(p.value,'$.source.type')='asset';
END;
