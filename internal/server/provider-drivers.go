package server

import "net/http"

const defaultProviderKind = openAIProviderKind
const openAIResponsesProviderKind = "openai-responses"

func defaultProviderDrivers() map[string]ProviderDriver {
	client := &http.Client{}
	return map[string]ProviderDriver{openAIProviderKind: &OpenAICompatibleDriver{httpClient: client}, openAIResponsesProviderKind: &OpenAICompatibleDriver{httpClient: client}}
}
