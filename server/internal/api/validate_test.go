package api

import (
	"strings"
	"testing"
)

func TestValidateShortcutFields(t *testing.T) {
	long64 := strings.Repeat("a", 65)
	long512 := strings.Repeat("/", 513)
	long255 := strings.Repeat("b", 256)
	for name, tc := range map[string]struct {
		agentID, path, label string
		wantErr              bool
	}{
		"ok":               {"a62", "/home/u/agents/generic", "favorite", false},
		"agent too long":   {long64, "/work", "", true},
		"path too long":    {"ag", long512, "", true},
		"label too long":   {"ag", "/work", long255, true},
		"multibyte counts": {"a" + strings.Repeat("界", 64), "/work", "", true}, // 65 runes, >3x that in bytes
	} {
		t.Run(name, func(t *testing.T) {
			err := validateShortcutFields(tc.agentID, tc.path, tc.label)
			if tc.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
