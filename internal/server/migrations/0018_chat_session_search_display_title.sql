DROP TRIGGER chat_session_search_after_insert;
DROP TRIGGER chat_session_search_after_title_update;

UPDATE chat_session_search
SET title = coalesce(
	nullif(trim((SELECT label FROM chat_sessions WHERE id = chat_session_search.session_id)), ''),
	nullif(trim((SELECT title FROM chat_sessions WHERE id = chat_session_search.session_id)), ''),
	nullif(trim((SELECT derived_title FROM chat_sessions WHERE id = chat_session_search.session_id)), ''),
	(SELECT friendly_id FROM chat_sessions WHERE id = chat_session_search.session_id)
)
WHERE document_kind = 'title';

CREATE TRIGGER chat_session_search_after_insert
AFTER INSERT ON chat_sessions
BEGIN
	INSERT INTO chat_session_search(session_id, user_id, message_id, document_kind, title, content)
	VALUES (
		NEW.id,
		NEW.user_id,
		'',
		'title',
		coalesce(
			nullif(trim(NEW.label), ''),
			nullif(trim(NEW.title), ''),
			nullif(trim(NEW.derived_title), ''),
			NEW.friendly_id
		),
		''
	);
END;

CREATE TRIGGER chat_session_search_after_title_update
AFTER UPDATE OF title, label, derived_title ON chat_sessions
BEGIN
	UPDATE chat_session_search
	SET title = coalesce(
		nullif(trim(NEW.label), ''),
		nullif(trim(NEW.title), ''),
		nullif(trim(NEW.derived_title), ''),
		NEW.friendly_id
	)
	WHERE session_id = NEW.id AND document_kind = 'title';
END;
