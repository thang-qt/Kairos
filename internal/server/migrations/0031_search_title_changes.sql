DROP TRIGGER chat_session_search_after_title_update;
CREATE TRIGGER chat_session_search_after_title_update
AFTER UPDATE OF title, label, derived_title ON chat_sessions
WHEN coalesce(nullif(trim(OLD.label),''),nullif(trim(OLD.title),''),nullif(trim(OLD.derived_title),''),OLD.friendly_id)
 IS NOT coalesce(nullif(trim(NEW.label),''),nullif(trim(NEW.title),''),nullif(trim(NEW.derived_title),''),NEW.friendly_id)
BEGIN
 UPDATE chat_session_search
 SET title=coalesce(nullif(trim(NEW.label),''),nullif(trim(NEW.title),''),nullif(trim(NEW.derived_title),''),NEW.friendly_id)
 WHERE session_id=NEW.id AND document_kind='title';
END;
