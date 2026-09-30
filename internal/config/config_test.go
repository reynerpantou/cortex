package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotEnv(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := "# comment\n\nCORTEX_T_A=plain\nexport CORTEX_T_B=\"quoted value\"\nCORTEX_T_C='single'\r\nCORTEX_T_D=\nCORTEX_T_E=from-file\nnot a setting\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CORTEX_T_E", "from-env")
	for _, k := range []string{"CORTEX_T_A", "CORTEX_T_B", "CORTEX_T_C", "CORTEX_T_D"} {
		os.Unsetenv(k)
		t.Cleanup(func() { os.Unsetenv(k) })
	}
	loadDotEnv(path)
	want := map[string]string{"CORTEX_T_A": "plain", "CORTEX_T_B": "quoted value", "CORTEX_T_C": "single", "CORTEX_T_D": "", "CORTEX_T_E": "from-env"}
	for k, v := range want {
		if got := os.Getenv(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	loadDotEnv(filepath.Join(t.TempDir(), "missing")) // no file: no-op
}
