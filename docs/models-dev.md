# Synced model metadata

Kairos enriches discovered provider models from [models.dev](https://models.dev/) during model syncing, including initial discovery and background provider-model refresh. It fetches the public `https://models.dev/api.json` catalog without provider credentials, with a five-second timeout and a 16 MiB size limit. The last good catalog is stored in SQLite and reused for 24 hours. Failed refreshes retain cached metadata and back off for ten minutes; a catalog outage does not fail provider syncing. Regular model reads and chat generation use the cached catalog.

Matching first uses the configured endpoint host and an exact model ID or an explicit catalog canonical ID. This picks Hyper's own catalog entries for `https://hyper.charm.land/v1`, including its provider-specific prices and limits. Without an endpoint match, Kairos uses an unambiguous exact ID, qualified provider/model ID, or explicit shared canonical identity. Ambiguous IDs remain unenriched. It does not infer providers from user-facing labels, remove model version/quantization/context suffixes, or choose a similar model name.

The model API returns optional `catalogMetadata` with the catalog source, provider, match method, and the original model entry. That entry preserves capabilities, reasoning options, modalities, input/output/context limits, pricing, dates, and other catalog fields. Catalog prices are the listed catalog provider's prices and are not guaranteed to be the configured endpoint's current charges when the match came from another provider.

Catalog names replace empty or raw-ID names for synced models. Descriptions and context windows fill missing values. Existing provider metadata and custom names are preserved; user metadata overrides apply last. Catalog metadata does not change the model ID sent to the provider. Reasoning controls use advertised effort levels; exact endpoint matches also validate explicit reasoning efforts before the provider request. Other capabilities remain descriptive.

The catalog cache uses migration `0023_model_catalog.sql`. No provider keys are included in catalog requests or stored in this table.
