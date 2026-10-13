CREATE TABLE model_catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    catalog_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
