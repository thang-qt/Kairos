CREATE INDEX idx_chat_events_revision_cursor ON chat_events(session_id,revision,sequence);
-- Readers already filter to the current revision and reconnect from full history.
DELETE FROM chat_events
WHERE revision < (SELECT revision FROM chat_sessions WHERE id=chat_events.session_id);
CREATE TRIGGER chat_events_after_revision_change
AFTER UPDATE OF revision ON chat_sessions
WHEN NEW.revision>OLD.revision
BEGIN
 DELETE FROM chat_events WHERE session_id=NEW.id AND revision<NEW.revision;
END;
