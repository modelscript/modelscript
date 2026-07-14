package tree_sitter_csv_test

import (
	"testing"

	tree_sitter "github.com/smacker/go-tree-sitter"
	"github.com/tree-sitter/tree-sitter-csv"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_csv.Language())
	if language == nil {
		t.Errorf("Error loading Csv grammar")
	}
}
