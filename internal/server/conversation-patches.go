package server

import (
	"reflect"
	"sort"
	"strconv"
	"strings"
)

// Paths use object keys and decimal array indices. Append carries only a new string suffix.
type TurnPatchOperation struct {
	Op    string   `json:"op"`
	Path  []string `json:"path"`
	Value any      `json:"value"`
}

func diffTurn(previous, next map[string]any) []TurnPatchOperation {
	operations := []TurnPatchOperation{}
	diffTurnValue(previous, next, []string{}, &operations)
	return operations
}

func diffTurnValue(previous, next any, path []string, operations *[]TurnPatchOperation) {
	if reflect.DeepEqual(previous, next) {
		return
	}
	child := func(key string) []string { p := append([]string{}, path...); return append(p, key) }
	if old, ok := previous.(string); ok {
		if value, ok := next.(string); ok && strings.HasPrefix(value, old) {
			*operations = append(*operations, TurnPatchOperation{Op: "append", Path: path, Value: strings.TrimPrefix(value, old)})
			return
		}
	}
	if old, ok := previous.(map[string]any); ok {
		if value, ok := next.(map[string]any); ok {
			keys := make([]string, 0, len(value)+len(old))
			for key := range value {
				keys = append(keys, key)
			}
			for key := range old {
				if _, exists := value[key]; !exists {
					keys = append(keys, key)
				}
			}
			sort.Strings(keys)
			for _, key := range keys {
				before, exists := old[key]
				after, present := value[key]
				if !present {
					*operations = append(*operations, TurnPatchOperation{Op: "remove", Path: child(key)})
					continue
				}
				if !exists {
					*operations = append(*operations, TurnPatchOperation{Op: "set", Path: child(key), Value: after})
					continue
				}
				diffTurnValue(before, after, child(key), operations)
			}
			return
		}
	}
	if old, ok := previous.([]any); ok {
		if value, ok := next.([]any); ok && len(value) >= len(old) {
			for i, before := range old {
				diffTurnValue(before, value[i], child(strconv.Itoa(i)), operations)
			}
			for i := len(old); i < len(value); i++ {
				*operations = append(*operations, TurnPatchOperation{Op: "set", Path: child(strconv.Itoa(i)), Value: value[i]})
			}
			return
		}
	}
	*operations = append(*operations, TurnPatchOperation{Op: "set", Path: path, Value: next})
}
