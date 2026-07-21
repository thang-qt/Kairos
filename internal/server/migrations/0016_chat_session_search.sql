CREATE VIRTUAL TABLE chat_session_search USING fts5(
	session_id UNINDEXED,
	user_id UNINDEXED,
	message_id UNINDEXED,
	document_kind UNINDEXED,
	title,
	content,
	tokenize = 'unicode61'
);

INSERT INTO chat_session_search(session_id, user_id, message_id, document_kind, title, content)
SELECT
	session.id,
	session.user_id,
	'',
	'title',
	trim(coalesce(session.title, '') || ' ' || coalesce(session.label, '') || ' ' || coalesce(session.derived_title, '')),
	''
FROM chat_sessions AS session;

INSERT INTO chat_session_search(session_id, user_id, message_id, document_kind, title, content)
SELECT
	session.id,
	session.user_id,
	message.id,
	'message',
	'',
	trim(group_concat(trim(coalesce(json_extract(part.value, '$.text'), '')), ' '))
FROM chat_messages AS message
JOIN chat_sessions AS session ON session.id = message.session_id
JOIN json_each(CASE WHEN json_valid(message.content_json) THEN message.content_json ELSE '[]' END) AS part
WHERE
	message.role IN ('user', 'assistant') AND
	(
		message.role <> 'assistant' OR
		NOT EXISTS (
			SELECT 1
			FROM json_each(CASE WHEN json_valid(message.content_json) THEN message.content_json ELSE '[]' END) AS tool_part
			WHERE json_extract(tool_part.value, '$.type') = 'toolCall'
		)
	) AND
	json_extract(part.value, '$.type') = 'text' AND
	trim(coalesce(json_extract(part.value, '$.text'), '')) <> ''
GROUP BY message.id, session.id, session.user_id;

CREATE TRIGGER chat_session_search_after_insert
AFTER INSERT ON chat_sessions
BEGIN
	INSERT INTO chat_session_search(session_id, user_id, message_id, document_kind, title, content)
	VALUES (
		NEW.id,
		NEW.user_id,
		'',
		'title',
		trim(coalesce(NEW.title, '') || ' ' || coalesce(NEW.label, '') || ' ' || coalesce(NEW.derived_title, '')),
		''
	);
END;

CREATE TRIGGER chat_session_search_after_title_update
AFTER UPDATE OF title, label, derived_title ON chat_sessions
BEGIN
	UPDATE chat_session_search
	SET title = trim(coalesce(NEW.title, '') || ' ' || coalesce(NEW.label, '') || ' ' || coalesce(NEW.derived_title, ''))
	WHERE session_id = NEW.id AND document_kind = 'title';
END;

CREATE TRIGGER chat_session_search_after_delete
AFTER DELETE ON chat_sessions
BEGIN
	DELETE FROM chat_session_search
	WHERE session_id = OLD.id;
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
END;

CREATE TRIGGER chat_session_search_after_message_delete
AFTER DELETE ON chat_messages
BEGIN
	DELETE FROM chat_session_search
	WHERE message_id = OLD.id;
END;

CREATE TRIGGER chat_session_search_after_message_update
AFTER UPDATE OF id, session_id, role, content_json ON chat_messages
BEGIN
	DELETE FROM chat_session_search
	WHERE message_id = OLD.id;

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
END;
