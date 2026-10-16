package server

import (
	"reflect"
	"strconv"
)

func cloneTurnValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, child := range typed {
			result[key] = cloneTurnValue(child)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for i, child := range typed {
			result[i] = cloneTurnValue(child)
		}
		return result
	case []map[string]any:
		result := make([]any, len(typed))
		for i, child := range typed {
			result[i] = cloneTurnValue(child)
		}
		return result
	default:
		return value
	}
}

// Only the changed step is compared. Completed tool results remain shared and
// are never serialized or traversed to produce ordinary text append patches.
func advanceRunProjection(previous map[string]any, message map[string]any) (map[string]any, []TurnPatchOperation) {
	message = cloneTurnValue(message).(map[string]any)
	next := make(map[string]any, len(previous))
	for key, value := range previous {
		next[key] = value
	}
	oldSteps, _ := previous["steps"].([]any)
	steps := append([]any(nil), oldSteps...)
	index := len(steps)
	offset := 0
	var old map[string]any
	for i, value := range steps {
		step, _ := value.(map[string]any)
		if stringValueFromMap(step, "id") == messageIDFromMap(message) {
			index = i
			old = step
			break
		}
		if stringValueFromMap(step, "role") == "assistant" {
			parts, _ := step["content"].([]any)
			offset += len(parts)
		}
	}
	var changes []TurnPatchOperation
	if old == nil {
		changes = []TurnPatchOperation{{Op: "set", Value: message}}
		steps = append(steps, message)
	} else {
		changes = diffTurn(old, message)
		steps[index] = message
	}
	next["steps"] = steps
	patches := make([]TurnPatchOperation, 0, len(changes)*2)
	for _, change := range changes {
		patches = append(patches, TurnPatchOperation{Op: change.Op, Path: append([]string{"steps", strconv.Itoa(index)}, change.Path...), Value: change.Value})
	}
	if stringValueFromMap(message, "role") == "assistant" {
		oldContent, _ := previous["content"].([]any)
		oldParts, _ := old["content"].([]any)
		parts, _ := message["content"].([]any)
		content := make([]any, 0, len(oldContent)-len(oldParts)+len(parts))
		content = append(content, oldContent[:offset]...)
		content = append(content, parts...)
		content = append(content, oldContent[offset+len(oldParts):]...)
		next["content"] = content
		if old == nil {
			for i, part := range parts {
				patches = append(patches, TurnPatchOperation{Op: "set", Path: []string{"content", strconv.Itoa(offset + i)}, Value: part})
			}
		} else {
			for _, change := range changes {
				if len(change.Path) == 0 || change.Path[0] != "content" {
					continue
				}
				if len(change.Path) == 1 {
					patches = append(patches, TurnPatchOperation{Op: "set", Path: []string{"content"}, Value: content})
				} else {
					partIndex, err := strconv.Atoi(change.Path[1])
					if err != nil {
						continue
					}
					path := append([]string{"content", strconv.Itoa(offset + partIndex)}, change.Path[2:]...)
					patches = append(patches, TurnPatchOperation{Op: change.Op, Path: path, Value: change.Value})
				}
			}
		}
		for _, key := range []string{"model", "modelName", "modelDescription", "details"} {
			value, present := message[key]
			_, existed := previous[key]
			if !present && existed {
				delete(next, key)
				patches = append(patches, TurnPatchOperation{Op: "remove", Path: []string{key}})
			} else if present && !reflect.DeepEqual(previous[key], value) {
				next[key] = value
				patches = append(patches, TurnPatchOperation{Op: "set", Path: []string{key}, Value: value})
			}
		}
	}
	return next, patches
}
