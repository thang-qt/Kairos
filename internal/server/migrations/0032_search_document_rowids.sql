-- Keep indexed document identifiers outside FTS; mutate FTS rows by rowid.
CREATE TABLE chat_search_documents (
 fts_rowid INTEGER PRIMARY KEY,
 session_id TEXT NOT NULL,
 message_id TEXT
);
CREATE INDEX idx_chat_search_documents_session ON chat_search_documents(session_id);
CREATE UNIQUE INDEX idx_chat_search_documents_message ON chat_search_documents(message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX idx_chat_search_documents_title ON chat_search_documents(session_id) WHERE message_id IS NULL;
INSERT INTO chat_search_documents SELECT rowid,session_id,NULLIF(message_id,'') FROM chat_session_search;
DROP TRIGGER chat_session_search_after_insert;
DROP TRIGGER chat_session_search_after_title_update;
DROP TRIGGER chat_session_search_after_delete;
DROP TRIGGER chat_session_search_after_message_insert;
DROP TRIGGER chat_session_search_after_message_delete;
DROP TRIGGER chat_session_search_after_message_update;

CREATE TRIGGER chat_session_search_after_insert AFTER INSERT ON chat_sessions
BEGIN
 INSERT INTO chat_session_search(session_id,user_id,message_id,document_kind,title,content)
 VALUES(NEW.id,NEW.user_id,'','title',coalesce(nullif(trim(NEW.label),''),nullif(trim(NEW.title),''),nullif(trim(NEW.derived_title),''),NEW.friendly_id),'');
 INSERT INTO chat_search_documents(fts_rowid,session_id) VALUES(last_insert_rowid(),NEW.id);
END;
CREATE TRIGGER chat_session_search_after_title_update AFTER UPDATE OF title,label,derived_title ON chat_sessions
WHEN coalesce(nullif(trim(OLD.label),''),nullif(trim(OLD.title),''),nullif(trim(OLD.derived_title),''),OLD.friendly_id)
 IS NOT coalesce(nullif(trim(NEW.label),''),nullif(trim(NEW.title),''),nullif(trim(NEW.derived_title),''),NEW.friendly_id)
BEGIN
 UPDATE chat_session_search SET title=coalesce(nullif(trim(NEW.label),''),nullif(trim(NEW.title),''),nullif(trim(NEW.derived_title),''),NEW.friendly_id)
 WHERE rowid=(SELECT fts_rowid FROM chat_search_documents WHERE session_id=NEW.id AND message_id IS NULL);
END;
CREATE TRIGGER chat_session_search_after_delete AFTER DELETE ON chat_sessions
BEGIN
 DELETE FROM chat_session_search WHERE rowid IN (SELECT fts_rowid FROM chat_search_documents WHERE session_id=OLD.id);
 DELETE FROM chat_search_documents WHERE session_id=OLD.id;
END;
CREATE TRIGGER chat_session_search_after_message_delete AFTER DELETE ON chat_messages
BEGIN
 DELETE FROM chat_session_search WHERE rowid=(SELECT fts_rowid FROM chat_search_documents WHERE message_id=OLD.id);
 DELETE FROM chat_search_documents WHERE message_id=OLD.id;
END;

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
AFTER UPDATE OF id, session_id, role, content_json ON chat_messages
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
