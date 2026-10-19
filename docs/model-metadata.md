# Model information

During provider model syncing, Kairos uses the public
[models.dev](https://models.dev/) catalog to fill in model names, descriptions,
context windows, capabilities, and pricing where a reliable match exists.
Provider credentials are not sent to the catalog.

Existing provider information and custom names are preserved, and your metadata
overrides take precedence. Catalog enrichment does not change the model ID sent
to your provider or select a different model for you.

The catalog is cached for 24 hours. If it is unavailable, Kairos keeps the last
successful copy and provider syncing can continue. Some models may have no
matching catalog entry.

Prices describe the catalog's listed provider and may differ from your endpoint's
actual charges. Treat capability and context information as guidance; provider
support can differ even when model names match.
