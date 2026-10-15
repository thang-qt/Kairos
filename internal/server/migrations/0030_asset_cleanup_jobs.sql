-- Index ownership references once instead of parsing every message on each send.
CREATE TABLE chat_asset_references (
 message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE ON UPDATE CASCADE,
 asset_id TEXT NOT NULL REFERENCES chat_assets(id),
 PRIMARY KEY(message_id,asset_id)
);
CREATE INDEX idx_chat_asset_references_asset ON chat_asset_references(asset_id);
INSERT OR IGNORE INTO chat_asset_references(message_id,asset_id)
SELECT m.id,a.id FROM chat_messages m, json_each(m.content_json) p
JOIN chat_assets a ON a.id=json_extract(p.value,'$.source.assetId')
WHERE json_extract(p.value,'$.source.type')='asset';

-- Claimed jobs retain the storage location after metadata is removed, for retries.
CREATE TABLE asset_cleanup_jobs (
 asset_id TEXT PRIMARY KEY,
 backend TEXT NOT NULL,
 object_key TEXT NOT NULL,
 claimed INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_asset_cleanup_jobs_available ON asset_cleanup_jobs(available_at,asset_id);
INSERT INTO asset_cleanup_jobs(asset_id,backend,object_key)
SELECT a.id,a.backend,a.object_key FROM chat_assets a
WHERE NOT EXISTS (SELECT 1 FROM chat_asset_references r WHERE r.asset_id=a.id);

CREATE TRIGGER asset_cleanup_after_insert AFTER INSERT ON chat_assets
BEGIN
 INSERT OR IGNORE INTO asset_cleanup_jobs(asset_id,backend,object_key)
 VALUES(NEW.id,NEW.backend,NEW.object_key);
END;
CREATE TRIGGER asset_cleanup_after_reference_delete AFTER DELETE ON chat_asset_references
BEGIN
 INSERT OR IGNORE INTO asset_cleanup_jobs(asset_id,backend,object_key)
 SELECT id,backend,object_key FROM chat_assets WHERE id=OLD.asset_id;
END;
CREATE TRIGGER asset_references_after_message_insert AFTER INSERT ON chat_messages
BEGIN
 INSERT OR IGNORE INTO chat_asset_references(message_id,asset_id)
 SELECT NEW.id,a.id FROM json_each(NEW.content_json) p
 JOIN chat_assets a ON a.id=json_extract(p.value,'$.source.assetId')
 WHERE json_extract(p.value,'$.source.type')='asset';
END;
CREATE TRIGGER asset_references_after_message_update AFTER UPDATE OF content_json ON chat_messages
WHEN OLD.content_json IS NOT NEW.content_json
BEGIN
 DELETE FROM chat_asset_references WHERE message_id=OLD.id;
 INSERT OR IGNORE INTO chat_asset_references(message_id,asset_id)
 SELECT NEW.id,a.id FROM json_each(NEW.content_json) p
 JOIN chat_assets a ON a.id=json_extract(p.value,'$.source.assetId')
 WHERE json_extract(p.value,'$.source.type')='asset';
END;
-- A committed reference cancels a pending candidate immediately, so successful
-- uploads do not build up work for the janitor.
CREATE TRIGGER asset_cleanup_after_reference_insert AFTER INSERT ON chat_asset_references
BEGIN
 DELETE FROM asset_cleanup_jobs WHERE asset_id=NEW.asset_id AND claimed=0;
END;
